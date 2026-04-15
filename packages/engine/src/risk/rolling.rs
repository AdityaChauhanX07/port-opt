//! Rolling Sharpe and Sortino ratios.

use nalgebra::DVector;

/// Rolling Sharpe ratio over a sliding `window` of periods.
///
/// At each position `i ≥ window − 1`:
///
/// `sharpe[i] = mean(excess[i−window+1 .. i]) / std(excess, ddof=1)`
///
/// where `excess = returns − rf_per_period`.
///
/// The first `window − 1` elements are `NaN`.  If the excess returns in a
/// window are constant (std = 0) that window also yields `NaN`.
///
/// Mirrors `risk.rolling_sharpe`.
pub fn rolling_sharpe(
    returns: &DVector<f64>,
    rf_per_period: f64,
    window: usize,
) -> DVector<f64> {
    let n = returns.len();
    let mut out = DVector::from_element(n, f64::NAN);

    if window == 0 || window > n {
        return out;
    }

    for i in (window - 1)..n {
        let start = i + 1 - window;
        let excess: Vec<f64> = (start..=i).map(|k| returns[k] - rf_per_period).collect();
        let mean = excess.iter().sum::<f64>() / window as f64;
        // ddof = 1
        let var = excess.iter().map(|&x| (x - mean).powi(2)).sum::<f64>()
            / (window as f64 - 1.0);
        let std = var.sqrt();
        out[i] = if std > 0.0 { mean / std } else { f64::NAN };
    }
    out
}

/// Rolling Sortino ratio over a sliding `window` of periods.
///
/// At each position `i ≥ window − 1`:
///
/// `sortino[i] = mean(excess) / downside_std(excess, ddof=1)`
///
/// where `downside_std` uses only the elements of `excess` that are strictly
/// negative (matching `risk.rolling_sortino` which filters `x < 0`).
///
/// Returns `NaN` when there are fewer than 2 negative excess returns in the
/// window (insufficient data for ddof = 1), or when the downside std is zero.
///
/// The first `window − 1` elements are `NaN`.
///
/// Mirrors `risk.rolling_sortino`.
pub fn rolling_sortino(
    returns: &DVector<f64>,
    rf_per_period: f64,
    window: usize,
) -> DVector<f64> {
    let n = returns.len();
    let mut out = DVector::from_element(n, f64::NAN);

    if window == 0 || window > n {
        return out;
    }

    for i in (window - 1)..n {
        let start = i + 1 - window;
        let excess: Vec<f64> = (start..=i).map(|k| returns[k] - rf_per_period).collect();
        let mean = excess.iter().sum::<f64>() / window as f64;

        let downside: Vec<f64> = excess.iter().filter(|&&x| x < 0.0).cloned().collect();
        if downside.len() < 2 {
            // pandas std(ddof=1) of ≤1 element is NaN → propagate NaN
            continue;
        }
        let d_mean = downside.iter().sum::<f64>() / downside.len() as f64;
        let d_var = downside.iter().map(|&x| (x - d_mean).powi(2)).sum::<f64>()
            / (downside.len() as f64 - 1.0);
        let d_std = d_var.sqrt();
        out[i] = if d_std > 0.0 { mean / d_std } else { f64::NAN };
    }
    out
}
