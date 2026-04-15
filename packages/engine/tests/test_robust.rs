//! Integration tests for the robust mean–variance SOCP solver.

use engine::optimize::robust;
use nalgebra::{DMatrix, DVector};

const EPS: f64 = 1e-4;

fn sample_mu() -> DVector<f64> {
    DVector::from_vec(vec![0.10, 0.15, 0.20])
}

fn diagonal_cov() -> DMatrix<f64> {
    DMatrix::from_row_slice(3, 3, &[
        0.04, 0.00, 0.00,
        0.00, 0.09, 0.00,
        0.00, 0.00, 0.16,
    ])
}

/// Weights must sum to 1 and be ≥ 0.
#[test]
fn test_robust_feasibility() {
    let mu = sample_mu();
    let cov = diagonal_cov();
    let w = robust::solve(&mu, &cov, 1.0, true, 0.0, 1.0)
        .expect("robust solve should succeed");

    assert_eq!(w.len(), 3);
    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi >= -EPS, "w[{i}] = {wi:.6} < 0");
    }
}

/// gamma = 0: pure return maximisation. On this problem all weight should
/// concentrate on asset 2 (highest return 0.20).
#[test]
fn test_robust_gamma_zero_maximises_return() {
    let mu = sample_mu();
    let cov = diagonal_cov();
    let w = robust::solve(&mu, &cov, 0.0, true, 0.0, 1.0)
        .expect("gamma=0 should succeed");

    let ret: f64 = w.dot(&mu);
    // Expect return very close to max(mu) = 0.20
    assert!(
        ret >= 0.20 - 1e-3,
        "gamma=0 should achieve max return, got {ret:.6}"
    );
}

/// Higher gamma should yield a *lower* (or equal) expected return, because
/// the solver penalises the uncertainty cost more.
#[test]
fn test_robust_gamma_trades_off_return() {
    let mu = sample_mu();
    let cov = diagonal_cov();

    let w_g1 = robust::solve(&mu, &cov, 1.0, true, 0.0, 1.0).unwrap();
    let w_g5 = robust::solve(&mu, &cov, 5.0, true, 0.0, 1.0).unwrap();

    let ret_g1: f64 = w_g1.dot(&mu);
    let ret_g5: f64 = w_g5.dot(&mu);

    assert!(
        ret_g5 <= ret_g1 + 1e-3,
        "larger gamma should not increase expected return: {ret_g5:.6} > {ret_g1:.6}"
    );
}

/// With ub = 0.5 no weight may exceed 0.5.
#[test]
fn test_robust_box_ub() {
    let mu = sample_mu();
    let cov = diagonal_cov();
    let w = robust::solve(&mu, &cov, 0.5, true, 0.0, 0.5)
        .expect("robust ub=0.5 should succeed");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS);
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi <= 0.5 + EPS, "w[{i}] = {wi:.6} > 0.5");
    }
}

/// Dimension mismatch must be caught before the solver runs.
#[test]
fn test_robust_bad_dimensions() {
    let mu = DVector::from_vec(vec![0.1, 0.2]);
    let cov = diagonal_cov(); // 3×3 but mu has 2 elements
    assert!(robust::solve(&mu, &cov, 1.0, true, 0.0, 1.0).is_err());
}

/// Near-rank-1 covariance must not crash.
#[test]
fn test_robust_near_singular_cov() {
    #[rustfmt::skip]
    let cov = DMatrix::from_row_slice(3, 3, &[
        0.04,  0.059, 0.030,
        0.059, 0.09,  0.044,
        0.030, 0.044, 0.06,
    ]);
    let mu = DVector::from_vec(vec![0.08, 0.12, 0.10]);
    let _ = robust::solve(&mu, &cov, 1.0, true, 0.0, 1.0);
}
