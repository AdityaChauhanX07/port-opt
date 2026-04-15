//! Historical Value-at-Risk and Conditional Value-at-Risk (Expected Shortfall).

use nalgebra::DVector;

/// Historical VaR and CVaR for a long portfolio at confidence level `alpha`.
///
/// Both quantities are returned as **positive** numbers representing losses:
///
/// - `VaR  = −quantile(returns, 1 − alpha)`
/// - `CVaR = −mean(returns | returns ≤ quantile)`
///
/// The quantile is computed with linear interpolation (NumPy default).
///
/// Mirrors `risk.var_cvar_historical`.
///
/// # Errors
/// Returns `Err` if `returns` is empty or `alpha` is not in `(0, 1)`.
pub fn historical_var_cvar(
    returns: &DVector<f64>,
    alpha: f64,
) -> Result<(f64, f64), String> {
    if returns.len() == 0 {
        return Err("return series is empty".to_string());
    }
    if !(alpha > 0.0 && alpha < 1.0) {
        return Err(format!("alpha must be in (0, 1), got {alpha}"));
    }

    let mut sorted: Vec<f64> = returns.iter().cloned().collect();
    // partial_cmp is safe here because we don't expect NaN in production data;
    // if NaN is present it will sort to the end which is acceptable behaviour.
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    // quantile at p = 1 − alpha (lower tail)
    let q = linear_quantile(&sorted, 1.0 - alpha);

    let var = -q; // positive loss

    let tail: Vec<f64> = sorted.iter().filter(|&&r| r <= q).cloned().collect();
    let cvar = if tail.is_empty() {
        f64::NAN
    } else {
        -tail.iter().sum::<f64>() / tail.len() as f64
    };

    Ok((var, cvar))
}

/// Linear-interpolation quantile, matching `numpy.quantile` default behaviour.
fn linear_quantile(sorted: &[f64], p: f64) -> f64 {
    let n = sorted.len();
    debug_assert!(n >= 1);
    if n == 1 {
        return sorted[0];
    }
    let idx = p * (n - 1) as f64;
    let lo = idx.floor() as usize;
    let hi = (idx.ceil() as usize).min(n - 1);
    let frac = idx - lo as f64;
    sorted[lo] * (1.0 - frac) + sorted[hi] * frac
}
