from __future__ import annotations

import numpy as np
import cvxpy as cp
from scipy.optimize import minimize


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _box_bounds(n: int, long_only: bool, lb: float, ub: float) -> tuple[np.ndarray, np.ndarray]:
    lo = max(0.0, lb) if long_only else lb
    return np.full(n, lo), np.full(n, ub)


def _solve(prob: cp.Problem) -> None:
    """Attempt solvers in order of speed/reliability; raise if all fail."""
    for solver in (cp.CLARABEL, cp.ECOS, cp.OSQP, cp.SCS):
        try:
            prob.solve(solver=solver, verbose=False)
            if prob.status in ("optimal", "optimal_inaccurate"):
                return
        except Exception:
            continue
    prob.solve(verbose=False)


def _sqrt_cov(cov: np.ndarray) -> np.ndarray:
    """Symmetric matrix square root via eigen-decomposition (handles semi-definiteness)."""
    eigvals, eigvecs = np.linalg.eigh(cov)
    return eigvecs @ np.diag(np.sqrt(np.clip(eigvals, 0.0, None))) @ eigvecs.T


# ─────────────────────────────────────────────────────────────────────────────
# Core solvers
# ─────────────────────────────────────────────────────────────────────────────

def solve_min_variance(
    mu: np.ndarray,
    cov: np.ndarray,
    long_only: bool = True,
    lb: float = 0.0,
    ub: float = 1.0,
) -> np.ndarray | None:
    """Minimum-variance portfolio subject to box and full-investment constraints."""
    n = len(mu)
    w = cp.Variable(n)
    lb_arr, ub_arr = _box_bounds(n, long_only, lb, ub)
    prob = cp.Problem(
        cp.Minimize(cp.quad_form(w, cp.psd_wrap(cov))),
        [cp.sum(w) == 1, w >= lb_arr, w <= ub_arr],
    )
    _solve(prob)
    return None if w.value is None else np.asarray(w.value).ravel()


def solve_target_return(
    mu: np.ndarray,
    cov: np.ndarray,
    target: float,
    long_only: bool = True,
    lb: float = 0.0,
    ub: float = 1.0,
) -> np.ndarray | None:
    """Minimum-variance portfolio with a target-return constraint."""
    n = len(mu)
    w = cp.Variable(n)
    lb_arr, ub_arr = _box_bounds(n, long_only, lb, ub)
    prob = cp.Problem(
        cp.Minimize(cp.quad_form(w, cp.psd_wrap(cov))),
        [cp.sum(w) == 1, w >= lb_arr, w <= ub_arr, mu @ w >= target],
    )
    _solve(prob)
    return None if w.value is None else np.asarray(w.value).ravel()


# ─────────────────────────────────────────────────────────────────────────────
# Efficient frontier
# ─────────────────────────────────────────────────────────────────────────────

def trace_efficient_frontier(
    mu: np.ndarray,
    cov: np.ndarray,
    n_pts: int = 25,
    long_only: bool = True,
    lb: float = 0.0,
    ub: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Sweep target returns from min(mu) to max(mu) and collect feasible portfolios.

    Parameters
    ----------
    mu : np.ndarray
        Annualised expected returns, shape (n,).
    cov : np.ndarray
        Annualised covariance matrix, shape (n, n).
    n_pts : int
        Number of target-return grid points to try.
    long_only : bool
        Enforce non-negative weights.
    lb, ub : float
        Per-asset weight bounds.

    Returns
    -------
    tuple[np.ndarray, np.ndarray]
        ``(W, targets)`` where ``W`` is shape ``(k, n)`` and ``targets``
        is shape ``(k,)`` — only feasible points are included.

    Raises
    ------
    ValueError
        If no feasible portfolio is found across the entire target grid.
    """
    mu_min = float(np.min(mu))
    mu_max = float(np.max(mu))
    if abs(mu_max - mu_min) < 1e-12:
        mu_max = mu_min + 1e-6

    good_w, good_t = [], []
    for t in np.linspace(mu_min, mu_max, n_pts):
        w = solve_target_return(mu, cov, target=t, long_only=long_only, lb=lb, ub=ub)
        if w is not None and not np.isnan(w).any():
            good_w.append(w)
            good_t.append(t)

    if not good_w:
        raise ValueError(
            "No feasible portfolios found. "
            "Try widening the upper-bound, relaxing long-only, or using a wider date range."
        )
    return np.vstack(good_w), np.array(good_t)


def pick_max_sharpe(
    mu: np.ndarray,
    cov: np.ndarray,
    rf: float,
    frontier_weights: np.ndarray,
) -> tuple[int | None, float]:
    """
    Return the index and Sharpe ratio of the max-Sharpe portfolio on the frontier.

    Parameters
    ----------
    mu : np.ndarray
        Annualised expected returns.
    cov : np.ndarray
        Annualised covariance matrix.
    rf : float
        Annual risk-free rate.
    frontier_weights : np.ndarray
        Weight matrix from :func:`trace_efficient_frontier`, shape (k, n).

    Returns
    -------
    tuple[int | None, float]
        ``(best_index, best_sharpe)``.  Index is None if no valid portfolio exists.
    """
    best_idx, best_sharpe = None, -np.inf
    for i, w in enumerate(frontier_weights):
        vol = float(np.sqrt(max(0.0, w @ cov @ w)))
        if vol <= 0:
            continue
        sharpe = (float(w @ mu) - rf) / vol
        if sharpe > best_sharpe:
            best_sharpe, best_idx = sharpe, i
    return best_idx, best_sharpe


# ─────────────────────────────────────────────────────────────────────────────
# Risk parity
# ─────────────────────────────────────────────────────────────────────────────

def risk_parity_weights(
    cov: np.ndarray,
    lb: float = 0.0,
    ub: float = 1.0,
    initial: np.ndarray | None = None,
) -> np.ndarray:
    """
    Equal Risk Contribution (risk-parity) weights via SLSQP.

    Minimises ``Σᵢ (RCᵢ − σ²/n)²`` where ``RCᵢ = wᵢ (Cw)ᵢ``.

    Parameters
    ----------
    cov : np.ndarray
        Covariance matrix, shape (n, n).
    lb, ub : float
        Per-asset weight bounds.  ``lb`` is floored at 0 (long-only enforced).
    initial : np.ndarray or None
        Starting weights.  Defaults to equal weight.

    Returns
    -------
    np.ndarray
        Risk-parity weights, shape (n,).

    Raises
    ------
    RuntimeError
        If SLSQP fails to converge.
    """
    cov = np.asarray(cov, dtype=float)
    n   = cov.shape[0]
    if cov.shape != (n, n):
        raise ValueError("cov must be a square matrix.")

    x0 = np.full(n, 1.0 / n) if initial is None else np.asarray(initial, dtype=float)
    if x0.shape[0] != n:
        raise ValueError("initial must have length n.")

    lo = max(0.0, lb)

    def objective(w: np.ndarray) -> float:
        port_var = float(w @ cov @ w)
        if port_var <= 0:
            return 1e10
        rc     = w * (cov @ w)
        target = port_var / n
        return float(((rc - target) ** 2).sum())

    def gradient(w: np.ndarray) -> np.ndarray:
        """Analytical gradient speeds up convergence noticeably."""
        cw       = cov @ w
        port_var = float(w @ cw)
        if port_var <= 0:
            return np.zeros(n)
        rc     = w * cw
        target = port_var / n
        diff   = rc - target                       # (n,)
        # d(rc_i)/d(w_j) = cov_{ij} w_i + cov_{ii} delta_{ij}  [approx]
        # Full gradient via chain rule:
        dcw    = cov                               # d(cw)/dw = cov
        drc    = np.diag(cw) + np.diag(w) @ cov   # d(rc)/dw
        dtarget_dw = 2.0 * cw / n                 # d(port_var/n)/dw
        grad   = 2.0 * (drc.T @ diff - dtarget_dw * diff.sum())
        return grad

    res = minimize(
        objective,
        x0,
        jac=gradient,
        method="SLSQP",
        bounds=[(lo, ub)] * n,
        constraints={"type": "eq", "fun": lambda w: w.sum() - 1.0},
        options={"maxiter": 2000, "ftol": 1e-10},
    )

    if not res.success:
        raise RuntimeError(f"Risk parity optimisation failed: {res.message}")

    w = np.maximum(np.asarray(res.x, dtype=float), 0.0)
    return w / w.sum()


# ─────────────────────────────────────────────────────────────────────────────
# CVaR minimisation
# ─────────────────────────────────────────────────────────────────────────────

def solve_cvar_min(
    returns: np.ndarray,
    alpha: float = 0.95,
    long_only: bool = True,
    lb: float = 0.0,
    ub: float = 1.0,
) -> np.ndarray:
    """
    Minimise historical Conditional Value-at-Risk (CVaR) via linear programming.

    Uses the Rockafellar-Uryasev (2000) LP reformulation.

    Parameters
    ----------
    returns : np.ndarray
        Scenario returns, shape (T, n).
    alpha : float
        Confidence level (e.g. 0.95 → minimise expected loss in worst 5%).
    long_only : bool
        Enforce non-negative weights.
    lb, ub : float
        Per-asset weight bounds.

    Returns
    -------
    np.ndarray
        CVaR-minimising weights, shape (n,).

    Raises
    ------
    ValueError
        If ``returns`` has wrong shape.
    RuntimeError
        If the solver fails.
    """
    R = np.asarray(returns, dtype=float)
    if R.ndim != 2:
        raise ValueError("returns must be 2-D (T, n).")
    T, n = R.shape
    if T == 0 or n == 0:
        raise ValueError("returns array is empty.")

    w     = cp.Variable(n)
    zeta  = cp.Variable()       # VaR level
    u     = cp.Variable(T)      # exceedance slack

    lb_arr, ub_arr = _box_bounds(n, long_only, lb, ub)

    prob = cp.Problem(
        cp.Minimize(zeta + (1.0 / ((1.0 - alpha) * T)) * cp.sum(u)),
        [
            cp.sum(w) == 1,
            w >= lb_arr,
            w <= ub_arr,
            u >= -(R @ w) - zeta,
            u >= 0,
        ],
    )
    _solve(prob)

    if prob.status not in ("optimal", "optimal_inaccurate"):
        raise RuntimeError(f"CVaR optimisation failed — solver status: {prob.status}")
    if w.value is None:
        raise RuntimeError("CVaR optimisation returned no weights.")

    w_val = np.asarray(w.value, dtype=float).ravel()
    if long_only:
        w_val = np.maximum(w_val, 0.0)
    total = w_val.sum()
    return w_val / total if total != 0 else w_val


# ─────────────────────────────────────────────────────────────────────────────
# Robust MVO
# ─────────────────────────────────────────────────────────────────────────────

def robust_return_weights(
    mu: np.ndarray,
    cov: np.ndarray,
    gamma: float = 1.0,
    long_only: bool = True,
    lb: float = 0.0,
    ub: float = 1.0,
) -> np.ndarray:
    """
    Robust MVO with ellipsoidal uncertainty on expected returns.

    Maximises the worst-case expected return over the uncertainty set

        U = { μ : ‖Σ^{−½}(μ − μ̂)‖₂ ≤ γ }

    which reduces to minimising:

        γ ‖Σ^{½} w‖₂ − μ̂ᵀ w

    Parameters
    ----------
    mu : np.ndarray
        Estimated annualised expected returns, shape (n,).
    cov : np.ndarray
        Estimated annualised covariance matrix, shape (n, n).
    gamma : float
        Robustness level.  ``gamma=0`` recovers nominal MVO;
        larger values are more conservative.
    long_only : bool
        Enforce non-negative weights.
    lb, ub : float
        Per-asset weight bounds.

    Returns
    -------
    np.ndarray
        Robust portfolio weights, shape (n,).

    Raises
    ------
    RuntimeError
        If the solver fails.
    """
    mu  = np.asarray(mu, dtype=float).ravel()
    cov = np.asarray(cov, dtype=float)
    n   = mu.shape[0]
    if cov.shape != (n, n):
        raise ValueError("cov must be (n, n) with n = len(mu).")

    sqrt_c     = _sqrt_cov(cov)
    lb_arr, ub_arr = _box_bounds(n, long_only, lb, ub)
    w          = cp.Variable(n)

    prob = cp.Problem(
        cp.Minimize(gamma * cp.norm(sqrt_c @ w, 2) - mu @ w),
        [cp.sum(w) == 1, w >= lb_arr, w <= ub_arr],
    )
    _solve(prob)

    if prob.status not in ("optimal", "optimal_inaccurate"):
        raise RuntimeError(f"Robust optimisation failed — solver status: {prob.status}")
    if w.value is None:
        raise RuntimeError("Robust optimisation returned no weights.")

    w_val = np.asarray(w.value, dtype=float).ravel()
    if long_only:
        w_val = np.maximum(w_val, 0.0)
    total = w_val.sum()
    return w_val / total if total != 0 else w_val