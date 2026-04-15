//! Covariance estimation, shrinkage, annualization, and correlation.

use nalgebra::{DMatrix, DVector};

/// Annualize per-period returns to get an annual mean vector and covariance matrix.
///
/// `returns` is `(n_periods × n_assets)`.  The sample covariance (ddof = 1)
/// is computed per pandas convention, then scaled by `ppy`.
///
/// Returns `(mu, cov)` where:
/// - `mu[j]  = mean(returns[:, j]) * ppy`
/// - `cov[i,j] = sample_cov(returns[:, i], returns[:, j]) * ppy`
///
/// Mirrors `stats.annualize_mean_cov`.
///
/// # Errors
/// Returns `Err` if the return matrix has fewer than 2 rows.
pub fn annualize(
    returns: &DMatrix<f64>,
    ppy: usize,
) -> Result<(DVector<f64>, DMatrix<f64>), String> {
    let n = returns.nrows();
    let p = returns.ncols();
    if n < 2 {
        return Err(format!(
            "need at least 2 observations to compute a covariance matrix, got {n}"
        ));
    }

    // Column means (arithmetic, ddof=0)
    let mut mu = DVector::zeros(p);
    for j in 0..p {
        mu[j] = returns.column(j).iter().sum::<f64>() / n as f64;
    }

    // Sample covariance (ddof=1)
    let denom = (n - 1) as f64;
    let mut cov = DMatrix::zeros(p, p);
    for i in 0..p {
        for j in 0..=i {
            let cov_ij: f64 = returns
                .column(i)
                .iter()
                .zip(returns.column(j).iter())
                .map(|(&xi, &xj)| (xi - mu[i]) * (xj - mu[j]))
                .sum::<f64>()
                / denom;
            cov[(i, j)] = cov_ij;
            cov[(j, i)] = cov_ij;
        }
    }

    let f = ppy as f64;
    Ok((mu * f, cov * f))
}

/// Shrink a covariance matrix toward its diagonal (constant-correlation target = 0).
///
/// `result = (1 − α) · cov + α · diag(cov)`
///
/// `alpha = 0` returns the original covariance; `alpha = 1` zeroes all
/// off-diagonal elements, retaining only variances.
///
/// Mirrors `stats.shrink_cov_to_diag`.
pub fn shrink_ledoit_wolf(cov: &DMatrix<f64>, alpha: f64) -> DMatrix<f64> {
    let p = cov.nrows();
    let mut shrunk = cov.scale(1.0 - alpha);
    for i in 0..p {
        // diagonal element becomes (1-α)*cov[i,i] + α*cov[i,i] = cov[i,i]
        shrunk[(i, i)] += alpha * cov[(i, i)];
    }
    shrunk
}

/// Compute the Pearson correlation matrix of an `(n_periods × n_assets)` return matrix.
///
/// Uses sample standard deviations (ddof = 1) consistent with the covariance estimator.
/// Assets with zero variance get `NaN` correlations (diagonal = 1.0).
///
/// Mirrors `stats.corr_matrix` / `risk.corr_matrix`.
///
/// # Errors
/// Returns `Err` if the matrix has fewer than 2 rows.
pub fn correlation(returns: &DMatrix<f64>) -> Result<DMatrix<f64>, String> {
    let n = returns.nrows();
    let p = returns.ncols();
    if n < 2 {
        return Err(format!(
            "need at least 2 observations to compute a correlation matrix, got {n}"
        ));
    }

    let denom = (n - 1) as f64;

    // Column means
    let means: Vec<f64> = (0..p)
        .map(|j| returns.column(j).iter().sum::<f64>() / n as f64)
        .collect();

    // Column standard deviations (ddof=1)
    let stds: Vec<f64> = (0..p)
        .map(|j| {
            let var = returns
                .column(j)
                .iter()
                .map(|&x| (x - means[j]).powi(2))
                .sum::<f64>()
                / denom;
            var.sqrt()
        })
        .collect();

    let mut corr = DMatrix::zeros(p, p);
    for i in 0..p {
        for j in 0..=i {
            let c = if i == j {
                1.0
            } else if stds[i] == 0.0 || stds[j] == 0.0 {
                f64::NAN
            } else {
                let cov_ij: f64 = returns
                    .column(i)
                    .iter()
                    .zip(returns.column(j).iter())
                    .map(|(&xi, &xj)| (xi - means[i]) * (xj - means[j]))
                    .sum::<f64>()
                    / denom;
                cov_ij / (stds[i] * stds[j])
            };
            corr[(i, j)] = c;
            corr[(j, i)] = c;
        }
    }
    Ok(corr)
}
