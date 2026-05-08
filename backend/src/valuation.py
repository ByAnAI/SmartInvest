from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd


@dataclass
class DCFResult:
    base_value: float
    low_value: float
    high_value: float
    assumptions: Dict[str, float]


@dataclass
class ResidualIncomeResult:
    base_value: float
    assumptions: Dict[str, float]


@dataclass
class QualityResult:
    score: float
    metrics: Dict[str, float]


def _latest_value(series: pd.Series) -> Optional[float]:
    if series is None or series.dropna().empty:
        return None
    return float(series.dropna().iloc[-1])


def _safe_series(df: pd.DataFrame, candidates: Iterable[str]) -> pd.Series:
    for name in candidates:
        if name in df.columns:
            return df[name]
    return pd.Series(dtype="float64")


def free_cash_flow_series(cashflow: pd.DataFrame) -> pd.Series:
    op_cf = _safe_series(
        cashflow,
        [
            "Total Cash From Operating Activities",
            "Operating Cash Flow",
        ],
    )
    capex = _safe_series(
        cashflow,
        ["Capital Expenditures", "Capital Expenditure"],
    )
    if op_cf.empty:
        return pd.Series(dtype="float64")
    if capex.empty:
        return op_cf.copy()
    return op_cf - capex


def revenue_series(financials: pd.DataFrame) -> pd.Series:
    return _safe_series(
        financials,
        ["Total Revenue", "TotalRevenue", "Revenue"],
    )


def net_income_series(financials: pd.DataFrame) -> pd.Series:
    return _safe_series(
        financials,
        ["Net Income", "NetIncome", "Net Income Common Stockholders"],
    )


def interest_expense_series(financials: pd.DataFrame) -> pd.Series:
    return _safe_series(
        financials,
        ["Interest Expense", "InterestExpense"],
    )


def book_value_series(balance_sheet: pd.DataFrame) -> pd.Series:
    return _safe_series(
        balance_sheet,
        ["Total Stockholder Equity", "Total Stockholders Equity", "Total Equity Gross Minority Interest"],
    )


def total_debt_series(balance_sheet: pd.DataFrame) -> pd.Series:
    debt = _safe_series(
        balance_sheet,
        ["Long Term Debt", "Long Term Debt Noncurrent", "LongTermDebt"],
    )
    short = _safe_series(
        balance_sheet,
        ["Short Long Term Debt", "Short/Current Long Term Debt", "ShortTermDebt"],
    )
    if debt.empty and short.empty:
        return pd.Series(dtype="float64")
    if debt.empty:
        return short
    if short.empty:
        return debt
    return debt + short


def cash_series(balance_sheet: pd.DataFrame) -> pd.Series:
    return _safe_series(
        balance_sheet,
        ["Cash", "Cash And Cash Equivalents", "Cash And Cash Equivalents Including Short Term Investments"],
    )


def compute_wacc(
    cost_of_equity: float,
    cost_of_debt: float,
    total_debt: float,
    market_cap: float,
    tax_rate: float,
) -> float:
    if market_cap is None or market_cap <= 0:
        return cost_of_equity
    debt = total_debt or 0.0
    equity = market_cap
    total = equity + debt
    if total <= 0:
        return cost_of_equity
    weight_e = equity / total
    weight_d = debt / total
    return weight_e * cost_of_equity + weight_d * cost_of_debt * (1 - tax_rate)


def _cagr(series: pd.Series) -> Optional[float]:
    clean = series.dropna()
    if len(clean) < 2:
        return None
    start = float(clean.iloc[0])
    end = float(clean.iloc[-1])
    if start == 0:
        return None
    years = len(clean) - 1
    return (end / start) ** (1 / years) - 1


def dcf_valuation(
    fcf_series: pd.Series,
    wacc: float,
    terminal_growth: float,
    years: int = 10,
    growth_assumption: Optional[float] = None,
) -> DCFResult:
    clean_fcf = fcf_series.dropna()
    if clean_fcf.empty:
        return DCFResult(0.0, 0.0, 0.0, {"reason": "missing_fcf"})

    base_fcf = float(clean_fcf.iloc[-1])
    hist_cagr = _cagr(clean_fcf)
    g1 = growth_assumption if growth_assumption is not None else (hist_cagr or 0.05)
    g1 = float(np.clip(g1, -0.05, 0.25))

    def present_value(growth: float, discount: float) -> float:
        cashflows = []
        for year in range(1, years + 1):
            if year <= 5:
                g = growth
            else:
                fade = (year - 5) / 5
                g = growth + (terminal_growth - growth) * fade
            cashflows.append(base_fcf * ((1 + g) ** year))
        pv = sum(cf / ((1 + discount) ** idx) for idx, cf in enumerate(cashflows, start=1))
        terminal_cf = cashflows[-1] * (1 + terminal_growth)
        terminal_value = terminal_cf / (discount - terminal_growth) if discount > terminal_growth else 0.0
        pv_terminal = terminal_value / ((1 + discount) ** years)
        return pv + pv_terminal

    base_value = present_value(g1, wacc)
    low_value = present_value(g1 - 0.02, wacc + 0.01)
    high_value = present_value(g1 + 0.02, wacc - 0.01)

    return DCFResult(
        base_value=base_value,
        low_value=min(low_value, high_value, base_value),
        high_value=max(low_value, high_value, base_value),
        assumptions={"growth": g1, "wacc": wacc, "terminal_growth": terminal_growth},
    )


def residual_income_valuation(
    net_income: pd.Series,
    book_value: pd.Series,
    cost_of_equity: float,
    years: int = 10,
) -> ResidualIncomeResult:
    ni = _latest_value(net_income)
    bv = _latest_value(book_value)
    if ni is None or bv is None or bv == 0:
        return ResidualIncomeResult(0.0, {"reason": "missing_net_income_or_book"})

    roe = ni / bv
    roe = float(np.clip(roe, -0.1, 0.4))

    residuals = []
    for year in range(1, years + 1):
        fade = (year - 1) / max(1, years - 1)
        target_roe = roe + (cost_of_equity - roe) * fade
        residual = bv * (target_roe - cost_of_equity)
        residuals.append(residual / ((1 + cost_of_equity) ** year))
    intrinsic = bv + sum(residuals)
    return ResidualIncomeResult(base_value=intrinsic, assumptions={"roe": roe, "cost_of_equity": cost_of_equity})


def quality_score(
    financials: pd.DataFrame,
    cashflow: pd.DataFrame,
    balance_sheet: pd.DataFrame,
) -> QualityResult:
    rev = revenue_series(financials)
    margin = (net_income_series(financials) / rev.replace(0, np.nan)).dropna()
    margin_stability = 1.0 - float(np.clip(margin.std() / (abs(margin.mean()) + 1e-6), 0, 1))

    fcf = free_cash_flow_series(cashflow)
    fcf_margin = (fcf / rev.replace(0, np.nan)).dropna()
    fcf_quality = float(np.clip(fcf_margin.mean(), -0.2, 0.3))

    debt = _latest_value(total_debt_series(balance_sheet)) or 0.0
    cash = _latest_value(cash_series(balance_sheet)) or 0.0
    leverage = debt / max(cash + debt, 1.0)
    leverage_score = 1.0 - float(np.clip(leverage, 0, 1))

    r_and_d = _safe_series(financials, ["Research Development", "ResearchAndDevelopment"])
    r_and_d_ratio = (r_and_d / rev.replace(0, np.nan)).dropna()
    rd_efficiency = float(np.clip(r_and_d_ratio.mean(), 0.0, 0.25))

    roic_proxy = (fcf / (debt + (book_value_series(balance_sheet).replace(0, np.nan)))).dropna()
    roic_score = float(np.clip(roic_proxy.mean(), -0.1, 0.2))

    raw_score = (
        0.25 * margin_stability
        + 0.25 * (fcf_quality + 0.2)
        + 0.2 * leverage_score
        + 0.15 * (rd_efficiency / 0.25 if rd_efficiency else 0)
        + 0.15 * (roic_score + 0.1)
    )
    score = float(np.clip(raw_score, 0.0, 1.0))

    return QualityResult(
        score=score,
        metrics={
            "margin_stability": margin_stability,
            "fcf_margin": float(fcf_margin.mean()) if not fcf_margin.empty else 0.0,
            "leverage_score": leverage_score,
            "rd_intensity": float(r_and_d_ratio.mean()) if not r_and_d_ratio.empty else 0.0,
            "roic_proxy": float(roic_proxy.mean()) if not roic_proxy.empty else 0.0,
        },
    )


def enterprise_value(market_cap: float, balance_sheet: pd.DataFrame) -> Optional[float]:
    if market_cap is None:
        return None
    debt = _latest_value(total_debt_series(balance_sheet)) or 0.0
    cash = _latest_value(cash_series(balance_sheet)) or 0.0
    return market_cap + debt - cash
