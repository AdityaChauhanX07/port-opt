//! Per-period return computations: weighted portfolio returns, equity curves,
//! drawdown series, and summary drawdown statistics.

use nalgebra::{DMatrix, DVector};

/// Compute a portfolio return series as the weighted sum of asset returns per period.
///
/// `returns` is an `(n_periods × n_assets)` matrix where each row is one period's
/// asset returns.  `weights` is an `n_assets` vector of portfolio weights.
///
/// Returns a `DVector<f64>` of length `n_periods`.
///
/// # Errors
/// Returns `Err` if `weights.len() != returns.ncols()`.
pub fn portfolio_returns(
    returns: &DMatrix<f64>,
    weights: &DVector<f64>,
) -> Result<DVector<f64>, String> {
    if returns.ncols() != weights.len() {
        return Err(format!(
            "weights length {} does not match number of assets {}",
            weights.len(),
            returns.ncols()
        ));
    }
    // (n_periods × n_assets) · (n_assets) = (n_periods)
    Ok(returns * weights)
}

/// Compound per-period returns into an equity curve starting at `start_value`.
///
/// `equity[i] = start_value · ∏_{k=0}^{i} (1 + returns[k])`
///
/// Mirrors `stats.equity_curve` in the Python reference implementation.
pub fn equity_curve(returns: &DVector<f64>, start_value: f64) -> DVector<f64> {
    let n = returns.len();
    let mut out = DVector::zeros(n);
    let mut cum = start_value;
    for i in 0..n {
        cum *= 1.0 + returns[i];
        out[i] = cum;
    }
    out
}

/// Compute the drawdown series of an equity curve.
///
/// `drawdown[i] = equity[i] / running_max[i] − 1`
///
/// Values are ≤ 0: zero at new highs, negative while underwater.
/// Mirrors `stats.drawdown_series`.
pub fn drawdown(equity: &DVector<f64>) -> DVector<f64> {
    let n = equity.len();
    let mut dd = DVector::zeros(n);
    let mut peak = f64::NEG_INFINITY;
    for i in 0..n {
        if equity[i] > peak {
            peak = equity[i];
        }
        dd[i] = equity[i] / peak - 1.0;
    }
    dd
}

/// Maximum (deepest) drawdown of an equity curve as a non-positive number.
///
/// Returns `f64::NAN` for an empty curve.
/// Mirrors `stats.max_drawdown`.
pub fn max_drawdown(equity: &DVector<f64>) -> f64 {
    if equity.len() == 0 {
        return f64::NAN;
    }
    drawdown(equity)
        .iter()
        .cloned()
        .fold(f64::INFINITY, f64::min)
}
