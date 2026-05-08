"""
FastAPI backend: company lists (e.g. SP500) and Yahoo Finance current data.
Run: uvicorn main:app --reload --port 8000
"""
import os
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from data_loader import (
    fetch_financial_summary,
    fetch_financial_statements,
    fetch_financials_batch,
    fetch_returns_batch,
    load_tickers,
    sp500_instrument_csv_path,
)
from watchlist_snapshot_csv import save_snapshot_csv_bundles

from forex_registry import FOREX_YAHOO, normalize_forex_pair_symbol, pairs_touching_currency
from forex_sentinel_payload import build_sentinel_payload

app = FastAPI(title="Watchlist API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Ensure JSON error bodies (and log tracebacks) instead of opaque 500 HTML."""
    if isinstance(exc, HTTPException):
        detail: Any = exc.detail
        if not isinstance(detail, (str, list, dict)):
            detail = str(detail)
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})
    import traceback

    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc!s}"},
    )


@app.get("/")
def root() -> dict[str, str]:
    """No HTML UI here; use /docs for the API browser or /api/health for a quick check."""
    return {"service": app.title, "docs": "/docs", "openapi": "/openapi.json", "health": "/api/health"}


@app.get("/api/lists/sp500/meta")
def get_sp500_meta() -> dict[str, Any]:
    """Resolve CSV path and ticker count without loading Yahoo; use before full watchlist runs."""
    path = sp500_instrument_csv_path()
    try:
        rows = load_tickers(csv_path=path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read SP500 CSV at {path}: {e}") from e
    return jsonable_encoder({"path": path, "count": len(rows)})


@app.get("/api/lists/sp500")
def get_sp500_list(
    limit: Annotated[
        Optional[int],
        Query(description="Max tickers; omit this parameter to return every row in the CSV", ge=1, le=5000),
    ] = None,
) -> list[dict[str, Any]]:
    """Return company list from backend/data/sp500.csv by default (override with SP500_INSTRUMENT_CSV). Omit `limit` for the full file."""
    try:
        rows = load_tickers(csv_path=sp500_instrument_csv_path(), limit=limit)
        return jsonable_encoder(rows)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load ticker list (check SP500_INSTRUMENT_CSV / backend/data/sp500.csv): {e}",
        ) from e


@app.get("/api/financials/{ticker}")
def get_financials(ticker: str) -> Any:
    """Fetch current data from Yahoo Finance for one ticker."""
    return jsonable_encoder(fetch_financial_summary(ticker))


@app.get("/api/financials/{ticker}/statements")
def get_financial_statements(ticker: str) -> Any:
    """Fetch balance_sheet, income_statement, cash_flow for one ticker."""
    return jsonable_encoder(fetch_financial_statements(ticker))


@app.post("/api/financials/batch")
def post_financials_batch(body: dict[str, list[str]]) -> Any:
    """Fetch current data for multiple tickers (max 5000). Body: { \"tickers\": [\"AAPL\", \"MSFT\"] }"""
    tickers = body.get("tickers") or []
    try:
        rows = fetch_financials_batch(tickers)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Yahoo Finance batch failed (network or data). Try a smaller list. {type(e).__name__}: {e}",
        ) from e
    try:
        return jsonable_encoder(rows)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not serialize batch response. {type(e).__name__}: {e}",
        ) from e


@app.post("/api/financials/returns-batch")
def post_returns_batch(body: dict[str, list[str]]) -> Any:
    """Fetch daily returns series for multiple tickers (max 5000). Body: { \"tickers\": [\"AAPL\", \"MSFT\"] }"""
    tickers = body.get("tickers") or []
    try:
        return jsonable_encoder(fetch_returns_batch(tickers))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Returns batch failed: {type(e).__name__}: {e}") from e


class WatchlistExportBody(BaseModel):
    """Symbols to write on the machine where this API runs (e.g. for a local Alpaca bot)."""

    symbols: list[str] = Field(..., min_length=1)
    watchlist_date: str | None = Field(
        default=None,
        description="Optional YYYY-MM-DD (used in response only; file is always the configured filename).",
    )


def _alpaca_watchlist_dir() -> Path:
    raw = os.environ.get("ALPACA_WATCHLIST_EXPORT_DIR", "~/alpaca-bot/watchlistSP500")
    return Path(os.path.expanduser(raw.strip())).resolve()


def _alpaca_watchlist_filename() -> str:
    name = (os.environ.get("WATCHLIST_EXPORT_FILENAME") or "symbols.txt").strip()
    return name if name else "symbols.txt"


@app.post("/api/watchlist/export")
def post_watchlist_export(body: WatchlistExportBody) -> dict[str, Any]:
    """
    Write tickers to a local directory on the host running this process.
    Default: ~/alpaca-bot/watchlistSP500/symbols.txt (one symbol per line, UTF-8).
    Override with ALPACA_WATCHLIST_EXPORT_DIR and WATCHLIST_EXPORT_FILENAME.
    When using Docker, mount the host folder into the container and set ALPACA_WATCHLIST_EXPORT_DIR accordingly.
    """
    if (os.environ.get("WATCHLIST_EXPORT_DISABLED") or "").strip().lower() in ("1", "true", "yes"):
        return {"skipped": True, "reason": "WATCHLIST_EXPORT_DISABLED is set"}

    seen: set[str] = set()
    normalized: list[str] = []
    for s in body.symbols:
        u = str(s).upper().strip()
        if u and u not in seen:
            seen.add(u)
            normalized.append(u)
    if not normalized:
        raise HTTPException(status_code=400, detail="No valid symbols after normalization.")

    out_dir = _alpaca_watchlist_dir()
    out_name = _alpaca_watchlist_filename()
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / out_name
        text = "\n".join(normalized) + "\n"
        out_path.write_text(text, encoding="utf-8")
    except OSError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not write watchlist file: {e}. Create the folder or set ALPACA_WATCHLIST_EXPORT_DIR; or WATCHLIST_EXPORT_DISABLED=1 to skip.",
        ) from e

    return {
        "path": str(out_path),
        "dir": str(out_dir),
        "file": out_name,
        "count": len(normalized),
        "watchlist_date": body.watchlist_date,
    }


class WatchlistSnapshotCsvBody(BaseModel):
    """Triggered when admin saves a daily watchlist — writes CSV bundles on the machine running this API."""

    started_at_iso: str = Field(..., min_length=16, description="ISO timestamp (UTC) for audit")
    csv_stamp: Optional[str] = Field(
        default=None,
        description="Optional YYYY-MM-DD-HHMMSS from browser local time; must match watchlistCsvFilenameBase stamp",
    )
    items: Optional[list[dict[str, Any]]] = Field(default=None, description="Snapshot rows with metrics")
    symbols: Optional[list[str]] = Field(default=None, description="Fallback when items are empty")
    watchlist_date: Optional[str] = Field(default=None, description="YYYY-MM-DD for symbols-only CSV")


@app.post("/api/watchlist/snapshot-csv")
def post_watchlist_snapshot_csv(body: WatchlistSnapshotCsvBody) -> dict[str, Any]:
    """
    Writes UTF-8 CSV files under SMARTINVEST_WATCHLIST_CSV_DIR (default: <repo>/watchlist):
    watchlist-{date}-{time}.csv (matches legacy filenames), optional watchlist-top10-* / watchlist-worst10-*.
    """
    if (os.environ.get("WATCHLIST_SNAPSHOT_CSV_DISABLED") or "").strip().lower() in ("1", "true", "yes"):
        return {"skipped": True, "reason": "WATCHLIST_SNAPSHOT_CSV_DISABLED"}

    items = body.items or []
    symbols = body.symbols or []
    if not items and not symbols:
        raise HTTPException(status_code=400, detail="Provide items and/or symbols.")

    try:
        return save_snapshot_csv_bundles(
            started_at_iso=body.started_at_iso,
            items=items,
            symbols_only=None if items else symbols,
            watchlist_date_ymd=body.watchlist_date,
            csv_stamp=body.csv_stamp,
        )
    except OSError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not write CSV bundle: {e}. Check SMARTINVEST_WATCHLIST_CSV_DIR and permissions.",
        ) from e


def _repo_root_path() -> Path:
    return Path(__file__).resolve().parent.parent


def _clear_hmm_cache(pair: str) -> None:
    pu = normalize_forex_pair_symbol(pair)
    cache = Path(__file__).resolve().parent / "cache" / f"hmm_{pu}.pkl"
    try:
        if cache.exists():
            cache.unlink()
    except OSError:
        pass


class ForexRefreshBody(BaseModel):
    pair: Optional[str] = Field(default=None, description="Single pair e.g. EURUSD")
    currency: Optional[str] = Field(default=None, description="ISO currency code — refresh all pairs containing it (e.g. EUR)")


@app.post("/api/forex/refresh")
def post_forex_refresh(body: ForexRefreshBody) -> dict[str, Any]:
    """Download/update OHLC CSVs via scripts/download_forex_history.py (mirrors public/currency_data)."""
    repo = _repo_root_path()
    script = repo / "scripts" / "download_forex_history.py"
    if not script.exists():
        raise HTTPException(status_code=500, detail=f"Missing script at {script}")

    pairs: list[str] = []
    if body.pair and str(body.pair).strip():
        p = normalize_forex_pair_symbol(str(body.pair))
        if p not in FOREX_YAHOO:
            raise HTTPException(status_code=400, detail=f"Unknown forex pair {p}. Sync backend/forex_registry.py with components/ForexData.ts.")
        pairs = [p]
    elif body.currency and str(body.currency).strip():
        pairs = pairs_touching_currency(str(body.currency))
        if not pairs:
            raise HTTPException(status_code=400, detail=f"No pairs registered for currency {body.currency!r}")
    else:
        raise HTTPException(status_code=400, detail="Provide `pair` or `currency`.")

    exe = sys.executable
    refreshed: list[str] = []
    errors: list[str] = []

    for p in pairs:
        try:
            r = subprocess.run(
                [exe, str(script), "--pair", p],
                cwd=str(repo),
                check=True,
                capture_output=True,
                text=True,
                timeout=600,
            )
            if r.stdout:
                pass  # logs optional
            refreshed.append(p)
            _clear_hmm_cache(p)
        except subprocess.TimeoutExpired:
            errors.append(f"{p}: timeout")
        except subprocess.CalledProcessError as e:
            err = (e.stderr or e.stdout or str(e))[:800]
            errors.append(f"{p}: {err}")

    return jsonable_encoder(
        {
            "refreshed": refreshed,
            "errors": errors,
            "count": len(refreshed),
        }
    )


@app.get("/api/forex/pairs")
def get_forex_pairs() -> dict[str, Any]:
    """Pairs available for OHLC download / Sentinel (aligned with forex_registry)."""
    return {"pairs": sorted(FOREX_YAHOO.keys())}


class ForexSentinelBody(BaseModel):
    pair: str = Field(..., min_length=5)
    sentiment_score: float = Field(default=0.0, ge=-1.0, le=1.0)
    sentiment_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    hmm_and_fx_data_only: bool = Field(
        default=False,
        description="When true, directional_forecast uses only HMM + FX OHLC-derived technicals (no news sentiment in the blend).",
    )


@app.post("/api/forex/sentinel-context")
def post_forex_sentinel_context(body: ForexSentinelBody) -> dict[str, Any]:
    """
    HMM regime (trained on RSI+MACD only) + technicals + optional sentiment placeholders.
    Fuse regime/sentiment/levels in the frontend LLM step (Forex Sentinel Alpha).
    """
    try:
        payload = build_sentinel_payload(
            body.pair,
            sentiment_score=body.sentiment_score,
            sentiment_confidence=body.sentiment_confidence,
            hmm_and_fx_data_only=body.hmm_and_fx_data_only,
        )
        return jsonable_encoder(payload)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}") from e


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
