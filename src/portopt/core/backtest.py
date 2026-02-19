from __future__ import annotations

import numpy as np
import pandas as pd

from .stats import (
    annualize_mean_cov,
    drawdown_series,
    equity_curve,
    shrink_cov_to_diag,
)
from .opt import pick_max_sharpe, trace_efficient_frontier


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _equal_weight(n: int) -> np.ndarray:
    return np.ones(n) / n


def _market_series(prices: pd.DataFrame, proxy: str) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return (returns, equity, drawdown) for a market proxy ticker."""
    r   = prices[proxy].pct_change().dropna().rename("MarketR")
    eq  = equity_curve(r).rename("Market")
    dd  = drawdown_series(eq).rename("MarketDD")
    return r, eq, dd


def _portfolio_returns(returns: pd.DataFrame, weights: np.ndarray) -> pd.Series:
    """
    Compute period-by-period portfolio returns for a fixed weight vector.

    Parameters
    ----------
    returns : pd.DataFrame
        Per-period asset returns, shape (T, N).
    weights : np.ndarray
        Portfolio weights, length N.

    Returns
    -------
    pd.Series
        Portfolio return series named "Portfolio".
    """
    w = np.asarray(weights, dtype=float).ravel()
    if len(w) != returns.shape[1]:
        raise ValueError(
            f"Weight length {len(w)} does not match asset count {returns.shape[1]}."
        )
    return returns.mul(w, axis=1).sum(axis=1).rename("Portfolio")


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def backtest_static(
    prices: pd.DataFrame,
    returns: pd.DataFrame,
    weights: np.ndarray,
    *,
    include_equal_weight: bool = True,
    market_proxy: str | None = "SPY",
) -> dict[str, pd.Series]:
    """
    Static (buy-and-hold) backtest of a fixed-weight portfolio.

    Parameters
    ----------
    prices : pd.DataFrame
        Adjusted close prices (used for market proxy only).
    returns : pd.DataFrame
        Per-period asset returns aligned with ``prices``.
    weights : np.ndarray
        Portfolio weights (must sum to ≈ 1).
    include_equal_weight : bool
        If True, also compute the equal-weight benchmark.
    market_proxy : str | None
        Ticker to use as market benchmark. Skipped if None or not in ``prices``.

    Returns
    -------
    dict
        Keys: Portfolio, PortfolioR, PortfolioDD,
              EqualWeight*, EqualWeightR*, EqualWeightDD*,
              Market*, MarketR*, MarketDD*  (* = optional).
    """
    out: dict[str, pd.Series] = {}

    r_p  = _portfolio_returns(returns, weights)
    eq_p = equity_curve(r_p)
    out.update(PortfolioR=r_p, Portfolio=eq_p, PortfolioDD=drawdown_series(eq_p))

    if include_equal_weight:
        r_ew  = _portfolio_returns(returns, _equal_weight(returns.shape[1]))
        eq_ew = equity_curve(r_ew)
        out.update(EqualWeightR=r_ew, EqualWeight=eq_ew,
                   EqualWeightDD=drawdown_series(eq_ew))

    if market_proxy and market_proxy in prices.columns:
        r_m, eq_m, dd_m = _market_series(prices, market_proxy)
        out.update(MarketR=r_m, Market=eq_m, MarketDD=dd_m)

    return out


def backtest_walkforward(
    prices: pd.DataFrame,
    returns: pd.DataFrame,
    rf: float,
    ppy: int,
    *,
    window: int = 252,
    step: int = 21,
    tc_bps: float = 0.0,
    slippage_bps: float = 0.0,
    long_only: bool = True,
    lb: float = 0.0,
    ub: float = 1.0,
    alpha: float = 0.1,
    n_pts: int = 25,
    include_equal_weight: bool = True,
    market_proxy: str | None = "SPY",
) -> dict[str, pd.Series | pd.DataFrame]:
    """
    Walk-forward backtest with rolling re-optimisation.

    At each rebalance date the portfolio is re-solved using only the
    preceding ``window`` periods of data.  Transaction costs and slippage
    are applied as a one-period return drag proportional to turnover.

    Parameters
    ----------
    prices : pd.DataFrame
        Adjusted close prices.
    returns : pd.DataFrame
        Per-period log or simple returns.
    rf : float
        Annual risk-free rate (used for Sharpe optimisation).
    ppy : int
        Periods per year (252 / 52 / 12).
    window : int
        Look-back window for each estimation, in periods.
    step : int
        Rebalance frequency in periods.
    tc_bps : float
        One-way transaction cost in *decimal* form (5 bps → 0.0005).
    slippage_bps : float
        Slippage cost in *decimal* form, applied per unit turnover.
    long_only : bool
        Enforce non-negative weights.
    lb, ub : float
        Per-asset weight bounds.
    alpha : float
        Covariance shrinkage intensity toward the diagonal.
    n_pts : int
        Number of frontier points to solve at each rebalance.
    include_equal_weight : bool
        Add equal-weight benchmark.
    market_proxy : str | None
        Market benchmark ticker.

    Returns
    -------
    dict
        Same keys as :func:`backtest_static`, plus ``WeightsHistory``
        (DataFrame of rebalance weights, index = rebalance dates).

    Raises
    ------
    ValueError
        If the return series is too short for the requested window/step.
    """
    returns = returns.dropna()

    min_required = window + step
    if len(returns) <= min_required:
        raise ValueError(
            f"Need > {min_required} periods of data; got {len(returns)}. "
            "Widen the date range or reduce window/step."
        )

    n_assets = returns.shape[1]
    idx      = returns.index
    total_cost_per_unit = tc_bps + slippage_bps   # decimal, per unit turnover

    r_p        = pd.Series(np.nan, index=idx, name="Portfolio", dtype=float)
    current_w  = np.zeros(n_assets)

    weights_hist: list[np.ndarray]    = []
    rebalance_dates: list[pd.Timestamp] = []

    i = window
    while i < len(idx):
        # ── Estimate on training window ──────────────────────────────────────
        train = returns.iloc[i - window : i].dropna()
        if len(train) < 20:
            i += step
            continue

        mu, cov  = annualize_mean_cov(train, ppy)
        cov_use  = shrink_cov_to_diag(cov, alpha=alpha)

        # ── Optimise ─────────────────────────────────────────────────────────
        try:
            W, _       = trace_efficient_frontier(mu, cov_use, n_pts=n_pts,
                                                  long_only=long_only, lb=lb, ub=ub)
            best_idx, _ = pick_max_sharpe(mu, cov_use, rf, W)
            w_new = W[best_idx] if best_idx is not None else _equal_weight(n_assets)
        except Exception:
            # fall back to equal weight if optimisation fails
            w_new = _equal_weight(n_assets)

        # ── Transaction costs ────────────────────────────────────────────────
        cost_rate = 0.0
        if weights_hist:
            turnover  = float(np.abs(w_new - current_w).sum())
            cost_rate = float(np.clip(total_cost_per_unit * turnover, 0.0, 0.9))

        current_w = w_new.copy()
        weights_hist.append(current_w.copy())
        rebalance_dates.append(idx[i])

        # ── Apply weights until next rebalance ───────────────────────────────
        j_end = min(i + step, len(idx))
        for j in range(i, j_end):
            r_gross = float(returns.iloc[j].to_numpy() @ current_w)
            if j == i and cost_rate > 0.0:
                r_p.iloc[j] = (1.0 - cost_rate) * (1.0 + r_gross) - 1.0
            else:
                r_p.iloc[j] = r_gross

        i += step

    # ── Assemble output ───────────────────────────────────────────────────────
    r_p  = r_p.dropna()
    eq_p = equity_curve(r_p)

    out: dict = {
        "PortfolioR":  r_p,
        "Portfolio":   eq_p,
        "PortfolioDD": drawdown_series(eq_p),
    }

    if include_equal_weight:
        r_ew  = _portfolio_returns(returns, _equal_weight(n_assets))
        eq_ew = equity_curve(r_ew)
        out.update(EqualWeightR=r_ew, EqualWeight=eq_ew,
                   EqualWeightDD=drawdown_series(eq_ew))

    if market_proxy and market_proxy in prices.columns:
        r_m, eq_m, dd_m = _market_series(prices, market_proxy)
        out.update(MarketR=r_m, Market=eq_m, MarketDD=dd_m)

    if weights_hist:
        out["WeightsHistory"] = pd.DataFrame(
            weights_hist,
            index=pd.Index(rebalance_dates, name="Date"),
            columns=returns.columns,
        )

    return out