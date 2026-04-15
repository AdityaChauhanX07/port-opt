//! Geometric Brownian Motion path simulation.
//!
//! # Model
//!
//! Each discrete time step uses the exact GBM increment:
//!
//! ```text
//! S(t+dt) = S(t) · exp((μ − σ²/2)·dt  +  σ·√dt · Z),   Z ~ N(0,1)
//! ```
//!
//! # Output shape
//!
//! `simulate` returns a matrix of shape `(n_steps + 1, n_paths)`.
//! Row 0 is the fixed start value; rows 1..n_steps are the simulated equity levels.

use nalgebra::DMatrix;
use rand::SeedableRng;
use rand_distr::{Distribution, Normal};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Parameters for a single-portfolio GBM simulation.
#[derive(Debug, Clone)]
pub struct GbmParams {
    /// Annualised drift (e.g. 0.10 for 10 %).
    pub mu_annual: f64,
    /// Annualised volatility (e.g. 0.20 for 20 %).
    pub vol_annual: f64,
    /// Starting equity value (e.g. 1.0).
    pub start_value: f64,
    /// Simulation horizon in years.
    pub years: f64,
    /// Number of periods per year (252 for daily, 12 for monthly, …).
    pub ppy: usize,
    /// Number of independent paths to generate.
    pub n_paths: usize,
    /// Seed for the pseudo-random number generator (reproducibility).
    pub seed: u64,
}

/// Summary statistics of the terminal equity distribution.
#[derive(Debug, Clone)]
pub struct TerminalSummary {
    pub mean: f64,
    pub median: f64,
    pub p5: f64,
    pub p25: f64,
    pub p75: f64,
    pub p95: f64,
    pub std: f64,
    /// Fraction of paths that end below `start_value` (probability of loss).
    pub prob_loss: f64,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Simulate GBM paths.
///
/// Returns a `(n_steps + 1) × n_paths` matrix.  Row 0 equals `start_value`
/// for every path; subsequent rows are simulated equity levels.
///
/// On non-wasm platforms paths are generated in parallel with Rayon.
pub fn simulate(params: &GbmParams) -> DMatrix<f64> {
    let dt = 1.0 / params.ppy as f64;
    let n_steps = (params.years * params.ppy as f64).round() as usize;
    let log_start = params.start_value.ln();
    let mu_dt = (params.mu_annual - 0.5 * params.vol_annual.powi(2)) * dt;
    let sigma_dt = params.vol_annual * dt.sqrt();

    let paths = generate_all_paths(params.n_paths, n_steps, log_start, mu_dt, sigma_dt, params.seed);

    // Assemble into (n_steps+1) × n_paths matrix
    let mut out = DMatrix::zeros(n_steps + 1, params.n_paths);
    for (p, path) in paths.iter().enumerate() {
        for (t, &val) in path.iter().enumerate() {
            out[(t, p)] = val;
        }
    }
    out
}

/// Compute summary statistics from a simulation matrix.
///
/// `paths` is the `(n_steps+1) × n_paths` matrix returned by [`simulate`].
pub fn summarize_terminal(paths: &DMatrix<f64>, start_value: f64) -> TerminalSummary {
    let n_paths = paths.ncols();
    if n_paths == 0 || paths.nrows() == 0 {
        return TerminalSummary {
            mean: f64::NAN,
            median: f64::NAN,
            p5: f64::NAN,
            p25: f64::NAN,
            p75: f64::NAN,
            p95: f64::NAN,
            std: f64::NAN,
            prob_loss: f64::NAN,
        };
    }

    let last_row = paths.nrows() - 1;
    let mut terminal: Vec<f64> = (0..n_paths).map(|p| paths[(last_row, p)]).collect();
    terminal.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let n = terminal.len() as f64;
    let mean = terminal.iter().sum::<f64>() / n;

    let var = terminal.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
    let std = var.sqrt();

    let prob_loss = terminal.iter().filter(|&&x| x < start_value).count() as f64 / n;

    TerminalSummary {
        mean,
        median: quantile_sorted(&terminal, 0.50),
        p5: quantile_sorted(&terminal, 0.05),
        p25: quantile_sorted(&terminal, 0.25),
        p75: quantile_sorted(&terminal, 0.75),
        p95: quantile_sorted(&terminal, 0.95),
        std,
        prob_loss,
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Generate a single GBM path (returns a Vec of length n_steps+1).
///
/// Each path gets a derived seed so paths are independent but reproducible.
fn single_path(path_idx: usize, base_seed: u64, n_steps: usize, log_start: f64, mu_dt: f64, sigma_dt: f64) -> Vec<f64> {
    // Derive a unique seed per path via a simple mixing function.
    let seed = base_seed
        .wrapping_add(path_idx as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let normal = Normal::new(0.0_f64, 1.0).unwrap();

    let mut path = Vec::with_capacity(n_steps + 1);
    path.push(log_start.exp()); // row 0 = start_value

    let mut log_s = log_start;
    for _ in 0..n_steps {
        let z = normal.sample(&mut rng);
        log_s += mu_dt + sigma_dt * z;
        path.push(log_s.exp());
    }
    path
}

/// Generate all paths — parallel on native, sequential on wasm32.
#[cfg(not(target_arch = "wasm32"))]
fn generate_all_paths(
    n_paths: usize,
    n_steps: usize,
    log_start: f64,
    mu_dt: f64,
    sigma_dt: f64,
    seed: u64,
) -> Vec<Vec<f64>> {
    use rayon::prelude::*;
    (0..n_paths)
        .into_par_iter()
        .map(|p| single_path(p, seed, n_steps, log_start, mu_dt, sigma_dt))
        .collect()
}

#[cfg(target_arch = "wasm32")]
fn generate_all_paths(
    n_paths: usize,
    n_steps: usize,
    log_start: f64,
    mu_dt: f64,
    sigma_dt: f64,
    seed: u64,
) -> Vec<Vec<f64>> {
    (0..n_paths)
        .map(|p| single_path(p, seed, n_steps, log_start, mu_dt, sigma_dt))
        .collect()
}

/// Linear-interpolation quantile on a *sorted* slice.
fn quantile_sorted(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let n = sorted.len();
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
