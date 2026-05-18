"""Load US macro indicator snapshots from backend/data/macro_daily.csv."""
from __future__ import annotations

import os
from typing import Any

import pandas as pd


def macro_daily_csv_path() -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    return os.environ.get("MACRO_DAILY_CSV", os.path.join(base, "data", "macro_daily.csv"))


def load_macro_daily() -> dict[str, Any]:
    """Return latest macro rows plus file metadata."""
    path = macro_daily_csv_path()
    if not os.path.exists(path):
        return {
            "path": path,
            "collection_date": None,
            "collection_utc": None,
            "indicators": [],
        }

    df = pd.read_csv(path)
    if df.empty:
        return {
            "path": path,
            "collection_date": None,
            "collection_utc": None,
            "indicators": [],
        }

    collection_date = None
    collection_utc = None
    if "collection_date" in df.columns and len(df):
        collection_date = str(df["collection_date"].iloc[0]).strip() or None
    if "collection_utc" in df.columns and len(df):
        collection_utc = str(df["collection_utc"].iloc[0]).strip() or None

    indicators: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        val = row.get("value")
        if pd.isna(val):
            num_val = None
        else:
            try:
                num_val = float(val)
            except (TypeError, ValueError):
                num_val = None
        indicators.append(
            {
                "indicator": str(row.get("indicator", "")).strip(),
                "value": num_val,
                "date": _format_date_cell(row.get("date")),
                "collection_date": _format_date_cell(row.get("collection_date")),
                "collection_utc": str(row.get("collection_utc", "")).strip() or None,
            }
        )

    return {
        "path": path,
        "collection_date": collection_date,
        "collection_utc": collection_utc,
        "indicators": indicators,
    }


def _format_date_cell(val: Any) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    if not s or s.lower() == "nan":
        return None
    if " " in s:
        s = s.split(" ", 1)[0]
    return s
