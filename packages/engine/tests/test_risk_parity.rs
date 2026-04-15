//! Integration tests for the Equal Risk Contribution solver.

use engine::optimize::risk_parity;
use nalgebra::DMatrix;

const EPS: f64 = 1e-4;

// 3-asset diagonal covariance: vols 20 %, 30 %, 40 %
fn diag_cov() -> DMatrix<f64> {
    DMatrix::from_row_slice(3, 3, &[
        0.04, 0.00, 0.00,
        0.00, 0.09, 0.00,
        0.00, 0.00, 0.16,
    ])
}

/// Weights must sum to 1 and all be ≥ 0.
#[test]
fn test_risk_parity_feasibility() {
    let cov = diag_cov();
    let w = risk_parity::solve(&cov, 0.0, 1.0)
        .expect("risk parity should converge");

    assert_eq!(w.len(), 3);
    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights must sum to 1, got {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi >= -EPS, "w[{i}] = {wi:.6} < 0");
    }
}

/// On a diagonal covariance the exact ERC solution is w_i ∝ 1/σ_i.
/// Verify that all risk contributions RC_i = w_i·(Σw)_i are approximately equal.
#[test]
fn test_risk_parity_equal_contributions() {
    let cov = diag_cov();
    let w = risk_parity::solve(&cov, 0.0, 1.0)
        .expect("risk parity should converge");

    // Compute risk contributions
    let cw = &cov * &w;
    let rc: Vec<f64> = (0..3).map(|i| w[i] * cw[i]).collect();
    let rc_mean = rc.iter().sum::<f64>() / 3.0;

    for (i, &rc_i) in rc.iter().enumerate() {
        let rel_err = (rc_i - rc_mean).abs() / rc_mean;
        assert!(
            rel_err < 1e-3,
            "RC[{i}] = {rc_i:.8} deviates from mean {rc_mean:.8} by {rel_err:.2e}"
        );
    }
}

/// For a diagonal cov, the exact weights are w_i ∝ 1/σ_i.
/// Check that asset 0 (lowest vol) gets the highest weight.
#[test]
fn test_risk_parity_weight_ordering() {
    let cov = diag_cov();
    let w = risk_parity::solve(&cov, 0.0, 1.0)
        .expect("risk parity should converge");

    assert!(
        w[0] > w[1] && w[1] > w[2],
        "expect w[0] > w[1] > w[2] for ascending vols, got {:.4} {:.4} {:.4}",
        w[0], w[1], w[2]
    );
}

/// With ub = 0.5 no weight may exceed 0.5.
#[test]
fn test_risk_parity_box_ub() {
    let cov = diag_cov();
    let w = risk_parity::solve(&cov, 0.0, 0.5)
        .expect("risk parity ub=0.5 should converge");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi <= 0.5 + EPS, "w[{i}] = {wi:.6} > 0.5");
    }
}

/// Empty universe must return an error.
#[test]
fn test_risk_parity_empty() {
    let cov = DMatrix::<f64>::zeros(0, 0);
    assert!(risk_parity::solve(&cov, 0.0, 1.0).is_err());
}

/// Single-asset universe: only feasible weight is 1.
#[test]
fn test_risk_parity_single_asset() {
    let cov = DMatrix::from_row_slice(1, 1, &[0.04]);
    let w = risk_parity::solve(&cov, 0.0, 1.0)
        .expect("single-asset must succeed");
    assert!((w[0] - 1.0).abs() < EPS, "w[0] = {:.6}", w[0]);
}
