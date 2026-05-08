from __future__ import annotations
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd
import yfinance as yf


@dataclass
class DataBundle:
    ticker: str
    info: Dict[str, Any]
    price: pd.DataFrame
    financials: pd.DataFrame
    cashflow: pd.DataFrame
    balance_sheet: pd.DataFrame
    shares_outstanding: Optional[float]
    market_cap: Optional[float]
    beta: Optional[float]


def load_universe(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    needed =['Ticker',	'Company','Sector','Location','Industry','Website']
    for col in needed:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")
    return df[needed].copy()



def _safe_ticker_dir(cache_dir: Path, ticker: str) -> Path:
    path = cache_dir / ticker.replace("/", "_")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _save_json(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle)


def _load_df(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    if path.suffix == ".parquet":
        return pd.read_parquet(path)
    return pd.read_csv(path, index_col=0)


def _save_df(path: Path, df: pd.DataFrame) -> None:
    if df.empty:
        return
    if path.suffix == ".parquet":
        df.to_parquet(path)
    else:
        df.to_csv(path)


def _normalize_financials(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    # yfinance returns columns as dates; transpose for easier time-series ops.
    cleaned = df.T.copy()
    cleaned.index = pd.to_datetime(cleaned.index)
    cleaned.sort_index(inplace=True)
    return cleaned


def fetch_yfinance_bundle(
    ticker: str,
    cache_dir: str,
    use_cache: bool = True,
    price_period: str = "max",
) -> DataBundle:
    cache_base = Path(cache_dir)
    cache_base.mkdir(parents=True, exist_ok=True)
    ticker_dir = _safe_ticker_dir(cache_base, ticker)

    info_path = ticker_dir / "info.json"
    price_path = ticker_dir / "price.parquet"
    financials_path = ticker_dir / "financials.parquet"
    cashflow_path = ticker_dir / "cashflow.parquet"
    balance_path = ticker_dir / "balance_sheet.parquet"

    if use_cache and all(
        p.exists()
        for p in [info_path, price_path, financials_path, cashflow_path, balance_path]
    ):
        info = _load_json(info_path)
        price = _load_df(price_path)
        financials = _load_df(financials_path)
        cashflow = _load_df(cashflow_path)
        balance_sheet = _load_df(balance_path)
    else:
        yf_ticker = yf.Ticker(ticker)
        info = yf_ticker.get_info()
        price = yf_ticker.history(period=price_period, auto_adjust=False)
        financials = _normalize_financials(yf_ticker.financials)
        cashflow = _normalize_financials(yf_ticker.cashflow)
        balance_sheet = _normalize_financials(yf_ticker.balance_sheet)

        _save_json(info_path, info or {})
        _save_df(price_path, price)
        _save_df(financials_path, financials)
        _save_df(cashflow_path, cashflow)
        _save_df(balance_path, balance_sheet)

    shares_outstanding = info.get("sharesOutstanding") if info else None
    market_cap = info.get("marketCap") if info else None
    beta = info.get("beta") if info else None

    return DataBundle(
        ticker=ticker,
        info=info or {},
        price=price,
        financials=financials,
        cashflow=cashflow,
        balance_sheet=balance_sheet,
        shares_outstanding=shares_outstanding,
        market_cap=market_cap,
        beta=beta,
    )


def latest_price(price_df: pd.DataFrame) -> Optional[float]:
    if price_df is None or price_df.empty:
        return None
    return float(price_df["Close"].dropna().iloc[-1])
