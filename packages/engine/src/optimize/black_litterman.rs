//! Black-Litterman model.
//!
//! Blends market-implied equilibrium returns with investor views to produce
//! a posterior expected-return vector and covariance matrix, then traces
//! the efficient frontier on the posterior distribution.
//!
//! The derivation follows He & Litterman (1999) and Idzorek (2005).
//! Works on both native and `wasm32` targets (pure nalgebra, no Clarabel).

use nalgebra::{DMatrix, DVector};

use crate::EngineError;
use super::frontier::{trace, FrontierResult};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A single investor view on expected asset returns.
pub struct View {
    /// Indices of assets this view is about.
    pub asset_indices: Vec<usize>,
    /// Pick weights: `+1` for absolute/long side, `-1` for short side.
    /// Length must equal `asset_indices`.
    pub weights: Vec<f64>,
    /// The view's expected return (annualised, e.g. `0.15` = 15 %).
    pub expected_return: f64,
    /// Confidence in [0, 1). Higher = more confident, lower = more uncertain.
    pub confidence: f64,
}

/// Output of the Black-Litterman solver.
pub struct BlackLittermanResult {
    /// Posterior expected return vector (annualised), length = n_assets.
    pub posterior_mu: DVector<f64>,
    /// Posterior covariance matrix.
    pub posterior_cov: DMatrix<f64>,
    /// Market-implied (equilibrium) returns  π = δ · Σ · w_mkt.
    pub implied_returns: DVector<f64>,
    /// Efficient frontier traced on the posterior distribution.
    pub frontier: FrontierResult,
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/// Black-Litterman solver.
///
/// # Arguments
/// - `cov`            — annualised N×N covariance matrix.
/// - `market_weights` — N-vector of market-cap or equal weights (must sum ≈ 1).
/// - `rf`             — risk-free rate (annualised).
/// - `market_return`  — expected market portfolio return (annualised).
/// - `views`          — investor views (may be empty).
/// - `tau`            — prior uncertainty scalar (0.01–0.20, typically 0.05).
/// - `long_only`, `lb`, `ub` — weight constraints for the frontier solver.
/// - `n_pts`          — number of target returns on the frontier.
///
/// # Errors
/// [`EngineError::InvalidInput`] for bad arguments.
/// [`EngineError::InfeasibleProblem`] if the posterior frontier is infeasible.
/// [`EngineError::OptimizationFailed`] if a required matrix is singular.
pub fn solve(
    cov: &DMatrix<f64>,
    market_weights: &DVector<f64>,
    rf: f64,
    market_return: f64,
    views: &[View],
    tau: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
    n_pts: usize,
) -> Result<BlackLittermanResult, EngineError> {
    let n = cov.nrows();
    if n == 0 {
        return Err(EngineError::InvalidInput("empty asset universe".into()));
    }
    if cov.ncols() != n {
        return Err(EngineError::InvalidInput("covariance matrix is not square".into()));
    }
    if market_weights.len() != n {
        return Err(EngineError::InvalidInput(format!(
            "market_weights length {} != n_assets {n}",
            market_weights.len()
        )));
    }
    if tau <= 0.0 {
        return Err(EngineError::InvalidInput("tau must be > 0".into()));
    }

    // ── Step 1: market variance and risk-aversion coefficient δ ─────────────
    // σ²_m = w_mkt' Σ w_mkt
    let cov_w = cov * market_weights;
    let market_var = market_weights.dot(&cov_w).max(1e-16);
    let delta = (market_return - rf) / market_var;

    // ── Step 2: implied equilibrium returns  π = δ · Σ · w_mkt ─────────────
    let pi: DVector<f64> = cov_w.scale(delta);

    // ── Step 3: no views → run frontier directly on (π, Σ) ──────────────────
    if views.is_empty() {
        let frontier = trace(&pi, cov, n_pts, long_only, lb, ub, rf)
            .map_err(|e| match e {
                EngineError::InfeasibleProblem => EngineError::InfeasibleProblem,
                other => EngineError::OptimizationFailed(other.to_string()),
            })?;
        return Ok(BlackLittermanResult {
            posterior_mu: pi.clone(),
            posterior_cov: cov.clone(),
            implied_returns: pi,
            frontier,
        });
    }

    let k = views.len();

    // ── Step 4: build pick matrix P (K×N) and view vector Q (K) ─────────────
    let mut p_mat = DMatrix::<f64>::zeros(k, n);
    let mut q_vec = DVector::<f64>::zeros(k);

    for (i, view) in views.iter().enumerate() {
        if view.asset_indices.len() != view.weights.len() {
            return Err(EngineError::InvalidInput(format!(
                "view {i}: asset_indices and weights lengths differ"
            )));
        }
        for (&idx, &w) in view.asset_indices.iter().zip(view.weights.iter()) {
            if idx >= n {
                return Err(EngineError::InvalidInput(format!(
                    "view {i}: asset index {idx} out of range (n={n})"
                )));
            }
            p_mat[(i, idx)] += w; // accumulate in case the same asset appears twice
        }
        q_vec[i] = view.expected_return;
    }

    // ── Step 5: build Ω diagonal (K) ────────────────────────────────────────
    // Ω_ii = (1/conf_i − 1) · τ · (P_i · Σ · P_i')
    //
    // This sets view uncertainty proportional to its implied prior variance.
    // conf → 1 ⟹ Ω_ii → 0 (views dominate)
    // conf → 0 ⟹ Ω_ii → ∞ (views ignored)
    let mut omega = DVector::<f64>::zeros(k);
    for i in 0..k {
        let p_row: DVector<f64> = p_mat.row(i).transpose();
        let sigma_p = cov * &p_row;
        let p_sigma_p = p_row.dot(&sigma_p).max(0.0);
        let conf = views[i].confidence.clamp(1e-6, 0.9999);
        omega[i] = ((1.0 / conf) - 1.0) * tau * p_sigma_p;
        if omega[i] < 1e-14 {
            omega[i] = 1e-14; // guard against numerical zero
        }
    }

    // ── Step 6: compute (τΣ)⁻¹ with regularisation ──────────────────────────
    let max_diag: f64 = (0..n).map(|i| cov[(i, i)]).fold(0.0_f64, f64::max);
    let eps = 1e-8 * max_diag.max(1e-12);

    let tau_sigma_inv = invert_with_reg(cov, tau, eps)?;

    // ── Step 7: M = (τΣ)⁻¹ + P' Ω⁻¹ P ─────────────────────────────────────
    // P' Ω⁻¹ P = Σ_i (1/ω_i) · p_i · p_i'
    let mut big_m = tau_sigma_inv.clone();
    for i in 0..k {
        let p_row: DVector<f64> = p_mat.row(i).transpose();
        let inv_omega_i = 1.0 / omega[i];
        for r in 0..n {
            for c in 0..n {
                big_m[(r, c)] += inv_omega_i * p_row[r] * p_row[c];
            }
        }
    }

    // ── Step 8: Λ = M⁻¹ ─────────────────────────────────────────────────────
    let lambda = big_m.clone().try_inverse().ok_or_else(|| {
        EngineError::OptimizationFailed(
            "M = (τΣ)⁻¹ + P'Ω⁻¹P is singular; try adjusting view confidences".into(),
        )
    })?;

    // ── Step 9: posterior expected returns ───────────────────────────────────
    // RHS = (τΣ)⁻¹·π + P'Ω⁻¹Q
    let mut rhs: DVector<f64> = &tau_sigma_inv * &pi;
    for i in 0..k {
        let p_row: DVector<f64> = p_mat.row(i).transpose();
        rhs += p_row.scale(q_vec[i] / omega[i]);
    }
    let posterior_mu: DVector<f64> = &lambda * &rhs;

    // ── Step 10: posterior covariance ────────────────────────────────────────
    // Σ_BL = Σ + Λ   (adds uncertainty about μ itself)
    let posterior_cov: DMatrix<f64> = cov + &lambda;

    // ── Step 11: trace efficient frontier on posterior distribution ──────────
    let frontier = trace(&posterior_mu, &posterior_cov, n_pts, long_only, lb, ub, rf)
        .map_err(|e| match e {
            EngineError::InfeasibleProblem => EngineError::InfeasibleProblem,
            other => EngineError::OptimizationFailed(other.to_string()),
        })?;

    Ok(BlackLittermanResult {
        posterior_mu,
        posterior_cov,
        implied_returns: pi,
        frontier,
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Compute `(τ · Σ_reg)⁻¹` where `Σ_reg = Σ + eps · I`.
/// Falls back to larger regularisation on first failure.
fn invert_with_reg(
    cov: &DMatrix<f64>,
    tau: f64,
    eps: f64,
) -> Result<DMatrix<f64>, EngineError> {
    let n = cov.nrows();

    // Try with mild regularisation first.
    let mut cov_reg = cov.clone();
    for i in 0..n { cov_reg[(i, i)] += eps; }
    if let Some(inv) = cov_reg.scale(tau).try_inverse() {
        return Ok(inv);
    }

    // Stronger regularisation.
    let max_diag: f64 = (0..n).map(|i| cov[(i, i)]).fold(0.0_f64, f64::max);
    let mut cov_reg2 = cov.clone();
    for i in 0..n { cov_reg2[(i, i)] += 1e-4 * max_diag.max(1e-8); }
    cov_reg2.scale(tau).try_inverse().ok_or_else(|| {
        EngineError::OptimizationFailed(
            "τΣ is singular even after regularisation".into(),
        )
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::{DMatrix, DVector};

    /// Build a simple diagonal covariance matrix for n assets with given vols.
    fn diag_cov(vols: &[f64]) -> DMatrix<f64> {
        let n = vols.len();
        let mut m = DMatrix::zeros(n, n);
        for (i, &v) in vols.iter().enumerate() {
            m[(i, i)] = v * v; // variance = vol²
        }
        m
    }

    fn equal_weights(n: usize) -> DVector<f64> {
        DVector::from_element(n, 1.0 / n as f64)
    }

    // ── Test 1: absolute view tilts posterior toward the viewed asset ────────
    #[test]
    fn test_absolute_view_tilts_posterior() {
        // 3 assets, independent, equal vols.
        let cov = diag_cov(&[0.20, 0.20, 0.20]); // annual vols = 20%
        let w_mkt = equal_weights(3);
        let rf = 0.02;
        let market_return = 0.08; // 8% market return

        // Absolute view: asset 0 will return 15%
        let views = vec![View {
            asset_indices: vec![0],
            weights: vec![1.0],
            expected_return: 0.15,
            confidence: 0.5,
        }];

        let result = solve(&cov, &w_mkt, rf, market_return, &views, 0.05, true, 0.0, 1.0, 10)
            .expect("BL solve should succeed");

        // Posterior for asset 0 should exceed implied (equilibrium) for asset 0.
        assert!(
            result.posterior_mu[0] > result.implied_returns[0],
            "posterior_mu[0]={:.4} should exceed implied_returns[0]={:.4}",
            result.posterior_mu[0],
            result.implied_returns[0],
        );
        // Assets 1 and 2 should not change as much (symmetric, independent).
        let delta0 = result.posterior_mu[0] - result.implied_returns[0];
        let delta1 = (result.posterior_mu[1] - result.implied_returns[1]).abs();
        assert!(
            delta0 > delta1,
            "view on asset 0 should move it more than unviewed assets"
        );
    }

    // ── Test 2: no views → posterior = equilibrium ──────────────────────────
    #[test]
    fn test_no_views_returns_equilibrium() {
        let cov = diag_cov(&[0.15, 0.20, 0.25]);
        let w_mkt = equal_weights(3);

        let result = solve(&cov, &w_mkt, 0.02, 0.07, &[], 0.05, true, 0.0, 1.0, 10)
            .expect("BL with no views should succeed");

        // With no views, posterior_mu = implied_returns exactly.
        for i in 0..3 {
            let diff = (result.posterior_mu[i] - result.implied_returns[i]).abs();
            assert!(diff < 1e-10, "posterior_mu[{i}] should equal implied_returns[{i}]");
        }
        // Frontier should have at least one feasible portfolio.
        assert!(result.frontier.weights.nrows() > 0);
    }

    // ── Test 3: relative view (asset 0 outperforms asset 1 by 3%) ───────────
    #[test]
    fn test_relative_view_changes_spread() {
        let cov = diag_cov(&[0.20, 0.20, 0.20]);
        let w_mkt = equal_weights(3);

        // "Asset 0 will outperform asset 1 by 3%"
        let views = vec![View {
            asset_indices: vec![0, 1],
            weights: vec![1.0, -1.0],
            expected_return: 0.03,
            confidence: 0.7,
        }];

        let result = solve(&cov, &w_mkt, 0.02, 0.08, &views, 0.05, true, 0.0, 1.0, 10)
            .expect("BL relative view should succeed");

        let implied_spread = result.implied_returns[0] - result.implied_returns[1];
        let post_spread   = result.posterior_mu[0]     - result.posterior_mu[1];
        // The view says asset 0 outperforms: posterior spread should exceed implied spread.
        assert!(
            post_spread > implied_spread,
            "posterior spread {post_spread:.4} should exceed implied spread {implied_spread:.4}"
        );
    }

    // ── Test 4: view packing round-trip (verifies WASM bridge format) ────────
    #[test]
    fn test_packed_view_parsing() {
        // Pack: n_views=2
        // View 0: absolute on asset 1, return 0.12, confidence 0.6
        // View 1: relative (asset 0 vs asset 2), return 0.04, confidence 0.8
        let packed: Vec<f64> = vec![
            2.0,                    // n_views
            // view 0
            1.0, 1.0, 1.0, 0.12, 0.6,
            // view 1
            2.0, 0.0, 1.0, 2.0, -1.0, 0.04, 0.8,
        ];

        let (views, n_read) = parse_views_packed(&packed, 3).unwrap();
        assert_eq!(views.len(), 2);
        assert_eq!(n_read, packed.len());

        let v0 = &views[0];
        assert_eq!(v0.asset_indices, vec![1]);
        assert_eq!(v0.weights, vec![1.0]);
        assert!((v0.expected_return - 0.12).abs() < 1e-12);
        assert!((v0.confidence - 0.6).abs() < 1e-12);

        let v1 = &views[1];
        assert_eq!(v1.asset_indices, vec![0, 2]);
        assert_eq!(v1.weights, vec![1.0, -1.0]);
        assert!((v1.expected_return - 0.04).abs() < 1e-12);
        assert!((v1.confidence - 0.8).abs() < 1e-12);
    }
}

// ---------------------------------------------------------------------------
// Packed-view parser (shared with WASM bridge)
// ---------------------------------------------------------------------------

/// Parse a flat `views_packed` slice into `Vec<View>`.
///
/// Format:
/// ```text
/// [n_views,
///   per view: n_picks, idx_0, w_0, idx_1, w_1, …, expected_return, confidence,
///   …]
/// ```
///
/// Returns `(views, n_consumed)` on success or an error string.
pub fn parse_views_packed(
    packed: &[f64],
    n_assets: usize,
) -> Result<(Vec<View>, usize), String> {
    if packed.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let n_views = packed[0] as usize;
    let mut idx = 1_usize;
    let mut views = Vec::with_capacity(n_views);

    for vi in 0..n_views {
        if idx >= packed.len() {
            return Err(format!("views_packed truncated before view {vi}"));
        }
        let n_picks = packed[idx] as usize;
        idx += 1;

        let required = 2 * n_picks + 2; // idx/weight pairs + return + confidence
        if idx + required > packed.len() {
            return Err(format!("views_packed truncated in view {vi}"));
        }

        let mut asset_indices = Vec::with_capacity(n_picks);
        let mut weights = Vec::with_capacity(n_picks);
        for _ in 0..n_picks {
            let asset_idx = packed[idx] as usize;
            if asset_idx >= n_assets {
                return Err(format!(
                    "view {vi}: asset index {asset_idx} >= n_assets {n_assets}"
                ));
            }
            asset_indices.push(asset_idx);
            weights.push(packed[idx + 1]);
            idx += 2;
        }

        let expected_return = packed[idx];
        let confidence = packed[idx + 1];
        idx += 2;

        views.push(View { asset_indices, weights, expected_return, confidence });
    }

    Ok((views, idx))
}
