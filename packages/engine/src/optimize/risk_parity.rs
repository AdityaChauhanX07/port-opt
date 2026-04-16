//! Equal Risk Contribution (risk-parity) portfolio optimiser.
//!
//! Minimises the sum of squared deviations between each asset's risk
//! contribution and the equal target `σ²/n`:
//!
//! ```text
//! f(w) = Σᵢ (RCᵢ − σ²/n)²
//! RCᵢ  = wᵢ · (Σw)ᵢ
//! σ²   = wᵀΣw
//! ```
//!
//! The feasible set is `{ w : Σwᵢ = 1, lb ≤ wᵢ ≤ ub }`.
//! Uses projected-gradient descent with backtracking line search.

use nalgebra::{DMatrix, DVector};

use crate::EngineError;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Compute Equal Risk Contribution weights.
///
/// `lb` is clamped to 0 (long-only is always enforced).
///
/// # Errors
/// Returns [`EngineError::InvalidInput`] for bad dimensions or bounds.
/// Returns [`EngineError::OptimizationFailed`] if the solver fails to converge.
pub fn solve(cov: &DMatrix<f64>, lb: f64, ub: f64) -> Result<DVector<f64>, EngineError> {
    let n = cov.nrows();
    if n == 0 {
        return Err(EngineError::InvalidInput("empty asset universe".into()));
    }
    if cov.ncols() != n {
        return Err(EngineError::InvalidInput("cov is not square".into()));
    }
    // Single asset: only feasible weight is 1.
    if n == 1 {
        return Ok(DVector::from_element(1, 1.0));
    }

    let eff_lb = lb.max(0.0);
    if eff_lb > ub {
        return Err(EngineError::InvalidInput("lb > ub".into()));
    }

    // Check feasibility: n*lb < 1 < n*ub
    let n_f = n as f64;
    if n_f * eff_lb >= 1.0 - 1e-9 || n_f * ub <= 1.0 + 1e-9 {
        return Err(EngineError::InvalidInput(
            "box constraints are infeasible for sum-to-1".into(),
        ));
    }

    // Initial guess: equal weight (already feasible when eff_lb ≤ 1/n ≤ ub)
    let init = (1.0 / n_f).clamp(eff_lb, ub);
    let mut w = DVector::from_element(n, init);
    project_onto_feasible(&mut w, eff_lb, ub);

    // Scale covariance so the average diagonal entry ≈ 1.
    // ERC is scale-invariant: if Σ → αΣ, the ERC weights are unchanged.
    // This avoids the gradient-scale issue when cov is at per-period scale (~1e-6).
    let diag_mean: f64 = (0..n).map(|i| cov[(i, i)]).sum::<f64>() / n_f;
    let cov_scale = diag_mean.max(1e-30);
    let cov_s = cov / cov_scale;

    // Phase 1 — Multiplicative ERC fixed-point iteration (scale-invariant, fast).
    //
    // ERC condition:  w_i · (Σw)_i = constant  ∀i
    // Rearranging:    w_i ∝ 1 / (Σw)_i  at the fixed point.
    // Update:         w_i^{k+1} = sqrt(w_i^k / (Σw^k)_i)  (Roncalli 2013)
    // Normalise to sum=1 after each step; apply box constraints via re-projection.
    const MAX_ITER: usize = 2_000;
    const TOL: f64 = 1e-10;

    for _ in 0..MAX_ITER {
        let cw: DVector<f64> = &cov_s * &w;

        // Multiplicative update: scale-invariant square-root fixed point.
        let mut w_new = DVector::from_fn(n, |i, _| {
            if cw[i] > 1e-30 {
                (w[i] / cw[i]).sqrt()
            } else {
                w[i]
            }
        });

        // Normalise.
        let s: f64 = w_new.sum();
        if s < 1e-30 {
            break;
        }
        w_new /= s;

        // Re-project onto box × simplex constraints.
        project_onto_feasible(&mut w_new, eff_lb, ub);

        let diff: f64 = (&w_new - &w).amax();
        w = w_new;
        if diff < TOL {
            break;
        }
    }

    // Phase 2 — Projected-gradient refinement (handles active box constraints).
    // Only needed when the multiplicative phase stagnates near a bound.
    let mut step = 1e-2;
    for _ in 0..2_000 {
        let (f0, grad) = objective_and_grad(&cov_s, &w);
        if f0 < TOL {
            break;
        }
        let mut alpha = step;
        let mut improved = false;
        for _ in 0..40 {
            let mut w_new = &w - alpha * &grad;
            project_onto_feasible(&mut w_new, eff_lb, ub);
            let (f1, _) = objective_and_grad(&cov_s, &w_new);
            if f1 < f0 {
                w = w_new;
                step = alpha * 1.05;
                improved = true;
                break;
            }
            alpha *= 0.5;
            if alpha < 1e-18 {
                break;
            }
        }
        if !improved {
            break;
        }
    }

    // Final feasibility: clip + renormalise for tiny numerical drift.
    for i in 0..n {
        w[i] = w[i].max(0.0);
    }
    let s: f64 = w.iter().sum();
    if s < 1e-12 {
        return Err(EngineError::OptimizationFailed(
            "risk parity produced zero weights".into(),
        ));
    }
    w /= s;

    Ok(w)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Compute f(w) = Σᵢ(RCᵢ − σ²/n)² and its analytical gradient.
fn objective_and_grad(cov: &DMatrix<f64>, w: &DVector<f64>) -> (f64, DVector<f64>) {
    let n = w.len();
    let cw: DVector<f64> = cov * w;
    let port_var = w.dot(&cw);

    if port_var <= 0.0 {
        return (1e10, DVector::zeros(n));
    }

    let n_f = n as f64;
    let target = port_var / n_f;

    // Risk contributions RCᵢ = wᵢ · (Σw)ᵢ
    let rc: DVector<f64> = DVector::from_fn(n, |i, _| w[i] * cw[i]);
    let residual: DVector<f64> = DVector::from_fn(n, |i, _| rc[i] - target);

    let f: f64 = residual.iter().map(|&r| r * r).sum();

    // Gradient: df/dw_j = 2 · Σᵢ (RCᵢ − target) · d(RCᵢ − target)/dw_j
    //
    // d(RCᵢ)/dw_j = (Σw)ᵢ · δᵢⱼ + wᵢ · Σᵢⱼ
    // d(target)/dw_j = (2/n) · (Σw)ⱼ
    let mut grad = DVector::zeros(n);
    for j in 0..n {
        let d_target = 2.0 * cw[j] / n_f;
        let mut g = 0.0;
        for i in 0..n {
            let d_rc = if i == j {
                cw[i] + w[i] * cov[(i, j)]
            } else {
                w[i] * cov[(i, j)]
            };
            g += residual[i] * (d_rc - d_target);
        }
        grad[j] = 2.0 * g;
    }

    (f, grad)
}

/// Project `w` onto `{ sum = 1, lb ≤ wᵢ ≤ ub }` via bisection on the
/// dual variable λ satisfying `Σ clip(wᵢ − λ, lb, ub) = 1`.
fn project_onto_feasible(w: &mut DVector<f64>, lb: f64, ub: f64) {
    let n = w.len();

    // f(λ) = Σᵢ clip(wᵢ − λ, lb, ub) — strictly decreasing.
    // Bracket: f(lam_lo) = n·ub ≥ 1, f(lam_hi) = n·lb ≤ 1.
    let w_min = w.iter().cloned().fold(f64::INFINITY, f64::min);
    let w_max = w.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let mut lam_lo = w_min - ub; // f = n·ub
    let mut lam_hi = w_max - lb; // f = n·lb

    // Bisect to find λ* where f(λ*) ≈ 1.
    for _ in 0..100 {
        let mid = 0.5 * (lam_lo + lam_hi);
        let fmid: f64 = (0..n).map(|i| (w[i] - mid).clamp(lb, ub)).sum();
        if fmid > 1.0 {
            lam_lo = mid;
        } else {
            lam_hi = mid;
        }
        if (lam_hi - lam_lo).abs() < 1e-14 {
            break;
        }
    }

    let lam = 0.5 * (lam_lo + lam_hi);
    for i in 0..n {
        w[i] = (w[i] - lam).clamp(lb, ub);
    }
}
