"""
POST /prices        — fetch, clean, and return price data
GET  /tickers/search — lightweight ticker symbol search
"""
from __future__ import annotations

import logging
from typing import Literal

import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from data import align_and_clean, fetch_prices

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# Common tickers used for instant search results (no network call needed)
# ---------------------------------------------------------------------------
_COMMON_TICKERS: list[dict[str, str]] = [
    # US equities
    {"symbol": "AAPL",  "name": "Apple Inc."},
    {"symbol": "MSFT",  "name": "Microsoft Corporation"},
    {"symbol": "GOOGL", "name": "Alphabet Inc. (Class A)"},
    {"symbol": "AMZN",  "name": "Amazon.com Inc."},
    {"symbol": "NVDA",  "name": "NVIDIA Corporation"},
    {"symbol": "META",  "name": "Meta Platforms Inc."},
    {"symbol": "TSLA",  "name": "Tesla Inc."},
    {"symbol": "BRK-B", "name": "Berkshire Hathaway Inc. (Class B)"},
    {"symbol": "JPM",   "name": "JPMorgan Chase & Co."},
    {"symbol": "V",     "name": "Visa Inc."},
    {"symbol": "JNJ",   "name": "Johnson & Johnson"},
    {"symbol": "WMT",   "name": "Walmart Inc."},
    {"symbol": "PG",    "name": "Procter & Gamble Co."},
    {"symbol": "MA",    "name": "Mastercard Inc."},
    {"symbol": "HD",    "name": "The Home Depot Inc."},
    {"symbol": "BAC",   "name": "Bank of America Corporation"},
    {"symbol": "XOM",   "name": "Exxon Mobil Corporation"},
    {"symbol": "PFE",   "name": "Pfizer Inc."},
    {"symbol": "DIS",   "name": "The Walt Disney Company"},
    {"symbol": "NFLX",  "name": "Netflix Inc."},
    # ETFs
    {"symbol": "SPY",   "name": "SPDR S&P 500 ETF Trust"},
    {"symbol": "QQQ",   "name": "Invesco QQQ Trust (Nasdaq-100)"},
    {"symbol": "IWM",   "name": "iShares Russell 2000 ETF"},
    {"symbol": "VTI",   "name": "Vanguard Total Stock Market ETF"},
    {"symbol": "VOO",   "name": "Vanguard S&P 500 ETF"},
    {"symbol": "VEA",   "name": "Vanguard FTSE Developed Markets ETF"},
    {"symbol": "VWO",   "name": "Vanguard FTSE Emerging Markets ETF"},
    {"symbol": "EFA",   "name": "iShares MSCI EAFE ETF"},
    {"symbol": "EEM",   "name": "iShares MSCI Emerging Markets ETF"},
    {"symbol": "GLD",   "name": "SPDR Gold Shares"},
    {"symbol": "SLV",   "name": "iShares Silver Trust"},
    {"symbol": "USO",   "name": "United States Oil Fund"},
    {"symbol": "TLT",   "name": "iShares 20+ Year Treasury Bond ETF"},
    {"symbol": "IEF",   "name": "iShares 7-10 Year Treasury Bond ETF"},
    {"symbol": "SHY",   "name": "iShares 1-3 Year Treasury Bond ETF"},
    {"symbol": "BND",   "name": "Vanguard Total Bond Market ETF"},
    {"symbol": "AGG",   "name": "iShares Core U.S. Aggregate Bond ETF"},
    {"symbol": "HYG",   "name": "iShares iBoxx High Yield Corporate Bond ETF"},
    {"symbol": "LQD",   "name": "iShares iBoxx Investment Grade Corporate Bond ETF"},
    {"symbol": "VNQ",   "name": "Vanguard Real Estate ETF"},
    {"symbol": "ARKK",  "name": "ARK Innovation ETF"},
    {"symbol": "XLK",   "name": "Technology Select Sector SPDR Fund"},
    {"symbol": "XLF",   "name": "Financial Select Sector SPDR Fund"},
    {"symbol": "XLE",   "name": "Energy Select Sector SPDR Fund"},
    {"symbol": "XLV",   "name": "Health Care Select Sector SPDR Fund"},
    {"symbol": "XLI",   "name": "Industrial Select Sector SPDR Fund"},
    # Crypto
    {"symbol": "BTC-USD", "name": "Bitcoin USD"},
    {"symbol": "ETH-USD", "name": "Ethereum USD"},
]

# Build a lookup for O(1) search
_TICKER_LOOKUP: dict[str, dict[str, str]] = {
    t["symbol"].upper(): t for t in _COMMON_TICKERS
}

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PricesRequest(BaseModel):
    tickers: list[str]
    start: str
    end: str
    interval: Literal["daily", "weekly", "monthly"] = "daily"

    @field_validator("tickers")
    @classmethod
    def tickers_not_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("tickers list must not be empty")
        cleaned = [t.strip().upper() for t in v]
        if any(not t for t in cleaned):
            raise ValueError("ticker symbols must be non-empty strings")
        return cleaned

    @field_validator("start", "end")
    @classmethod
    def valid_date_format(cls, v: str) -> str:
        import re
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("dates must be in YYYY-MM-DD format")
        return v


class PricesResponse(BaseModel):
    dates: list[str]
    tickers: list[str]
    values: list[float]       # flattened column-major (ticker-by-ticker)
    n_periods: int
    n_assets: int


class TickerResult(BaseModel):
    symbol: str
    name: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/prices", response_model=PricesResponse)
async def get_prices(body: PricesRequest) -> PricesResponse:
    """Fetch, clean, and return price data as a flat column-major array.

    Column-major layout means all of ticker[0]'s prices come first, then
    ticker[1]'s, etc.  Use ``n_periods`` and ``n_assets`` to reshape.
    """
    if body.start >= body.end:
        raise HTTPException(
            status_code=400,
            detail=f"start ({body.start}) must be before end ({body.end})",
        )

    try:
        raw = fetch_prices(body.tickers, body.start, body.end, body.interval)
    except Exception as exc:
        logger.exception("fetch_prices failed for tickers=%s", body.tickers)
        raise HTTPException(
            status_code=500,
            detail=f"Price fetch failed: {exc}",
        ) from exc

    if raw.empty:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No price data returned for tickers {body.tickers} "
                f"between {body.start} and {body.end}."
            ),
        )

    try:
        prices = align_and_clean(raw)
    except Exception as exc:
        logger.exception("align_and_clean failed")
        raise HTTPException(status_code=500, detail=f"Data cleaning failed: {exc}") from exc

    if prices.empty:
        raise HTTPException(
            status_code=400,
            detail="All price data was dropped after cleaning (too many gaps).",
        )

    # Build response
    dates = [str(d.date()) for d in prices.index]
    returned_tickers = prices.columns.tolist()
    n_periods = len(dates)
    n_assets = len(returned_tickers)

    # Flatten column-major: ticker0[t=0..T-1], ticker1[t=0..T-1], ...
    values: list[float] = []
    for col in returned_tickers:
        values.extend(float(v) for v in prices[col])

    return PricesResponse(
        dates=dates,
        tickers=returned_tickers,
        values=values,
        n_periods=n_periods,
        n_assets=n_assets,
    )


# ---------------------------------------------------------------------------
# Market snapshot
# ---------------------------------------------------------------------------

_SNAPSHOT_TICKERS = ["SPY", "QQQ", "DIA", "IWM", "TLT", "GLD", "DBC", "^VIX"]


class SnapshotItem(BaseModel):
    ticker: str
    price: float
    change_pct: float
    sparkline: list[float]


@router.get("/market-snapshot", response_model=list[SnapshotItem])
async def market_snapshot(
    tickers: list[str] | None = Query(default=None, description="Custom ticker list; omit for the default set"),
) -> list[SnapshotItem]:
    """Return last-price, 1-day change, and 30-day sparkline for a set of tickers."""
    from datetime import datetime, timedelta

    end_date = datetime.today().strftime("%Y-%m-%d")
    start_date = (datetime.today() - timedelta(days=40)).strftime("%Y-%m-%d")

    ticker_list = [t.upper() for t in tickers] if tickers else _SNAPSHOT_TICKERS

    results: list[SnapshotItem] = []
    for ticker in ticker_list:
        try:
            raw = fetch_prices([ticker], start_date, end_date, "daily")
            if raw.empty:
                continue
            col = raw.columns[0]
            prices_series = raw[col].dropna()
            if len(prices_series) < 2:
                continue
            price_list = prices_series.tolist()
            price = float(price_list[-1])
            change_pct = (price_list[-1] / price_list[-2] - 1.0) * 100.0
            sparkline = [round(float(p), 4) for p in price_list[-30:]]
            results.append(SnapshotItem(
                ticker=ticker.lstrip("^"),
                price=round(price, 4),
                change_pct=round(change_pct, 4),
                sparkline=sparkline,
            ))
        except Exception:
            logger.exception("market_snapshot: failed for %s", ticker)

    return results


@router.get("/tickers/search", response_model=list[TickerResult])
async def search_tickers(
    q: str = Query(..., min_length=1, description="Ticker symbol or company name query"),
) -> list[TickerResult]:
    """Search for ticker symbols.

    Checks the local common-ticker list first (instant).  If the query looks
    like a valid symbol but isn't in the list, attempts a live yfinance lookup.
    Returns at most 10 results.
    """
    q_upper = q.strip().upper()

    # 1. Exact symbol match from local list
    if q_upper in _TICKER_LOOKUP:
        return [TickerResult(**_TICKER_LOOKUP[q_upper])]

    # 2. Prefix/substring match in local list
    local_matches = [
        TickerResult(**t)
        for t in _COMMON_TICKERS
        if q_upper in t["symbol"] or q_upper in t["name"].upper()
    ]
    if local_matches:
        return local_matches[:10]

    # 3. Live yfinance lookup for unknown symbols
    try:
        info = yf.Ticker(q_upper).info
        short_name = info.get("shortName") or info.get("longName") or ""
        symbol = info.get("symbol") or q_upper
        if short_name:
            return [TickerResult(symbol=symbol, name=short_name)]
    except Exception:
        pass

    return []
