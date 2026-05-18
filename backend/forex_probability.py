"""
Collective directional probabilities: blend HMM regime probs, news sentiment (score + confidence),
and technicals (RSI, MACD, position vs classic pivot S1/R1).

Also outputs conditional “touch race” estimates: which side is hit first given distances to S1/R1.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from pivot_levels import ClassicPivotLevels, classic_pivot_levels, nearest_resistance_above, nearest_support_below


def _normalize_triple(a: float, b: float, c: float) -> tuple[float, float, float]:
    s = a + b + c
    if s <= 1e-15:
        return 1 / 3, 1 / 3, 1 / 3
    return a / s, b / s, c / s


def _sentiment_triple(score: float, confidence: float) -> tuple[float, float, float]:
    """score in [-1,1], confidence in [0,1]. Returns (up, sideways, down) masses mixing toward uniform when c→0."""
    s = float(np.clip(score, -1, 1))
    c = float(np.clip(confidence, 0, 1))
    nu = max(0.0, (s + 1) / 2)
    nd = max(0.0, (1 - s) / 2)
    nm = max(0.0, 1 - abs(s))
    ns = nu + nm + nd
    if ns <= 1e-15:
        uu, mm, dd = 1 / 3, 1 / 3, 1 / 3
    else:
        uu, mm, dd = nu / ns, nm / ns, nd / ns
    # Mix with uniform when confidence is low
    u = c * uu + (1 - c) / 3
    m = c * mm + (1 - c) / 3
    d = c * dd + (1 - c) / 3
    return _normalize_triple(u, m, d)


def _technical_triple(
    rsi: float,
    macd: float,
    close: float,
    lv: ClassicPivotLevels,
) -> tuple[float, float, float]:
    """Rough likelihood masses for near-term up / range / down from RSI, MACD, position between S1–R1."""
    R1 = nearest_resistance_above(close, lv)
    S1 = nearest_support_below(close, lv)
    span = max(R1 - S1, 1e-12)
    pos = float(np.clip((close - S1) / span, 0, 1))  # 0 at support, 1 at resistance

    # Range-bound tendency near pivot band center
    band_mid = 4 * pos * (1 - pos)

    rsi_f = float(np.clip(rsi, 0, 100))
    over = max(0, rsi_f - 70) / 30
    under = max(0, 30 - rsi_f) / 30

    tech_down = 0.35 * pos ** 1.2 + 0.25 * over + 0.15 * max(0, -macd)
    tech_up = 0.35 * (1 - pos) ** 1.2 + 0.25 * under + 0.15 * max(0, macd)
    tech_mid = 0.4 * band_mid + 0.1 * (1 - abs(rsi_f - 50) / 50)

    return _normalize_triple(tech_up, tech_mid, tech_down)


def _scenario_confidence(
    p: float,
    hmm_align: float,
    news_confidence: float,
    triple_entropy_bits: float,
) -> int:
    """Scalar confidence 0–100 for one scenario probability mass."""
    # Lower entropy in the full triple ⇒ higher conviction
    max_ent = np.log(3)
    agreement = 1 - min(1, triple_entropy_bits / max_ent) if max_ent > 0 else 0.5
    base = p * (0.35 + 0.35 * hmm_align + 0.25 * news_confidence + 0.05 * agreement)
    return int(round(float(np.clip(base * 100, 0, 100))))


def _triple_entropy(pu: float, pm: float, pd: float) -> float:
    ps = np.array([pu, pm, pd], dtype=float)
    ps = ps[ps > 1e-15]
    if ps.size == 0:
        return np.log(3)
    return float(-np.sum(ps * np.log(ps)))


def band_quality(close: float, lv: ClassicPivotLevels) -> float:
    """How centered price is between nearest S and R (0–1, peaks mid-band)."""
    R1 = nearest_resistance_above(close, lv)
    S1 = nearest_support_below(close, lv)
    span = max(R1 - S1, 1e-12)
    pos = (close - S1) / span
    return float(4 * pos * (1 - pos))


def touch_race_probabilities(close: float, lv: ClassicPivotLevels) -> dict[str, float]:
    """
    Symmetric barrier intuition: dup = distance up to nearest R above, ddown = distance down to nearest S below.
    P(hit resistance first) ≈ ddown / (dup + ddown) (standard diffusion shortcut; not investment advice).
    """
    R = nearest_resistance_above(close, lv)
    S = nearest_support_below(close, lv)
    dup = max(R - close, 1e-9)
    ddown = max(close - S, 1e-9)
    p_resist_first = ddown / (dup + ddown)
    p_support_first = dup / (dup + ddown)
    return {
        "nearest_resistance": float(R),
        "nearest_support": float(S),
        "distance_up_to_resistance": float(dup),
        "distance_down_to_support": float(ddown),
        "probability_resistance_hit_before_support": float(p_resist_first),
        "probability_support_hit_before_resistance": float(p_support_first),
    }


def compute_directional_forecast(
    hmm_probs_bear_neutral_bull: list[float],
    sentiment_score: float,
    sentiment_confidence: float,
    rsi: float,
    macd: float,
    close: float,
    prev_high: float,
    prev_low: float,
    prev_close: float,
    *,
    hmm_and_fx_data_only: bool = False,
) -> dict[str, Any]:
    """
    hmm_probs: mapped order [P(bear), P(neutral), P(bull)] each in [0,1], sum ~ 1.
    When hmm_and_fx_data_only=True: blend only HMM regime + FX OHLC-derived technicals (pivots/RSI/MACD); no news sentiment.
    """
    pb, pn, pu_hmm = [float(x) for x in hmm_probs_bear_neutral_bull]
    lv = classic_pivot_levels(prev_high, prev_low, prev_close)

    nu, nm, nd = _sentiment_triple(sentiment_score, sentiment_confidence)
    tu, tm, td = _technical_triple(rsi, macd, close, lv)

    # Linear blend then renormalize (interpretable weights)
    if hmm_and_fx_data_only:
        w_h, w_s, w_t = 0.50, 0.0, 0.50
        news_c_eff = 0.0
    else:
        w_h, w_s, w_t = 0.35, 0.35, 0.30
        news_c_eff = float(np.clip(sentiment_confidence, 0, 1))

    vu = w_h * pu_hmm + w_s * nu + w_t * tu
    vm = w_h * pn + w_s * nm + w_t * tm
    vd = w_h * pb + w_s * nd + w_t * td
    p_up, p_mid, p_down = _normalize_triple(vu, vm, vd)

    ent = _triple_entropy(p_up, p_mid, p_down)

    race = touch_race_probabilities(close, lv)
    bq = band_quality(close, lv)

    blend_note = (
        "HMM regime + FX OHLC technicals (pivots/RSI/MACD from CSV only). News sentiment excluded from blend."
        if hmm_and_fx_data_only
        else "Scenario probabilities normalize HMM + sentiment + pivot/RSI/MACD. Touch-race is a distance-based first-touch shortcut (not a price target)."
    )
    scen_up_note = (
        "HMM + intraday/OHLC-based technicals only; path metric uses distance to nearest R vs S."
        if hmm_and_fx_data_only
        else "Collective blend of news + HMM + tech; path metric uses distance to nearest R vs S."
    )

    out = {
        "weights": {"hmm": w_h, "sentiment": w_s, "technicals": w_t},
        "pivot_levels": {
            "pivot": lv.pivot,
            "r1": lv.r1,
            "r2": lv.r2,
            "r3": lv.r3,
            "s1": lv.s1,
            "s2": lv.s2,
            "s3": lv.s3,
            "prior_bar": {"high": prev_high, "low": prev_low, "close": prev_close},
        },
        "scenarios": {
            "up": {
                "label": "Higher — bull bias / toward resistance",
                "probability": round(p_up, 4),
                "confidence_percent": _scenario_confidence(p_up, pu_hmm, news_c_eff, ent),
                "path_probability_hit_resistance_before_support": round(
                    float(race["probability_resistance_hit_before_support"]), 4
                ),
                "interpretation": scen_up_note,
            },
            "neutral": {
                "label": "Sideways — range / no clear regime shift",
                "probability": round(p_mid, 4),
                "confidence_percent": _scenario_confidence(p_mid, pn, news_c_eff, ent),
                "range_quality_between_nearest_sr": round(float(bq), 4),
                "interpretation": "Chop when this branch dominates; check pivot band and RSI extremes.",
            },
            "down": {
                "label": "Lower — bear bias / toward support",
                "probability": round(p_down, 4),
                "confidence_percent": _scenario_confidence(p_down, pb, news_c_eff, ent),
                "path_probability_hit_support_before_resistance": round(
                    float(race["probability_support_hit_before_resistance"]), 4
                ),
                "interpretation": "Collective blend favors weakness; path metric uses distance to nearest S vs R.",
            },
        },
        "touch_race": race,
        "meta": {
            "distribution_entropy_bits": round(ent, 4),
            "blend_note": blend_note,
            "hmm_and_fx_data_only": bool(hmm_and_fx_data_only),
        },
    }
    return out
