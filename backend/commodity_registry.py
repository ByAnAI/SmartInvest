"""Commodity ids aligned with ``services/tradingQuotes`` METAL_QUOTE_ROWS."""

from __future__ import annotations

from pathlib import Path

COMMODITY_IDS: tuple[str, ...] = ("XAU", "XAG", "OIL", "XCU", "NI", "XPT", "ALI")

COMMODITY_LABELS: dict[str, str] = {
    "XAU": "Gold",
    "XAG": "Silver",
    "OIL": "Oil",
    "XCU": "Copper",
    "NI": "Nickel (ETF)",
    "XPT": "Platinum",
    "ALI": "Aluminum",
}


def normalize_commodity_id(raw: str) -> str:
    cid = raw.strip().upper()
    if cid not in COMMODITY_IDS:
        raise ValueError(f"Unknown commodity {raw!r}. Use one of: {', '.join(COMMODITY_IDS)}")
    return cid


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def resolve_commodity_ohlc_csv(commodity_id: str) -> Path | None:
    cid = normalize_commodity_id(commodity_id)
    name = "daily_ohlcv.csv"
    root = _repo_root()
    for base in (root / "commodity_data", root / "public" / "commodity_data"):
        cand = base / cid / name
        if cand.exists():
            return cand
    return None


def resolve_commodity_sentiment_csv(commodity_id: str) -> Path | None:
    cid = normalize_commodity_id(commodity_id)
    name = "daily_sentiment_features.csv"
    root = _repo_root()
    for base in (root / "commodity_data", root / "public" / "commodity_data"):
        cand = base / cid / name
        if cand.exists():
            return cand
    return None
