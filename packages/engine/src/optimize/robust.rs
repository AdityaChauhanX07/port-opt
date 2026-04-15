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
// Public API — WASM stub
// ---------------------------------------------------------------------------

/// WASM stub: Clarabel SOCP solver not available in WASM builds.
#[cfg(target_arch = "wasm32")]
pub fn solve(
    _mu: &DVector<f64>,
    _cov: &DMatrix<f64>,
    _gamma: f64,
    _long_only: bool,
    _lb: f64,
    _ub: f64,
) -> Result<DVector<f64>, EngineError> {
    Err(EngineError::OptimizationFailed(
        "Clarabel SOCP solver not available in WASM build".into(),
    ))
}
