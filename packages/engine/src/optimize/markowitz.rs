//! Markowitz mean–variance QP solvers backed by Clarabel.
//!
//! On `wasm32-unknown-unknown` Clarabel is not available; both public functions
//! return `EngineError::OptimizationFailed` with an explanatory message.

use nalgebra::{DMatrix, DVector};

use crate::EngineError;

// ---------------------------------------------------------------------------
// Clarabel helpers — compiled only for non-WASM targets
// ---------------------------------------------------------------------------

#[cfg(not(target_arch = "wasm32"))]
use clarabel::algebra::*;
#[cfg(not(target_arch = "wasm32"))]
use clarabel::solver::*;

/// Effective lower bound: clamp to 0 when `long_only = true`.
#[cfg(not(target_arch = "wasm32"))]
fn effective_lb(long_only: bool, lb: f64) -> f64 {
    if long_only { lb.max(0.0) } else { lb }
}

/// Validate that `cov` is square and matches `n`.
#[cfg(not(target_arch = "wasm32"))]
fn validate_inputs(n: usize, cov: &DMatrix<f64>) -> Result<(), EngineError> {
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
    Ok(())
}

/// Build the **upper-triangular** CSC representation of `2 × cov`.
#[cfg(not(target_arch = "wasm32"))]
fn cov_to_p_csc(cov: &DMatrix<f64>) -> CscMatrix<f64> {
    let n = cov.nrows();
    let nnz = n * (n + 1) / 2;
    let mut colptr: Vec<usize> = Vec::with_capacity(n + 1);
    let mut rowval: Vec<usize> = Vec::with_capacity(nnz);
    let mut nzval: Vec<f64> = Vec::with_capacity(nnz);

    colptr.push(0);
    for col in 0..n {
        for row in 0..=col {
            rowval.push(row);
            nzval.push(2.0 * cov[(row, col)]);
        }
        colptr.push(rowval.len());
    }

    CscMatrix::new(n, n, colptr, rowval, nzval)
}

/// Build `A` and `b` for min-variance (2n+1 rows).
#[cfg(not(target_arch = "wasm32"))]
fn build_a_min_var(n: usize, eff_lb: f64, ub: f64) -> (CscMatrix<f64>, Vec<f64>) {
    let m = 2 * n + 1;
    let nnz = 3 * n;

    let mut colptr: Vec<usize> = Vec::with_capacity(n + 1);
    let mut rowval: Vec<usize> = Vec::with_capacity(nnz);
    let mut nzval: Vec<f64> = Vec::with_capacity(nnz);

    colptr.push(0);
    for j in 0..n {
        rowval.push(0);         nzval.push(1.0);
        rowval.push(1 + j);     nzval.push(-1.0);
        rowval.push(n + 1 + j); nzval.push(1.0);
        colptr.push(rowval.len());
    }

    let a = CscMatrix::new(m, n, colptr, rowval, nzval);

    let mut b = vec![0.0f64; m];
    b[0] = 1.0;
    for j in 0..n {
        b[1 + j] = -eff_lb;
        b[n + 1 + j] = ub;
    }

    (a, b)
}

/// Build `A` and `b` for target-return (2n+2 rows).
#[cfg(not(target_arch = "wasm32"))]
fn build_a_target(
    n: usize,
    mu: &DVector<f64>,
    eff_lb: f64,
    ub: f64,
    target: f64,
) -> (CscMatrix<f64>, Vec<f64>) {
    let m = 2 * n + 2;
    let nnz = 4 * n;

    let mut colptr: Vec<usize> = Vec::with_capacity(n + 1);
    let mut rowval: Vec<usize> = Vec::with_capacity(nnz);
    let mut nzval: Vec<f64> = Vec::with_capacity(nnz);

    colptr.push(0);
    for j in 0..n {
        rowval.push(0);           nzval.push(1.0);
        rowval.push(1 + j);       nzval.push(-1.0);
        rowval.push(n + 1 + j);   nzval.push(1.0);
        rowval.push(2 * n + 1);   nzval.push(-mu[j]);
        colptr.push(rowval.len());
    }

    let a = CscMatrix::new(m, n, colptr, rowval, nzval);

    let mut b = vec![0.0f64; m];
    b[0] = 1.0;
    for j in 0..n {
        b[1 + j] = -eff_lb;
        b[n + 1 + j] = ub;
    }
    b[2 * n + 1] = -target;

    (a, b)
}

/// Extract the primal solution from a solved Clarabel problem.
#[cfg(not(target_arch = "wasm32"))]
fn extract(status: SolverStatus, x: &[f64], n: usize) -> Result<DVector<f64>, EngineError> {
    match status {
        SolverStatus::Solved | SolverStatus::AlmostSolved => {
            Ok(DVector::from_column_slice(&x[..n]))
        }
        SolverStatus::PrimalInfeasible
        | SolverStatus::DualInfeasible
        | SolverStatus::AlmostPrimalInfeasible
        | SolverStatus::AlmostDualInfeasible => Err(EngineError::InfeasibleProblem),
        other => Err(EngineError::OptimizationFailed(format!("{:?}", other))),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn quiet_settings() -> DefaultSettings<f64> {
    DefaultSettings { verbose: false, ..DefaultSettings::default() }
}

// ---------------------------------------------------------------------------
// Public API — native
// ---------------------------------------------------------------------------

/// Find the minimum-variance portfolio.
#[cfg(not(target_arch = "wasm32"))]
pub fn min_variance(
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> Result<DVector<f64>, EngineError> {
    let n = mu.len();
    validate_inputs(n, cov)?;
    let eff_lb = effective_lb(long_only, lb);

    let p = cov_to_p_csc(cov);
    let q = vec![0.0f64; n];
    let (a, b) = build_a_min_var(n, eff_lb, ub);
    let cones = [ZeroConeT(1), NonnegativeConeT(n), NonnegativeConeT(n)];

    let mut solver = DefaultSolver::new(&p, &q, &a, &b, &cones, quiet_settings());
    solver.solve();

    extract(solver.solution.status, &solver.solution.x, n)
}

/// Find the minimum-variance portfolio subject to a target return constraint.
#[cfg(not(target_arch = "wasm32"))]
pub fn target_return(
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    target: f64,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> Result<DVector<f64>, EngineError> {
    let n = mu.len();
    validate_inputs(n, cov)?;
    let eff_lb = effective_lb(long_only, lb);

    let p = cov_to_p_csc(cov);
    let q = vec![0.0f64; n];
    let (a, b) = build_a_target(n, mu, eff_lb, ub, target);
    let cones = [
        ZeroConeT(1),
        NonnegativeConeT(n),
        NonnegativeConeT(n),
        NonnegativeConeT(1),
    ];

    let mut solver = DefaultSolver::new(&p, &q, &a, &b, &cones, quiet_settings());
    solver.solve();

    extract(solver.solution.status, &solver.solution.x, n)
}

// ---------------------------------------------------------------------------
// Public API — WASM stubs
// ---------------------------------------------------------------------------

/// WASM stub: Clarabel is not available in WASM builds.
#[cfg(target_arch = "wasm32")]
pub fn min_variance(
    _mu: &DVector<f64>,
    _cov: &DMatrix<f64>,
    _long_only: bool,
    _lb: f64,
    _ub: f64,
) -> Result<DVector<f64>, EngineError> {
    Err(EngineError::OptimizationFailed(
        "Clarabel QP solver not available in WASM build".into(),
    ))
}

/// WASM stub: Clarabel is not available in WASM builds.
#[cfg(target_arch = "wasm32")]
pub fn target_return(
    _mu: &DVector<f64>,
    _cov: &DMatrix<f64>,
    _target: f64,
    _long_only: bool,
    _lb: f64,
    _ub: f64,
) -> Result<DVector<f64>, EngineError> {
    Err(EngineError::OptimizationFailed(
        "Clarabel QP solver not available in WASM build".into(),
    ))
}
