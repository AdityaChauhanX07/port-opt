//! CVaR-minimising portfolio via the Rockafellar–Uryasev LP reformulation.
//!
//! On `wasm32-unknown-unknown` Clarabel is not available; the public function
//! returns `EngineError::OptimizationFailed` with an explanatory message.

use nalgebra::{DMatrix, DVector};

use crate::EngineError;

#[cfg(not(target_arch = "wasm32"))]
use clarabel::algebra::*;
#[cfg(not(target_arch = "wasm32"))]
use clarabel::solver::*;

// ---------------------------------------------------------------------------
// Public API — native
// ---------------------------------------------------------------------------

/// Minimise CVaR at confidence level `alpha` over historical `returns` (T × n).
///
/// # Errors
/// Returns [`EngineError::InvalidInput`] for bad inputs.
/// Returns [`EngineError::InfeasibleProblem`] / [`EngineError::OptimizationFailed`]
/// on solver failure.
#[cfg(not(target_arch = "wasm32"))]
pub fn solve(
    returns: &DMatrix<f64>,
    alpha: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> Result<DVector<f64>, EngineError> {
    let t_rows = returns.nrows();
    let n = returns.ncols();

    if n == 0 || t_rows == 0 {
        return Err(EngineError::InvalidInput("returns matrix is empty".into()));
    }
    if !(0.0 < alpha && alpha < 1.0) {
        return Err(EngineError::InvalidInput("alpha must be in (0, 1)".into()));
    }

    let eff_lb = if long_only { lb.max(0.0) } else { lb };
    let n_vars = n + 1 + t_rows;

    // Objective: P = 0 (LP), q = [0,...,0, 1, c,...,c]
    let p: CscMatrix<f64> = CscMatrix::zeros((n_vars, n_vars));
    let cvar_coeff = 1.0 / ((1.0 - alpha) * t_rows as f64);
    let mut q = vec![0.0f64; n_vars];
    q[n] = 1.0;
    for t in 0..t_rows {
        q[n + 1 + t] = cvar_coeff;
    }

    // Constraint matrix A  (m rows × n_vars cols)
    let m = 1 + 2 * n + 2 * t_rows;
    let nnz = n * (3 + t_rows) + t_rows + 2 * t_rows;

    let mut colptr: Vec<usize> = Vec::with_capacity(n_vars + 1);
    let mut rowval: Vec<usize> = Vec::with_capacity(nnz);
    let mut nzval: Vec<f64> = Vec::with_capacity(nnz);

    colptr.push(0);

    // Columns 0..n-1 — weights wⱼ
    for j in 0..n {
        rowval.push(0);        nzval.push(1.0);
        rowval.push(1 + j);    nzval.push(-1.0);
        rowval.push(n + 1 + j); nzval.push(1.0);
        for t in 0..t_rows {
            rowval.push(2 * n + t_rows + 1 + t);
            nzval.push(-returns[(t, j)]);
        }
        colptr.push(rowval.len());
    }

    // Column n — ζ (VaR threshold)
    for t in 0..t_rows {
        rowval.push(2 * n + t_rows + 1 + t);
        nzval.push(-1.0);
    }
    colptr.push(rowval.len());

    // Columns n+1..n+T — slack uₜ
    for t in 0..t_rows {
        rowval.push(2 * n + 1 + t);
        nzval.push(-1.0);
        rowval.push(2 * n + t_rows + 1 + t);
        nzval.push(-1.0);
        colptr.push(rowval.len());
    }

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
        NonnegativeConeT(t_rows),
        NonnegativeConeT(t_rows),
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
// Public API — WASM implementation (projected subgradient)
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

/// WASM: Minimise CVaR via projected subgradient descent.
///
/// CVaR_α ≈ −(1/k) Σ_{k worst} (rᵀw)  where k = ⌈(1−α)T⌉.
/// Subgradient: g[j] = −(1/k) Σ_{t ∈ worst-k} returns[t,j].
#[cfg(target_arch = "wasm32")]
pub fn solve(
    returns: &DMatrix<f64>,
    alpha: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> Result<DVector<f64>, EngineError> {
    let t_rows = returns.nrows();
    let n = returns.ncols();

    if n == 0 || t_rows == 0 {
        return Err(EngineError::InvalidInput("returns matrix is empty".into()));
    }
    if !(0.0 < alpha && alpha < 1.0) {
        return Err(EngineError::InvalidInput("alpha must be in (0, 1)".into()));
    }

    let eff_lb = if long_only { lb.max(0.0) } else { lb };
    if eff_lb > ub + 1e-12 {
        return Err(EngineError::InvalidInput("lb > ub".into()));
    }

    let k = (((1.0 - alpha) * t_rows as f64).ceil() as usize).max(1);

    // Warm start: equal weights.
    let n_f = n as f64;
    let w_0 = (1.0 / n_f).clamp(eff_lb, ub);
    let mut w = DVector::from_element(n, w_0);
    project_simplex(&mut w, eff_lb, ub);

    // CVaR objective: -(1/k) * sum of k smallest portfolio returns.
    let cvar_obj = |v: &DVector<f64>| -> f64 {
        let mut port_rets: Vec<f64> = (0..t_rows)
            .map(|t| (0..n).map(|j| returns[(t, j)] * v[j]).sum::<f64>())
            .collect();
        port_rets.sort_by(|a, b| a.partial_cmp(b).unwrap());
        -port_rets[..k].iter().sum::<f64>() / k as f64
    };

    const MAX_ITER: usize = 10_000;
    const TOL: f64 = 1e-9;

    let mut best_w = w.clone();
    let mut best_obj = cvar_obj(&w);
    let step = 0.01_f64;

    for iter in 0..MAX_ITER {
        // Compute portfolio returns and find k worst indices.
        let mut port_rets: Vec<(usize, f64)> = (0..t_rows)
            .map(|t| (t, (0..n).map(|j| returns[(t, j)] * w[j]).sum::<f64>()))
            .collect();
        port_rets.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

        // Subgradient: g[j] = -(1/k) * sum_{worst-k t} returns[t,j]
        let mut grad = DVector::zeros(n);
        for &(t, _) in &port_rets[..k] {
            for j in 0..n {
                grad[j] -= returns[(t, j)];
            }
        }
        grad /= k as f64;

        // Diminishing step size.
        let alpha_step = step / (1.0 + (iter as f64).sqrt());

        let mut w_new = &w - alpha_step * &grad;
        project_simplex(&mut w_new, eff_lb, ub);

        let obj_new = cvar_obj(&w_new);
        if obj_new < best_obj {
            best_obj = obj_new;
            best_w = w_new.clone();
        }

        let diff = (&w_new - &w).norm();
        w = w_new;
        if diff < TOL { break; }
    }

    Ok(best_w)
}
