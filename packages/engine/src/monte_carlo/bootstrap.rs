//! Overlapping block bootstrap for Sharpe-ratio confidence intervals.
//!
//! Mirrors `stats.bootstrap_sharpe_ci` from the Python reference implementation.
//!
//! # Algorithm
//!
//! For each of `n_boot` replications:
//! 1. Draw random block-start indices from `U[0, n − block_size]`.
//! 2. Concatenate blocks until the bootstrapped sample has at least `n` elements.
//! 3. Trim to exactly `n` elements.
//! 4. Compute the sample Sharpe ratio (ddof = 1).
//!
//! The confidence interval is the `[α/2, 1−α/2]` percentile of the replication distribution.

use nalgebra::DVector;
use rand::SeedableRng;
use rand::Rng;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Result of the block-bootstrap Sharpe confidence interval.
#[derive(Debug, Clone)]
pub struct BootstrapResult {
    /// Mean of bootstrap Sharpe samples.
    pub mean: f64,
    /// Lower bound of the `ci`-level confidence interval.
    pub ci_lower: f64,
    /// Upper bound of the `ci`-level confidence interval.
    pub ci_upper: f64,
    /// All finite Sharpe replication values (length ≤ `n_boot`).
    pub samples: Vec<f64>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Compute a block-bootstrap confidence interval for the Sharpe ratio.
///
/// # Arguments
/// * `returns` — per-period return series (NaNs ignored).
/// * `rf_per_period` — risk-free rate per period (subtracted before computing Sharpe).
/// * `n_boot` — number of bootstrap replications.
/// * `block_size` — length of contiguous return blocks (preserves some autocorrelation).
/// * `ci` — confidence level, e.g. `0.95` for a 95 % CI.
/// * `seed` — RNG seed for reproducibility.
///
/// Returns `BootstrapResult` with `mean = NaN` if the series is too short.
pub fn sharpe_ci(
    returns: &DVector<f64>,
    rf_per_period: f64,
    n_boot: usize,
    block_size: usize,
    ci: f64,
    seed: u64,
) -> BootstrapResult {
    let nan_result = BootstrapResult {
        mean: f64::NAN,
        ci_lower: f64::NAN,
        ci_upper: f64::NAN,
        samples: Vec::new(),
    };

    // Collect finite excess returns (mirrors Python's dropna + excess = r - rf)
    let excess: Vec<f64> = returns
        .iter()
        .filter(|&&x| x.is_finite())
        .map(|&x| x - rf_per_period)
        .collect();

    let n = excess.len();
    let min_len = (block_size * 2).max(10);
    if n < min_len {
        return nan_result;
    }

    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let max_start = (n as isize - block_size as isize).max(1) as usize;

    let mut sharpe_samples: Vec<f64> = Vec::with_capacity(n_boot);

    for _ in 0..n_boot {
        // Build bootstrapped indices via overlapping block bootstrap.
        let mut idx: Vec<usize> = Vec::with_capacity(n + block_size);
        while idx.len() < n {
            let start = rng.gen_range(0..max_start);
            let end = (start + block_size).min(n);
            idx.extend(start..end);
        }
        idx.truncate(n);

        // Compute sample Sharpe (ddof=1).
        let sample: Vec<f64> = idx.iter().map(|&i| excess[i]).collect();
        let mean = sample.iter().sum::<f64>() / n as f64;
        let var = sample.iter().map(|&x| (x - mean).powi(2)).sum::<f64>()
            / (n - 1) as f64;
        let std = var.sqrt();

        if std <= 0.0 || !std.is_finite() {
            continue;
        }
        let s = mean / std;
        if s.is_finite() {
            sharpe_samples.push(s);
        }
    }

    if sharpe_samples.is_empty() {
        return nan_result;
    }

    sharpe_samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let alpha = 1.0 - ci;
    let ci_lower = quantile_sorted(&sharpe_samples, alpha / 2.0);
    let ci_upper = quantile_sorted(&sharpe_samples, 1.0 - alpha / 2.0);
    let mean = sharpe_samples.iter().sum::<f64>() / sharpe_samples.len() as f64;

    BootstrapResult {
        mean,
        ci_lower,
        ci_upper,
        samples: sharpe_samples,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Linear-interpolation quantile on a *sorted* slice.
fn quantile_sorted(sorted: &[f64], q: f64) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return f64::NAN;
    }
    if n == 1 {
        return sorted[0];
    }
    let pos = q * (n - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    if lo == hi {
        sorted[lo]
    } else {
        let frac = pos - lo as f64;
        sorted[lo] * (1.0 - frac) + sorted[hi] * frac
    }
}
