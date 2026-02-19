from __future__ import annotations

import numpy as np
import pandas as pd


def portfolio_returns(returns: pd.DataFrame, weights: np.ndarray) -> pd.Series:
    """
    Compute portfolio return series from asset returns and a weight vector.

    Parameters
    ----------
    returns : pd.DataFrame
        Per-period asset returns, shape (T, n).
    weights : np.ndarray
        Portfolio weights, length n.

    Returns
    -------
    pd.Series
        Portfolio return series named "PortfolioReturn".

    Raises
    ------
    ValueError
        If weight length does not match number of assets.
    """
    w = np.asarray(weights, dtype=float).ravel()
    if returns.shape[1] != len(w):
        raise ValueError(
            f"Weight length {len(w)} does not match asset count {returns.shape[1]}."
        )
    return returns.mul(w, axis=1).sum(axis=1).rename("PortfolioReturn")


def var_cvar_historical(
    returns: pd.Series,
    alpha: float = 0.95,
) -> tuple[float, float]:
    """
    Historical (non-parametric) VaR and CVaR for a long portfolio.

    Both values are returned as positive numbers representing losses,
    consistent with the convention that VaR > 0 means a loss.

    Parameters
    ----------
    returns : pd.Series
        Per-period portfolio returns.
    alpha : float
        Confidence level (e.g. 0.95 → 95% VaR).

    Returns
    -------
    tuple[float, float]
        ``(VaR, CVaR)`` — both positive loss figures.
        Returns ``(nan, nan)`` if the series is empty.
    """
    clean = returns.dropna()
    if clean.empty:
        return np.nan, np.nan

    q    = float(np.quantile(clean, 1.0 - alpha))
    tail = clean[clean <= q]

    var  = -q
    cvar = -float(tail.mean()) if len(tail) > 0 else np.nan
    return var, cvar


def rolling_sharpe(
    returns: pd.Series,
    rf_per_period: float = 0.0,
    window: int = 60,
) -> pd.Series:
    """
    Rolling annualisation-invariant Sharpe ratio.

    Computed as ``mean(excess) / std(excess)`` over each window,
    with no annualisation factor applied — caller can scale if needed.

    Parameters
    ----------
    returns : pd.Series
        Per-period portfolio returns.
    rf_per_period : float
        Risk-free rate per period (not annualised).
    window : int
        Rolling window length in periods.

    Returns
    -------
    pd.Series
        Rolling Sharpe ratio; NaN where window is incomplete or std = 0.
    """
    if returns.empty:
        return pd.Series(dtype=float)

    excess = returns - rf_per_period

    def _sharpe(x: np.ndarray) -> float:
        s = x.std(ddof=1)
        return x.mean() / s if s > 0 else np.nan

    return excess.rolling(window=window, min_periods=window).apply(_sharpe, raw=True)


def rolling_sortino(
    returns: pd.Series,
    rf_per_period: float = 0.0,
    window: int = 60,
) -> pd.Series:
    """
    Rolling Sortino ratio using downside deviation.

    Downside deviation is computed only over negative-excess-return periods.

    Parameters
    ----------
    returns : pd.Series
        Per-period portfolio returns.
    rf_per_period : float
        Risk-free rate per period (not annualised).
    window : int
        Rolling window length in periods.

    Returns
    -------
    pd.Series
        Rolling Sortino ratio; NaN where window is incomplete or downside std = 0.
    """
    if returns.empty:
        return pd.Series(dtype=float)

    excess = returns - rf_per_period

    def _sortino(x: np.ndarray) -> float:
        downside = x[x < 0]
        if len(downside) == 0:
            return np.nan
        s = downside.std(ddof=1)
        return x.mean() / s if s > 0 else np.nan

    return excess.rolling(window=window, min_periods=window).apply(_sortino, raw=True)


def corr_matrix(returns: pd.DataFrame) -> pd.DataFrame:
    """
    Compute the Pearson correlation matrix of asset returns.

    Parameters
    ----------
    returns : pd.DataFrame
        Per-period asset returns, shape (T, n).

    Returns
    -------
    pd.DataFrame
        Correlation matrix, shape (n, n).
    """
    return returns.corr()