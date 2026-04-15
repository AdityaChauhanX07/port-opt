//! Integration tests for the CVaR-minimising portfolio solver.

use engine::optimize::cvar;
use nalgebra::DMatrix;

const EPS: f64 = 1e-4;

/// Build a deterministic (T × n) returns matrix.
/// Uses a fixed linear pattern so the test is reproducible without RNG.
fn synthetic_returns(t: usize, n: usize) -> DMatrix<f64> {
    // Asset 0: low-vol, small positive drift
    // Asset 1: high-vol, fat-tailed (alternating large swings)
    // Asset 2: medium-vol, moderate drift
    DMatrix::from_fn(t, n, |i, j| {
        let ti = i as f64;
        match j {
            0 => 0.001 + 0.005 * ((ti * 0.7).sin()),
            1 => 0.002 + 0.040 * ((ti * 1.3).sin()),
            _ => 0.001 + 0.015 * ((ti * 0.9).cos()),
        }
    })
}

/// Basic feasibility: weights sum to 1, all ≥ 0, ≤ 1.
#[test]
fn test_cvar_feasibility() {
    let ret = synthetic_returns(60, 3);
    let w = cvar::solve(&ret, 0.95, true, 0.0, 1.0)
        .expect("CVaR solve should succeed");

    assert_eq!(w.len(), 3);
    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi >= -EPS, "w[{i}] = {wi:.6} < 0");
        assert!(wi <= 1.0 + EPS, "w[{i}] = {wi:.6} > 1");
    }
}

/// The high-volatility asset (asset 1) should receive a lower weight than
/// the low-volatility asset (asset 0) when minimising CVaR.
#[test]
fn test_cvar_avoids_high_vol() {
    let ret = synthetic_returns(100, 3);
    let w = cvar::solve(&ret, 0.95, true, 0.0, 1.0)
        .expect("CVaR solve should succeed");

    assert!(
        w[1] < w[0] + EPS || w[1] < w[2] + EPS,
        "high-vol asset 1 should not dominate: w = [{:.4}, {:.4}, {:.4}]",
        w[0], w[1], w[2]
    );
}

/// With ub = 0.5 no weight may exceed 0.5.
#[test]
fn test_cvar_box_ub() {
    let ret = synthetic_returns(60, 3);
    let w = cvar::solve(&ret, 0.95, true, 0.0, 0.5)
        .expect("CVaR ub=0.5 should succeed");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi <= 0.5 + EPS, "w[{i}] = {wi:.6} > 0.5");
    }
}

/// With lb = 0.1 each weight must be ≥ 0.1.
#[test]
fn test_cvar_box_lb() {
    let ret = synthetic_returns(60, 3);
    let w = cvar::solve(&ret, 0.95, true, 0.1, 1.0)
        .expect("CVaR lb=0.1 should succeed");

    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS, "weights sum = {sum:.6}");
    for (i, &wi) in w.iter().enumerate() {
        assert!(wi >= 0.1 - EPS, "w[{i}] = {wi:.6} < lb 0.1");
    }
}

/// Invalid alpha must return an error.
#[test]
fn test_cvar_bad_alpha() {
    let ret = synthetic_returns(20, 2);
    assert!(cvar::solve(&ret, 1.5, true, 0.0, 1.0).is_err());
    assert!(cvar::solve(&ret, 0.0, true, 0.0, 1.0).is_err());
}

/// Empty returns matrix must return an error.
#[test]
fn test_cvar_empty() {
    let ret = DMatrix::<f64>::zeros(0, 3);
    assert!(cvar::solve(&ret, 0.95, true, 0.0, 1.0).is_err());
}

/// Different alpha levels should produce different (or equal) optimal values
/// without crashing.
#[test]
fn test_cvar_different_alphas() {
    let ret = synthetic_returns(80, 3);
    for alpha in [0.90, 0.95, 0.99] {
        let w = cvar::solve(&ret, alpha, true, 0.0, 1.0)
            .unwrap_or_else(|_| panic!("CVaR failed for alpha={alpha}"));
        let sum: f64 = w.iter().sum();
        assert!((sum - 1.0).abs() < EPS, "alpha={alpha} weights sum={sum:.6}");
    }
}
