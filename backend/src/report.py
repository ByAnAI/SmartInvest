from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np
import pandas as pd

from src.valuation import (
    DCFResult,
    ResidualIncomeResult,
    QualityResult,
    enterprise_value,
    revenue_series,
    net_income_series,
)


@dataclass
class RelativeResult:
    base_value: float
    assumptions: Dict[str, float]


@dataclass
class SynthesisResult:
    iv_low: float
    iv_high: float
    iv_base: float
    upside_pct: float
    conviction: float
    action_label: str
    valuation_label: str
    risks: str
    model_weights: Dict[str, float]


def compute_multiples(
    market_cap: Optional[float],
    balance_sheet: pd.DataFrame,
    financials: pd.DataFrame,
) -> Dict[str, float]:
    if market_cap is None or market_cap <= 0:
        return {}
    ev = enterprise_value(market_cap, balance_sheet)
    rev = revenue_series(financials).dropna()
    net_income = net_income_series(financials).dropna()
    ebitda = None
    if "Ebitda" in financials.columns:
        ebitda = financials["Ebitda"].dropna()
    elif "EBITDA" in financials.columns:
        ebitda = financials["EBITDA"].dropna()

    multiples = {}
    if ev and not rev.empty:
        multiples["ev_to_revenue"] = ev / float(rev.iloc[-1])
    if ev and ebitda is not None and not ebitda.empty:
        multiples["ev_to_ebitda"] = ev / float(ebitda.iloc[-1])
    if not net_income.empty:
        multiples["pe"] = market_cap / float(net_income.iloc[-1]) if net_income.iloc[-1] != 0 else np.nan
    return multiples


def relative_valuation(
    peer_multiples: Dict[str, float],
    financials: pd.DataFrame,
    balance_sheet: pd.DataFrame,
) -> RelativeResult:
    rev = revenue_series(financials).dropna()
    net_income = net_income_series(financials).dropna()
    ebitda = None
    if "Ebitda" in financials.columns:
        ebitda = financials["Ebitda"].dropna()
    elif "EBITDA" in financials.columns:
        ebitda = financials["EBITDA"].dropna()

    values = []
    assumptions = {}
    if "ev_to_revenue" in peer_multiples and not rev.empty:
        ev = peer_multiples["ev_to_revenue"] * float(rev.iloc[-1])
        values.append(ev)
        assumptions["ev_to_revenue"] = peer_multiples["ev_to_revenue"]
    if "ev_to_ebitda" in peer_multiples and ebitda is not None and not ebitda.empty:
        ev = peer_multiples["ev_to_ebitda"] * float(ebitda.iloc[-1])
        values.append(ev)
        assumptions["ev_to_ebitda"] = peer_multiples["ev_to_ebitda"]
    if "pe" in peer_multiples and not net_income.empty:
        equity = peer_multiples["pe"] * float(net_income.iloc[-1])
        values.append(equity)
        assumptions["pe"] = peer_multiples["pe"]

    if not values:
        return RelativeResult(0.0, {"reason": "missing_peer_multiples"})

    # Convert EV to equity by removing net debt if EV values are present.
    net_debt = 0.0
    if values:
        debt = balance_sheet.get("Long Term Debt")
        if debt is not None and not debt.dropna().empty:
            net_debt += float(debt.dropna().iloc[-1])
        cash = balance_sheet.get("Cash And Cash Equivalents")
        if cash is not None and not cash.dropna().empty:
            net_debt -= float(cash.dropna().iloc[-1])
    equity_values = [v - net_debt for v in values]

    return RelativeResult(base_value=float(np.nanmean(equity_values)), assumptions=assumptions)


def dynamic_weights(
    dcf: DCFResult,
    residual: ResidualIncomeResult,
    relative: RelativeResult,
    quality: QualityResult,
    fcf_positive: bool,
) -> Dict[str, float]:
    if fcf_positive:
        w_dcf, w_res, w_rel = 0.5, 0.25, 0.25
    else:
        w_dcf, w_res, w_rel = 0.25, 0.45, 0.30
    if quality.score < 0.4:
        w_rel += 0.1
        w_dcf -= 0.05
        w_res -= 0.05
    total = w_dcf + w_res + w_rel
    return {"dcf": w_dcf / total, "residual": w_res / total, "relative": w_rel / total}


def conviction_score(values: Dict[str, float], quality: QualityResult) -> float:
    val_list = [v for v in values.values() if v > 0]
    if len(val_list) < 2:
        agreement = 0.3
    else:
        mean = np.mean(val_list)
        spread = np.std(val_list) / mean if mean else 1.0
        agreement = float(np.clip(1.0 - spread, 0.0, 1.0))
    return float(np.clip(0.6 * agreement + 0.4 * quality.score, 0.0, 1.0))


def action_label(upside_pct: float) -> str:
    if upside_pct >= 40:
        return "Good buy"
    if upside_pct >= 20:
        return "Buy"
    if upside_pct >= -10:
        return "stay as is"
    if upside_pct >= -30:
        return "sell"
    return "Good Sell"


def valuation_label(price: float, iv_low: float, iv_high: float) -> str:
    if price < iv_low:
        return "Undervalued"
    if price > iv_high:
        return "Overvalued"
    return "Fairly Valued"


def synthesize(
    dcf: DCFResult,
    residual: ResidualIncomeResult,
    relative: RelativeResult,
    quality: QualityResult,
    price: float,
    fcf_positive: bool,
    risks: str,
) -> SynthesisResult:
    weights = dynamic_weights(dcf, residual, relative, quality, fcf_positive)
    values = {
        "dcf": dcf.base_value,
        "residual": residual.base_value,
        "relative": relative.base_value,
    }
    iv_base = sum(values[key] * weights[key] for key in weights)
    iv_low = min(dcf.low_value, iv_base, dcf.high_value)
    iv_high = max(dcf.low_value, iv_base, dcf.high_value)
    upside = ((iv_base - price) / price) * 100 if price else 0.0
    conviction = conviction_score(values, quality)

    return SynthesisResult(
        iv_low=iv_low,
        iv_high=iv_high,
        iv_base=iv_base,
        upside_pct=upside,
        conviction=conviction,
        action_label=action_label(upside),
        valuation_label=valuation_label(price, iv_low, iv_high),
        risks=risks,
        model_weights=weights,
    )
