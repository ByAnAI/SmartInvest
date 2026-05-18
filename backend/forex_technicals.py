"""RSI, MACD, and proximity to recent swing support/resistance from OHLC CSV."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd


def load_ohlc_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    if "Datetime" in df.columns:
        df["Datetime"] = pd.to_datetime(df["Datetime"], utc=True, errors="coerce")
        df = df.set_index("Datetime").sort_index()
    for c in ("Open", "High", "Low", "Close"):
        if c not in df.columns:
            raise ValueError(f"Missing column {c} in {path}")
    return df[["Open", "High", "Low", "Close"]].dropna()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - (100 / (1 + rs))
    return out.fillna(50.0)


def macd_line(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    line = ema_fast - ema_slow
    sig = line.ewm(span=signal, adjust=False).mean()
    hist = line - sig
    return line, sig, hist


def swing_support_resistance(
    df: pd.DataFrame,
    lookback: int = 20,
) -> tuple[pd.Series, pd.Series]:
    """Rolling min low / max high as proxy for nearby S/R."""
    low = df["Low"]
    high = df["High"]
    support = low.rolling(lookback, min_periods=max(3, lookback // 4)).min()
    resistance = high.rolling(lookback, min_periods=max(3, lookback // 4)).max()
    return support, resistance


def dist_fractions(close: pd.Series, support: pd.Series, resistance: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Dimensionless proximity: how far price sits above support / below resistance (0–1 scale typical)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        d_support = (close - support) / close.replace(0, np.nan)
        d_resist = (resistance - close) / close.replace(0, np.nan)
    return d_support.fillna(0.0).clip(-2, 2), d_resist.fillna(0.0).clip(-2, 2)


def build_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    c = df["Close"]
    line, _sig, _hist = macd_line(c)
    r = rsi(c)
    sup, res = swing_support_resistance(df)
    ds, dr = dist_fractions(c, sup, res)
    log_ret = np.log(c / c.shift(1)).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    out = pd.DataFrame(
        {
            "close": c,
            "log_ret": log_ret,
            "rsi": r,
            "macd": line,
            "dist_to_support": ds,
            "dist_to_resistance": dr,
        },
        index=df.index,
    )
    return out.dropna()
