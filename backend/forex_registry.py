"""Single source for Yahoo FX spot ids — keep aligned with components/ForexData.ts (pair list)."""

from __future__ import annotations

# symbol -> Yahoo Finance ticker (spot FX uses =X suffix)
FOREX_YAHOO: dict[str, str] = {
    "EURUSD": "EURUSD=X",
    "USDJPY": "USDJPY=X",
    "GBPUSD": "GBPUSD=X",
    "USDCHF": "USDCHF=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "USDCAD=X",
    "NZDUSD": "NZDUSD=X",
    "EURGBP": "EURGBP=X",
    "EURJPY": "EURJPY=X",
    "EURCHF": "EURCHF=X",
    "EURAUD": "EURAUD=X",
    "EURCAD": "EURCAD=X",
    "EURNZD": "EURNZD=X",
    "GBPJPY": "GBPJPY=X",
    "GBPCHF": "GBPCHF=X",
    "GBPAUD": "GBPAUD=X",
    "GBPCAD": "GBPCAD=X",
    "GBPNZD": "GBPNZD=X",
    "AUDJPY": "AUDJPY=X",
    "AUDCAD": "AUDCAD=X",
    "AUDCHF": "AUDCHF=X",
    "AUDNZD": "AUDNZD=X",
    "CADJPY": "CADJPY=X",
    "CADCHF": "CADCHF=X",
    "CHFJPY": "CHFJPY=X",
    "NZDJPY": "NZDJPY=X",
    "NZDCAD": "NZDCAD=X",
    "NZDCHF": "NZDCHF=X",
    "USDMXN": "USDMXN=X",
    "USDZAR": "USDZAR=X",
}

PAIR_CCY: dict[str, tuple[str, str]] = {
    "EURUSD": ("EUR", "USD"),
    "USDJPY": ("USD", "JPY"),
    "GBPUSD": ("GBP", "USD"),
    "USDCHF": ("USD", "CHF"),
    "AUDUSD": ("AUD", "USD"),
    "USDCAD": ("USD", "CAD"),
    "NZDUSD": ("NZD", "USD"),
    "EURGBP": ("EUR", "GBP"),
    "EURJPY": ("EUR", "JPY"),
    "EURCHF": ("EUR", "CHF"),
    "EURAUD": ("EUR", "AUD"),
    "EURCAD": ("EUR", "CAD"),
    "EURNZD": ("EUR", "NZD"),
    "GBPJPY": ("GBP", "JPY"),
    "GBPCHF": ("GBP", "CHF"),
    "GBPAUD": ("GBP", "AUD"),
    "GBPCAD": ("GBP", "CAD"),
    "GBPNZD": ("GBP", "NZD"),
    "AUDJPY": ("AUD", "JPY"),
    "AUDCAD": ("AUD", "CAD"),
    "AUDCHF": ("AUD", "CHF"),
    "AUDNZD": ("AUD", "NZD"),
    "CADJPY": ("CAD", "JPY"),
    "CADCHF": ("CAD", "CHF"),
    "CHFJPY": ("CHF", "JPY"),
    "NZDJPY": ("NZD", "JPY"),
    "NZDCAD": ("NZD", "CAD"),
    "NZDCHF": ("NZD", "CHF"),
    "USDMXN": ("USD", "MXN"),
    "USDZAR": ("USD", "ZAR"),
}

DEFAULT_DOWNLOAD_PAIRS = list(FOREX_YAHOO.keys())


def normalize_forex_pair_symbol(raw: str) -> str:
    """
    Map display or loose forms (EUR/USD, EUR-USD, eur usd) to file/API keys (EURUSD)
    matching ``currency_data/EURUSD/`` and ``hmm_EURUSD.pkl``.
    """
    return "".join(ch for ch in raw.strip().upper() if ch.isalnum())


def pairs_touching_currency(code: str) -> list[str]:
    c = code.strip().upper()
    if len(c) != 3:
        return []
    out: list[str] = []
    for pair, (b, q) in PAIR_CCY.items():
        if b == c or q == c:
            out.append(pair)
    return sorted(out)
