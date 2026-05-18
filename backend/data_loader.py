"""Load company list from CSV and fetch current data from Yahoo Finance."""
from __future__ import annotations

import math
import os
from typing import Any

import pandas as pd
import yfinance as yf

_BENCHMARK_RET_CACHE: dict[str, pd.Series] = {}


def _clean_for_json(val: Any) -> Any:
    """Replace NaN/Inf and pandas NA so JSON serialization works."""
    try:
        if pd.isna(val):
            return None
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
            return None
    except (TypeError, ValueError):
        pass
    return val


def _default_csv_path() -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    return os.environ.get("CSV_PATH", os.path.join(base, "data", "company_fundamentals.csv"))


def _full_sp500_csv_path() -> str:
    """Legacy: components/S&P500_instrument.csv (used when load_tickers falls back from fundamentals)."""
    base = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(base, "..", "components", "S&P500_instrument.csv"))


def _default_sp500_watchlist_csv_path() -> str:
    """Primary file for `/api/lists/sp500`: backend/data/sp500.csv (committed in repo)."""
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(backend_dir, "data", "sp500.csv"))


def sp500_instrument_csv_path() -> str:
    """CSV for watchlists (`GET /api/lists/sp500`). Defaults to backend/data/sp500.csv. Override with SP500_INSTRUMENT_CSV."""
    override = (os.environ.get("SP500_INSTRUMENT_CSV") or "").strip()
    if override:
        if os.path.isabs(override):
            return override
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.abspath(os.path.join(backend_dir, override))
    return _default_sp500_watchlist_csv_path()


def load_tickers(csv_path: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    """Load tickers and metadata from CSV. Returns list of {ticker, company, sector, location, industry, website}."""
    path = csv_path or _default_csv_path()
    if not os.path.exists(path):
        return []
    df = pd.read_csv(path)
    # If local fundamentals CSV is a short subset, fallback to full SP500 universe file.
    if csv_path is None and len(df) < 400:
        full_path = _full_sp500_csv_path()
        if os.path.exists(full_path):
            try:
                df_full = pd.read_csv(full_path)
                if len(df_full) > len(df):
                    df = df_full
            except Exception:
                pass
    if "symbol" in df.columns:
        df = df.rename(columns={"symbol": "Ticker"})
    if "name" in df.columns:
        df = df.rename(columns={"name": "Company"})
    if "Company" not in df.columns and "Ticker" in df.columns:
        df["Company"] = df["Ticker"]
    if "Ticker" not in df.columns:
        return []
    if "Sector" not in df.columns:
        df["Sector"] = ""
    if "Industry" not in df.columns:
        df["Industry"] = ""
    if "Location" not in df.columns:
        df["Location"] = ""
    if "Website" not in df.columns:
        df["Website"] = ""
    rows = df[["Ticker", "Company", "Sector", "Location", "Industry", "Website"]].fillna("").to_dict("records")
    out = [
        {
            "ticker": str(r["Ticker"]).strip().upper(),
            "company": str(r.get("Company", r["Ticker"])).strip(),
            "sector": str(r.get("Sector", "")).strip(),
            "location": str(r.get("Location", "")).strip(),
            "industry": str(r.get("Industry", "")).strip(),
            "website": str(r.get("Website", "")).strip(),
        }
        for r in rows
        if r.get("Ticker")
    ]
    if limit is not None:
        out = out[:limit]
    return out


def _first_non_none(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None


def _safe_float(v: Any) -> float | None:
    try:
        if v is None or pd.isna(v):
            return None
        out = float(v)
        if math.isnan(out) or math.isinf(out):
            return None
        return out
    except Exception:
        return None


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _scale_to_0_100(value: float | None, lo: float, hi: float, neutral: float = 50.0) -> float:
    if value is None:
        return neutral
    if hi <= lo:
        return neutral
    z = (value - lo) / (hi - lo)
    return _clamp(z * 100.0, 0.0, 100.0)


def _benchmark_returns(period: str = "1y") -> pd.Series | None:
    cached = _BENCHMARK_RET_CACHE.get(period)
    if cached is not None:
        return cached
    try:
        hist = yf.Ticker("^GSPC").history(period=period)
        if hist is None or hist.empty or "Close" not in hist.columns:
            return None
        rets = pd.to_numeric(hist["Close"], errors="coerce").pct_change().dropna()
        if rets.empty:
            return None
        _BENCHMARK_RET_CACHE[period] = rets
        return rets
    except Exception:
        return None


def _weighted_mean(values: list[tuple[float | None, float]]) -> float | None:
    total_w = 0.0
    total_v = 0.0
    for v, w in values:
        if v is None:
            continue
        total_w += w
        total_v += v * w
    if total_w <= 0:
        return None
    return total_v / total_w


def _sector_ps_anchor(sector: str | None) -> float:
    s = (sector or "").strip().lower()
    anchors = {
        "technology": 6.0,
        "communication services": 4.5,
        "consumer cyclical": 2.2,
        "consumer defensive": 1.8,
        "healthcare": 4.0,
        "financial services": 2.0,
        "industrials": 2.0,
        "energy": 1.4,
        "utilities": 2.3,
        "real estate": 3.0,
        "basic materials": 1.6,
    }
    return anchors.get(s, 2.5)


def _sector_ev_ebitda_anchor(sector: str | None) -> float:
    s = (sector or "").strip().lower()
    anchors = {
        "technology": 16.0,
        "communication services": 12.0,
        "consumer cyclical": 11.0,
        "consumer defensive": 10.0,
        "healthcare": 13.0,
        "financial services": 9.0,
        "industrials": 10.0,
        "energy": 7.0,
        "utilities": 11.0,
        "real estate": 12.0,
        "basic materials": 8.5,
    }
    return anchors.get(s, 10.5)


def _get_latest_from_df(df: Any, *row_names: str) -> Any:
    """Get first non-empty value across period columns for matching row names."""
    if df is None or (hasattr(df, "empty") and df.empty) or not hasattr(df, "index"):
        return None
    idx = getattr(df, "index", None)
    cols = getattr(df, "columns", None)
    if idx is None or cols is None or len(cols) == 0:
        return None
    for name in row_names:
        try:
            if name in idx:
                row = df.loc[name]
                try:
                    iterator = row.items()
                except AttributeError:
                    iterator = enumerate(row)
                for _, val in iterator:
                    if not pd.isna(val):
                        return _clean_for_json(val)
        except (KeyError, TypeError):
            continue
    return None


def fetch_financial_summary(ticker: str, period: str = "1y") -> dict[str, Any] | None:
    """Fetch current price, summary, and key statement metrics (balance_sheet, cash_flow, earnings/income) from yfinance."""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        hist = stock.history(period=period)
        current_price = None
        if not hist.empty and "Close" in hist.columns:
            current_price = float(hist["Close"].iloc[-1])
        if current_price is None and isinstance(info.get("currentPrice"), (int, float)):
            current_price = info["currentPrice"]

        out: dict[str, Any] = {
            "ticker": ticker.upper(),
            "current_price": _clean_for_json(current_price),
            "currency": info.get("currency"),
            "short_name": info.get("shortName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "total_assets": None,
            "total_liabilities": None,
            "total_revenue": None,
            "net_income": None,
            "operating_cash_flow": None,
            "free_cash_flow": None,
            "iv_dcf": None,
            "iv_ri": None,
            "iv_multiples": None,
            "iv_quality_score": None,
            "iv_ensemble": None,
            "iv_upside_pct": None,
            "torchlight_score": None,
            "torchlight_rank_factors": None,
            "torchlight_momentum": None,
            "torchlight_valuation_edge": None,
            "torchlight_quality": None,
            "torchlight_growth": None,
            "torchlight_sentiment": None,
            "torchlight_macro_fit": None,
            "torchlight_execution_feasibility": None,
            "torchlight_risk_adjusted_alpha": None,
            "torchlight_capital_efficiency": None,
            "torchlight_analyst_drift": None,
            "ctr_total_return": None,
            "ctr_price_return": None,
            "ctr_cash_return": None,
            "ctr_annualized": None,
            "torchlight_ctr_score": None,
            "risk_daily_return_mean": None,
            "risk_volatility_daily": None,
            "risk_volatility_annual": None,
            "risk_sharpe": None,
            "risk_sortino": None,
            "risk_max_drawdown": None,
            "risk_var_95_hist": None,
            "risk_var_99_hist": None,
            "risk_var_95_param": None,
            "risk_var_99_param": None,
            "risk_cvar_95": None,
            "risk_beta": None,
            "risk_summary_score": None,
        }

        bs = getattr(stock, "balance_sheet", None)
        if bs is not None and hasattr(bs, "index"):
            out["total_assets"] = _get_latest_from_df(bs, "Total Assets", "TotalAssets")
            out["total_liabilities"] = _get_latest_from_df(
                bs,
                "Total Liabilities Net Minority Interest",
                "Total Liabilities",
                "TotalLiabilitiesNet",
                "Total Liabilities And Stockholders Equity",
            )

        inc = _first_non_none(getattr(stock, "income_stmt", None), getattr(stock, "income_statement", None))
        if inc is not None and hasattr(inc, "index"):
            out["total_revenue"] = _get_latest_from_df(inc, "Total Revenue", "Revenue", "Gross Revenue")
            out["net_income"] = _get_latest_from_df(inc, "Net Income", "Net Income Common Stockholders", "Net Income Continuous Operations")

        cf = _first_non_none(getattr(stock, "cashflow", None), getattr(stock, "cash_flow", None))
        if cf is not None and hasattr(cf, "index"):
            out["operating_cash_flow"] = _get_latest_from_df(cf, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities")
            out["free_cash_flow"] = _get_latest_from_df(cf, "Free Cash Flow", "Free Cash Flow")

        # ---- Intrinsic Value (IV) ensemble ----
        shares_outstanding = _safe_float(info.get("sharesOutstanding"))
        has_shares = shares_outstanding is not None and shares_outstanding > 0

        total_assets = _safe_float(out.get("total_assets"))
        total_liabilities = _safe_float(out.get("total_liabilities"))
        total_revenue = _safe_float(out.get("total_revenue"))
        net_income = _safe_float(out.get("net_income"))
        free_cash_flow = _safe_float(out.get("free_cash_flow"))
        operating_cash_flow = _safe_float(out.get("operating_cash_flow"))
        ebitda = _safe_float(info.get("ebitda"))
        total_debt = _safe_float(info.get("totalDebt")) or 0.0
        total_cash = _safe_float(info.get("totalCash")) or 0.0
        beta = _safe_float(info.get("beta")) or 1.0
        revenue_growth = _safe_float(info.get("revenueGrowth"))
        earnings_growth = _safe_float(info.get("earningsGrowth"))
        operating_margin = _safe_float(info.get("operatingMargins"))
        roe = _safe_float(info.get("returnOnEquity"))
        market_cap = _safe_float(info.get("marketCap"))
        avg_vol = _safe_float(info.get("averageVolume")) or _safe_float(info.get("averageDailyVolume10Day"))
        recommendation_mean = _safe_float(info.get("recommendationMean"))
        target_mean_price = _safe_float(info.get("targetMeanPrice"))

        # WACC / cost of equity proxy (macro regime-aware via beta + sector defensive tilt)
        wacc = 0.09 + max(-0.02, min(0.04, (beta - 1.0) * 0.02))
        sector = str(info.get("sector") or "")
        if sector.lower() in {"utilities", "consumer defensive"}:
            wacc -= 0.005
        wacc = max(0.07, min(0.14, wacc))
        cost_equity = max(0.08, min(0.16, 0.095 + max(-0.03, min(0.05, (beta - 1.0) * 0.03))))

        # DCF
        fcf0 = free_cash_flow if free_cash_flow is not None else (operating_cash_flow * 0.7 if operating_cash_flow is not None else None)
        iv_dcf = None
        if has_shares and fcf0 is not None and fcf0 > 0:
            g_start = revenue_growth if revenue_growth is not None else (earnings_growth if earnings_growth is not None else 0.06)
            g_start = max(0.00, min(0.15, g_start))
            g_terminal = 0.025
            years = 7
            pv = 0.0
            fcf_t = fcf0
            for t in range(1, years + 1):
                fade = (t - 1) / max(1, years - 1)
                g_t = g_start * (1.0 - fade) + g_terminal * fade
                fcf_t = fcf_t * (1.0 + g_t)
                pv += fcf_t / ((1.0 + wacc) ** t)
            if wacc > g_terminal:
                terminal = (fcf_t * (1.0 + g_terminal)) / (wacc - g_terminal)
                pv += terminal / ((1.0 + wacc) ** years)
            iv_dcf = pv / shares_outstanding

        # Residual Income
        iv_ri = None
        book_value = None
        if total_assets is not None and total_liabilities is not None:
            book_value = total_assets - total_liabilities
        if has_shares and book_value is not None and book_value > 0 and net_income is not None:
            years = 5
            retention = 0.5
            growth_ni = earnings_growth if earnings_growth is not None else 0.05
            growth_ni = max(-0.05, min(0.15, growth_ni))
            pv_ri = 0.0
            bv_prev = book_value
            ni_t = net_income
            for t in range(1, years + 1):
                ni_t = ni_t * (1.0 + growth_ni)
                ri_t = ni_t - cost_equity * bv_prev
                pv_ri += ri_t / ((1.0 + cost_equity) ** t)
                bv_prev = bv_prev + ni_t * retention
            iv_ri = (book_value + pv_ri) / shares_outstanding

        # Multiples
        iv_multiples = None
        ev_ebitda_target = _sector_ev_ebitda_anchor(sector)
        ps_target = _sector_ps_anchor(sector)
        if has_shares and ebitda is not None and ebitda > 0:
            implied_ev = ev_ebitda_target * ebitda
            implied_equity = implied_ev - total_debt + total_cash
            if implied_equity > 0:
                iv_multiples = implied_equity / shares_outstanding
        if has_shares and iv_multiples is None and total_revenue is not None and total_revenue > 0:
            rev_per_share = total_revenue / shares_outstanding
            iv_multiples = rev_per_share * ps_target

        # Quality score/adjustment
        roic_proxy = roe if roe is not None else (operating_margin if operating_margin is not None else 0.1)
        spread = roic_proxy - wacc
        spread_score = max(0.0, min(1.0, 0.5 + (spread / 0.2)))
        fcf_conv = None
        if free_cash_flow is not None and net_income is not None and abs(net_income) > 1:
            fcf_conv = free_cash_flow / net_income
        fcf_score = 0.5 if fcf_conv is None else max(0.0, min(1.0, fcf_conv))
        reinvest_consistency = 0.6
        quality_score = 0.5 * spread_score + 0.3 * fcf_score + 0.2 * reinvest_consistency
        quality_factor = 0.85 + 0.3 * quality_score  # 0.85 -> 1.15

        base_iv = _weighted_mean([(iv_dcf, 0.5), (iv_ri, 0.3), (iv_multiples, 0.2)])
        iv_ensemble = base_iv * quality_factor if base_iv is not None else None
        price_now = _safe_float(current_price)
        upside_pct = ((iv_ensemble - price_now) / price_now * 100.0) if (iv_ensemble is not None and price_now and price_now > 0) else None

        out["iv_dcf"] = _clean_for_json(iv_dcf)
        out["iv_ri"] = _clean_for_json(iv_ri)
        out["iv_multiples"] = _clean_for_json(iv_multiples)
        out["iv_quality_score"] = _clean_for_json(quality_score)
        out["iv_ensemble"] = _clean_for_json(iv_ensemble)
        out["iv_upside_pct"] = _clean_for_json(upside_pct)

        # ---- Compound Total Return (CTR) tracking ----
        # CTR_t = Π_i (1 + R_price_i + R_cash_i - C_fee_i) - 1
        # Here we approximate C_fee_i = 0 at security level (portfolio costs tracked separately).
        ctr_total_return = None
        ctr_price_return = None
        ctr_cash_return = None
        ctr_annualized = None
        trading_days = 0
        if hist is not None and not hist.empty and "Close" in hist.columns:
            try:
                df_hist = hist.copy()
                close = pd.to_numeric(df_hist["Close"], errors="coerce")
                prev_close = close.shift(1)
                price_ret = close.pct_change().fillna(0.0)
                cash_ret = pd.Series(0.0, index=df_hist.index)
                if "Dividends" in df_hist.columns:
                    dividends = pd.to_numeric(df_hist["Dividends"], errors="coerce").fillna(0.0)
                    denom = prev_close.where(prev_close > 0)
                    cash_ret = (dividends / denom).fillna(0.0)
                gross = (1.0 + price_ret + cash_ret).replace([math.inf, -math.inf], 1.0).fillna(1.0)
                gross = gross.clip(lower=0.01, upper=10.0)

                ctr_total_return = float(gross.prod() - 1.0)
                first_close = _safe_float(close.iloc[0])
                last_close = _safe_float(close.iloc[-1])
                if first_close is not None and first_close > 0 and last_close is not None:
                    ctr_price_return = (last_close / first_close) - 1.0
                if ctr_price_return is not None:
                    ctr_cash_return = ctr_total_return - ctr_price_return

                trading_days = int(max(0, len(gross)))
                if trading_days > 0 and ctr_total_return is not None:
                    years = max(1e-6, trading_days / 252.0)
                    if (1.0 + ctr_total_return) > 0:
                        ctr_annualized = (1.0 + ctr_total_return) ** (1.0 / years) - 1.0
            except Exception:
                ctr_total_return = None
                ctr_price_return = None
                ctr_cash_return = None
                ctr_annualized = None
                trading_days = 0

        out["ctr_total_return"] = _clean_for_json(ctr_total_return)
        out["ctr_price_return"] = _clean_for_json(ctr_price_return)
        out["ctr_cash_return"] = _clean_for_json(ctr_cash_return)
        out["ctr_annualized"] = _clean_for_json(ctr_annualized)

        # ---- Risk metrics from daily returns ----
        risk_free_annual = 0.04
        rf_daily = risk_free_annual / 252.0
        daily_ret_mean = None
        vol_daily = None
        vol_annual = None
        sharpe = None
        sortino = None
        max_drawdown = None
        var95_hist = None
        var99_hist = None
        var95_param = None
        var99_param = None
        cvar95 = None
        beta_mkt = None
        rets = None
        if hist is not None and not hist.empty and "Close" in hist.columns:
            try:
                close = pd.to_numeric(hist["Close"], errors="coerce")
                rets = close.pct_change().dropna()
                if not rets.empty:
                    daily_ret_mean = _safe_float(rets.mean())
                    vol_daily = _safe_float(rets.std(ddof=1))
                    vol_annual = None if vol_daily is None else vol_daily * (252.0 ** 0.5)
                    ann_ret = None if daily_ret_mean is None else daily_ret_mean * 252.0
                    if vol_annual is not None and vol_annual > 1e-9 and ann_ret is not None:
                        sharpe = (ann_ret - risk_free_annual) / vol_annual

                    downside = (rets - rf_daily).where((rets - rf_daily) < 0, 0.0)
                    downside_var = _safe_float((downside.pow(2)).mean())
                    if downside_var is not None and downside_var > 0 and ann_ret is not None:
                        downside_dev_annual = (downside_var ** 0.5) * (252.0 ** 0.5)
                        if downside_dev_annual > 1e-9:
                            sortino = (ann_ret - risk_free_annual) / downside_dev_annual

                    cum = (1.0 + rets).cumprod()
                    running_max = cum.cummax()
                    dd = (cum - running_max) / running_max
                    max_drawdown = _safe_float(dd.min())

                    var95_hist = _safe_float(rets.quantile(0.05))
                    var99_hist = _safe_float(rets.quantile(0.01))
                    if daily_ret_mean is not None and vol_daily is not None:
                        var95_param = daily_ret_mean - 1.645 * vol_daily
                        var99_param = daily_ret_mean - 2.326 * vol_daily
                    if var95_hist is not None:
                        tail = rets[rets <= var95_hist]
                        if len(tail) > 0:
                            cvar95 = _safe_float(tail.mean())

                    mkt = _benchmark_returns(period=period)
                    if mkt is not None and not mkt.empty:
                        aligned = pd.concat([rets.rename("s"), mkt.rename("m")], axis=1).dropna()
                        if len(aligned) > 5:
                            cov = _safe_float(aligned["s"].cov(aligned["m"]))
                            var_m = _safe_float(aligned["m"].var())
                            if cov is not None and var_m is not None and var_m > 1e-12:
                                beta_mkt = cov / var_m
            except Exception:
                pass

        out["risk_daily_return_mean"] = _clean_for_json(daily_ret_mean)
        out["risk_volatility_daily"] = _clean_for_json(vol_daily)
        out["risk_volatility_annual"] = _clean_for_json(vol_annual)
        out["risk_sharpe"] = _clean_for_json(sharpe)
        out["risk_sortino"] = _clean_for_json(sortino)
        out["risk_max_drawdown"] = _clean_for_json(max_drawdown)
        out["risk_var_95_hist"] = _clean_for_json(var95_hist)
        out["risk_var_99_hist"] = _clean_for_json(var99_hist)
        out["risk_var_95_param"] = _clean_for_json(var95_param)
        out["risk_var_99_param"] = _clean_for_json(var99_param)
        out["risk_cvar_95"] = _clean_for_json(cvar95)
        out["risk_beta"] = _clean_for_json(beta_mkt)

        # Compact 0-100 risk summary score (higher = better risk profile)
        s_vol = 100.0 - _scale_to_0_100(vol_annual, 0.10, 0.80)
        s_drawdown = 100.0 - _scale_to_0_100(abs(max_drawdown) if max_drawdown is not None else None, 0.05, 0.60)
        s_var = 100.0 - _scale_to_0_100(abs(var95_hist) if var95_hist is not None else None, 0.005, 0.08)
        s_cvar = 100.0 - _scale_to_0_100(abs(cvar95) if cvar95 is not None else None, 0.007, 0.12)
        s_sharpe = _scale_to_0_100(sharpe, -1.0, 3.0)
        s_sortino = _scale_to_0_100(sortino, -1.0, 4.0)
        s_beta = 100.0 - _scale_to_0_100(abs((beta_mkt or 1.0) - 1.0), 0.0, 1.5)
        risk_summary_score = _weighted_mean([
            (s_vol, 1.0),
            (s_drawdown, 1.0),
            (s_var, 1.0),
            (s_cvar, 1.0),
            (s_sharpe, 1.0),
            (s_sortino, 1.0),
            (s_beta, 1.0),
        ])
        out["risk_summary_score"] = _clean_for_json(risk_summary_score)

        # ---- Torchlight composite ranking (W1..W8 equal) ----
        # W1 Momentum (CTR-based)
        momentum_ret = ctr_total_return
        s_momentum = _scale_to_0_100(momentum_ret, -0.5, 0.5)

        # W2 ValuationEdge (based on IV upside)
        s_valuation = _scale_to_0_100(upside_pct, -50.0, 100.0)

        # W3 Quality
        s_quality = _clamp((quality_score if quality_score is not None else 0.5) * 100.0, 0.0, 100.0)

        # W4 Growth
        growth_proxy = _weighted_mean([(revenue_growth, 0.5), (earnings_growth, 0.5)])
        s_growth = _scale_to_0_100(growth_proxy, -0.1, 0.3)

        # W5 Sentiment (lower recommendationMean is better: 1 strong buy .. 5 sell)
        s_sentiment = 50.0 if recommendation_mean is None else _scale_to_0_100(5.0 - recommendation_mean, 0.0, 4.0)

        # W6 MacroFit (proxy from beta stability around 1.0 and reasonable WACC)
        beta_fit = 100.0 - min(100.0, abs(beta - 1.0) * 50.0)
        wacc_fit = 100.0 - min(100.0, abs(wacc - 0.1) * 500.0)
        s_macro = _weighted_mean([(beta_fit, 0.6), (wacc_fit, 0.4)])

        # W7 ExecutionFeasibility (liquidity / size)
        cap_score = 50.0 if market_cap is None or market_cap <= 0 else _scale_to_0_100(math.log10(market_cap), 8.0, 13.0)
        vol_score = 50.0 if avg_vol is None or avg_vol <= 0 else _scale_to_0_100(math.log10(avg_vol), 4.0, 8.0)
        s_execution = _weighted_mean([(cap_score, 0.6), (vol_score, 0.4)])

        # W8 RiskAdjustedAlpha (Sharpe-like proxy from daily returns)
        sharpe_proxy = None
        if hist is not None and not hist.empty and "Close" in hist.columns and len(hist) > 30:
            try:
                rets = hist["Close"].pct_change().dropna()
                mu = _safe_float(rets.mean())
                sd = _safe_float(rets.std())
                if mu is not None and sd is not None and sd > 1e-9:
                    sharpe_proxy = (mu * 252.0) / (sd * (252.0 ** 0.5))
            except Exception:
                sharpe_proxy = None
        s_risk_alpha = _scale_to_0_100(sharpe_proxy, -1.0, 2.0)
        s_ctr = _scale_to_0_100(ctr_annualized if ctr_annualized is not None else ctr_total_return, -0.2, 0.4)

        # Additional tracking factors (not in equal-weight W1..W8 blend)
        s_cap_eff = s_quality
        analyst_drift = None
        if target_mean_price is not None and price_now is not None and price_now > 0:
            analyst_drift = (target_mean_price - price_now) / price_now * 100.0
        s_analyst_drift = _scale_to_0_100(analyst_drift, -30.0, 40.0)

        torchlight_score = _weighted_mean([
            (s_momentum, 1.0),
            (s_valuation, 1.0),
            (s_quality, 1.0),
            (s_growth, 1.0),
            (s_sentiment, 1.0),
            (s_macro, 1.0),
            (s_execution, 1.0),
            (s_risk_alpha, 1.0),
        ])

        out["torchlight_score"] = _clean_for_json(torchlight_score)
        out["torchlight_rank_factors"] = "W1..W8 equal"
        out["torchlight_momentum"] = _clean_for_json(s_momentum)
        out["torchlight_valuation_edge"] = _clean_for_json(s_valuation)
        out["torchlight_quality"] = _clean_for_json(s_quality)
        out["torchlight_growth"] = _clean_for_json(s_growth)
        out["torchlight_sentiment"] = _clean_for_json(s_sentiment)
        out["torchlight_macro_fit"] = _clean_for_json(s_macro)
        out["torchlight_execution_feasibility"] = _clean_for_json(s_execution)
        out["torchlight_risk_adjusted_alpha"] = _clean_for_json(s_risk_alpha)
        out["torchlight_capital_efficiency"] = _clean_for_json(s_cap_eff)
        out["torchlight_analyst_drift"] = _clean_for_json(s_analyst_drift)
        out["torchlight_ctr_score"] = _clean_for_json(s_ctr)

        return out
    except Exception:
        return None


def _df_to_json_safe(df: Any) -> dict[str, Any] | None:
    """Convert DataFrame to JSON-serializable: { index: row labels, columns: period dates, data: 2d array }."""
    if df is None or (hasattr(df, "empty") and df.empty):
        return None
    try:
        d = df.to_dict("split")
        raw_data = d.get("data", [])
        data = [[_clean_for_json(v) for v in row] for row in raw_data]
        return {
            "index": list(d.get("index", [])),
            "columns": list(d.get("columns", [])),
            "data": data,
        }
    except Exception:
        return None


def fetch_financial_statements(ticker: str) -> dict[str, Any] | None:
    """Fetch balance_sheet, income_statement, cash_flow for one ticker. Returns JSON-serializable dicts."""
    try:
        stock = yf.Ticker(ticker)
        out: dict[str, Any] = {
            "ticker": ticker.upper(),
            "balance_sheet": None,  # { index, columns, data }
            "income_statement": None,
            "cash_flow": None,
        }
        # Balance sheet
        bs = getattr(stock, "balance_sheet", None)
        if bs is not None and hasattr(bs, "to_dict"):
            out["balance_sheet"] = _df_to_json_safe(bs)
        # Income statement (income_stmt in yfinance)
        inc = _first_non_none(getattr(stock, "income_stmt", None), getattr(stock, "income_statement", None))
        if inc is not None and hasattr(inc, "to_dict"):
            out["income_statement"] = _df_to_json_safe(inc)
        # Cash flow
        cf = _first_non_none(getattr(stock, "cashflow", None), getattr(stock, "cash_flow", None))
        if cf is not None and hasattr(cf, "to_dict"):
            out["cash_flow"] = _df_to_json_safe(cf)
        return out
    except Exception:
        return None


def fetch_financials_batch(tickers: list[str], period: str = "1y") -> list[dict[str, Any]]:
    """Fetch summary for multiple tickers. Returns list of summaries (skips failures).

    Set env WATCHLIST_API_GC_TICKER=1 to run gc.collect(0) after each ticker (slower; may trim peak RSS).
    """
    import gc

    gc_each = os.environ.get("WATCHLIST_API_GC_TICKER", "").strip().lower() in ("1", "true", "yes")
    out = []
    for t in tickers[:5000]:
        s = fetch_financial_summary(t, period=period)
        if s:
            out.append(s)
        if gc_each:
            gc.collect(0)
    return out


def fetch_returns_series(ticker: str, period: str = "1y") -> dict[str, Any] | None:
    """Fetch daily returns series for covariance/correlation analysis."""
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period=period)
        if hist is None or hist.empty or "Close" not in hist.columns:
            return {"ticker": ticker.upper(), "series": []}
        close = pd.to_numeric(hist["Close"], errors="coerce")
        rets = close.pct_change().dropna()
        if rets.empty:
            return {"ticker": ticker.upper(), "series": []}
        series = [{"date": str(idx.date()), "ret": _clean_for_json(val)} for idx, val in rets.items()]
        return {"ticker": ticker.upper(), "series": series}
    except Exception:
        return None


def fetch_returns_batch(tickers: list[str], period: str = "1y") -> list[dict[str, Any]]:
    """Fetch daily returns series for multiple tickers (max 600)."""
    out = []
    for t in tickers[:5000]:
        s = fetch_returns_series(t, period=period)
        if s is not None:
            out.append(s)
    return out
