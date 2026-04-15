//! Integration tests for static and walk-forward backtests.

use engine::backtest::{static_run, walkforward_run, WalkforwardConfig};
use nalgebra::{DMatrix, DVector};

const EPS: f64 = 1e-8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a constant-return matrix: `T` rows × `n` columns.
/// Asset `j` returns `base_ret[j]` every period.
fn constant_returns(t: usize, base_ret: &[f64]) -> DMatrix<f64> {
    let n = base_ret.len();
    DMatrix::from_fn(t, n, |_, j| base_ret[j])
}

// ---------------------------------------------------------------------------
// Static backtest
// ---------------------------------------------------------------------------

/// Equity curve length must equal the number of return periods.
#[test]
fn test_static_equity_length() {
    let t = 30;
    let ret = constant_returns(t, &[0.01, 0.02, -0.005]);
    let w = DVector::from_vec(vec![1.0 / 3.0; 3]);
    let result = static_run(&ret, &w, false).expect("static backtest should succeed");
    assert_eq!(result.portfolio_equity.len(), t);
    assert_eq!(result.portfolio_returns.len(), t);
    assert_eq!(result.portfolio_dd.len(), t);
}

/// With constant positive return `r`, final equity = (1 + r)^T.
#[test]
fn test_static_known_terminal_equity() {
    let r = 0.01_f64;
    let t = 20_usize;
    let ret = constant_returns(t, &[r, r, r]);
    let w = DVector::from_vec(vec![1.0 / 3.0; 3]);
    let result = static_run(&ret, &w, false).expect("static backtest should succeed");

    let expected = (1.0 + r).powi(t as i32);
    let actual = result.portfolio_equity[t - 1];
    assert!(
        (actual - expected).abs() < EPS,
        "terminal equity {actual:.8} ≠ expected {expected:.8}"
    );
}

/// Equal-weight equity curve is included when requested.
#[test]
fn test_static_equal_weight_included() {
    let ret = constant_returns(20, &[0.01, 0.02, -0.005]);
    let w = DVector::from_vec(vec![0.5, 0.3, 0.2]);
    let result = static_run(&ret, &w, true).expect("static backtest with ew should succeed");
    assert!(result.ew_equity.is_some(), "ew_equity should be Some when include_ew=true");
    assert!(result.ew_dd.is_some());
    assert_eq!(result.ew_equity.unwrap().len(), 20);
}

/// Equal-weight equity is None when not requested.
#[test]
fn test_static_equal_weight_excluded() {
    let ret = constant_returns(10, &[0.01, 0.02]);
    let w = DVector::from_vec(vec![0.5, 0.5]);
    let result = static_run(&ret, &w, false).expect("static backtest should succeed");
    assert!(result.ew_equity.is_none());
}

/// Drawdown on monotonically increasing equity must be zero everywhere.
#[test]
fn test_static_drawdown_zero_for_monotone() {
    let ret = constant_returns(20, &[0.01, 0.01]);
    let w = DVector::from_vec(vec![0.5, 0.5]);
    let result = static_run(&ret, &w, false).expect("static backtest should succeed");
    for (t, &dd) in result.portfolio_dd.iter().enumerate() {
        assert!(dd.abs() < EPS, "drawdown at t={t} should be 0, got {dd:.8}");
    }
}

/// Dimension mismatch must return an error, not panic.
#[test]
fn test_static_dimension_mismatch() {
    let ret = constant_returns(10, &[0.01, 0.02, 0.03]);
    let w = DVector::from_vec(vec![0.5, 0.5]); // wrong length
    assert!(static_run(&ret, &w, false).is_err());
}

/// Empty returns matrix must return an error.
#[test]
fn test_static_empty_returns() {
    let ret = DMatrix::<f64>::zeros(0, 3);
    let w = DVector::from_vec(vec![1.0 / 3.0; 3]);
    assert!(static_run(&ret, &w, false).is_err());
}

// ---------------------------------------------------------------------------
// Walk-forward backtest
// ---------------------------------------------------------------------------

fn default_wf_config() -> WalkforwardConfig {
    WalkforwardConfig {
        window: 20,
        step: 5,
        tc_bps: 0.0,
        slippage_bps: 0.0,
        long_only: true,
        lb: 0.0,
        ub: 1.0,
        shrinkage_alpha: 0.1,
        n_pts: 10,
        rf: 0.0,
        ppy: 252,
    }
}

/// Walk-forward on a 60-row, 3-asset returns matrix should produce non-empty outputs.
#[test]
fn test_walkforward_basic() {
    let t = 60;
    let ret = DMatrix::from_fn(t, 3, |i, j| {
        let ti = i as f64;
        match j {
            0 => 0.001 + 0.005 * (ti * 0.3).sin(),
            1 => 0.002 + 0.010 * (ti * 0.5).cos(),
            _ => 0.001 + 0.007 * (ti * 0.7).sin(),
        }
    });

    let cfg = default_wf_config();
    let result = walkforward_run(&ret, &cfg).expect("walkforward should succeed");

    // Walk-forward period: rows 20..60 → 40 periods
    assert_eq!(result.portfolio_returns.len(), 40, "portfolio returns length");
    assert_eq!(result.portfolio_equity.len(), 40);
    assert_eq!(result.portfolio_dd.len(), 40);

    // At least one rebalance
    assert!(!result.rebalance_indices.is_empty(), "should have at least one rebalance");
    assert!(result.weights_history.nrows() > 0, "weight history should be non-empty");
    assert_eq!(result.weights_history.ncols(), 3, "weight history should have 3 asset cols");
}

/// Every row of weight history must sum to approximately 1.
#[test]
fn test_walkforward_weights_sum_to_one() {
    let t = 60;
    let ret = DMatrix::from_fn(t, 3, |i, j| 0.001 * ((i + j) as f64 * 0.4).sin() + 0.002);
    let cfg = default_wf_config();
    let result = walkforward_run(&ret, &cfg).expect("walkforward should succeed");

    for r in 0..result.weights_history.nrows() {
        let sum: f64 = (0..3).map(|c| result.weights_history[(r, c)]).sum();
        assert!(
            (sum - 1.0).abs() < 1e-6,
            "weight row {r} sums to {sum:.8}, expected 1"
        );
    }
}

/// Equal-weight equity must cover the full period (all T rows).
#[test]
fn test_walkforward_ew_equity_length() {
    let t = 60;
    let ret = constant_returns(t, &[0.005, 0.010, -0.002]);
    let cfg = default_wf_config();
    let result = walkforward_run(&ret, &cfg).expect("walkforward should succeed");

    let ew = result.ew_equity.expect("ew_equity should be Some");
    assert_eq!(ew.len(), t, "EW equity should span full period");
}

/// Equity curve must start positive and all values must be positive.
#[test]
fn test_walkforward_equity_positive() {
    let t = 60;
    let ret = DMatrix::from_fn(t, 3, |i, j| 0.003 + 0.001 * ((i * j) as f64 * 0.2).sin());
    let cfg = default_wf_config();
    let result = walkforward_run(&ret, &cfg).expect("walkforward should succeed");

    for (i, &eq) in result.portfolio_equity.iter().enumerate() {
        assert!(eq > 0.0, "equity at step {i} = {eq:.8} must be positive");
    }
}

/// Too little data for the given window+step must return an error.
#[test]
fn test_walkforward_insufficient_data() {
    let ret = constant_returns(20, &[0.01, 0.02, 0.01]); // 20 rows ≤ window+step = 25
    let cfg = default_wf_config(); // window=20, step=5
    assert!(walkforward_run(&ret, &cfg).is_err());
}

/// Transaction costs reduce return relative to zero-cost version.
#[test]
fn test_walkforward_costs_reduce_return() {
    let t = 80;
    let ret = DMatrix::from_fn(t, 3, |i, j| {
        0.002 + 0.005 * ((i as f64 * 0.4 + j as f64).sin())
    });

    let mut cfg_no_cost = default_wf_config();
    cfg_no_cost.tc_bps = 0.0;
    cfg_no_cost.slippage_bps = 0.0;

    let mut cfg_with_cost = default_wf_config();
    cfg_with_cost.tc_bps = 0.005; // 50 bps
    cfg_with_cost.slippage_bps = 0.005;

    let r_no_cost = walkforward_run(&ret, &cfg_no_cost).unwrap();
    let r_with_cost = walkforward_run(&ret, &cfg_with_cost).unwrap();

    let terminal_no_cost = r_no_cost.portfolio_equity[r_no_cost.portfolio_equity.len() - 1];
    let terminal_with_cost = r_with_cost.portfolio_equity[r_with_cost.portfolio_equity.len() - 1];

    assert!(
        terminal_with_cost <= terminal_no_cost + 1e-6,
        "costs should not improve terminal equity: {terminal_with_cost:.6} > {terminal_no_cost:.6}"
    );
}

// ---------------------------------------------------------------------------
// costs module
// ---------------------------------------------------------------------------

#[test]
fn test_flat_cost_zero_turnover() {
    let c = engine::backtest::flat_cost(0.0, 0.001, 0.0005);
    assert_eq!(c, 0.0);
}

#[test]
fn test_flat_cost_clamp() {
    // Extreme parameters → should be clamped to 0.9
    let c = engine::backtest::flat_cost(100.0, 1.0, 1.0);
    assert_eq!(c, 0.9);
}

#[test]
fn test_flat_cost_basic() {
    // turnover=0.5, tc=0.001, slip=0.0005 → cost = 0.0015 * 0.5 = 0.00075
    let c = engine::backtest::flat_cost(0.5, 0.001, 0.0005);
    assert!((c - 0.00075).abs() < 1e-10, "flat_cost = {c:.8}");
}
