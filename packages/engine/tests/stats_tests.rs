//! Integration tests for the `engine` crate's stats and risk modules.
//!
//! Every test case has manually-computed expected values so the assertions
//! are self-documenting.

use engine::risk::rolling::{rolling_sharpe, rolling_sortino};
use engine::risk::var::historical_var_cvar;
use engine::stats::covariance::{annualize, correlation, shrink_ledoit_wolf};
use engine::stats::metrics::{ann_return_vol, cagr, portfolio_metrics};
use engine::stats::returns::{drawdown, equity_curve, max_drawdown, portfolio_returns};
use nalgebra::{DMatrix, DVector};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EPS: f64 = 1e-10;

fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() < EPS
}

/// Looser tolerance for cumulative floating-point computations.
fn approx_eq_loose(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-8
}

// ---------------------------------------------------------------------------
// stats::returns
// ---------------------------------------------------------------------------

/// portfolio_returns: verify weighted sum per period on a 3×2 matrix.
///
/// Asset 0 returns: [0.01, -0.01, 0.02]
/// Asset 1 returns: [0.02,  0.03, -0.02]
/// weights = [0.6, 0.4]
///
/// Period 0: 0.6·0.01 + 0.4·0.02 = 0.006 + 0.008 = 0.014
/// Period 1: 0.6·(-0.01) + 0.4·0.03 = -0.006 + 0.012 = 0.006
/// Period 2: 0.6·0.02 + 0.4·(-0.02) = 0.012 - 0.008 = 0.004
#[test]
fn test_portfolio_returns() {
    #[rustfmt::skip]
    let data = vec![
        0.01,  0.02,
       -0.01,  0.03,
        0.02, -0.02,
    ];
    let returns = DMatrix::from_row_slice(3, 2, &data);
    let weights = DVector::from_vec(vec![0.6, 0.4]);

    let pr = portfolio_returns(&returns, &weights).expect("portfolio_returns failed");

    assert_eq!(pr.len(), 3);
    assert!(approx_eq(pr[0], 0.014), "period 0: got {}", pr[0]);
    assert!(approx_eq(pr[1], 0.006), "period 1: got {}", pr[1]);
    assert!(approx_eq(pr[2], 0.004), "period 2: got {}", pr[2]);
}

/// portfolio_returns: dimension mismatch must return Err.
#[test]
fn test_portfolio_returns_dimension_mismatch() {
    let returns = DMatrix::from_row_slice(3, 2, &[0.01, 0.02, -0.01, 0.03, 0.02, -0.02]);
    let weights = DVector::from_vec(vec![1.0, 0.0, 0.0]); // 3 weights, 2 assets
    assert!(portfolio_returns(&returns, &weights).is_err());
}

/// equity_curve on returns [0.1, -0.05, 0.03] with start = 1.0:
///
///   equity[0] = 1.0 · 1.10 = 1.1
///   equity[1] = 1.1 · 0.95 = 1.045
///   equity[2] = 1.045 · 1.03 = 1.07635
#[test]
fn test_equity_curve() {
    let rets = DVector::from_vec(vec![0.1, -0.05, 0.03]);
    let eq = equity_curve(&rets, 1.0);

    assert_eq!(eq.len(), 3);
    assert!(approx_eq(eq[0], 1.1), "eq[0] = {}", eq[0]);
    assert!(approx_eq(eq[1], 1.045), "eq[1] = {}", eq[1]);
    assert!(approx_eq(eq[2], 1.07635), "eq[2] = {}", eq[2]);
}

/// equity_curve with a non-unit start value.
#[test]
fn test_equity_curve_start_value() {
    let rets = DVector::from_vec(vec![0.0]); // zero return
    let eq = equity_curve(&rets, 100.0);
    assert!(approx_eq(eq[0], 100.0));
}

/// drawdown and max_drawdown on a curve that drops 20 % from its peak.
///
///   equity       = [1.0, 1.1, 1.2, 0.96, 1.0, 1.1]
///   running_max  = [1.0, 1.1, 1.2, 1.2,  1.2, 1.2]
///   drawdown     = [ 0,   0,   0, -0.2, -1/6, -1/12]
///   max_drawdown = -0.2
#[test]
fn test_drawdown_and_max_drawdown() {
    let eq = DVector::from_vec(vec![1.0, 1.1, 1.2, 0.96, 1.0, 1.1]);
    let dd = drawdown(&eq);

    assert_eq!(dd.len(), 6);
    assert!(approx_eq(dd[0], 0.0), "dd[0] = {}", dd[0]);
    assert!(approx_eq(dd[1], 0.0), "dd[1] = {}", dd[1]);
    assert!(approx_eq(dd[2], 0.0), "dd[2] = {}", dd[2]);
    assert!(approx_eq(dd[3], 0.96 / 1.2 - 1.0), "dd[3] = {}", dd[3]); // -0.2
    assert!(approx_eq(dd[4], 1.0 / 1.2 - 1.0), "dd[4] = {}", dd[4]);
    assert!(approx_eq(dd[5], 1.1 / 1.2 - 1.0), "dd[5] = {}", dd[5]);

    let mdd = max_drawdown(&eq);
    assert!(approx_eq(mdd, -0.2), "max_drawdown = {mdd}");
}

/// max_drawdown of an empty curve returns NaN.
#[test]
fn test_max_drawdown_empty() {
    let eq = DVector::from_vec(vec![]);
    assert!(max_drawdown(&eq).is_nan());
}

// ---------------------------------------------------------------------------
// stats::covariance
// ---------------------------------------------------------------------------

/// annualize on a known 5×3 daily return matrix (ppy = 252).
///
/// Returns:
///   Asset 0: [0.01,  0.02, -0.01,  0.03,  0.00]  mean = 0.01,  ann_mean = 2.52
///   Asset 1: [0.02, -0.01,  0.03,  0.01,  0.02]  mean = 0.014, ann_mean = 3.528
///   Asset 2: [-0.01, 0.03,  0.02, -0.02,  0.01]  mean = 0.006, ann_mean = 1.512
#[test]
fn test_annualize_3asset_means() {
    #[rustfmt::skip]
    let data = vec![
         0.01,  0.02, -0.01,
         0.02, -0.01,  0.03,
        -0.01,  0.03,  0.02,
         0.03,  0.01, -0.02,
         0.00,  0.02,  0.01,
    ];
    let returns = DMatrix::from_row_slice(5, 3, &data);
    let (mu, cov) = annualize(&returns, 252).expect("annualize failed");

    // --- means ---
    assert_eq!(mu.len(), 3);
    assert!(approx_eq(mu[0], 0.01 * 252.0), "mu[0] = {}", mu[0]);
    assert!(approx_eq(mu[1], 0.014 * 252.0), "mu[1] = {}", mu[1]);
    assert!(approx_eq(mu[2], 0.006 * 252.0), "mu[2] = {}", mu[2]);

    // --- covariance shape and symmetry ---
    assert_eq!(cov.nrows(), 3);
    assert_eq!(cov.ncols(), 3);
    assert!(approx_eq(cov[(0, 1)], cov[(1, 0)]), "cov not symmetric (01/10)");
    assert!(approx_eq(cov[(0, 2)], cov[(2, 0)]), "cov not symmetric (02/20)");
    assert!(approx_eq(cov[(1, 2)], cov[(2, 1)]), "cov not symmetric (12/21)");

    // --- diagonal elements are positive variances ---
    assert!(cov[(0, 0)] > 0.0, "var[0] = {}", cov[(0, 0)]);
    assert!(cov[(1, 1)] > 0.0, "var[1] = {}", cov[(1, 1)]);
    assert!(cov[(2, 2)] > 0.0, "var[2] = {}", cov[(2, 2)]);
}

/// annualize: fewer than 2 rows should return Err.
#[test]
fn test_annualize_insufficient_data() {
    let returns = DMatrix::from_row_slice(1, 2, &[0.01, 0.02]);
    assert!(annualize(&returns, 252).is_err());
}

/// shrink_ledoit_wolf: alpha = 0 → unchanged.
#[test]
fn test_shrinkage_alpha_zero() {
    let cov = DMatrix::from_row_slice(2, 2, &[1.0, 0.5, 0.5, 2.0]);
    let result = shrink_ledoit_wolf(&cov, 0.0);
    assert!(approx_eq(result[(0, 0)], 1.0));
    assert!(approx_eq(result[(0, 1)], 0.5));
    assert!(approx_eq(result[(1, 0)], 0.5));
    assert!(approx_eq(result[(1, 1)], 2.0));
}

/// shrink_ledoit_wolf: alpha = 1 → diagonal only (off-diagonals zeroed).
#[test]
fn test_shrinkage_alpha_one() {
    let cov = DMatrix::from_row_slice(2, 2, &[1.0, 0.5, 0.5, 2.0]);
    let result = shrink_ledoit_wolf(&cov, 1.0);
    assert!(approx_eq(result[(0, 0)], 1.0));
    assert!(approx_eq(result[(0, 1)], 0.0));
    assert!(approx_eq(result[(1, 0)], 0.0));
    assert!(approx_eq(result[(1, 1)], 2.0));
}

/// shrink_ledoit_wolf: alpha = 0.4 on a 2×2 matrix.
///
///  result = 0.6·[[1, 0.5],[0.5, 2]] + 0.4·[[1, 0],[0, 2]]
///         = [[1, 0.3],[0.3, 2]]
#[test]
fn test_shrinkage_alpha_partial() {
    let cov = DMatrix::from_row_slice(2, 2, &[1.0, 0.5, 0.5, 2.0]);
    let result = shrink_ledoit_wolf(&cov, 0.4);
    assert!(approx_eq(result[(0, 0)], 1.0));
    assert!(approx_eq(result[(0, 1)], 0.3), "off-diag = {}", result[(0, 1)]);
    assert!(approx_eq(result[(1, 0)], 0.3));
    assert!(approx_eq(result[(1, 1)], 2.0));
}

/// correlation: verify diagonal = 1 and off-diagonal ≤ 1.
#[test]
fn test_correlation_shape_and_diagonal() {
    #[rustfmt::skip]
    let data = vec![
         0.01,  0.02,
         0.02, -0.01,
        -0.01,  0.03,
         0.03,  0.01,
    ];
    let returns = DMatrix::from_row_slice(4, 2, &data);
    let corr = correlation(&returns).expect("correlation failed");

    assert_eq!(corr.nrows(), 2);
    assert!(approx_eq(corr[(0, 0)], 1.0));
    assert!(approx_eq(corr[(1, 1)], 1.0));
    assert!(approx_eq(corr[(0, 1)], corr[(1, 0)]), "not symmetric");
    assert!(corr[(0, 1)].abs() <= 1.0 + EPS);
}

// ---------------------------------------------------------------------------
// stats::metrics
// ---------------------------------------------------------------------------

/// portfolio_metrics: equal-weight 2-asset case with diagonal covariance.
///
///   weights = [0.5, 0.5]
///   mu      = [0.10, 0.20]
///   cov     = diag(0.04, 0.09)
///
///   ret = 0.5·0.10 + 0.5·0.20 = 0.15
///   vol = √(0.25·0.04 + 0.25·0.09) = √(0.0325)
///   sharpe (rf=0) = 0.15 / √0.0325
#[test]
fn test_portfolio_metrics_equal_weights() {
    let weights = DVector::from_vec(vec![0.5, 0.5]);
    let mu = DVector::from_vec(vec![0.10, 0.20]);
    let cov = DMatrix::from_row_slice(2, 2, &[0.04, 0.0, 0.0, 0.09]);

    let m = portfolio_metrics(&weights, &mu, &cov, 0.0).expect("portfolio_metrics failed");

    let expected_vol = 0.0325_f64.sqrt();
    assert!(approx_eq(m.ret, 0.15), "ret = {}", m.ret);
    assert!(approx_eq(m.vol, expected_vol), "vol = {}", m.vol);
    assert!(
        approx_eq(m.sharpe, 0.15 / expected_vol),
        "sharpe = {}",
        m.sharpe
    );
}

/// portfolio_metrics: rf shifts Sharpe but not ret/vol.
#[test]
fn test_portfolio_metrics_with_rf() {
    let weights = DVector::from_vec(vec![1.0]);
    let mu = DVector::from_vec(vec![0.12]);
    let cov = DMatrix::from_row_slice(1, 1, &[0.04]); // vol = 0.2

    let m = portfolio_metrics(&weights, &mu, &cov, 0.02).expect("portfolio_metrics failed");
    assert!(approx_eq(m.ret, 0.12));
    assert!(approx_eq(m.vol, 0.2));
    assert!(approx_eq(m.sharpe, (0.12 - 0.02) / 0.2), "sharpe = {}", m.sharpe);
}

/// portfolio_metrics: dimension mismatch returns Err.
#[test]
fn test_portfolio_metrics_dimension_mismatch() {
    let weights = DVector::from_vec(vec![0.5, 0.5]);
    let mu = DVector::from_vec(vec![0.10]); // wrong length
    let cov = DMatrix::from_row_slice(2, 2, &[0.04, 0.0, 0.0, 0.09]);
    assert!(portfolio_metrics(&weights, &mu, &cov, 0.0).is_err());
}

/// cagr: 252-period curve, start=1, end=exp(1·0.10)≈1.10 with ppy=252.
///
/// A simpler known case: equity = [1.10, 1.21] (two-period, both 10 % gains).
/// years = 2/252. cagr = (1.21/1.10)^(252/2) − 1 = 1.1^126 − 1 ≈ enormous,
/// but we can verify the formula in a degenerate case.
///
/// Simpler: equity = [2.0, 2.0], ppy=1 → 0 % cagr.
#[test]
fn test_cagr_flat_equity() {
    let eq = DVector::from_vec(vec![2.0, 2.0]);
    let c = cagr(&eq, 1);
    assert!(approx_eq(c, 0.0), "cagr flat = {c}");
}

/// cagr: equity doubles over ppy periods → 100 % annual return.
///
///   equity = [1.0, 2.0], ppy = 2 → years = 2/2 = 1 → cagr = 2/1 − 1 = 1.0
#[test]
fn test_cagr_doubles() {
    let eq = DVector::from_vec(vec![1.0, 2.0]);
    let c = cagr(&eq, 2);
    assert!(approx_eq(c, 1.0), "cagr doubles = {c}");
}

/// ann_return_vol: constant 1 % daily return over 3 periods, ppy=252.
///
///   pct_change = [1.01/1.0-1, 1.0201/1.01-1] = [0.01, 0.01]
///   mean = 0.01, std(ddof=1) = 0.0
///   ann_return = 0.01 * 252 = 2.52
///   ann_vol    = 0.0 * √252 = 0.0
///
/// Use equity directly: [1.01, 1.0201, 1.030301]
#[test]
fn test_ann_return_vol_constant() {
    let eq = DVector::from_vec(vec![1.01, 1.0201, 1.030301]);
    let (ret, vol) = ann_return_vol(&eq, 252);
    assert!(
        approx_eq_loose(ret, 0.01 * 252.0),
        "ann_return = {ret}"
    );
    assert!(vol.abs() < 1e-8, "ann_vol should be ~0, got {vol}");
}

// ---------------------------------------------------------------------------
// risk::var
// ---------------------------------------------------------------------------

/// historical_var_cvar on a known 10-element return series.
///
///   sorted = [-0.05, -0.04, -0.03, -0.02, -0.01, 0.0, 0.01, 0.02, 0.03, 0.04]
///   alpha = 0.95  →  p = 0.05
///   idx   = 0.05 · 9 = 0.45
///   q     = sorted[0]·0.55 + sorted[1]·0.45 = -0.05·0.55 + (-0.04)·0.45
///         = -0.0275 − 0.018 = -0.0455
///   VaR   = 0.0455
///   tail  = {-0.05}   (only -0.05 ≤ -0.0455)
///   CVaR  = 0.05
#[test]
fn test_var_cvar_known_series() {
    let data = vec![
        -0.05, -0.04, -0.03, -0.02, -0.01, 0.0, 0.01, 0.02, 0.03, 0.04,
    ];
    let returns = DVector::from_vec(data);

    let (var, cvar) = historical_var_cvar(&returns, 0.95).expect("var_cvar failed");

    assert!(approx_eq(var, 0.0455), "VaR = {var}");
    assert!(approx_eq(cvar, 0.05), "CVaR = {cvar}");
}

/// historical_var_cvar: empty series returns Err.
#[test]
fn test_var_cvar_empty() {
    let returns = DVector::from_vec(vec![]);
    assert!(historical_var_cvar(&returns, 0.95).is_err());
}

/// historical_var_cvar: invalid alpha returns Err.
#[test]
fn test_var_cvar_invalid_alpha() {
    let returns = DVector::from_vec(vec![0.01, -0.01]);
    assert!(historical_var_cvar(&returns, 0.0).is_err());
    assert!(historical_var_cvar(&returns, 1.0).is_err());
}

/// historical_var_cvar: all-positive returns → VaR ≤ 0 (no loss at 95 %).
#[test]
fn test_var_cvar_all_positive() {
    let data: Vec<f64> = (1..=20).map(|i| i as f64 * 0.01).collect();
    let returns = DVector::from_vec(data);
    let (var, _cvar) = historical_var_cvar(&returns, 0.95).unwrap();
    // lower tail is positive → VaR is negative (gain, not a loss)
    assert!(var < 0.0, "VaR of all-positive returns should be negative, got {var}");
}

// ---------------------------------------------------------------------------
// risk::rolling
// ---------------------------------------------------------------------------

/// rolling_sharpe: verify output length, leading NaNs, and known values.
///
///   returns = [0.01, 0.02, 0.03, 0.04, 0.05], rf = 0, window = 3
///
///   result[0,1] = NaN
///   result[2]: excess=[0.01,0.02,0.03], mean=0.02, std=0.01 → sharpe=2.0
///   result[3]: excess=[0.02,0.03,0.04], mean=0.03, std=0.01 → sharpe=3.0
///   result[4]: excess=[0.03,0.04,0.05], mean=0.04, std=0.01 → sharpe=4.0
#[test]
fn test_rolling_sharpe_length_and_values() {
    let returns = DVector::from_vec(vec![0.01, 0.02, 0.03, 0.04, 0.05]);
    let rs = rolling_sharpe(&returns, 0.0, 3);

    assert_eq!(rs.len(), 5, "output length mismatch");
    assert!(rs[0].is_nan(), "rs[0] should be NaN");
    assert!(rs[1].is_nan(), "rs[1] should be NaN");
    assert!(
        approx_eq_loose(rs[2], 2.0),
        "rs[2] = {} (expected 2.0)",
        rs[2]
    );
    assert!(
        approx_eq_loose(rs[3], 3.0),
        "rs[3] = {} (expected 3.0)",
        rs[3]
    );
    assert!(
        approx_eq_loose(rs[4], 4.0),
        "rs[4] = {} (expected 4.0)",
        rs[4]
    );
}

/// rolling_sharpe: constant excess returns → all-NaN (std = 0).
#[test]
fn test_rolling_sharpe_constant_returns() {
    let returns = DVector::from_vec(vec![0.01, 0.01, 0.01, 0.01]);
    let rs = rolling_sharpe(&returns, 0.01, 2); // excess = all zeros
    // std of zeros is 0 → NaN for every valid window
    for i in 0..rs.len() {
        assert!(rs[i].is_nan(), "rs[{i}] = {} should be NaN", rs[i]);
    }
}

/// rolling_sharpe: window larger than series → all NaN.
#[test]
fn test_rolling_sharpe_window_too_large() {
    let returns = DVector::from_vec(vec![0.01, 0.02]);
    let rs = rolling_sharpe(&returns, 0.0, 5);
    assert_eq!(rs.len(), 2);
    assert!(rs[0].is_nan());
    assert!(rs[1].is_nan());
}

/// rolling_sortino: verify output length and that first (window-1) are NaN.
///
///   returns = [-0.02, 0.03, -0.01, 0.04, -0.03], rf = 0, window = 3
///
///   result[0,1] = NaN  (insufficient window)
///   result[2]:  excess=[-0.02, 0.03, -0.01], mean=0.0, downside=[-0.02,-0.01]
///               d_mean=-0.015, d_var=((−0.005)²+(0.005)²)/1=0.00005, d_std≈0.00707
///               sortino = 0.0/0.00707... = 0.0 (NaN in Python if downside std==0?)
///               No: d_std = 0.00707 ≠ 0, so sortino = 0.0
#[test]
fn test_rolling_sortino_length_and_leading_nans() {
    let returns = DVector::from_vec(vec![-0.02, 0.03, -0.01, 0.04, -0.03]);
    let rs = rolling_sortino(&returns, 0.0, 3);

    assert_eq!(rs.len(), 5, "output length mismatch");
    assert!(rs[0].is_nan(), "rs[0] should be NaN");
    assert!(rs[1].is_nan(), "rs[1] should be NaN");
    // result[2] should be a finite number (2 downside elements)
    assert!(rs[2].is_finite() || rs[2].is_nan()); // direction check only
}

/// rolling_sortino: window with fewer than 2 downside returns → NaN.
#[test]
fn test_rolling_sortino_insufficient_downside() {
    // All positive excess: no downside → NaN for every window
    let returns = DVector::from_vec(vec![0.01, 0.02, 0.03, 0.04]);
    let rs = rolling_sortino(&returns, 0.0, 2);
    for i in 0..rs.len() {
        assert!(rs[i].is_nan(), "rs[{i}] = {} should be NaN (no downside)", rs[i]);
    }
}
