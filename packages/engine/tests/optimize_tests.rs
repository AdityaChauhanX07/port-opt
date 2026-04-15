//! Integration tests for the Markowitz QP solver and frontier tracer.
//!
//! Each test uses a small, analytically tractable problem so expected values
//! can be verified by hand.

use engine::optimize::{frontier, markowitz};
use nalgebra::{DMatrix, DVector};

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/// 3-asset diagonal covariance (assets are uncorrelated).
/// Annualised vols: 20 %, 30 %, 40 %.
fn diagonal_cov() -> DMatrix<f64> {
    DMatrix::from_row_slice(3, 3, &[
        0.04, 0.00, 0.00,
        0.00, 0.09, 0.00,
        0.00, 0.00, 0.16,
    ])
}

/// Annualised expected returns.
fn sample_mu() -> DVector<f64> {
    DVector::from_vec(vec![0.10, 0.15, 0.20])
}

const EPS: f64 = 1e-4; // tolerance for QP solutions

// ---------------------------------------------------------------------------
// min_variance
// ---------------------------------------------------------------------------

/// With long-only, lb=0, ub=1 and a diagonal covariance, the minimum-variance
/// portfolio concentrates on the lowest-vol asset (asset 0).  Weights must:
///   - sum to 1.0
///   - all be ≥ 0
///   - asset-0 weight is the largest
#[test]
fn test_min_variance_unconstrained_long_only() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let w = markowitz::min_variance(&mu, &cov, true, 0.0, 1.0)
        .expect("min_variance should succeed");

    assert_eq!(w.len(), 3);
    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights must sum to 1, got {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi >= -EPS, "w[{i}] = {wi:.6} < 0 (long-only violated)");
    }
    // The unconstrained min-var portfolio on a diagonal cov is all-in on asset 0.
    assert!(w[0] > w[1] && w[0] > w[2], "asset 0 should have highest weight");
}

/// With ub = 0.5 no weight may exceed 0.5 (the upper bound).
#[test]
fn test_min_variance_box_ub() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let w = markowitz::min_variance(&mu, &cov, true, 0.0, 0.5)
        .expect("min_variance ub=0.5 should succeed");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi <= 0.5 + EPS, "w[{i}] = {wi:.6} > 0.5 (ub violated)");
        assert!(wi >= -EPS, "w[{i}] = {wi:.6} < 0 (lb violated)");
    }
}

/// With lb=0.1 each weight must be ≥ 0.1.
#[test]
fn test_min_variance_box_lb() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let w = markowitz::min_variance(&mu, &cov, true, 0.1, 1.0)
        .expect("min_variance lb=0.1 should succeed");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi >= 0.1 - EPS, "w[{i}] = {wi:.6} < lb 0.1");
    }
}

/// Empty universe should return an error immediately (no solver call needed).
#[test]
fn test_min_variance_empty_universe() {
    let mu = DVector::from_vec(vec![]);
    let cov = DMatrix::zeros(0, 0);
    assert!(markowitz::min_variance(&mu, &cov, true, 0.0, 1.0).is_err());
}

/// Dimension mismatch should be caught before the solver is invoked.
#[test]
fn test_min_variance_bad_dimensions() {
    let mu = DVector::from_vec(vec![0.1, 0.2]);
    let cov = diagonal_cov(); // 3×3 but mu has 2 elements
    assert!(markowitz::min_variance(&mu, &cov, true, 0.0, 1.0).is_err());
}

// ---------------------------------------------------------------------------
// target_return
// ---------------------------------------------------------------------------

/// The solution must achieve the requested expected return (μᵀw ≥ target).
#[test]
fn test_target_return_constraint_satisfied() {
    let mu = sample_mu();
    let cov = diagonal_cov();
    let target = 0.12; // between min(μ)=0.10 and max(μ)=0.20

    let w = markowitz::target_return(&mu, &cov, target, true, 0.0, 1.0)
        .expect("target_return should succeed for feasible target");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");

    let achieved: f64 = w.dot(&mu);
    assert!(
        achieved >= target - EPS,
        "achieved return {achieved:.6} < target {target:.6}"
    );

    for (i, &wi) in w.iter().enumerate() {
        assert!(wi >= -EPS, "w[{i}] = {wi:.6} < 0");
    }
}

/// Targeting max(μ) should concentrate on the high-return asset.
#[test]
fn test_target_return_max_mu() {
    let mu = sample_mu();
    let cov = diagonal_cov();
    let target = *mu.iter().cloned().reduce(f64::max).as_ref().unwrap();

    let w = markowitz::target_return(&mu, &cov, target, true, 0.0, 1.0)
        .expect("targeting max mu should be feasible");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS);

    let achieved: f64 = w.dot(&mu);
    assert!(achieved >= target - EPS);
}

/// Target strictly above max(μ) must be infeasible.
#[test]
fn test_target_return_infeasible() {
    let mu = sample_mu();
    let cov = diagonal_cov();
    let target = 1.0; // far above max(μ) = 0.20

    let result = markowitz::target_return(&mu, &cov, target, true, 0.0, 1.0);
    // Should either be InfeasibleProblem or OptimizationFailed — either way, Err.
    assert!(result.is_err(), "above-max target should be infeasible");
}

// ---------------------------------------------------------------------------
// frontier::trace
// ---------------------------------------------------------------------------

/// The frontier must be non-empty and best_idx must point to a valid portfolio.
#[test]
fn test_trace_basic() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let fr = frontier::trace(&mu, &cov, 15, true, 0.0, 1.0, 0.04)
        .expect("trace should succeed for standard inputs");

    let k = fr.weights.nrows();
    assert!(k > 0, "at least one feasible portfolio expected");
    assert!(fr.best_idx.is_some(), "best_idx should be set");

    let bi = fr.best_idx.unwrap();
    assert!(bi < k, "best_idx out of range");
    assert!(fr.best_sharpe.is_finite(), "best_sharpe should be finite");

    // Weights row sums should be ~1.
    for i in 0..k {
        let sum: f64 = (0..fr.weights.ncols()).map(|j| fr.weights[(i, j)]).sum();
        assert!(
            (sum - 1.0).abs() < EPS,
            "frontier row {i} sums to {sum:.6}"
        );
    }

    // Risks, returns, sharpes must have the same length as weights rows.
    assert_eq!(fr.risks.len(), k);
    assert_eq!(fr.returns.len(), k);
    assert_eq!(fr.sharpes.len(), k);
    assert_eq!(fr.targets.len(), k);
}

/// Frontier must be monotone: higher-target portfolios have weakly higher
/// realised returns.
#[test]
fn test_trace_monotone_returns() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let fr = frontier::trace(&mu, &cov, 10, true, 0.0, 1.0, 0.0)
        .expect("trace should succeed");

    for i in 1..fr.returns.len() {
        assert!(
            fr.returns[i] >= fr.returns[i - 1] - EPS,
            "returns not monotone at i={i}: {} < {}",
            fr.returns[i],
            fr.returns[i - 1]
        );
    }
}

/// With ub = 0.5 no weight in any frontier portfolio may exceed 0.5.
#[test]
fn test_trace_box_constraint_respected() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let fr = frontier::trace(&mu, &cov, 10, true, 0.0, 0.5, 0.04)
        .expect("trace ub=0.5 should succeed");

    for i in 0..fr.weights.nrows() {
        for j in 0..fr.weights.ncols() {
            assert!(
                fr.weights[(i, j)] <= 0.5 + EPS,
                "w[{i},{j}] = {:.6} > 0.5",
                fr.weights[(i, j)]
            );
        }
    }
}

/// n_pts = 0 must be rejected before any solver is invoked.
#[test]
fn test_trace_zero_points() {
    let mu = sample_mu();
    let cov = diagonal_cov();
    assert!(frontier::trace(&mu, &cov, 0, true, 0.0, 1.0, 0.04).is_err());
}

// ---------------------------------------------------------------------------
// frontier::max_sharpe
// ---------------------------------------------------------------------------

/// max_sharpe on the precomputed weights should agree with the index stored in
/// the FrontierResult.
#[test]
fn test_max_sharpe_consistency() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let fr = frontier::trace(&mu, &cov, 15, true, 0.0, 1.0, 0.04)
        .expect("trace");

    let (idx, sharpe) = frontier::max_sharpe(&mu, &cov, 0.04, &fr.weights);

    assert_eq!(idx, fr.best_idx, "max_sharpe index should match FrontierResult");
    if let Some(i) = idx {
        assert!(
            (sharpe - fr.sharpes[i]).abs() < EPS,
            "sharpe mismatch: {sharpe:.6} vs {:.6}",
            fr.sharpes[i]
        );
    }
}

// ---------------------------------------------------------------------------
// Numerical robustness: highly correlated assets
// ---------------------------------------------------------------------------

/// A near-rank-1 covariance matrix (assets almost perfectly correlated) must
/// not crash the solver — we just verify it returns some result.
#[test]
fn test_highly_correlated_assets_no_crash() {
    // Assets 0 and 1 almost perfectly correlated; asset 2 less so.
    #[rustfmt::skip]
    let cov = DMatrix::from_row_slice(3, 3, &[
        0.04,  0.059, 0.030,
        0.059, 0.09,  0.044,
        0.030, 0.044, 0.06,
    ]);
    let mu = DVector::from_vec(vec![0.08, 0.12, 0.10]);

    // Should not panic regardless of whether it returns Ok or Err.
    let _ = markowitz::min_variance(&mu, &cov, true, 0.0, 1.0);
    let _ = frontier::trace(&mu, &cov, 5, true, 0.0, 1.0, 0.04);
}

/// Single-asset universe: the only feasible portfolio has weight 1.
#[test]
fn test_single_asset() {
    let mu = DVector::from_vec(vec![0.10]);
    let cov = DMatrix::from_row_slice(1, 1, &[0.04]);

    let w = markowitz::min_variance(&mu, &cov, true, 0.0, 1.0)
        .expect("single-asset min-var must succeed");

    assert_eq!(w.len(), 1);
    assert!((w[0] - 1.0).abs() < EPS, "w[0] = {:.6}", w[0]);
}
