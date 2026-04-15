//! Integration tests for Hierarchical Risk Parity.

use engine::optimize::hrp;
use nalgebra::DMatrix;

const EPS: f64 = 1e-6;

/// Build a T×n returns matrix that has a block correlation structure:
///   - Assets 0 & 1: strongly correlated (move together)
///   - Assets 2 & 3: strongly correlated with each other, weakly with 0 & 1
///
/// Construction: two independent factors f₁, f₂ (deterministic waves).
/// Asset j = loading_j · factor + small_idio_j.
fn block_returns() -> DMatrix<f64> {
    let t = 100;
    let n = 4;
    DMatrix::from_fn(t, n, |i, j| {
        let ti = i as f64;
        // Two independent base factors
        let f1 = (ti * 0.31).sin() * 0.03; // drives assets 0 & 1
        let f2 = (ti * 0.57).cos() * 0.04; // drives assets 2 & 3
        // Small idiosyncratic component (orthogonal to factors)
        let idio = (ti * (3.7 + j as f64)).sin() * 0.005;
        match j {
            0 => 0.8 * f1 + idio,
            1 => 0.75 * f1 + idio,
            2 => 0.8 * f2 + idio,
            _ => 0.75 * f2 + idio,
        }
    })
}

/// Weights must sum to 1, length must equal number of assets.
#[test]
fn test_hrp_weights_sum_to_one() {
    let ret = block_returns();
    let tickers: Vec<String> = vec!["A", "B", "C", "D"]
        .into_iter()
        .map(String::from)
        .collect();

    let w = hrp::solve(&ret, &tickers).expect("HRP should succeed");

    assert_eq!(w.len(), 4);
    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < EPS * 100.0, "weights sum = {sum:.8}");
}

/// All HRP weights must be positive (HRP is long-only by construction).
#[test]
fn test_hrp_weights_positive() {
    let ret = block_returns();
    let w = hrp::solve(&ret, &[]).expect("HRP should succeed");

    for (i, &wi) in w.iter().enumerate() {
        assert!(wi > 0.0, "w[{i}] = {wi:.8} should be positive");
    }
}

/// The two high-volatility assets (0+1 group vs 2+3 group) should together
/// receive roughly half the total weight each (block-level equal variance split).
/// We use a loose tolerance because sample estimates are noisy.
#[test]
fn test_hrp_block_allocation() {
    let ret = block_returns();
    let w = hrp::solve(&ret, &[]).expect("HRP should succeed");

    let group_a = w[0] + w[1];
    let group_b = w[2] + w[3];

    // Each group's block weight should be between 0.2 and 0.8.
    assert!(
        group_a > 0.2 && group_a < 0.8,
        "group A weight = {group_a:.4} out of expected (0.2, 0.8)"
    );
    assert!(
        group_b > 0.2 && group_b < 0.8,
        "group B weight = {group_b:.4} out of expected (0.2, 0.8)"
    );
}

/// Empty ticker slice (length 0) should be accepted as "no ticker validation".
#[test]
fn test_hrp_empty_tickers() {
    let ret = block_returns();
    assert!(hrp::solve(&ret, &[]).is_ok());
}

/// Ticker length mismatch must be rejected.
#[test]
fn test_hrp_ticker_mismatch() {
    let ret = block_returns();
    let bad_tickers: Vec<String> = vec!["A".into(), "B".into()]; // only 2 for 4-asset problem
    assert!(hrp::solve(&ret, &bad_tickers).is_err());
}

/// Fewer than 2 assets must be rejected.
#[test]
fn test_hrp_single_asset_rejected() {
    let ret = DMatrix::from_row_slice(10, 1, &vec![0.01f64; 10]);
    assert!(hrp::solve(&ret, &[]).is_err());
}

/// Fewer than 2 observations must be rejected.
#[test]
fn test_hrp_single_observation_rejected() {
    let ret = DMatrix::from_row_slice(1, 3, &[0.01, 0.02, 0.015]);
    assert!(hrp::solve(&ret, &[]).is_err());
}

// ---------------------------------------------------------------------------
// Unit tests for internal helpers (accessed via public API wrappers)
// ---------------------------------------------------------------------------

/// correlation_distance: diagonal must be 0, off-diagonal in (0, 1].
#[test]
fn test_correlation_distance_properties() {
    let corr = DMatrix::from_row_slice(3, 3, &[
        1.0, 0.8, 0.2,
        0.8, 1.0, 0.3,
        0.2, 0.3, 1.0,
    ]);
    let dist = hrp::correlation_distance(&corr);

    for i in 0..3 {
        assert!(dist[(i, i)].abs() < 1e-10, "diagonal should be 0");
        for j in 0..3 {
            assert!(dist[(i, j)] >= 0.0, "distance must be ≥ 0");
            assert!(dist[(i, j)] <= 1.0 + 1e-10, "distance must be ≤ 1");
            assert!((dist[(i, j)] - dist[(j, i)]).abs() < 1e-12, "must be symmetric");
        }
    }
}

/// cluster: linkage list length must be n-1 for n assets.
#[test]
fn test_cluster_linkage_length() {
    let dist = DMatrix::from_row_slice(4, 4, &[
        0.0, 0.1, 0.5, 0.6,
        0.1, 0.0, 0.4, 0.5,
        0.5, 0.4, 0.0, 0.2,
        0.6, 0.5, 0.2, 0.0,
    ]);
    let link = hrp::cluster(&dist);
    assert_eq!(link.len(), 3, "n-1 merge steps for 4 assets");
}

/// cluster: distances in the linkage must be non-decreasing (single-linkage
/// monotonicity property).
#[test]
fn test_cluster_monotone_distances() {
    let ret = block_returns();
    let tickers: Vec<String> = Vec::new();

    // Build distance matrix the same way solve() does internally.
    // We test the public correlation_distance + cluster functions.
    let n = ret.ncols();
    let t = ret.nrows();
    let mu: Vec<f64> = (0..n)
        .map(|j| ret.column(j).iter().sum::<f64>() / t as f64)
        .collect();

    // Quick sample correlation
    let mut corr = DMatrix::zeros(n, n);
    for i in 0..n {
        for j in 0..n {
            let xi: Vec<f64> = (0..t).map(|k| ret[(k, i)] - mu[i]).collect();
            let xj: Vec<f64> = (0..t).map(|k| ret[(k, j)] - mu[j]).collect();
            let cov_ij: f64 = xi.iter().zip(xj.iter()).map(|(a, b)| a * b).sum::<f64>()
                / (t - 1) as f64;
            let std_i: f64 = (xi.iter().map(|a| a * a).sum::<f64>() / (t - 1) as f64).sqrt();
            let std_j: f64 = (xj.iter().map(|a| a * a).sum::<f64>() / (t - 1) as f64).sqrt();
            corr[(i, j)] = if std_i * std_j < 1e-12 { 0.0 } else { cov_ij / (std_i * std_j) };
        }
    }

    let dist = hrp::correlation_distance(&corr);
    let link = hrp::cluster(&dist);

    // Merge distances should be non-decreasing (monotonicity of single-linkage)
    for k in 1..link.len() {
        assert!(
            link[k].2 >= link[k - 1].2 - 1e-10,
            "linkage not monotone at step {k}: {} < {}",
            link[k].2,
            link[k - 1].2
        );
    }

    // Also verify that solve still works (no panic, weights feasible)
    let w = hrp::solve(&ret, &tickers).unwrap();
    let sum: f64 = w.iter().sum();
    assert!((sum - 1.0).abs() < 1e-6);
}
