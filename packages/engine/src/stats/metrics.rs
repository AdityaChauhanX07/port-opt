//! Portfolio-level performance metrics: return, volatility, Sharpe, CAGR, annualized stats.

use nalgebra::{DMatrix, DVector};

/// Annualized portfolio performance metrics.
#[derive(Debug, Clone)]
pub struct PortfolioMetrics {
    /// Annualized expected return: `w · μ`
    pub ret: f64,
    /// Annualized volatility: `√(wᵀ Σ w)`
    pub vol: f64,
    /// Sharpe ratio: `(ret − rf) / vol`.  `NaN` when `vol = 0`.
    pub sharpe: f64,
}

/// Compute annualized portfolio return, volatility, and Sharpe ratio.
///
/// - `weights`: portfolio weight vector (n_assets)
/// - `mu`: annualized expected return vector (n_assets)
/// - `cov`: annualized covariance matrix (n_assets × n_assets)
/// - `rf`: annual risk-free rate
///
/// Mirrors `stats.portfolio_metrics`.
///
/// # Errors
/// Returns `Err` on dimension mismatch or negative implied variance.
pub fn portfolio_metrics(
    weights: &DVector<f64>,
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    rf: f64,
) -> Result<PortfolioMetrics, String> {
    let n = weights.len();
    if mu.len() != n {
        return Err(format!(
            "mu length {} != weights length {}",
            mu.len(),
            n
        ));
    }
    if cov.nrows() != n || cov.ncols() != n {
        return Err(format!(
            "cov is {}×{} but expected {n}×{n}",
            cov.nrows(),
            cov.ncols()
        ));
    }

    let ret = weights.dot(mu);

    // vol² = wᵀ Σ w
    let cov_w: DVector<f64> = cov * weights;
    let vol_sq = weights.dot(&cov_w);
    if vol_sq < -1e-12 {
        return Err(format!("negative implied variance {vol_sq:.3e}"));
    }
    let vol = vol_sq.max(0.0).sqrt();
    let sharpe = if vol > 0.0 { (ret - rf) / vol } else { f64::NAN };

    Ok(PortfolioMetrics { ret, vol, sharpe })
}

/// Compound annual growth rate from an equity curve.
///
/// `cagr = (equity[−1] / equity[0]) ^ (ppy / n) − 1`
///
/// where `n = equity.len()` (number of periods in the curve).
/// Mirrors `stats.cagr_from_equity`.
///
/// Returns `f64::NAN` for curves shorter than 2 elements or a zero start value.
pub fn cagr(equity: &DVector<f64>, ppy: usize) -> f64 {
    let n = equity.len();
    if n < 2 {
        return f64::NAN;
    }
    let start = equity[0];
    let end = equity[n - 1];
    if start <= 0.0 || ppy == 0 {
        return f64::NAN;
    }
    let years = n as f64 / ppy as f64;
    (end / start).powf(1.0 / years) - 1.0
}

/// Annualized arithmetic return and volatility estimated from an equity curve.
///
/// Derives per-period returns via `equity[i+1]/equity[i] − 1` (equivalent to
/// pandas `pct_change().dropna()`), then scales:
///
/// `ann_return = mean(rets) * ppy`
/// `ann_vol    = std(rets, ddof=1) * √ppy`
///
/// Mirrors `stats.ann_return_vol_from_equity`.
///
/// Returns `(NaN, NaN)` for curves with fewer than 2 elements.
pub fn ann_return_vol(equity: &DVector<f64>, ppy: usize) -> (f64, f64) {
    let n = equity.len();
    if n < 2 {
        return (f64::NAN, f64::NAN);
    }

    let rets: Vec<f64> = (0..n - 1).map(|i| equity[i + 1] / equity[i] - 1.0).collect();
    let m = rets.len();
    if m < 2 {
        // single-observation rets → std(ddof=1) is undefined, return NaN for vol
        let ann_ret = rets[0] * ppy as f64;
        return (ann_ret, f64::NAN);
    }
    let m_f = m as f64;
    let mean_r = rets.iter().sum::<f64>() / m_f;
    // ddof = 1 (matches pandas)
    let var_r = rets.iter().map(|&r| (r - mean_r).powi(2)).sum::<f64>() / (m_f - 1.0);

    let f = ppy as f64;
    (mean_r * f, var_r.sqrt() * f.sqrt())
}
