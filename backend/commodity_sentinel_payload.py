"""Commodity HMM multi-horizon forecast payload for API + UI."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd

from commodity_forecast import build_horizon_forecasts
from commodity_registry import (
    COMMODITY_IDS,
    COMMODITY_LABELS,
    normalize_commodity_id,
    resolve_commodity_ohlc_csv,
    resolve_commodity_sentiment_csv,
)


def load_commodity_sentiment(commodity_id: str) -> tuple[float, float]:
    """Return (score in [-1,1], confidence in [0,1]) from latest daily_sentiment_features row."""
    path = resolve_commodity_sentiment_csv(commodity_id)
    if path is None:
        return 0.0, 0.0
    try:
        df = pd.read_csv(path)
        if df.empty:
            return 0.0, 0.0
        last = df.iloc[-1]
        mean = float(last.get("sentiment_mean", 0.0) or 0.0)
        count = int(last.get("news_count", 0) or 0)
        score = float(max(-1.0, min(1.0, mean)))
        conf = min(1.0, count / 8.0) if count > 0 else 0.0
        return score, conf
    except Exception:
        return 0.0, 0.0


def build_commodity_forecast_payload(
    commodity_id: str,
    *,
    sentiment_score: Optional[float] = None,
    sentiment_confidence: Optional[float] = None,
    csv_path: Path | None = None,
    use_csv_sentiment: bool = True,
) -> dict:
    cid = normalize_commodity_id(commodity_id)
    path = csv_path or resolve_commodity_ohlc_csv(cid)
    if path is None:
        raise FileNotFoundError(
            f"No daily OHLC CSV for {cid}. Run: npm run download:commodities:5y "
            f"(expects commodity_data/{cid}/daily_ohlcv.csv)."
        )

    if sentiment_score is None or sentiment_confidence is None:
        auto_s, auto_c = load_commodity_sentiment(cid) if use_csv_sentiment else (0.0, 0.0)
        score = float(sentiment_score if sentiment_score is not None else auto_s)
        conf = float(sentiment_confidence if sentiment_confidence is not None else auto_c)
    else:
        score = float(sentiment_score)
        conf = float(sentiment_confidence)

    forecast = build_horizon_forecasts(cid, path, sentiment_score=score, sentiment_confidence=conf)

    return {
        "commodity_id": cid,
        "label": COMMODITY_LABELS.get(cid, cid),
        "analysis_mode": "commodity_hmm_multi_horizon",
        "sentiment": {
            "score": score,
            "confidence": conf,
            "source": "daily_sentiment_features.csv" if use_csv_sentiment else "request",
        },
        "forecast": forecast,
    }


def list_commodity_ids() -> list[str]:
    return list(COMMODITY_IDS)
