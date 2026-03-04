"""Load company list from CSV and fetch current data from Yahoo Finance."""
import os
from typing import Any

import pandas as pd
import yfinance as yf


def _default_csv_path() -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    return os.environ.get("CSV_PATH", os.path.join(base, "data", "company_fundamentals.csv"))


def load_tickers(csv_path: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    """Load tickers and metadata from CSV. Returns list of {ticker, company, sector, location, industry, website}."""
    path = csv_path or _default_csv_path()
    if not os.path.exists(path):
        return []
    df = pd.read_csv(path)
    if "symbol" in df.columns:
        df = df.rename(columns={"symbol": "Ticker"})
    if "name" in df.columns:
        df = df.rename(columns={"name": "Company"})
    if "Company" not in df.columns and "Ticker" in df.columns:
        df["Company"] = df["Ticker"]
    if "Ticker" not in df.columns:
        return []
    if "Sector" not in df.columns:
        df["Sector"] = ""
    if "Industry" not in df.columns:
        df["Industry"] = ""
    if "Location" not in df.columns:
        df["Location"] = ""
    if "Website" not in df.columns:
        df["Website"] = ""
    rows = df[["Ticker", "Company", "Sector", "Location", "Industry", "Website"]].fillna("").to_dict("records")
    out = [
        {
            "ticker": str(r["Ticker"]).strip().upper(),
            "company": str(r.get("Company", r["Ticker"])).strip(),
            "sector": str(r.get("Sector", "")).strip(),
            "location": str(r.get("Location", "")).strip(),
            "industry": str(r.get("Industry", "")).strip(),
            "website": str(r.get("Website", "")).strip(),
        }
        for r in rows
        if r.get("Ticker")
    ]
    if limit is not None:
        out = out[:limit]
    return out


def fetch_financial_summary(ticker: str, period: str = "1y") -> dict[str, Any] | None:
    """Fetch current price and summary from yfinance for one ticker."""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        hist = stock.history(period=period)
        current_price = None
        if not hist.empty and "Close" in hist.columns:
            current_price = float(hist["Close"].iloc[-1])
        if current_price is None and isinstance(info.get("currentPrice"), (int, float)):
            current_price = info["currentPrice"]
        return {
            "ticker": ticker.upper(),
            "current_price": current_price,
            "currency": info.get("currency"),
            "short_name": info.get("shortName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
        }
    except Exception:
        return None


def fetch_financials_batch(tickers: list[str], period: str = "1y") -> list[dict[str, Any]]:
    """Fetch summary for multiple tickers. Returns list of summaries (skips failures)."""
    out = []
    for t in tickers[:50]:  # cap at 50 to avoid rate limit
        s = fetch_financial_summary(t, period=period)
        if s:
            out.append(s)
    return out
