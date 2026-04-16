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
// Public API — WASM implementations (penalty method + projected gradient)
// ---------------------------------------------------------------------------
//
// Clarabel links to native OS libraries (BLAS/LAPACK) that cannot compile to
// wasm32-unknown-unknown.  Instead we solve the QP via a penalty / projected-
// gradient approach:
//
//   min  ½ wᵀΣw  +  ρ · (μᵀw − target)²
//   s.t. 1ᵀw = 1,  lb ≤ w ≤ ub
//
// The sum-to-one equality is enforced exactly by projecting w onto the
// box-simplex `{ w : 1ᵀw = 1, lb ≤ wᵢ ≤ ub }` after every gradient step.
// The return constraint is handled by the penalty term with ρ = 500.
//
// We scale both Σ and μ so their magnitudes are O(1), which keeps the
// gradient well-conditioned regardless of the time-series frequency
// (daily vs weekly vs annual).

/// Project `w` onto `{ 1ᵀw = 1, lb ≤ wᵢ ≤ ub }` via bisection on the dual
/// variable λ.  Identical algorithm to `risk_parity::project_onto_feasible`.
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

/// WASM: minimum-variance portfolio via projected gradient descent.
#[cfg(target_arch = "wasm32")]
pub fn min_variance(
    _mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    long_only: bool,
    lb: f64,
    ub: f64,
) -> Result<DVector<f64>, EngineError> {
    let n = cov.nrows();
    if n == 0 {
        return Err(EngineError::InvalidInput("empty asset universe".into()));
    }
    if cov.ncols() != n {
        return Err(EngineError::InvalidInput("cov is not square".into()));
    }
    let eff_lb = if long_only { lb.max(0.0) } else { lb };
    if eff_lb > ub + 1e-12 {
        return Err(EngineError::InvalidInput("lb > ub".into()));
    }
    let n_f = n as f64;

    // Scale Σ so its Frobenius norm ≈ n (makes step-size tuning easier).
    let diag_sum: f64 = (0..n).map(|i| cov[(i, i)]).sum();
    let cov_scale = (diag_sum / n_f).max(1e-30);
    let cov_s = cov / cov_scale;

    // Warm start: equal weight projected onto feasible set.
    let w_0 = (1.0 / n_f).clamp(eff_lb, ub);
    let mut w = DVector::from_element(n, w_0);
    project_simplex(&mut w, eff_lb, ub);

    // Conservative step size from Lipschitz bound: L ≤ ‖Σ_s‖_F
    let mut step = 1.0 / (cov_s.norm() + 1.0);

    const MAX_ITER: usize = 8_000;
    const TOL: f64 = 1e-10;

    for _ in 0..MAX_ITER {
        let grad: DVector<f64> = &cov_s * &w;

        let mut w_new = &w - step * &grad;
        project_simplex(&mut w_new, eff_lb, ub);

        // Armijo sufficient-decrease check.
        let f_old = 0.5 * w.dot(&(&cov_s * &w));
        let f_new = 0.5 * w_new.dot(&(&cov_s * &w_new));

        if f_new <= f_old {
            let diff = (&w_new - &w).norm();
            w = w_new;
            step *= 1.1; // mild step growth on success
            if diff < TOL {
                break;
            }
        } else {
            step *= 0.5;
            if step < 1e-20 {
                break;
            }
        }
    }

    Ok(w)
}

/// WASM: minimum-variance portfolio with a target-return constraint.
///
/// Solved via:  min  ½ wᵀΣw  +  ρ·(μᵀw − target)²
///              s.t. 1ᵀw = 1,  lb ≤ w ≤ ub
/// with projected gradient (the sum-to-one constraint is exact; the return
/// constraint is driven to near-zero by the penalty).
#[cfg(target_arch = "wasm32")]
pub fn target_return(
    mu: &DVector<f64>,
    cov: &DMatrix<f64>,
    target: f64,
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
    let target_s = target / mu_scale;

    // Penalty weight.  Large enough to drive (μᵀw − target) ≈ 0 but not so
    // large that the Hessian becomes ill-conditioned.
    let rho = 500.0_f64;

    // Lipschitz constant of the gradient of the full penalised objective:
    //   ∇L = Σ_s w  +  2ρ·(μ_sᵀw − target_s)·μ_s
    // Hessian ≤ Σ_s + 2ρ·μ_s μ_sᵀ, whose spectral radius ≤ ‖Σ_s‖ + 2ρ·‖μ_s‖²
    let lip = cov_s.norm() + 2.0 * rho * mu_s.dot(&mu_s);
    let mut step = 1.0 / lip.max(1.0);

    // Warm start: equal weight projected onto feasible set.
    let w_0 = (1.0 / n_f).clamp(eff_lb, ub);
    let mut w = DVector::from_element(n, w_0);
    project_simplex(&mut w, eff_lb, ub);

    const MAX_ITER: usize = 8_000;
    const TOL: f64 = 1e-10;

    let penalised_obj = |v: &DVector<f64>| -> f64 {
        let cv = &cov_s * v;
        let ret_dev = mu_s.dot(v) - target_s;
        0.5 * v.dot(&cv) + rho * ret_dev * ret_dev
    };

    for _ in 0..MAX_ITER {
        let cw = &cov_s * &w;
        let ret_dev = mu_s.dot(&w) - target_s;
        let grad = &cw + mu_s.scale(2.0 * rho * ret_dev);

        let mut w_new = &w - step * &grad;
        project_simplex(&mut w_new, eff_lb, ub);

        if penalised_obj(&w_new) <= penalised_obj(&w) {
            let diff = (&w_new - &w).norm();
            w = w_new;
            step *= 1.05;
            if diff < TOL {
                break;
            }
        } else {
            step *= 0.5;
            if step < 1e-20 {
                break;
            }
        }
    }

    // Feasibility check: return constraint must be approximately satisfied.
    let ret_actual = mu.dot(&w);
    // Allow 5% of the full return range as tolerance.
    let mu_range = {
        let mn = mu.iter().cloned().fold(f64::INFINITY, f64::min);
        let mx = mu.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        (mx - mn).max(mu_scale * 1e-6)
    };
    if (ret_actual - target).abs() > 0.05 * mu_range + 1e-8 {
        return Err(EngineError::InfeasibleProblem);
    }

    Ok(w)
}
