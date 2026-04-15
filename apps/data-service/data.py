"""
Price data fetching and cleaning — ported from portopt/core/data.py.

Handles the new yfinance ≥ 0.2.x API where yf.download() always returns a
MultiIndex column DataFrame with shape (field, ticker), even for single tickers.
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

    Handles yfinance ≥ 0.2 where ``yf.download`` always returns a MultiIndex
    DataFrame with ``(field, ticker)`` columns, regardless of how many tickers
    are requested.

    Falls back to per-ticker downloads for any ticker missing after the bulk
    call.

    Parameters
    ----------
    tickers:  List of Yahoo Finance ticker symbols.
    start:    Start date, inclusive (YYYY-MM-DD or datetime.date).
    end:      End date, exclusive (YYYY-MM-DD or datetime.date).
    interval: One of ``"daily"``, ``"weekly"``, ``"monthly"``.

    Returns
    -------
    pd.DataFrame — shape (T, n_assets), DatetimeIndex, columns = tickers.
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

    if len(df) > 0 and isinstance(df.columns, pd.MultiIndex):
        # New yfinance API: columns are (field, ticker) tuples.
        # df['Close'] gives a DataFrame keyed by ticker (or Series for 1 ticker).
        if "Close" in df.columns.get_level_values(0):
            close = df["Close"]
        elif "Adj Close" in df.columns.get_level_values(0):
            close = df["Adj Close"]
        else:
            close = None

        if close is not None:
            if isinstance(close, pd.Series):
                # Single ticker returned as a Series — restore column name
                close = close.to_frame(name=tickers[0])
            # Ensure requested tickers that exist are present
            available = [t for t in tickers if t in close.columns]
            if available:
                out = close[available]

    # ------------------------------------------------------------------
    # Per-ticker fallback for any tickers still missing
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
                # Handle MultiIndex on single-ticker fallback too
                if isinstance(one.columns, pd.MultiIndex):
                    level0 = one.columns.get_level_values(0)
                    if "Close" in level0:
                        s = one["Close"]
                    elif "Adj Close" in level0:
                        s = one["Adj Close"]
                    else:
                        continue
                    if isinstance(s, pd.DataFrame):
                        s = s.iloc[:, 0]
                else:
                    if "Close" in one.columns:
                        s = one["Close"]
                    elif "Adj Close" in one.columns:
                        s = one["Adj Close"]
                    else:
                        continue
                frames.append(s.rename(t))
            except Exception:
                pass

        if frames:
            fallback = pd.concat(frames, axis=1)
            out = fallback if out is None else out.join(fallback, how="outer")

    if out is None or out.empty:
        return pd.DataFrame()

    # Reorder columns to match original ticker request order.
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
    Cleaned DataFrame.  May have fewer columns if some tickers had no data.
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
