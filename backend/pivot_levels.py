"""Classic pivot R1–R3 / S1–S3 (same formulas as services/pivotPoints.ts)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ClassicPivotLevels:
    pivot: float
    r1: float
    r2: float
    r3: float
    s1: float
    s2: float
    s3: float


def classic_pivot_levels(high: float, low: float, close: float) -> ClassicPivotLevels:
    H, L, C = high, low, close
    P = (H + L + C) / 3.0
    return ClassicPivotLevels(
        pivot=P,
        r1=2 * P - L,
        r2=P + (H - L),
        r3=H + 2 * (P - L),
        s1=2 * P - H,
        s2=P - (H - L),
        s3=L - 2 * (H - P),
    )


def nearest_resistance_above(close: float, lv: ClassicPivotLevels) -> float:
    """Smallest R strictly above close; if price already above all R lines, use highest R as extension anchor."""
    above = [float(x) for x in (lv.r1, lv.r2, lv.r3) if x > close]
    if above:
        return min(above)
    return float(max(lv.r1, lv.r2, lv.r3))


def nearest_support_below(close: float, lv: ClassicPivotLevels) -> float:
    """Largest S strictly below close; if price below all S lines, use lowest S as extension anchor."""
    below = [float(x) for x in (lv.s1, lv.s2, lv.s3) if x < close]
    if below:
        return max(below)
    return float(min(lv.s1, lv.s2, lv.s3))
