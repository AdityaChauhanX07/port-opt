"""
POST /factor-returns  — Fama-French 5 (via direct CSV download) or
                        proxy factors built from SPY + sector ETFs.

The Fama-French download can fail behind firewalls; the proxy approach
always works because it re-uses yfinance which is already a dependency.
"""
from __future__ import annotations

import io
import logging
import zipfile
from typing import Literal

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class FactorRequest(BaseModel):
    start_date: str
    end_date: str
    frequency: Literal["daily", "monthly"] = "daily"
    model: Literal["proxy", "ff5"] = "proxy"


class FactorResponse(BaseModel):
    dates: list[str]
    factor_names: list[str]
    values: list[float]      # row-major flat: T × K
    rf_values: list[float]   # T-length risk-free rate series


# ---------------------------------------------------------------------------
# Proxy factor construction (always available, no external CSV needed)
# ---------------------------------------------------------------------------

_PROXY_TICKERS = {
    "Market":     "SPY",
    "Tech":       "XLK",
    "Financials": "XLF",
    "Energy":     "XLE",
    "Healthcare": "XLV",
    "Industrials":"XLI",
}


def _log_returns(series: pd.Series) -> pd.Series:
    return np.log(series / series.shift(1)).dropna()


def _fetch_proxy_factors(start: str, end: str, freq: str) -> tuple[pd.DataFrame, pd.Series]:
    """Download SPY + sector ETFs and compute log returns as factor proxies."""
    tickers = list(_PROXY_TICKERS.values())
    raw = yf.download(
        tickers,
        start=start,
        end=end,
        interval="1d" if freq == "daily" else "1mo",
        auto_adjust=True,
        progress=False,
    )["Close"]

    if raw.empty:
        raise ValueError("yfinance returned no data for proxy factors")

    # Ensure column order matches _PROXY_TICKERS.values()
    raw = raw.reindex(columns=tickers)
    raw = raw.ffill().dropna()

    # Log returns
    rets = raw.pct_change().dropna()
    if freq == "monthly":
        rets = rets.resample("ME").apply(lambda x: (1 + x).prod() - 1)

    rets.columns = list(_PROXY_TICKERS.keys())

    # Approximate risk-free rate: 4% annualised → daily or monthly
    rf_per_period = 0.04 / 252 if freq == "daily" else 0.04 / 12
    rf_series = pd.Series(rf_per_period, index=rets.index, name="RF")

    return rets, rf_series


# ---------------------------------------------------------------------------
# Fama-French 5 factor download
# ---------------------------------------------------------------------------

_FF5_DAILY_URL = (
    "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
    "F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
)
_FF5_MONTHLY_URL = (
    "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
    "F-F_Research_Data_5_Factors_2x3_CSV.zip"
)

_FF5_FACTOR_NAMES = ["Mkt-RF", "SMB", "HML", "RMW", "CMA"]


def _fetch_ff5(start: str, end: str, freq: str) -> tuple[pd.DataFrame, pd.Series]:
    """Download Fama-French 5 factors from Kenneth French's data library."""
    url = _FF5_DAILY_URL if freq == "daily" else _FF5_MONTHLY_URL
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
    except Exception as exc:
        raise ValueError(f"FF5 download failed: {exc}") from exc

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        csv_name = next(n for n in zf.namelist() if n.endswith(".CSV"))
        raw_text = zf.read(csv_name).decode("latin-1")

    # Parse the CSV — skip header lines until we hit the data block
    lines = raw_text.splitlines()
    start_idx = next(
        i for i, ln in enumerate(lines)
        if ln.strip() and ln.strip()[0].isdigit()
    )
    data_lines = lines[start_idx:]
    # Find the annual factors block (contains single year integers)
    # Stop at first blank-ish line after data begins
    clean_lines: list[str] = []
    for ln in data_lines:
        if ln.strip() == "" or "Annual" in ln:
            break
        clean_lines.append(ln)

    df = pd.read_csv(
        io.StringIO("\n".join(clean_lines)),
        header=None,
        names=["Date"] + _FF5_FACTOR_NAMES + ["RF"],
    )
    df["Date"] = pd.to_datetime(df["Date"].astype(str), format="%Y%m%d" if freq == "daily" else "%Y%m")
    df = df.set_index("Date")
    df = df.apply(pd.to_numeric, errors="coerce") / 100.0  # percent → decimal
    df = df.loc[start:end].dropna()

    if freq == "monthly":
        df.index = df.index + pd.offsets.MonthEnd(0)

    return df[_FF5_FACTOR_NAMES], df["RF"]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/factor-returns", response_model=FactorResponse)
async def get_factor_returns(req: FactorRequest) -> FactorResponse:
    """Fetch factor returns for use in OLS risk decomposition."""
    try:
        if req.model == "ff5":
            try:
                factors, rf = _fetch_ff5(req.start_date, req.end_date, req.frequency)
            except Exception as exc:
                logger.warning("FF5 download failed (%s); falling back to proxy factors", exc)
                factors, rf = _fetch_proxy_factors(req.start_date, req.end_date, req.frequency)
        else:
            factors, rf = _fetch_proxy_factors(req.start_date, req.end_date, req.frequency)
    except Exception as exc:
        logger.exception("factor fetch failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if factors.empty:
        raise HTTPException(status_code=400, detail="No factor data returned for the requested period.")

    dates = [str(d.date()) for d in factors.index]
    factor_names = list(factors.columns)
    values: list[float] = [float(v) for row in factors.itertuples(index=False) for v in row]
    rf_values: list[float] = [float(v) for v in rf.reindex(factors.index).ffill().fillna(0)]

    return FactorResponse(
        dates=dates,
        factor_names=factor_names,
        values=values,
        rf_values=rf_values,
    )
