//! Integration tests for GBM path simulation and terminal-distribution summary.

use engine::monte_carlo::gbm::{simulate, summarize_terminal, GbmParams};

fn default_params() -> GbmParams {
    GbmParams {
        mu_annual: 0.08,
        vol_annual: 0.20,
        start_value: 1.0,
        years: 1.0,
        ppy: 252,
        n_paths: 100,
        seed: 42,
    }
}

/// Output shape must be (n_steps + 1, n_paths).
/// For 252 steps and 100 paths → (253, 100).
#[test]
fn test_simulate_shape() {
    let params = default_params();
    let paths = simulate(&params);
    assert_eq!(paths.nrows(), 253, "expected 252+1 rows");
    assert_eq!(paths.ncols(), 100, "expected 100 columns");
}

/// Row 0 of every path must equal start_value.
#[test]
fn test_simulate_row0_is_start() {
    let params = default_params();
    let paths = simulate(&params);
    for p in 0..paths.ncols() {
        assert!(
            (paths[(0, p)] - params.start_value).abs() < 1e-12,
            "path {p}: row0 = {:.8}, expected {}",
            paths[(0, p)],
            params.start_value
        );
    }
}

/// All simulated equity values must be strictly positive (GBM stays positive).
#[test]
fn test_simulate_all_positive() {
    let params = default_params();
    let paths = simulate(&params);
    for t in 0..paths.nrows() {
        for p in 0..paths.ncols() {
            assert!(
                paths[(t, p)] > 0.0,
                "path {p}, step {t}: value = {:.8} ≤ 0",
                paths[(t, p)]
            );
        }
    }
}

/// Different seeds must produce different paths.
#[test]
fn test_simulate_seed_reproducibility() {
    let mut p1 = default_params();
    let mut p2 = default_params();
    p1.seed = 1;
    p2.seed = 2;

    let paths1 = simulate(&p1);
    let paths2 = simulate(&p2);

    // At least one terminal value should differ.
    let differs = (0..10).any(|p| (paths1[(252, p)] - paths2[(252, p)]).abs() > 1e-6);
    assert!(differs, "different seeds produced identical paths");
}

/// Same seed must reproduce the same matrix.
#[test]
fn test_simulate_same_seed_reproducible() {
    let params = default_params();
    let paths_a = simulate(&params);
    let paths_b = simulate(&params);

    for p in 0..10 {
        assert!(
            (paths_a[(252, p)] - paths_b[(252, p)]).abs() < 1e-12,
            "same seed gave different results at path {p}"
        );
    }
}

/// Zero volatility: all paths grow at exactly the risk-free rate, no spread.
#[test]
fn test_simulate_zero_vol() {
    let params = GbmParams {
        mu_annual: 0.05,
        vol_annual: 0.0,
        start_value: 1.0,
        years: 1.0,
        ppy: 252,
        n_paths: 10,
        seed: 0,
    };
    let paths = simulate(&params);
    // All paths should be (approximately) identical and equal to exp(mu_annual).
    let expected = (params.mu_annual).exp();
    for p in 0..paths.ncols() {
        let terminal = paths[(paths.nrows() - 1, p)];
        assert!(
            (terminal - expected).abs() < 1e-6,
            "path {p} terminal = {terminal:.8}, expected {expected:.8}"
        );
    }
}

/// Terminal summary statistics: check basic sanity.
#[test]
fn test_summarize_terminal_sanity() {
    let params = GbmParams {
        mu_annual: 0.08,
        vol_annual: 0.20,
        start_value: 1.0,
        years: 1.0,
        ppy: 252,
        n_paths: 2_000,
        seed: 99,
    };
    let paths = simulate(&params);
    let summary = summarize_terminal(&paths, params.start_value);

    // Positive mean and median
    assert!(summary.mean > 0.0, "mean should be positive");
    assert!(summary.median > 0.0, "median should be positive");

    // Ordered quantiles
    assert!(summary.p5 <= summary.p25, "p5 ≤ p25");
    assert!(summary.p25 <= summary.median, "p25 ≤ median");
    assert!(summary.median <= summary.p75, "median ≤ p75");
    assert!(summary.p75 <= summary.p95, "p75 ≤ p95");

    // std should be positive
    assert!(summary.std > 0.0, "std should be positive");

    // prob_loss should be in [0, 1]
    assert!((0.0..=1.0).contains(&summary.prob_loss), "prob_loss out of range");

    // Positive drift → mean should be above start_value.
    assert!(
        summary.mean > params.start_value,
        "positive drift → mean terminal > start_value"
    );
}

/// Non-unit start value propagates correctly.
#[test]
fn test_simulate_non_unit_start() {
    let params = GbmParams {
        mu_annual: 0.08,
        vol_annual: 0.20,
        start_value: 100_000.0,
        years: 1.0,
        ppy: 252,
        n_paths: 10,
        seed: 7,
    };
    let paths = simulate(&params);
    for p in 0..paths.ncols() {
        assert!(
            (paths[(0, p)] - 100_000.0).abs() < 1.0,
            "row0 should be start_value"
        );
    }
}
