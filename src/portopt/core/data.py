from __future__ import annotations

import numpy as np
import pandas as pd
import yfinance as yf
from datetime import date
from typing import Sequence, Union


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

_INTERVAL_MAP: dict[str, str] = {
    "Daily":   "1d",
    "Weekly":  "1wk",
    "Monthly": "1mo",
}

_CLOSE_COLS = ("Close", "Adj Close")   # preference order


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _find_close_col(df: pd.DataFrame) -> str | None:
    """Return the first recognised close-price column name, or None."""
    for col in _CLOSE_COLS:
        if col in df.columns:
            return col
    return None


def _extract_multi(df: pd.DataFrame, tickers: Sequence[str]) -> pd.DataFrame | None:
    """Extract close prices from a multi-ticker MultiIndex DataFrame."""
    closes: dict[str, pd.Series] = {}
    for t in tickers:
        try:
            sub     = df[t]
            col     = _find_close_col(sub)
            if col is None:
                continue
            closes[t] = sub[col]
        except KeyError:
            continue
    return pd.DataFrame(closes) if closes else None


def _extract_single(df: pd.DataFrame, ticker: str) -> pd.DataFrame | None:
    """Extract close price from a single-ticker DataFrame."""
    col = _find_close_col(df)
    if col is None:
        return None
    return df[[col]].rename(columns={col: ticker})


def _download_one(ticker: str, start: str, end: str, interval: str) -> pd.Series | None:
    """Download a single ticker and return a named Series, or None on failure."""
    try:
        raw = yf.download(
            ticker,
            start=start,
            end=end,
            interval=interval,
            auto_adjust=True,
            progress=False,
        )
        if raw.empty:
            return None
        col = _find_close_col(raw)
        return raw[col].rename(ticker) if col else None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def fetch_prices(
    tickers: Sequence[str],
    start: Union[str, date],
    end: Union[str, date],
    interval: str = "Daily",
) -> pd.DataFrame:
    """
    Download adjusted close prices from Yahoo Finance.

    Tries a single bulk download first for efficiency; falls back to
    per-ticker downloads for any tickers that failed or returned no data.

    Parameters
    ----------
    tickers : sequence of str
        Yahoo Finance ticker symbols (e.g. ``["AAPL", "MSFT", "TLT"]``).
    start : str or date
        Start date (inclusive).
    end : str or date
        End date (inclusive).
    interval : {"Daily", "Weekly", "Monthly"}
        Sampling frequency.

    Returns
    -------
    pd.DataFrame
        Adjusted close prices with a DatetimeIndex named "Date" and one
        column per ticker.  Returns an empty DataFrame if nothing could
        be downloaded.

    Raises
    ------
    ValueError
        If ``interval`` is not one of the recognised keys.
    """
    tickers  = list(tickers)
    yf_ivl   = _INTERVAL_MAP.get(interval)
    if yf_ivl is None:
        raise ValueError(
            f"Unknown interval {interval!r}. "
            f"Choose from {list(_INTERVAL_MAP)}."
        )

    start_s, end_s = str(start), str(end)
    out: pd.DataFrame | None = None

    # ── Bulk download ─────────────────────────────────────────────────────────
    try:
        raw = yf.download(
            tickers=tickers,
            start=start_s,
            end=end_s,
            interval=yf_ivl,
            auto_adjust=True,
            progress=False,
            group_by="ticker",
            threads=True,
        )

        if not raw.empty:
            if isinstance(raw.columns, pd.MultiIndex) and len(tickers) > 1:
                out = _extract_multi(raw, tickers)
            elif len(tickers) == 1:
                out = _extract_single(raw, tickers[0])
    except Exception:
        pass

    # ── Per-ticker fallback for any missing columns ───────────────────────────
    present  = set(out.columns) if out is not None else set()
    missing  = [t for t in tickers if t not in present]

    if missing:
        extra = [s for t in missing if (s := _download_one(t, start_s, end_s, yf_ivl)) is not None]
        if extra:
            extra_df = pd.concat(extra, axis=1)
            out = extra_df if out is None else pd.concat([out, extra_df], axis=1)

    if out is None or out.empty:
        return pd.DataFrame()

    # ── Final cleanup ─────────────────────────────────────────────────────────
    out.index.name = "Date"
    # preserve original ticker order
    ordered = [t for t in tickers if t in out.columns]
    return out[ordered].sort_index()


def align_and_clean(
    prices: pd.DataFrame,
    ffill_limit: int = 3,
    coverage_threshold: float = 0.5,
) -> pd.DataFrame:
    """
    Align and clean a raw price DataFrame.

    Steps applied in order:

    1. Drop columns that are entirely NaN (delisted / bad tickers).
    2. Forward-fill short gaps (e.g. staggered exchange holidays).
    3. Drop rows where fewer than ``coverage_threshold`` of assets have data.
    4. Drop any remaining all-NaN rows.

    Parameters
    ----------
    prices : pd.DataFrame
        Raw price data, one column per ticker.
    ffill_limit : int
        Maximum number of consecutive NaNs to forward-fill.
    coverage_threshold : float
        Fraction of columns that must be non-NaN for a row to be kept.
        Default 0.5 means at least 50 % of assets must have data.

    Returns
    -------
    pd.DataFrame
        Cleaned price DataFrame.
    """
    df = prices.copy()

    # 1. Drop fully-empty columns
    df = df.dropna(axis=1, how="all")

    if df.empty:
        return df

    # 2. Forward-fill short gaps
    df = df.ffill(limit=ffill_limit)

    # 3. Row coverage filter
    if df.shape[1] >= 2:
        min_cols = max(1, int(np.ceil(coverage_threshold * df.shape[1])))
        df = df.dropna(thresh=min_cols)

    # 4. Drop fully-empty rows
    df = df.dropna(how="all")

    return df