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
// Public API — WASM stub
// ---------------------------------------------------------------------------

/// WASM stub: Clarabel LP solver not available in WASM builds.
#[cfg(target_arch = "wasm32")]
pub fn solve(
    _returns: &DMatrix<f64>,
    _alpha: f64,
    _long_only: bool,
    _lb: f64,
    _ub: f64,
) -> Result<DVector<f64>, EngineError> {
    Err(EngineError::OptimizationFailed(
        "Clarabel LP solver not available in WASM build".into(),
    ))
}
