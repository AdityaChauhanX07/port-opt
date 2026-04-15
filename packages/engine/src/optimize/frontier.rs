//! Efficient frontier tracing and Sharpe-ratio selection.

use nalgebra::{DMatrix, DVector};

use super::markowitz::target_return;
use crate::EngineError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// The output of [`trace`]: every feasible frontier portfolio plus summary stats.
pub struct FrontierResult {
    /// Portfolio weights.  Each row is one portfolio, columns are assets.
    /// Shape: `(n_feasible, n_assets)`.
    pub weights: DMatrix<f64>,
    /// Target returns that were actually used (one per feasible portfolio).
    pub targets: DVector<f64>,
    /// Annualised portfolio volatilities (std dev, not variance).
    pub risks: DVector<f64>,
    /// Realised expected returns `μᵀw` for each frontier portfolio.
    pub returns: DVector<f64>,
    /// Sharpe ratios `(ret − rf) / risk` for each frontier portfolio.
    pub sharpes: DVector<f64>,
    /// Index into the above slices for the max-Sharpe portfolio, if any is finite.
    pub best_idx: Option<usize>,
    /// Sharpe ratio of the best portfolio (`f64::NEG_INFINITY` when `best_idx` is `None`).
    pub best_sharpe: f64,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Sweep `n_pts` target returns from `min(μ)` to `max(μ)`, solve a QP at each
/// target, filter infeasible/numerical failures, then compute Sharpe ratios and
/// pick the best.
///
/// Mirrors `opt.trace_efficient_frontier` + `opt.pick_max_sharpe`.
///
/// # Errors
/// Returns [`EngineError::InfeasibleProblem`] when *no* target is feasible.
/// Returns [`EngineError::InvalidInput`] when `n_pts == 0`.
pub fn trace(
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    n_pts: usize,
    long_only: bool,
    lb: f64,
    ub: f64,
    rf: f64,
) -> Result<FrontierResult, EngineError> {
    if n_pts == 0 {
        return Err(EngineError::InvalidInput("n_pts must be ≥ 1".into()));
    }
    let n = mu.len();

    let mu_min = mu.iter().cloned().fold(f64::INFINITY, f64::min);
    let mu_max = mu.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    // Avoid zero-width range (all assets have identical expected returns).
    let range = if (mu_max - mu_min).abs() < 1e-12 {
        1e-6
    } else {
        mu_max - mu_min
    };

    // Linspace from mu_min to mu_min + range.
    let targets: Vec<f64> = if n_pts == 1 {
        vec![mu_min]
    } else {
        (0..n_pts)
            .map(|i| mu_min + (i as f64 / (n_pts - 1) as f64) * range)
            .collect()
    };

    let mut good_weights: Vec<DVector<f64>> = Vec::new();
    let mut good_targets: Vec<f64> = Vec::new();

    for &t in &targets {
        match target_return(mu, cov, t, long_only, lb, ub) {
            Ok(w) if w.iter().all(|x| x.is_finite()) => {
                good_weights.push(w);
                good_targets.push(t);
            }
            _ => { /* skip infeasible / numerical failure / NaN weights */ }
        }
    }

    if good_weights.is_empty() {
        return Err(EngineError::InfeasibleProblem);
    }

    let k = good_weights.len(); // number of feasible portfolios

    // Build output matrices.
    let mut weights_mat = DMatrix::zeros(k, n);
    let mut risks = DVector::zeros(k);
    let mut returns_vec = DVector::zeros(k);
    let mut sharpes = DVector::zeros(k);

    for i in 0..k {
        let w = &good_weights[i];

        // Copy weights row.
        for j in 0..n {
            weights_mat[(i, j)] = w[j];
        }

        // Portfolio return: μᵀw
        let ret: f64 = w.dot(mu);

        // Portfolio variance: wᵀΣw  (element-wise to avoid borrow issues)
        let var: f64 = {
            let mut v = 0.0;
            for j1 in 0..n {
                for j2 in 0..n {
                    v += w[j1] * cov[(j1, j2)] * w[j2];
                }
            }
            v.max(0.0) // clamp tiny numerical negatives
        };
        let vol = var.sqrt();
        let sharpe = if vol > 0.0 { (ret - rf) / vol } else { f64::NAN };

        returns_vec[i] = ret;
        risks[i] = vol;
        sharpes[i] = sharpe;
    }

    let (best_idx, best_sharpe) = best_sharpe_idx(&sharpes);

    Ok(FrontierResult {
        weights: weights_mat,
        targets: DVector::from_vec(good_targets),
        risks,
        returns: returns_vec,
        sharpes,
        best_idx,
        best_sharpe,
    })
}

/// Given pre-computed frontier weights (`k × n`), find the max-Sharpe portfolio.
///
/// Returns `(Some(idx), best_sharpe)` or `(None, f64::NEG_INFINITY)`.
/// Mirrors `opt.pick_max_sharpe`.
pub fn max_sharpe(
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    rf: f64,
    frontier_weights: &DMatrix<f64>,
) -> (Option<usize>, f64) {
    let k = frontier_weights.nrows();
    let n = mu.len();
    let mut best_idx: Option<usize> = None;
    let mut best = f64::NEG_INFINITY;

    for i in 0..k {
        let ret: f64 = (0..n).map(|j| frontier_weights[(i, j)] * mu[j]).sum();
        let var: f64 = {
            let mut v = 0.0;
            for j1 in 0..n {
                for j2 in 0..n {
                    v += frontier_weights[(i, j1)] * cov[(j1, j2)] * frontier_weights[(i, j2)];
                }
            }
            v.max(0.0)
        };
        if var <= 0.0 {
            continue;
        }
        let vol = var.sqrt();
        let s = (ret - rf) / vol;
        if s.is_finite() && s > best {
            best = s;
            best_idx = Some(i);
        }
    }

    (best_idx, best)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn best_sharpe_idx(sharpes: &DVector<f64>) -> (Option<usize>, f64) {
    let mut best_idx = None;
    let mut best = f64::NEG_INFINITY;
    for (i, &s) in sharpes.iter().enumerate() {
        if s.is_finite() && s > best {
            best = s;
            best_idx = Some(i);
        }
    }
    (best_idx, best)
}
