"""Persist daily macro LLM reports under backend/data/macro_reports/."""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def macro_reports_dir() -> Path:
    base = Path(os.path.dirname(os.path.abspath(__file__)))
    custom = os.environ.get("MACRO_REPORTS_DIR", "").strip()
    if custom:
        return Path(custom)
    return base / "data" / "macro_reports"


def _report_path(report_date: str) -> Path:
    if not _DATE_RE.match(report_date):
        raise ValueError(f"Invalid report_date {report_date!r}; use YYYY-MM-DD")
    return macro_reports_dir() / f"macro_report_{report_date}.txt"


def load_macro_report(report_date: str) -> dict[str, Any] | None:
    path = _report_path(report_date)
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return None
    return {
        "report_date": report_date,
        "path": str(path),
        "content": text,
        "saved_at_utc": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
    }


def load_latest_macro_report() -> dict[str, Any] | None:
    d = macro_reports_dir()
    if not d.is_dir():
        return None

    latest_date: str | None = None
    for path in d.glob("macro_report_*.txt"):
        report_date = path.stem[len("macro_report_") :]
        if not _DATE_RE.match(report_date):
            continue
        if latest_date is None or report_date > latest_date:
            latest_date = report_date

    if latest_date is None:
        return None
    return load_macro_report(latest_date)


def save_macro_report(report_date: str, content: str) -> dict[str, Any]:
    if not _DATE_RE.match(report_date):
        raise ValueError(f"Invalid report_date {report_date!r}; use YYYY-MM-DD")
    body = (content or "").strip()
    if not body:
        raise ValueError("Report content is empty")

    d = macro_reports_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = _report_path(report_date)
    header = (
        f"# US Macroeconomic Report\n"
        f"# Report date: {report_date}\n"
        f"# Saved at (UTC): {datetime.now(timezone.utc).isoformat()}\n"
        f"# Source: macro_daily.csv snapshot\n\n"
    )
    path.write_text(header + body + "\n", encoding="utf-8")
    return {
        "report_date": report_date,
        "path": str(path),
        "saved": True,
        "saved_at_utc": datetime.now(timezone.utc).isoformat(),
    }
