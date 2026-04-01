"""
FastAPI backend: company lists (e.g. SP500) and Yahoo Finance current data.
Run: uvicorn main:app --reload --port 8000
"""
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from data_loader import fetch_financial_summary, fetch_financial_statements, fetch_financials_batch, fetch_returns_batch, load_tickers

app = FastAPI(title="Watchlist API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/lists/sp500")
def get_sp500_list(limit: int = Query(default=600, le=600, description="Max number of tickers")) -> list[dict[str, Any]]:
    """Return company list (from CSV). Use limit for a short list."""
    return load_tickers(limit=limit)


@app.get("/api/financials/{ticker}")
def get_financials(ticker: str) -> dict[str, Any] | None:
    """Fetch current data from Yahoo Finance for one ticker."""
    return fetch_financial_summary(ticker)


@app.get("/api/financials/{ticker}/statements")
def get_financial_statements(ticker: str) -> dict[str, Any] | None:
    """Fetch balance_sheet, income_statement, cash_flow for one ticker."""
    return fetch_financial_statements(ticker)


@app.post("/api/financials/batch")
def post_financials_batch(body: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Fetch current data for multiple tickers (max 600). Body: { \"tickers\": [\"AAPL\", \"MSFT\"] }"""
    tickers = body.get("tickers") or []
    return fetch_financials_batch(tickers)


@app.post("/api/financials/returns-batch")
def post_returns_batch(body: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Fetch daily returns series for multiple tickers (max 600). Body: { \"tickers\": [\"AAPL\", \"MSFT\"] }"""
    tickers = body.get("tickers") or []
    return fetch_returns_batch(tickers)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
