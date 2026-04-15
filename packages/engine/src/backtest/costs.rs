//! Transaction cost and slippage models.

/// Compute the total cost rate for a rebalance event.
///
/// `tc_bps` and `slippage_bps` are in decimal form (e.g. 0.0005 = 5 bps),
/// matching the Python convention.  `turnover` is the sum of absolute weight
/// changes: `Σ |w_new_i − w_old_i|`.
///
/// The result is clamped to `[0, 0.9]` to prevent runaway values.
pub fn flat_cost(turnover: f64, tc_bps: f64, slippage_bps: f64) -> f64 {
    ((tc_bps + slippage_bps) * turnover).clamp(0.0, 0.9)
}
