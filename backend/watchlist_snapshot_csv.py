"""
Write watchlist-{YYYY-MM-DD-HHMMSS}.csv (+ optional top/worst 10) under SMARTINVEST_WATCHLIST_CSV_DIR (or <repo>/watchlist).
Stem matches frontend watchlistCsvFilenameBase(); column order matches utils/watchlistCsvDownload.ts WATCHLIST_SNAPSHOT_CSV_COLUMNS.
"""

from __future__ import annotations

import csv
import io
import os
from pathlib import Path
from typing import Any

# Keep in sync with utils/watchlistCsvDownload.ts WATCHLIST_SNAPSHOT_CSV_COLUMNS
SNAPSHOT_COLUMNS: list[str] = [
    "watchlist_date",
    "symbol",
    "company",
    "sector",
    "industry",
    "location",
    "current_price",
    "total_assets",
    "total_liabilities",
    "total_revenue",
    "net_income",
    "operating_cash_flow",
    "free_cash_flow",
    "iv_dcf",
    "iv_ri",
    "iv_multiples",
    "iv_quality_score",
    "iv_ensemble",
    "iv_upside_pct",
    "torchlight_score",
    "torchlight_rank_factors",
    "torchlight_momentum",
    "torchlight_valuation_edge",
    "torchlight_quality",
    "torchlight_growth",
    "torchlight_sentiment",
    "torchlight_macro_fit",
    "torchlight_execution_feasibility",
    "torchlight_risk_adjusted_alpha",
    "torchlight_capital_efficiency",
    "torchlight_analyst_drift",
    "ctr_total_return",
    "ctr_price_return",
    "ctr_cash_return",
    "ctr_annualized",
    "torchlight_ctr_score",
    "risk_daily_return_mean",
    "risk_volatility_daily",
    "risk_volatility_annual",
    "risk_sharpe",
    "risk_sortino",
    "risk_max_drawdown",
    "risk_var_95_hist",
    "risk_var_99_hist",
    "risk_var_95_param",
    "risk_var_99_param",
    "risk_cvar_95",
    "risk_beta",
    "risk_summary_score",
    "created_at",
]


def default_snapshot_csv_dir() -> Path:
    raw = (os.environ.get("SMARTINVEST_WATCHLIST_CSV_DIR") or "").strip()
    if raw:
        return Path(os.path.expanduser(raw)).resolve()
    # backend/watchlist_snapshot_csv.py -> backend -> repo root -> watchlist/
    return (Path(__file__).resolve().parent.parent / "watchlist").resolve()


def filename_stamp(started_at_iso: str) -> str:
    """2026-04-21T14:30:52.123Z -> 2026-04-21-143052"""
    d = started_at_iso[:10] if len(started_at_iso) >= 10 else "unknown-date"
    t = ""
    if len(started_at_iso) >= 19:
        t = started_at_iso[11:19].replace(":", "")
    return f"{d}-{t}" if t else d


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rank_tuple_for_top(row: dict[str, Any]) -> tuple[int, float]:
    """Higher tuple sorts last in ascending order; we use reverse for top."""
    iv = _to_float(row.get("iv_upside_pct"))
    tl = _to_float(row.get("torchlight_score"))
    if iv is not None:
        return (1, iv)
    if tl is not None:
        return (0, tl)
    return (-1, 0.0)


def top_n_and_worst_n(items: list[dict[str, Any]], n: int = 10) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Top N by iv_upside_pct (fallback torchlight_score); worst N = lowest upside."""
    if not items:
        return [], []

    ranked = [r for r in items if isinstance(r, dict)]
    # Top: highest upside first; rows without metrics sink to bottom
    top_sorted = sorted(ranked, key=_rank_tuple_for_top, reverse=True)
    top = top_sorted[: min(n, len(top_sorted))]

    # Worst: lowest iv_upside_pct first; missing upside sink to end
    def worst_key(row: dict[str, Any]) -> tuple[int, float]:
        iv = _to_float(row.get("iv_upside_pct"))
        tl = _to_float(row.get("torchlight_score"))
        if iv is not None:
            return (1, iv)
        if tl is not None:
            return (0, tl)
        return (-1, 0.0)

    worst_sorted = sorted(ranked, key=worst_key)
    worst = worst_sorted[: min(n, len(worst_sorted))]
    return top, worst


def rows_to_csv_bytes(rows: list[dict[str, Any]], columns: list[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([row.get(k) for k in columns])
    text = "\ufeff" + buf.getvalue()
    return text.encode("utf-8")


def save_snapshot_csv_bundles(
    *,
    started_at_iso: str,
    items: list[dict[str, Any]] | None,
    symbols_only: list[str] | None,
    watchlist_date_ymd: str | None,
    csv_stamp: str | None = None,
) -> dict[str, Any]:
    """
    Writes next to legacy repo CSVs (same naming as utils/watchlistCsvDownload.watchlistCsvFilenameBase):
    - watchlist-{stamp}.csv — full snapshot when items non-empty, or symbols-only fallback
    - watchlist-top10-{stamp}.csv / watchlist-worst10-{stamp}.csv — derived from items
    Prefer csv_stamp from the client (local wall clock); else derive from started_at_iso (UTC slice).
    """
    out_dir = default_snapshot_csv_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = (csv_stamp or "").strip() or filename_stamp(started_at_iso)
    written: list[str] = []

    items = items or []
    symbols_only = [str(s).upper().strip() for s in (symbols_only or []) if str(s).strip()]

    if len(items) > 0:
        full_path = out_dir / f"watchlist-{stamp}.csv"
        full_path.write_bytes(rows_to_csv_bytes(items, SNAPSHOT_COLUMNS))
        written.append(str(full_path))

        top, worst = top_n_and_worst_n(items, 10)
        if top:
            p_top = out_dir / f"watchlist-top10-{stamp}.csv"
            p_top.write_bytes(rows_to_csv_bytes(top, SNAPSHOT_COLUMNS))
            written.append(str(p_top))
        if worst:
            p_worst = out_dir / f"watchlist-worst10-{stamp}.csv"
            p_worst.write_bytes(rows_to_csv_bytes(worst, SNAPSHOT_COLUMNS))
            written.append(str(p_worst))
    elif symbols_only:
        date_cell = (watchlist_date_ymd or started_at_iso[:10])[:10]
        lines = ["watchlist_date,symbol"]
        for sym in symbols_only:
            lines.append(f"{date_cell},{sym}")
        text = "\ufeff" + "\r\n".join(lines) + "\r\n"
        sym_path = out_dir / f"watchlist-{stamp}.csv"
        sym_path.write_bytes(text.encode("utf-8"))
        written.append(str(sym_path))

    return {
        "dir": str(out_dir),
        "stamp": stamp,
        "written": written,
        "count_full": len(items),
        "count_symbols": len(symbols_only),
    }
