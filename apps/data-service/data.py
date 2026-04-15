"""
Price data fetching and cleaning — ported from portopt/core/data.py.
"""
from __future__ import annotations

from datetime import date
from typing import Union

import numpy as np
import pandas as pd
import yfinance as yf

# yfinance interval codes
_INTERVAL_MAP = {
    "daily":   "1d",
    "weekly":  "1wk",
    "monthly": "1mo",
}


def fetch_prices(
    tickers: list[str],
    start: Union[str, date],
    end: Union[str, date],
    interval: str = "daily",
) -> pd.DataFrame:
    """Download adjusted-close prices from Yahoo Finance.

    Tries a bulk download first; falls back to per-ticker downloads for any
    ticker that failed in the bulk call.

    Parameters
    ----------
    tickers:  List of Yahoo Finance ticker symbols.
    start:    Start date, inclusive (YYYY-MM-DD or datetime.date).
    end:      End date, exclusive (YYYY-MM-DD or datetime.date).
    interval: One of ``"daily"``, ``"weekly"``, ``"monthly"``.

    Returns
    -------
    pd.DataFrame  — shape (T, n_assets), DatetimeIndex, columns = tickers.
                    Returns an empty DataFrame when nothing could be fetched.
    """
    yf_interval = _INTERVAL_MAP.get(interval.lower(), "1d")
    start_s, end_s = str(start), str(end)

    # ------------------------------------------------------------------
    # Bulk download
    # ------------------------------------------------------------------
    df = yf.download(
        tickers=tickers,
        start=start_s,
        end=end_s,
        interval=yf_interval,
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )

    out: pd.DataFrame | None = None

    if len(df) > 0:
        if isinstance(df.columns, pd.MultiIndex) and len(tickers) > 1:
            closes: dict[str, pd.Series] = {}
            for t in tickers:
                try:
                    sub = df[t]
                    col = _pick_close_col(sub.columns)
                    if col:
                        closes[t] = sub[col]
                except Exception:
                    pass
            if closes:
                out = pd.DataFrame(closes)
        elif len(tickers) == 1:
            col = _pick_close_col(df.columns)
            if col:
                s = df[col]
                out = pd.DataFrame({tickers[0]: s})

    # ------------------------------------------------------------------
    # Per-ticker fallback for missing tickers
    # ------------------------------------------------------------------
    fetched = set(out.columns.tolist()) if out is not None else set()
    missing = [t for t in tickers if t not in fetched]

    if missing:
        frames: list[pd.Series] = []
        for t in missing:
            try:
                one = yf.download(
                    t,
                    start=start_s,
                    end=end_s,
                    interval=yf_interval,
                    auto_adjust=True,
                    progress=False,
                )
                if len(one) == 0:
                    continue
                col = _pick_close_col(one.columns)
                if col:
                    frames.append(one[col].rename(t))
            except Exception:
                pass
        if frames:
            fallback = pd.concat(frames, axis=1)
            out = fallback if out is None else out.join(fallback, how="outer")

    if out is None or out.empty:
        return pd.DataFrame()

    # Reorder columns to match original ticker order where possible.
    ordered = [t for t in tickers if t in out.columns]
    out = out[ordered]
    out.index.name = "Date"
    return out.sort_index()


def align_and_clean(prices: pd.DataFrame) -> pd.DataFrame:
    """Forward-fill small gaps, drop all-NaN tickers, enforce 50 % coverage.

    Parameters
    ----------
    prices: Raw price DataFrame from :func:`fetch_prices`.

    Returns
    -------
    Cleaned DataFrame.  May have fewer columns than the input if some tickers
    had no data at all.
    """
    df = prices.copy()

    # Drop tickers that are entirely missing.
    df = df.dropna(axis=1, how="all")

    if df.empty:
        return df

    # Forward-fill gaps of up to 3 periods (weekends / holidays).
    df = df.ffill(limit=3)

    # Drop rows that don't meet the 50 % column-coverage threshold.
    if df.shape[1] >= 2:
        thresh = max(2, int(np.ceil(0.5 * df.shape[1])))
        df = df.dropna(thresh=thresh)

    # Final pass: drop any row still fully NaN.
    df = df.dropna(how="all")

    return df


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _pick_close_col(columns: pd.Index) -> str | None:
    """Return 'Close' or 'Adj Close' from a column index, or None."""
    if "Close" in columns:
        return "Close"
    if "Adj Close" in columns:
        return "Adj Close"
    return None
