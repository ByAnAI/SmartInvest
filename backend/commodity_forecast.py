"""
Multi-horizon commodity price expectations from a 3-state daily HMM + pivot path probabilities.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from commodity_hmm import (
    mapped_state_mean_log_returns_from_labels,
    predict_commodity_state,
    remapped_transition_matrix,
    train_or_load_commodity,
)
from forex_probability import _scenario_confidence, _triple_entropy, compute_directional_forecast, touch_race_probabilities
from forex_technicals import build_feature_frame, load_ohlc_csv
from pivot_levels import classic_pivot_levels

HORIZONS: tuple[tuple[str, str, int], ...] = (
    ("1d", "Next day", 1),
    ("5d", "Next 5 days", 5),
    ("1m", "Next month (~21 sessions)", 21),
    ("3m", "Next 3 months (~63 sessions)", 63),
    ("1y", "Next year (~252 sessions)", 252),
    ("3y", "Next 3 years (~756 sessions)", 756),
)


def _propagate(pi: np.ndarray, T: np.ndarray, steps: int) -> np.ndarray:
    p = np.asarray(pi, dtype=float).copy()
    for _ in range(max(0, steps)):
        p = p @ T
    s = p.sum()
    if s <= 1e-15:
        return np.array([1 / 3, 1 / 3, 1 / 3])
    return p / s


def _expected_log_return_over_horizon(pi0: np.ndarray, T: np.ndarray, mu: np.ndarray, steps: int) -> float:
    p = pi0.copy()
    total = 0.0
    for _ in range(max(0, steps)):
        p = p @ T
        total += float(p @ mu)
    return total


def _horizon_confidence_percent(
    pi_h: list[float],
    scenario_entropy: float,
    n_bars: int,
    trading_days: int,
    leading_now: float,
) -> int:
    max_ent = float(np.log(3))
    ent_factor = 1.0 - min(1.0, scenario_entropy / max_ent) * 0.45 if max_ent > 0 else 0.55
    leading_h = max(pi_h) if pi_h else 0.33
    regime_factor = 0.25 + 0.75 * (0.45 * leading_now + 0.55 * leading_h)
    data_factor = min(1.0, n_bars / max(trading_days * 3, 30))
    if trading_days <= 5:
        horizon_factor = 1.0
    elif trading_days <= 63:
        horizon_factor = max(0.35, 1.0 - (trading_days / 252) ** 0.55 * 0.45)
    else:
        horizon_factor = max(0.12, 0.55 - (trading_days / 756) * 0.35)
    raw = ent_factor * regime_factor * data_factor * horizon_factor
    return int(round(float(np.clip(raw * 100, 5, 95))))


def _path_outcome_triple(
    p_up: float,
    p_mid: float,
    p_down: float,
    race: dict[str, float],
    trading_days: int,
    hmm_align: float,
    news_c_eff: float,
    ent: float,
) -> dict[str, Any]:
    """P(hit resistance), P(hit support), P(sideways) — renormalized to sum ~1."""
    p_race_r = float(race.get("probability_resistance_hit_before_support", 0.5))
    p_race_s = float(race.get("probability_support_hit_before_resistance", 0.5))
    h_scale = float(np.sqrt(max(1, trading_days)))
    dup = float(race.get("distance_up_to_resistance", 1.0)) * h_scale
    ddn = float(race.get("distance_down_to_support", 1.0)) * h_scale
    p_race_r = ddn / max(dup + ddn, 1e-12)
    p_race_s = dup / max(dup + ddn, 1e-12)

    w_path = min(0.55, 0.25 + 0.08 * np.sqrt(max(1, trading_days)))
    w_scen = 1.0 - w_path

    hit_r = w_scen * p_up + w_path * p_race_r
    hit_s = w_scen * p_down + w_path * p_race_s
    side = w_scen * p_mid + w_path * (1.0 - abs(p_race_r - p_race_s))

    s = hit_r + hit_s + side
    if s <= 1e-15:
        hit_r, hit_s, side = 1 / 3, 1 / 3, 1 / 3
    else:
        hit_r, hit_s, side = hit_r / s, hit_s / s, side / s

    return {
        "hit_resistance": {
            "label": "Hit resistance (bull path / upside barrier)",
            "probability": round(hit_r, 4),
            "confidence_percent": _scenario_confidence(hit_r, hmm_align, news_c_eff, ent),
        },
        "hit_support": {
            "label": "Hit support (bear path / downside barrier)",
            "probability": round(hit_s, 4),
            "confidence_percent": _scenario_confidence(hit_s, 1.0 - hmm_align, news_c_eff, ent),
        },
        "sideways": {
            "label": "Sideways / range between support and resistance",
            "probability": round(side, 4),
            "confidence_percent": _scenario_confidence(side, 0.5, news_c_eff, ent),
        },
    }


def build_horizon_forecasts(
    commodity_id: str,
    csv_path: Any,
    *,
    sentiment_score: float = 0.0,
    sentiment_confidence: float = 0.0,
) -> dict[str, Any]:
    from pathlib import Path

    path = Path(csv_path)
    df = load_ohlc_csv(path)
    if len(df) < 2:
        raise ValueError("Need at least 2 OHLC rows for commodity forecast.")

    prev_bar = df.iloc[-2]
    last_bar = df.iloc[-1]
    close_live = float(last_bar["Close"])
    prev_high = float(prev_bar["High"])
    prev_low = float(prev_bar["Low"])
    prev_close = float(prev_bar["Close"])

    feat = build_feature_frame(df)
    last = feat.iloc[-1]
    n_bars = len(feat)

    model, X, remap, log_ret = train_or_load_commodity(commodity_id, path)
    mapped_state, probs_now, _raw = predict_commodity_state(commodity_id, path)
    T = remapped_transition_matrix(model, remap)
    mu = mapped_state_mean_log_returns_from_labels(model, X, remap, log_ret)
    pi0 = np.asarray(probs_now, dtype=float)

    dominant = "Bull" if mapped_state == 2 else "Bear" if mapped_state == 0 else "Neutral"
    leading_p = max(probs_now) if probs_now else 0.0
    news_c_eff = float(np.clip(sentiment_confidence, 0, 1))

    horizons_out: list[dict[str, Any]] = []
    for hid, label, days in HORIZONS:
        pi_h = _propagate(pi0, T, days)
        exp_log = _expected_log_return_over_horizon(pi0, T, mu, days)
        expected_price = float(close_live * np.exp(exp_log))
        exp_ret_pct = float((np.exp(exp_log) - 1.0) * 100.0)

        directional = compute_directional_forecast(
            [float(pi_h[0]), float(pi_h[1]), float(pi_h[2])],
            float(sentiment_score),
            float(sentiment_confidence),
            float(last["rsi"]),
            float(last["macd"]),
            close_live,
            prev_high,
            prev_low,
            prev_close,
            hmm_and_fx_data_only=False,
        )
        scen = directional.get("scenarios", {})
        p_up = float(scen.get("up", {}).get("probability", 1 / 3))
        p_mid = float(scen.get("neutral", {}).get("probability", 1 / 3))
        p_down = float(scen.get("down", {}).get("probability", 1 / 3))
        ent = _triple_entropy(p_up, p_mid, p_down)
        race = touch_race_probabilities(close_live, classic_pivot_levels(prev_high, prev_low, prev_close))
        hmm_align = float(max(pi_h[2], pi_h[0]))

        conf = _horizon_confidence_percent(
            [float(pi_h[0]), float(pi_h[1]), float(pi_h[2])],
            ent,
            n_bars,
            days,
            leading_p,
        )

        horizons_out.append(
            {
                "horizon_id": hid,
                "label": label,
                "trading_days": days,
                "expected_price": round(expected_price, 4),
                "current_price": round(close_live, 4),
                "expected_return_percent": round(exp_ret_pct, 3),
                "confidence_percent": conf,
                "hmm_regime_probabilities": {
                    "bear": round(float(pi_h[0]), 4),
                    "neutral": round(float(pi_h[1]), 4),
                    "bull": round(float(pi_h[2]), 4),
                },
                "path_outcomes": _path_outcome_triple(
                    p_up,
                    p_mid,
                    p_down,
                    race,
                    days,
                    hmm_align,
                    news_c_eff,
                    ent,
                ),
                "directional_scenarios": scen,
                "touch_race": race,
            }
        )

    return {
        "commodity_id": commodity_id,
        "current_price": round(close_live, 4),
        "bars_used": n_bars,
        "hmm_regime": {
            "state": mapped_state,
            "probabilities": probs_now,
            "dominant_state": dominant,
            "regime_unstable": leading_p < 0.60,
            "leading_probability": round(leading_p, 4),
            "state_mean_daily_log_return": {
                "bear": round(float(mu[0]), 6),
                "neutral": round(float(mu[1]), 6),
                "bull": round(float(mu[2]), 6),
            },
            "note": "Daily 3-state Gaussian HMM on RSI+MACD; states remapped by mean log return (bear→bull).",
        },
        "horizons": horizons_out,
        "meta": {
            "model": "GaussianHMM",
            "features": ["RSI/100", "MACD scaled"],
            "disclaimer": (
                "Statistical model on historical daily bars — not investment advice. "
                "Long horizons (1y, 3y) have wide uncertainty; confidence is capped when history is short."
            ),
        },
    }
