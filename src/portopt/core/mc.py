from __future__ import annotations

import numpy as np
import pandas as pd


def simulate_gbm_portfolio(
    mu_annual: float,
    vol_annual: float,
    start_value: float = 1.0,
    years: float = 1.0,
    periods_per_year: int = 252,
    n_paths: int = 500,
    random_state: int | None = None,
) -> pd.DataFrame:
    """
    Simulate portfolio equity paths under Geometric Brownian Motion.

    Uses the exact GBM discretisation:
        S(t+dt) = S(t) · exp((μ − σ²/2)dt + σ√dt · Z)

    Parameters
    ----------
    mu_annual : float
        Annualised expected return (drift).
    vol_annual : float
        Annualised volatility (diffusion).
    start_value : float
        Starting portfolio value (default 1.0).
    years : float
        Simulation horizon in years.
    periods_per_year : int
        Number of time steps per year (252 = daily, 52 = weekly, 12 = monthly).
    n_paths : int
        Number of independent Monte Carlo paths.
    random_state : int or None
        Seed for reproducibility.

    Returns
    -------
    pd.DataFrame
        Shape ``(n_steps + 1, n_paths)``.  Row 0 is the starting value;
        columns are labelled ``path_0 … path_{n-1}``.

    Raises
    ------
    ValueError
        If ``vol_annual`` ≤ 0 or ``years`` ≤ 0 or ``n_paths`` < 1.
    """
    if vol_annual <= 0:
        raise ValueError(f"vol_annual must be positive; got {vol_annual}.")
    if years <= 0:
        raise ValueError(f"years must be positive; got {years}.")
    if n_paths < 1:
        raise ValueError(f"n_paths must be at least 1; got {n_paths}.")

    rng     = np.random.default_rng(random_state)
    dt      = 1.0 / periods_per_year
    n_steps = int(round(years * periods_per_year))

    mu_dt    = (mu_annual - 0.5 * vol_annual ** 2) * dt
    sigma_dt = vol_annual * np.sqrt(dt)

    # Cumulative log-returns: shape (n_steps, n_paths)
    log_increments = mu_dt + sigma_dt * rng.standard_normal((n_steps, n_paths))
    log_paths      = np.cumsum(log_increments, axis=0)          # cumulative sum

    # Convert to price levels and prepend start row
    paths = np.empty((n_steps + 1, n_paths), dtype=float)
    paths[0]  = start_value
    paths[1:] = start_value * np.exp(log_paths)

    return pd.DataFrame(
        paths,
        index=np.arange(n_steps + 1),
        columns=[f"path_{i}" for i in range(n_paths)],
    )


def summarize_terminal_distribution(paths: pd.DataFrame) -> dict[str, float]:
    """
    Summarise the terminal value distribution of simulated paths.

    Parameters
    ----------
    paths : pd.DataFrame
        Output of :func:`simulate_gbm_portfolio`.

    Returns
    -------
    dict
        Keys: ``mean``, ``median``, ``p5``, ``p25``, ``p75``, ``p95``,
        ``std``, ``prob_loss`` (probability terminal value < start value).
    """
    if paths.empty:
        nan = float("nan")
        return dict(mean=nan, median=nan, p5=nan, p25=nan,
                    p75=nan, p95=nan, std=nan, prob_loss=nan)

    terminal  = paths.iloc[-1]
    start_val = float(paths.iloc[0, 0])

    return {
        "mean":      float(terminal.mean()),
        "median":    float(terminal.median()),
        "p5":        float(terminal.quantile(0.05)),
        "p25":       float(terminal.quantile(0.25)),
        "p75":       float(terminal.quantile(0.75)),
        "p95":       float(terminal.quantile(0.95)),
        "std":       float(terminal.std()),
        "prob_loss": float((terminal < start_val).mean()),
    }