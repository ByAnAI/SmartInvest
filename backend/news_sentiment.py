"""
Alpha Vantage NEWS_SENTIMENT — used by AGENTS/news_agent and FastAPI portfolio routes.
Docs: https://www.alphavantage.co/documentation/#news-sentiment
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any, Optional

import requests
from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_REPO_ROOT / ".env")
load_dotenv(_REPO_ROOT / ".env.local")

BASE_URL = "https://www.alphavantage.co/query"
# Free tier: 5 calls/min — stay under with spacing between symbols in a batch.
_MIN_SECONDS_BETWEEN_CALLS = float(os.environ.get("ALPHA_VANTAGE_NEWS_MIN_INTERVAL", "12.5"))
_CACHE_TTL_SEC = int(os.environ.get("ALPHA_VANTAGE_NEWS_CACHE_TTL", "900"))
_MAX_SYMBOLS_PER_REQUEST = int(os.environ.get("ALPHA_VANTAGE_NEWS_MAX_SYMBOLS", "15"))

_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_last_call_at = 0.0

_EQUITY_TICKER = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def get_api_key() -> str:
    key = (os.environ.get("ALPHA_VANTAGE_API_KEY") or "").strip()
    if not key:
        raise ValueError(
            "ALPHA_VANTAGE_API_KEY is not set. Add it to the repo root .env (get a free key at https://www.alphavantage.co/support/#api-key)."
        )
    return key


def normalize_equity_symbol(symbol: str) -> Optional[str]:
    s = str(symbol or "").upper().strip()
    if not s or not _EQUITY_TICKER.match(s):
        return None
    if s.endswith("USDT") or s.endswith("USD") and len(s) > 5:
        return None
    return s


def _throttle() -> None:
    global _last_call_at
    elapsed = time.monotonic() - _last_call_at
    if elapsed < _MIN_SECONDS_BETWEEN_CALLS:
        time.sleep(_MIN_SECONDS_BETWEEN_CALLS - elapsed)
    _last_call_at = time.monotonic()


def fetch_news_feed(symbol: str, limit: int = 50, use_cache: bool = True) -> list[dict[str, Any]]:
    """Raw feed items from Alpha Vantage for one ticker."""
    sym = normalize_equity_symbol(symbol)
    if not sym:
        return []

    now = time.time()
    if use_cache and sym in _cache:
        ts, cached = _cache[sym]
        if now - ts < _CACHE_TTL_SEC:
            return cached

    _throttle()
    params = {
        "function": "NEWS_SENTIMENT",
        "tickers": sym,
        "apikey": get_api_key(),
        "limit": max(1, min(limit, 1000)),
    }
    response = requests.get(BASE_URL, params=params, timeout=45)
    response.raise_for_status()
    data = response.json()

    if "Note" in data or "Information" in data:
        msg = str(data.get("Note") or data.get("Information") or data)
        raise RuntimeError(f"Alpha Vantage rate limit or notice: {msg}")

    if "Error Message" in data:
        raise RuntimeError(str(data["Error Message"]))

    feed = data.get("feed")
    if not isinstance(feed, list):
        return []

    _cache[sym] = (now, feed)
    return feed


def _float_or_none(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def article_to_public(item: dict[str, Any], symbol: str) -> dict[str, Any]:
    """One article with ticker-specific sentiment when available."""
    sym = symbol.upper()
    score: Optional[float] = None
    label: Optional[str] = None
    for ts in item.get("ticker_sentiment") or []:
        if not isinstance(ts, dict):
            continue
        if str(ts.get("ticker", "")).upper() == sym:
            score = _float_or_none(ts.get("ticker_sentiment_score"))
            label = ts.get("ticker_sentiment_label")
            break
    if score is None:
        score = _float_or_none(item.get("overall_sentiment_score"))
        label = item.get("overall_sentiment_label")
    return {
        "title": item.get("title"),
        "source": item.get("source"),
        "url": item.get("url"),
        "time": item.get("time_published"),
        "sentiment": score,
        "sentiment_label": label,
    }


def average_sentiment_for_symbol(feed: list[dict[str, Any]], symbol: str) -> Optional[float]:
    scores: list[float] = []
    sym = symbol.upper()
    for item in feed:
        row = article_to_public(item, sym)
        s = row.get("sentiment")
        if s is not None and isinstance(s, (int, float)):
            scores.append(float(s))
    if not scores:
        return None
    return sum(scores) / len(scores)


def sentiment_label(score: Optional[float]) -> str:
    if score is None:
        return "Unknown"
    if score >= 0.15:
        return "Bullish"
    if score <= -0.15:
        return "Bearish"
    return "Neutral"


def health_score_from_average(avg: Optional[float]) -> Optional[float]:
    """Map Alpha Vantage [-1, 1] average to 0–100 health."""
    if avg is None:
        return None
    return max(0.0, min(100.0, (avg + 1.0) * 50.0))


def build_portfolio_sentiment(
    symbols: list[str],
    *,
    limit_per_symbol: int = 50,
    max_symbols: Optional[int] = None,
) -> dict[str, Any]:
    """
    For each equity symbol: fetch news, average article sentiments, then portfolio health
    = sum(position averages) / count(positions with data).
    """
    cap = max_symbols if max_symbols is not None else _MAX_SYMBOLS_PER_REQUEST
    seen: set[str] = set()
    ordered: list[str] = []
    skipped: list[str] = []
    for raw in symbols:
        sym = normalize_equity_symbol(raw)
        if not sym:
            skipped.append(str(raw).upper())
            continue
        if sym in seen:
            continue
        seen.add(sym)
        ordered.append(sym)
        if len(ordered) >= cap:
            break

    positions: list[dict[str, Any]] = []
    sentiment_sum = 0.0
    with_data = 0

    for sym in ordered:
        pos: dict[str, Any] = {
            "symbol": sym,
            "average_sentiment": None,
            "article_count": 0,
            "articles": [],
            "sentiment_label": "Unknown",
        }
        try:
            feed = fetch_news_feed(sym, limit=limit_per_symbol)
            articles = [article_to_public(item, sym) for item in feed[:20]]
            avg = average_sentiment_for_symbol(feed, sym)
            pos["average_sentiment"] = avg
            pos["article_count"] = len(feed)
            pos["articles"] = articles
            pos["sentiment_label"] = sentiment_label(avg)
            if avg is not None:
                sentiment_sum += avg
                with_data += 1
        except Exception as e:
            pos["error"] = str(e)
        positions.append(pos)

    portfolio_avg: Optional[float] = None
    if with_data > 0:
        portfolio_avg = sentiment_sum / with_data

    return {
        "source": "alphavantage",
        "source_url": "https://www.alphavantage.co/",
        "positions": positions,
        "portfolio_average_sentiment": portfolio_avg,
        "portfolio_health_score": health_score_from_average(portfolio_avg),
        "portfolio_health_label": sentiment_label(portfolio_avg),
        "positions_with_data": with_data,
        "positions_requested": len(ordered),
        "skipped_symbols": skipped,
        "max_symbols_applied": cap,
    }


def run(symbol: str, limit: int = 50) -> list[dict[str, Any]]:
    """CLI / agent entry — list of articles for one symbol."""
    feed = fetch_news_feed(symbol, limit=limit, use_cache=False)
    sym = normalize_equity_symbol(symbol) or str(symbol).upper()
    return [article_to_public(item, sym) for item in feed]
