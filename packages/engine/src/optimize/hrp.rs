//! Hierarchical Risk Parity (HRP) portfolio construction.
//!
//! Full pipeline (mirroring López de Prado 2016):
//!
//! 1. Compute sample correlation and covariance from a returns matrix.
//! 2. Build a correlation-based distance: `d_ij = √(0.5 · (1 − ρ_ij))`.
//! 3. Single-linkage hierarchical clustering on the distance matrix.
//! 4. Quasi-diagonalisation: recover the leaf order implied by the dendrogram.
//! 5. Recursive bisection: allocate weights by inverse-variance splitting.

use nalgebra::{DMatrix, DVector};

use crate::EngineError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A row of the linkage matrix produced by [`cluster`].
/// Fields: `(left_id, right_id, distance, cluster_size)`.
/// Original leaves have IDs `0..n`; merged clusters use IDs `n..2n-2`.
pub type LinkageRow = (usize, usize, f64, usize);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// López de Prado correlation distance: `d_ij = √(0.5 · (1 − ρ_ij))`.
///
/// Values in `[0, 1]`. Input should be a correlation matrix (diagonal ≈ 1).
pub fn correlation_distance(corr: &DMatrix<f64>) -> DMatrix<f64> {
    DMatrix::from_fn(corr.nrows(), corr.ncols(), |i, j| {
        let rho = corr[(i, j)].clamp(-1.0, 1.0);
        (0.5 * (1.0 - rho)).sqrt()
    })
}

/// Single-linkage hierarchical clustering on a square distance matrix.
///
/// Returns a linkage list of length `n-1`, each entry
/// `(left_cluster, right_cluster, merge_distance, new_cluster_size)`.
/// Original asset indices are `0..n`; merged cluster IDs start at `n`.
pub fn cluster(dist: &DMatrix<f64>) -> Vec<LinkageRow> {
    let n = dist.nrows();
    assert_eq!(n, dist.ncols(), "distance matrix must be square");

    if n <= 1 {
        return Vec::new();
    }

    // We maintain inter-cluster distances in a flat structure.
    // Capacity: up to 2n-1 clusters (n leaves + n-1 merges).
    let total = 2 * n - 1;
    let mut d = vec![f64::INFINITY; total * total];

    // Initialise with original pairwise distances.
    for i in 0..n {
        for j in 0..n {
            d[i * total + j] = dist[(i, j)];
        }
    }

    let mut active: Vec<usize> = (0..n).collect();
    let mut sizes: Vec<usize> = vec![1; total];
    let mut linkage: Vec<LinkageRow> = Vec::with_capacity(n - 1);

    let mut next_id = n; // next merged-cluster ID

    for _ in 0..(n - 1) {
        // Find the active pair with minimum distance.
        let mut min_d = f64::INFINITY;
        let mut min_i = 0;
        let mut min_j = 1;

        for a in 0..active.len() {
            for b in (a + 1)..active.len() {
                let ci = active[a];
                let cj = active[b];
                let dij = d[ci * total + cj];
                if dij < min_d {
                    min_d = dij;
                    min_i = a;
                    min_j = b;
                }
            }
        }

        let ci = active[min_i];
        let cj = active[min_j];
        let new_size = sizes[ci] + sizes[cj];
        sizes[next_id] = new_size;

        linkage.push((ci, cj, min_d, new_size));

        // Single-linkage update: dist(new, k) = min(dist(ci, k), dist(cj, k))
        for &ck in &active {
            if ck == ci || ck == cj {
                continue;
            }
            let dik = d[ci * total + ck];
            let djk = d[cj * total + ck];
            let dnew = dik.min(djk);
            d[next_id * total + ck] = dnew;
            d[ck * total + next_id] = dnew;
        }

        // Remove merged clusters, add new one.
        // Remove larger index first to keep min_i/min_j valid.
        active.remove(min_j);
        active.remove(min_i);
        active.push(next_id);
        next_id += 1;
    }

    linkage
}

/// Compute HRP weights for `returns` (T × n matrix, rows = observations, cols = assets).
///
/// `tickers` is used only for length validation; the returned vector is in the
/// same column order as `returns`.
///
/// # Errors
/// Returns [`EngineError::InvalidInput`] for degenerate inputs (< 2 assets, etc.).
pub fn solve(returns: &DMatrix<f64>, tickers: &[String]) -> Result<DVector<f64>, EngineError> {
    let t_rows = returns.nrows();
    let n = returns.ncols();

    if n < 2 {
        return Err(EngineError::InvalidInput(
            "HRP requires at least 2 assets".into(),
        ));
    }
    if t_rows < 2 {
        return Err(EngineError::InvalidInput(
            "HRP requires at least 2 return observations".into(),
        ));
    }
    if !tickers.is_empty() && tickers.len() != n {
        return Err(EngineError::InvalidInput(
            "tickers length does not match returns columns".into(),
        ));
    }

    // -----------------------------------------------------------------------
    // Step 1: sample mean, covariance, correlation (ddof = 1)
    // -----------------------------------------------------------------------
    let mu: DVector<f64> = DVector::from_fn(n, |j, _| {
        returns.column(j).iter().sum::<f64>() / t_rows as f64
    });

    let cov = sample_cov(returns, &mu, t_rows, n);
    let corr = cov_to_corr(&cov);

    // -----------------------------------------------------------------------
    // Step 2-3: distance → single-linkage clustering
    // -----------------------------------------------------------------------
    let dist = correlation_distance(&corr);
    let link = cluster(&dist);

    // -----------------------------------------------------------------------
    // Step 4: quasi-diagonalisation
    // -----------------------------------------------------------------------
    let sort_ix = quasi_diag(&link, n);

    // -----------------------------------------------------------------------
    // Step 5: recursive bisection
    // -----------------------------------------------------------------------
    let raw_w = recursive_bisection(&cov, &sort_ix);

    // Map sort_ix positions back to original asset order.
    let mut weights = vec![0.0f64; n];
    for (pos, &asset) in sort_ix.iter().enumerate() {
        weights[asset] = raw_w[pos];
    }

    Ok(DVector::from_vec(weights))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Compute ddof=1 sample covariance (n × n) from a returns matrix.
fn sample_cov(returns: &DMatrix<f64>, mu: &DVector<f64>, t: usize, n: usize) -> DMatrix<f64> {
    let denom = (t - 1) as f64;
    DMatrix::from_fn(n, n, |i, j| {
        let s: f64 = (0..t)
            .map(|k| (returns[(k, i)] - mu[i]) * (returns[(k, j)] - mu[j]))
            .sum();
        s / denom
    })
}

/// Convert a covariance matrix to a correlation matrix.
fn cov_to_corr(cov: &DMatrix<f64>) -> DMatrix<f64> {
    let n = cov.nrows();
    let std: Vec<f64> = (0..n).map(|i| cov[(i, i)].max(0.0).sqrt()).collect();
    DMatrix::from_fn(n, n, |i, j| {
        let denom = std[i] * std[j];
        if denom < 1e-12 { 0.0 } else { (cov[(i, j)] / denom).clamp(-1.0, 1.0) }
    })
}

/// Recover the leaf order from the linkage list (quasi-diagonalisation).
///
/// Iterative stack-based port of Python's `_quasi_diag`.
fn quasi_diag(link: &[LinkageRow], n: usize) -> Vec<usize> {
    if link.is_empty() {
        return vec![0];
    }

    let mut order: Vec<usize> = Vec::with_capacity(n);
    // Start from the root (last merged cluster); push its two children.
    let last = link.last().unwrap();
    let mut stack = vec![last.0, last.1];

    while let Some(node) = stack.pop() {
        if node < n {
            // Leaf node — emit it.
            order.push(node);
        } else {
            let idx = node - n;
            // Push right child first so left is processed first (LIFO).
            stack.push(link[idx].1);
            stack.push(link[idx].0);
        }
    }

    order
}

/// Equal-weight variance of a sub-portfolio defined by `indices`.
fn cluster_var(cov: &DMatrix<f64>, indices: &[usize]) -> f64 {
    let k = indices.len() as f64;
    let mut var = 0.0;
    for &i in indices {
        for &j in indices {
            var += cov[(i, j)];
        }
    }
    // w = ones/k, var = wᵀ Σ w = Σᵢⱼ cov[i,j] / k²
    var / (k * k)
}

/// Allocate weights by recursive bisection (inverse-variance split).
///
/// Returns weights aligned to the `sort_ix` ordering (position → weight).
/// Port of Python's `_recursive_bisection`.
fn recursive_bisection(cov: &DMatrix<f64>, sort_ix: &[usize]) -> Vec<f64> {
    let m = sort_ix.len();
    let mut weights = vec![1.0f64; m];
    // Each cluster is a Vec of *position* indices into sort_ix (not asset IDs).
    let mut clusters: Vec<Vec<usize>> = vec![(0..m).collect()];

    while let Some(cluster) = clusters.pop() {
        if cluster.len() < 2 {
            continue;
        }

        let mid = cluster.len() / 2;
        let left: Vec<usize> = cluster[..mid].to_vec();
        let right: Vec<usize> = cluster[mid..].to_vec();

        let left_assets: Vec<usize> = left.iter().map(|&i| sort_ix[i]).collect();
        let right_assets: Vec<usize> = right.iter().map(|&i| sort_ix[i]).collect();

        let var_l = cluster_var(cov, &left_assets);
        let var_r = cluster_var(cov, &right_assets);
        let total = var_l + var_r;

        // alpha = fraction allocated to the right sub-cluster.
        // (lower-variance cluster receives more weight)
        let alpha = if total > 0.0 {
            1.0 - var_l / total
        } else {
            0.5
        };

        for &i in &left {
            weights[i] *= alpha;
        }
        for &i in &right {
            weights[i] *= 1.0 - alpha;
        }

        clusters.push(left);
        clusters.push(right);
    }

    let sum: f64 = weights.iter().sum();
    if sum > 0.0 {
        weights.iter_mut().for_each(|w| *w /= sum);
    }
    weights
}
