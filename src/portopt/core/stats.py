from __future__ import annotations

import numpy as np
import pandas as pd


# ─────────────────────────────────────────────────────────────────────────────
# Return / covariance estimation
# ─────────────────────────────────────────────────────────────────────────────

def annualize_mean_cov(
    returns: pd.DataFrame,
    periods_per_year: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Annualise the sample mean and covariance of a return DataFrame.

    Parameters
    ----------
    returns : pd.DataFrame
        Per-period asset returns, shape (T, n).
    periods_per_year : int
        252 for daily, 52 for weekly, 12 for monthly.

    Returns
    -------
    tuple[np.ndarray, np.ndarray]
        ``(mu, cov)`` — both annualised, shapes (n,) and (n, n).
    """
    mu  = returns.mean().to_numpy() * periods_per_year
    cov = returns.cov().to_numpy()  * periods_per_year
    return mu, cov


def shrink_cov_to_diag(cov: np.ndarray, alpha: float = 0.1) -> np.ndarray:
    """
    Ledoit-Wolf-style linear shrinkage toward the diagonal.

    ``cov_shrunk = (1 − α) · cov + α · diag(cov)``

    Parameters
    ----------
    cov : np.ndarray
        Sample covariance matrix, shape (n, n).
    alpha : float
        Shrinkage intensity in [0, 1].  ``alpha=0`` → no shrinkage;
        ``alpha=1`` → fully diagonal.

    Returns
    -------
    np.ndarray
        Shrunk covariance matrix.
    """
    if not 0.0 <= alpha <= 1.0:
        raise ValueError(f"alpha must be in [0, 1]; got {alpha}.")
    diag = np.diag(np.diag(cov))
    return (1.0 - alpha) * cov + alpha * diag


# ─────────────────────────────────────────────────────────────────────────────
# Portfolio metrics
# ─────────────────────────────────────────────────────────────────────────────

def portfolio_metrics(
    weights: np.ndarray,
    mu: np.ndarray,
    cov: np.ndarray,
    rf: float = 0.0,
) -> dict[str, float]:
    """
    Compute annualised return, volatility, and Sharpe ratio for a portfolio.

    Parameters
    ----------
    weights : np.ndarray
        Portfolio weights, shape (n,).
    mu : np.ndarray
        Annualised expected returns, shape (n,).
    cov : np.ndarray
        Annualised covariance matrix, shape (n, n).
    rf : float
        Annual risk-free rate.

    Returns
    -------
    dict
        Keys: ``return``, ``vol``, ``sharpe``.
    """
    ret = float(weights @ mu)
    vol = float(np.sqrt(max(0.0, weights @ cov @ weights)))
    return {
        "return": ret,
        "vol":    vol,
        "sharpe": (ret - rf) / vol if vol > 0 else np.nan,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Equity curve & drawdown
# ─────────────────────────────────────────────────────────────────────────────

def equity_curve(
    returns: pd.Series | pd.DataFrame,
    start_value: float = 1.0,
) -> pd.Series | pd.DataFrame:
    """
    Compound a return series into an equity curve.

    Parameters
    ----------
    returns : pd.Series or pd.DataFrame
        Per-period returns.
    start_value : float
        Starting portfolio value (default 1.0).

    Returns
    -------
    pd.Series or pd.DataFrame
        Cumulative equity, same type as input.
    """
    return start_value * (1.0 + returns).cumprod()


def drawdown_series(equity: pd.Series) -> pd.Series:
    """
    Compute the drawdown series relative to the running peak.

    Returns values ≤ 0 (e.g. −0.20 = 20% below peak).

    Parameters
    ----------
    equity : pd.Series
        Equity curve.

    Returns
    -------
    pd.Series
        Drawdown series.
    """
    peak = equity.cummax()
    return equity / peak - 1.0


def max_drawdown(equity: pd.Series) -> float:
    """
    Maximum peak-to-trough drawdown of an equity curve.

    Returns a negative number representing the worst loss
    (e.g. −0.35 = 35% drawdown).

    Parameters
    ----------
    equity : pd.Series
        Equity curve.

    Returns
    -------
    float
        Most negative value of the drawdown series, or NaN if empty.
    """
    if equity.empty:
        return np.nan
    return float(drawdown_series(equity).min())


def cagr_from_equity(equity: pd.Series, periods_per_year: int) -> float:
    """
    Compound Annual Growth Rate from an equity curve.

    Parameters
    ----------
    equity : pd.Series
        Equity curve (must have at least 2 points).
    periods_per_year : int
        Used to convert length of series to years.

    Returns
    -------
    float
        CAGR as a decimal (e.g. 0.12 = 12% per year).
    """
    if equity.empty or len(equity) < 2:
        return np.nan
    years = len(equity) / periods_per_year
    if years <= 0:
        return np.nan
    total_return = float(equity.iloc[-1] / equity.iloc[0])
    return total_return ** (1.0 / years) - 1.0


def ann_return_vol_from_equity(
    equity: pd.Series,
    periods_per_year: int,
) -> tuple[float, float]:
    """
    Estimate annualised return and volatility from an equity curve.

    Derives per-period returns via ``pct_change``, then scales mean
    and standard deviation to annual frequency.

    Parameters
    ----------
    equity : pd.Series
        Equity curve.
    periods_per_year : int
        252 / 52 / 12 depending on data frequency.

    Returns
    -------
    tuple[float, float]
        ``(ann_return, ann_vol)``.  Both NaN if the series is too short.
    """
    if equity.empty:
        return np.nan, np.nan
    rets = equity.pct_change().dropna()
    if rets.empty:
        return np.nan, np.nan
    mu  = float(rets.mean()) * periods_per_year
    vol = float(rets.std(ddof=1)) * np.sqrt(periods_per_year)
    return mu, vol


# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap inference
# ─────────────────────────────────────────────────────────────────────────────

def bootstrap_sharpe_ci(
    returns: pd.Series,
    rf_per_period: float = 0.0,
    n_boot: int = 1000,
    block_size: int = 21,
    ci: float = 0.95,
    random_state: int | None = None,
) -> dict[str, float | np.ndarray]:
    """
    Overlapping block-bootstrap confidence interval for the Sharpe ratio.

    Block bootstrap preserves short-range autocorrelation in returns,
    making it more reliable than i.i.d. bootstrap for financial data.

    Parameters
    ----------
    returns : pd.Series
        Per-period portfolio returns.
    rf_per_period : float
        Risk-free rate per period (not annualised).
    n_boot : int
        Number of bootstrap replications.
    block_size : int
        Length of contiguous blocks drawn at each step.
    ci : float
        Confidence level (e.g. 0.95 → 95% CI).
    random_state : int or None
        Seed for reproducibility.

    Returns
    -------
    dict
        Keys: ``mean``, ``ci_lower``, ``ci_upper``, ``samples``
        (numpy array of per-replication Sharpe estimates).
        All float keys are NaN and ``samples`` is empty if insufficient data.
    """
    _empty = {"mean": np.nan, "ci_lower": np.nan, "ci_upper": np.nan,
              "samples": np.array([])}

    r = returns.dropna().to_numpy(dtype=float)
    if r.size < max(block_size * 2, 10):
        return _empty

    excess = r - rf_per_period
    n      = excess.size
    rng    = np.random.default_rng(random_state)

    # Pre-build all start indices for efficiency
    max_start    = max(1, n - block_size + 1)
    starts       = rng.integers(0, max_start, size=n_boot * (n // block_size + 2))
    start_cursor = 0

    sharpe_samples: list[float] = []

    for _ in range(n_boot):
        idx: list[int] = []
        while len(idx) < n:
            s = int(starts[start_cursor % len(starts)])
            start_cursor += 1
            idx.extend(range(s, min(s + block_size, n)))
        sample = excess[np.array(idx[:n], dtype=int)]
        std    = sample.std(ddof=1)
        if std > 0:
            s = sample.mean() / std
            if np.isfinite(s):
                sharpe_samples.append(s)

    if not sharpe_samples:
        return _empty

    samples  = np.array(sharpe_samples)
    tail     = (1.0 - ci) / 2.0
    lo, hi   = np.quantile(samples, [tail, 1.0 - tail])

    return {
        "mean":      float(samples.mean()),
        "ci_lower":  float(lo),
        "ci_upper":  float(hi),
        "samples":   samples,
    }