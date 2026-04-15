//! Integration tests for the block-bootstrap Sharpe CI.

use engine::monte_carlo::bootstrap::sharpe_ci;
use nalgebra::DVector;

/// Build a deterministic return series with clearly positive Sharpe.
/// Mean ≈ 0.01 per period, std ≈ small → high Sharpe.
fn positive_sharpe_returns(n: usize) -> DVector<f64> {
    DVector::from_fn(n, |i, _| {
        // Slight sinusoidal variation around a positive mean — deterministic, no RNG.
        0.010 + 0.002 * ((i as f64 * 0.31).sin())
    })
}

/// Build a return series with clearly negative Sharpe (always lose money).
fn negative_sharpe_returns(n: usize) -> DVector<f64> {
    DVector::from_fn(n, |i, _| {
        -0.010 + 0.002 * ((i as f64 * 0.31).sin())
    })
}

/// CI for a positive-Sharpe series must be entirely above zero.
#[test]
fn test_bootstrap_positive_sharpe_ci_above_zero() {
    let rets = positive_sharpe_returns(200);
    let result = sharpe_ci(&rets, 0.0, 1_000, 10, 0.95, 42);

    assert!(result.mean.is_finite(), "mean should be finite");
    assert!(
        result.ci_lower > 0.0,
        "lower CI = {:.4} should be > 0 for a high-Sharpe series",
        result.ci_lower
    );
    assert!(
        result.ci_upper > result.ci_lower,
        "upper CI {:.4} must exceed lower CI {:.4}",
        result.ci_upper,
        result.ci_lower
    );
}

/// CI for a negative-Sharpe series must be entirely below zero.
#[test]
fn test_bootstrap_negative_sharpe_ci_below_zero() {
    let rets = negative_sharpe_returns(200);
    let result = sharpe_ci(&rets, 0.0, 1_000, 10, 0.95, 42);

    assert!(result.mean.is_finite(), "mean should be finite");
    assert!(
        result.ci_upper < 0.0,
        "upper CI = {:.4} should be < 0 for a negative-Sharpe series",
        result.ci_upper
    );
}

/// Number of samples should equal (or be close to) n_boot
/// (some replications may be dropped for zero-std samples, but not many here).
#[test]
fn test_bootstrap_sample_count() {
    let rets = positive_sharpe_returns(200);
    let n_boot = 500;
    let result = sharpe_ci(&rets, 0.0, n_boot, 10, 0.95, 1);

    assert!(
        result.samples.len() > (n_boot as f64 * 0.9) as usize,
        "expected ~{n_boot} samples, got {}",
        result.samples.len()
    );
}

/// Reproducibility: same seed → identical results.
#[test]
fn test_bootstrap_reproducible() {
    let rets = positive_sharpe_returns(150);
    let r1 = sharpe_ci(&rets, 0.0, 500, 10, 0.95, 7);
    let r2 = sharpe_ci(&rets, 0.0, 500, 10, 0.95, 7);

    assert_eq!(r1.samples.len(), r2.samples.len());
    assert!((r1.mean - r2.mean).abs() < 1e-12, "results not reproducible");
}

/// Different seeds should produce (slightly) different results.
#[test]
fn test_bootstrap_seed_sensitivity() {
    let rets = positive_sharpe_returns(150);
    let r1 = sharpe_ci(&rets, 0.0, 500, 10, 0.95, 1);
    let r2 = sharpe_ci(&rets, 0.0, 500, 10, 0.95, 2);
    assert!(
        (r1.mean - r2.mean).abs() > 1e-6,
        "different seeds should produce different means"
    );
}

/// Series shorter than `2 * block_size` must return NaN result (not panic).
#[test]
fn test_bootstrap_too_short_returns_nan() {
    let rets = positive_sharpe_returns(5); // too short for block_size=10
    let result = sharpe_ci(&rets, 0.0, 100, 10, 0.95, 42);
    assert!(result.mean.is_nan(), "mean should be NaN for too-short series");
    assert!(result.samples.is_empty(), "samples should be empty");
}

/// Risk-free rate subtraction: a series with mean = rf → near-zero Sharpe.
#[test]
fn test_bootstrap_rf_subtraction() {
    // Constant return exactly equal to rf
    let rf = 0.01;
    let rets = DVector::from_element(200, rf);
    let result = sharpe_ci(&rets, rf, 500, 10, 0.95, 42);
    // std of constant series = 0, so all replications dropped → NaN
    assert!(result.mean.is_nan() || result.samples.is_empty(),
        "constant excess returns should yield no finite Sharpe samples");
}

/// A 95 % CI is wider than a 90 % CI: its lower bound is further left and
/// its upper bound is further right.
#[test]
fn test_bootstrap_ci_width_ordering() {
    let rets = positive_sharpe_returns(200);
    let r90 = sharpe_ci(&rets, 0.0, 1_000, 10, 0.90, 42);
    let r95 = sharpe_ci(&rets, 0.0, 1_000, 10, 0.95, 42);

    // 95 % lower = 2.5th pct  ≤  90 % lower = 5th pct
    assert!(
        r95.ci_lower <= r90.ci_lower + 1e-6,
        "95% CI lower {:.4} should be ≤ 90% CI lower {:.4}",
        r95.ci_lower, r90.ci_lower
    );
    // 95 % upper = 97.5th pct  ≥  90 % upper = 95th pct
    assert!(
        r95.ci_upper >= r90.ci_upper - 1e-6,
        "95% CI upper {:.4} should be ≥ 90% CI upper {:.4}",
        r95.ci_upper, r90.ci_upper
    );
}
