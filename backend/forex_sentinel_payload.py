"""Assemble Forex Sentinel Alpha JSON for the LLM decision layer."""

from __future__ import annotations

from pathlib import Path

from forex_probability import compute_directional_forecast
from forex_registry import FOREX_YAHOO, normalize_forex_pair_symbol
from forex_technicals import build_feature_frame, load_ohlc_csv
from hmm_brain import predict_state


def resolve_forex_ohlc_csv(pair: str, timeframe: str = "1h") -> Path | None:
    repo = Path(__file__).resolve().parent.parent
    pu = normalize_forex_pair_symbol(pair)
    name = f"{pu}_{timeframe}.csv"
    for base in (repo / "currency_data", repo / "public" / "currency_data"):
        cand = base / pu / name
        if cand.exists():
            return cand
    return None


def build_sentinel_payload(
    pair: str,
    *,
    sentiment_score: float = 0.0,
    sentiment_confidence: float = 0.0,
    csv_path: Path | None = None,
    hmm_and_fx_data_only: bool = False,
) -> dict:
    pu = normalize_forex_pair_symbol(pair)
    if pu not in FOREX_YAHOO:
        raise ValueError(
            f"Unknown forex pair {pair!r} → {pu!r}. Use symbols like EURUSD (same as currency_data/EURUSD/ on disk)."
        )
    path = csv_path or resolve_forex_ohlc_csv(pu)
    if path is None:
        raise FileNotFoundError(
            f"No OHLC CSV for {pu}. Run POST /api/forex/refresh first (downloads currency_data/{pu}/)."
        )

    df = load_ohlc_csv(path)
    if len(df) < 2:
        raise ValueError("Need at least 2 OHLC bars for pivots and forecast.")
    prev_bar = df.iloc[-2]
    last_bar = df.iloc[-1]
    close_live = float(last_bar["Close"])
    prev_high = float(prev_bar["High"])
    prev_low = float(prev_bar["Low"])
    prev_close = float(prev_bar["Close"])

    feat = build_feature_frame(df)
    last = feat.iloc[-1]

    mapped_state, probs_mapped, _raw = predict_state(pu, path)
    dominant = "Bull" if mapped_state == 2 else "Bear" if mapped_state == 0 else "Neutral"

    leading_p = max(probs_mapped) if probs_mapped else 0.0
    unstable = leading_p < 0.60

    directional_forecast = compute_directional_forecast(
        probs_mapped,
        float(sentiment_score),
        float(sentiment_confidence),
        float(last["rsi"]),
        float(last["macd"]),
        close_live,
        prev_high,
        prev_low,
        prev_close,
        hmm_and_fx_data_only=hmm_and_fx_data_only,
    )

    hmm_note = (
        "HMM trained on RSI+MACD only (2D). Directional forecast blends HMM + FX OHLC technicals only (no news sentiment)."
        if hmm_and_fx_data_only
        else "HMM trained on RSI+MACD only (2D). Sentiment + pivots fused in directional_forecast."
    )
    sentiment_block: dict = {
        "score": float(sentiment_score),
        "confidence": float(sentiment_confidence),
    }
    if hmm_and_fx_data_only:
        sentiment_block["note"] = (
            "Not used in directional_forecast blend for this request; quant path is HMM + OHLC-derived levels only."
        )

    out: dict = {
        "symbol": pu,
        "analysis_mode": "forex_ohlc_hmm_only" if hmm_and_fx_data_only else "forex_sentinel_full",
        "hmm_regime": {
            "state": mapped_state,
            "probabilities": probs_mapped,
            "dominant_state": dominant,
            "regime_unstable": unstable,
            "leading_probability": leading_p,
            "note": hmm_note,
        },
        "sentiment": sentiment_block,
        "technicals": {
            "rsi": float(last["rsi"]),
            "macd": float(last["macd"]),
            "proximity_to_support": float(last["dist_to_support"]),
            "proximity_to_resistance": float(last["dist_to_resistance"]),
            "current_price": float(close_live),
        },
        "directional_forecast": directional_forecast,
    }
    return out
