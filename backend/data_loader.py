"""Load company list from CSV and fetch current data from Yahoo Finance."""
import math
import os
from typing import Any

import pandas as pd
import yfinance as yf


def _clean_for_json(val: Any) -> Any:
    """Replace NaN/Inf and pandas NA so JSON serialization works."""
    try:
        if pd.isna(val):
            return None
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            return None
    except (TypeError, ValueError):
        pass
    return val


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


def _first_non_none(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None


def _get_latest_from_df(df: Any, *row_names: str) -> Any:
    """Get first non-empty value across period columns for matching row names."""
    if df is None or (hasattr(df, "empty") and df.empty) or not hasattr(df, "index"):
        return None
    idx = getattr(df, "index", None)
    cols = getattr(df, "columns", None)
    if idx is None or cols is None or len(cols) == 0:
        return None
    for name in row_names:
        try:
            if name in idx:
                row = df.loc[name]
                try:
                    iterator = row.items()
                except AttributeError:
                    iterator = enumerate(row)
                for _, val in iterator:
                    if not pd.isna(val):
                        return _clean_for_json(val)
        except (KeyError, TypeError):
            continue
    return None


def fetch_financial_summary(ticker: str, period: str = "1y") -> dict[str, Any] | None:
    """Fetch current price, summary, and key statement metrics (balance_sheet, cash_flow, earnings/income) from yfinance."""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        hist = stock.history(period=period)
        current_price = None
        if not hist.empty and "Close" in hist.columns:
            current_price = float(hist["Close"].iloc[-1])
        if current_price is None and isinstance(info.get("currentPrice"), (int, float)):
            current_price = info["currentPrice"]

        out: dict[str, Any] = {
            "ticker": ticker.upper(),
            "current_price": _clean_for_json(current_price),
            "currency": info.get("currency"),
            "short_name": info.get("shortName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "total_assets": None,
            "total_liabilities": None,
            "total_revenue": None,
            "net_income": None,
            "operating_cash_flow": None,
            "free_cash_flow": None,
        }

        bs = getattr(stock, "balance_sheet", None)
        if bs is not None and hasattr(bs, "index"):
            out["total_assets"] = _get_latest_from_df(bs, "Total Assets", "TotalAssets")
            out["total_liabilities"] = _get_latest_from_df(
                bs,
                "Total Liabilities Net Minority Interest",
                "Total Liabilities",
                "TotalLiabilitiesNet",
                "Total Liabilities And Stockholders Equity",
            )

        inc = _first_non_none(getattr(stock, "income_stmt", None), getattr(stock, "income_statement", None))
        if inc is not None and hasattr(inc, "index"):
            out["total_revenue"] = _get_latest_from_df(inc, "Total Revenue", "Revenue", "Gross Revenue")
            out["net_income"] = _get_latest_from_df(inc, "Net Income", "Net Income Common Stockholders", "Net Income Continuous Operations")

        cf = _first_non_none(getattr(stock, "cashflow", None), getattr(stock, "cash_flow", None))
        if cf is not None and hasattr(cf, "index"):
            out["operating_cash_flow"] = _get_latest_from_df(cf, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities")
            out["free_cash_flow"] = _get_latest_from_df(cf, "Free Cash Flow", "Free Cash Flow")

        return out
    except Exception:
        return None


def _df_to_json_safe(df: Any) -> dict[str, Any] | None:
    """Convert DataFrame to JSON-serializable: { index: row labels, columns: period dates, data: 2d array }."""
    if df is None or (hasattr(df, "empty") and df.empty):
        return None
    try:
        d = df.to_dict("split")
        raw_data = d.get("data", [])
        data = [[_clean_for_json(v) for v in row] for row in raw_data]
        return {
            "index": list(d.get("index", [])),
            "columns": list(d.get("columns", [])),
            "data": data,
        }
    except Exception:
        return None


def fetch_financial_statements(ticker: str) -> dict[str, Any] | None:
    """Fetch balance_sheet, income_statement, cash_flow for one ticker. Returns JSON-serializable dicts."""
    try:
        stock = yf.Ticker(ticker)
        out: dict[str, Any] = {
            "ticker": ticker.upper(),
            "balance_sheet": None,  # { index, columns, data }
            "income_statement": None,
            "cash_flow": None,
        }
        # Balance sheet
        bs = getattr(stock, "balance_sheet", None)
        if bs is not None and hasattr(bs, "to_dict"):
            out["balance_sheet"] = _df_to_json_safe(bs)
        # Income statement (income_stmt in yfinance)
        inc = _first_non_none(getattr(stock, "income_stmt", None), getattr(stock, "income_statement", None))
        if inc is not None and hasattr(inc, "to_dict"):
            out["income_statement"] = _df_to_json_safe(inc)
        # Cash flow
        cf = _first_non_none(getattr(stock, "cashflow", None), getattr(stock, "cash_flow", None))
        if cf is not None and hasattr(cf, "to_dict"):
            out["cash_flow"] = _df_to_json_safe(cf)
        return out
    except Exception:
        return None


def fetch_financials_batch(tickers: list[str], period: str = "1y") -> list[dict[str, Any]]:
    """Fetch summary for multiple tickers. Returns list of summaries (skips failures)."""
    out = []
    for t in tickers[:100]:  # cap at 100 for current run
        s = fetch_financial_summary(t, period=period)
        if s:
            out.append(s)
    return out
