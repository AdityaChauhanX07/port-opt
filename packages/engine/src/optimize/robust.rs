//! Robust mean–variance optimisation with ellipsoidal return uncertainty.
//!
//! On `wasm32-unknown-unknown` Clarabel is not available; the public function
//! returns `EngineError::OptimizationFailed` with an explanatory message.

use nalgebra::{DMatrix, DVector};

use crate::EngineError;

#[cfg(not(target_arch = "wasm32"))]
use clarabel::algebra::*;
#[cfg(not(target_arch = "wasm32"))]
use clarabel::solver::*;
#[cfg(not(target_arch = "wasm32"))]
use nalgebra::SymmetricEigen;

// ---------------------------------------------------------------------------
// Public API — native
// ---------------------------------------------------------------------------

/// Compute robust portfolio weights via SOCP.
#[cfg(not(target_arch = "wasm32"))]
pub fn solve(
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    gamma: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> Result<DVector<f64>, EngineError> {
    let n = mu.len();
    if n == 0 {
        return Err(EngineError::InvalidInput("empty asset universe".into()));
    }
    if cov.nrows() != n || cov.ncols() != n {
        return Err(EngineError::InvalidInput(format!(
            "cov is {}×{}, expected {n}×{n}",
            cov.nrows(), cov.ncols()
        )));
    }

    let eff_lb = if long_only { lb.max(0.0) } else { lb };

    // Σ^½ via eigendecomposition (handles semi-definiteness).
    let eigen = SymmetricEigen::new(cov.clone());
    let sqrt_eigvals: DVector<f64> = eigen.eigenvalues.map(|v| v.max(0.0).sqrt());
    let l: DMatrix<f64> = &eigen.eigenvectors
        * DMatrix::from_diagonal(&sqrt_eigvals)
        * eigen.eigenvectors.transpose();

    // Decision variables: x = [w (n), t (1)]
    let n_vars = n + 1;
    let p: CscMatrix<f64> = CscMatrix::zeros((n_vars, n_vars));
    let mut q = vec![0.0f64; n_vars];
    for i in 0..n { q[i] = -mu[i]; }
    q[n] = gamma;

    let m = 3 * n + 2;
    let nnz = n * (3 + n) + 1;

    let mut colptr: Vec<usize> = Vec::with_capacity(n_vars + 1);
    let mut rowval: Vec<usize> = Vec::with_capacity(nnz);
    let mut nzval: Vec<f64> = Vec::with_capacity(nnz);

    colptr.push(0);

    for j in 0..n {
        rowval.push(0);          nzval.push(1.0);
        rowval.push(1 + j);      nzval.push(-1.0);
        rowval.push(n + 1 + j);  nzval.push(1.0);
        for k in 0..n {
            rowval.push(2 * n + 2 + k);
            nzval.push(-l[(k, j)]);
        }
        colptr.push(rowval.len());
    }

    // Column n — auxiliary t
    rowval.push(2 * n + 1);
    nzval.push(-1.0);
    colptr.push(rowval.len());

    let a = CscMatrix::new(m, n_vars, colptr, rowval, nzval);

    let mut b = vec![0.0f64; m];
    b[0] = 1.0;
    for j in 0..n {
        b[1 + j] = -eff_lb;
        b[n + 1 + j] = ub;
    }

    let cones = [
        ZeroConeT(1),
        NonnegativeConeT(n),
        NonnegativeConeT(n),
        SecondOrderConeT(n + 1),
    ];

    let settings = DefaultSettings { verbose: false, ..DefaultSettings::default() };
    let mut solver = DefaultSolver::new(&p, &q, &a, &b, &cones, settings);
    solver.solve();

    match solver.solution.status {
        SolverStatus::Solved | SolverStatus::AlmostSolved => {
            let x = &solver.solution.x;
            let mut w = DVector::from_column_slice(&x[..n]);
            if long_only {
                for i in 0..n { w[i] = w[i].max(0.0); }
            }
            let s: f64 = w.iter().sum();
            if s > 1e-12 { w /= s; }
            Ok(w)
        }
        SolverStatus::PrimalInfeasible
        | SolverStatus::DualInfeasible
        | SolverStatus::AlmostPrimalInfeasible
        | SolverStatus::AlmostDualInfeasible => Err(EngineError::InfeasibleProblem),
        other => Err(EngineError::OptimizationFailed(format!("{other:?}"))),
    }
}

// ---------------------------------------------------------------------------
// Public API — WASM implementation (projected gradient descent)
// ---------------------------------------------------------------------------

/// Project `w` onto `{ 1ᵀw = 1, lb ≤ wᵢ ≤ ub }` via bisection on λ.
#[cfg(target_arch = "wasm32")]
fn project_simplex(w: &mut DVector<f64>, lb: f64, ub: f64) {
    let n = w.len();
    let w_min = w.iter().cloned().fold(f64::INFINITY, f64::min);
    let w_max = w.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let mut lam_lo = w_min - ub;
    let mut lam_hi = w_max - lb;
    for _ in 0..100 {
        let mid = 0.5 * (lam_lo + lam_hi);
        let fmid: f64 = (0..n).map(|i| (w[i] - mid).clamp(lb, ub)).sum();
        if fmid > 1.0 { lam_lo = mid; } else { lam_hi = mid; }
        if (lam_hi - lam_lo).abs() < 1e-14 { break; }
    }
    let lam = 0.5 * (lam_lo + lam_hi);
    for i in 0..n { w[i] = (w[i] - lam).clamp(lb, ub); }
}

/// WASM: Robust mean–variance via projected gradient descent.
///
/// Objective: min  −μᵀw + γ √(wᵀΣw)
/// Gradient:  g = −μ + γ · Σw / √(wᵀΣw)   (when wᵀΣw > 0)
/// mu and cov are already annualised by the WASM bridge.
#[cfg(target_arch = "wasm32")]
pub fn solve(
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    gamma: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> Result<DVector<f64>, EngineError> {
    let n = mu.len();
    if n == 0 {
        return Err(EngineError::InvalidInput("empty asset universe".into()));
    }
    if cov.nrows() != n || cov.ncols() != n {
        return Err(EngineError::InvalidInput(format!(
            "cov is {}×{}, expected {n}×{n}",
            cov.nrows(),
            cov.ncols()
        )));
    }
    let eff_lb = if long_only { lb.max(0.0) } else { lb };
    if eff_lb > ub + 1e-12 {
        return Err(EngineError::InvalidInput("lb > ub".into()));
    }
    let n_f = n as f64;

    // Scale Σ and μ to O(1) magnitudes.
    let diag_sum: f64 = (0..n).map(|i| cov[(i, i)]).sum();
    let cov_scale = (diag_sum / n_f).max(1e-30);
    let mu_scale = mu.amax().max(1e-30);
    let cov_s = cov / cov_scale;
    let mu_s: DVector<f64> = mu / mu_scale;

    // Robust objective (in scaled space).
    let robust_obj = |v: &DVector<f64>| -> f64 {
        let sv = &cov_s * v;
        let variance = v.dot(&sv).max(0.0);
        -mu_s.dot(v) + gamma * variance.sqrt()
    };

    // Warm start: equal weights.
    let w_0 = (1.0 / n_f).clamp(eff_lb, ub);
    let mut w = DVector::from_element(n, w_0);
    project_simplex(&mut w, eff_lb, ub);

    // Initial step size from Lipschitz bound.
    let lip = cov_s.norm() + 1.0;
    let mut step = 1.0 / lip;

    const MAX_ITER: usize = 8_000;
    const TOL: f64 = 1e-10;

    for _ in 0..MAX_ITER {
        let sw = &cov_s * &w;
        let variance = w.dot(&sw).max(0.0);
        let grad = if variance > 1e-30 {
            let vol = variance.sqrt();
            -&mu_s + sw.scale(gamma / vol)
        } else {
            -&mu_s
        };

        let mut w_new = &w - step * &grad;
        project_simplex(&mut w_new, eff_lb, ub);

        if robust_obj(&w_new) <= robust_obj(&w) {
            let diff = (&w_new - &w).norm();
            w = w_new;
            step *= 1.1;
            if diff < TOL { break; }
        } else {
            step *= 0.5;
            if step < 1e-20 { break; }
        }
    }

    Ok(w)
}
