#!/usr/bin/env python3
"""
Download Yahoo Finance OHLC forex history via yfinance and write CSV files per timeframe.

Examples (repo root, backend venv):
  backend/.venv/bin/python scripts/download_forex_history.py --pair EURUSD
  backend/.venv/bin/python scripts/download_forex_history.py --all

Output: currency_data/<PAIR>/ & mirror to public/currency_data/<PAIR>/ for Vite charts.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import sys

_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT / "backend"))

from forex_registry import DEFAULT_DOWNLOAD_PAIRS, FOREX_YAHOO, normalize_forex_pair_symbol  # noqa: E402


def _repo_root() -> Path:
    return _REPO_ROOT


def save_ohlc_csv(df, path: Path, label: str) -> None:
    import pandas as pd

    if df is None or df.empty:
        print(f"  [{label}] skipped — no rows")
        return
    out = df.copy()
    if not isinstance(out.index, pd.DatetimeIndex):
        print(f"  [{label}] skipped — unexpected index")
        return
    if getattr(out.index, "tz", None) is not None:
        out.index = out.index.tz_convert("UTC")
    out.index.name = "Datetime"
    out = out.rename(columns=lambda c: str(c).strip())
    need = [c for c in ("Open", "High", "Low", "Close") if c in out.columns]
    if len(need) < 4:
        print(f"  [{label}] skipped — missing OHLC columns {list(out.columns)}")
        return
    out = out.reset_index()
    preferred = ["Datetime", "Open", "High", "Low", "Close"]
    cols = [c for c in preferred if c in out.columns]
    out = out[cols]
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False)
    print(f"  [{label}] wrote {len(out)} rows → {path.relative_to(_repo_root())}")


def resample_ohlc(df, rule: str, label: str):
    import pandas as pd

    if df is None or df.empty:
        return df
    o = df.copy()
    if getattr(o.index, "tz", None) is not None:
        o.index = o.index.tz_convert("UTC")
    agg: dict[str, str] = {
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
    }
    if "Volume" in o.columns:
        agg["Volume"] = "sum"
    cols = [c for c in agg if c in o.columns]
    r = o[cols].resample(rule, label="left", closed="left").agg({c: agg[c] for c in cols})
    r = r.dropna(how="all")
    return r


def mirror_csvs_to_public(repo_root: Path, out_dir: Path, pair_upper: str) -> None:
    pub = repo_root / "public" / "currency_data" / pair_upper
    pub.mkdir(parents=True, exist_ok=True)
    n = 0
    for csv in sorted(out_dir.glob(f"{pair_upper}_*.csv")):
        shutil.copy2(csv, pub / csv.name)
        n += 1
    if n:
        print(f"  Mirrored {n} CSV(s) → public/currency_data/{pair_upper}/ (serve with Vite)")
    else:
        print("  Public mirror skipped — no CSV files")


def download_pair(pair_id: str, base_dir: Path, repo_root: Path, mirror_public: bool = True) -> None:
    import yfinance as yf

    sym = FOREX_YAHOO.get(pair_id.upper())
    if not sym:
        raise ValueError(f"Unknown pair {pair_id!r}. Add it to FOREX_YAHOO in this script.")

    out_dir = base_dir / pair_id.upper()
    out_dir.mkdir(parents=True, exist_ok=True)
    pair = pair_id.upper()
    print(f"Downloading {pair} ({sym}) → {out_dir.relative_to(_repo_root())}/")

    t = yf.Ticker(sym)

    # Intraday: Yahoo limits hourly history (~2y); extend if API allows.
    df_1h = t.history(period="730d", interval="1h", auto_adjust=False)
    save_ohlc_csv(df_1h, out_dir / f"{pair}_1h.csv", "1h")

    df_4h = resample_ohlc(df_1h, "4h", "4h")
    save_ohlc_csv(df_4h, out_dir / f"{pair}_4h.csv", "4h")

    df_8h = resample_ohlc(df_1h, "8h", "8h")
    save_ohlc_csv(df_8h, out_dir / f"{pair}_8h.csv", "8h")

    df_1d = t.history(period="max", interval="1d", auto_adjust=False)
    save_ohlc_csv(df_1d, out_dir / f"{pair}_1d.csv", "1d")

    df_1wk = t.history(period="max", interval="1wk", auto_adjust=False)
    save_ohlc_csv(df_1wk, out_dir / f"{pair}_1wk.csv", "1wk")

    df_1mo = t.history(period="max", interval="1mo", auto_adjust=False)
    save_ohlc_csv(df_1mo, out_dir / f"{pair}_1mo.csv", "1mo")

    if mirror_public:
        mirror_csvs_to_public(repo_root, out_dir, pair)


def main() -> None:
    root = _repo_root()
    parser = argparse.ArgumentParser(description="Download forex OHLC CSVs into currency_data/<PAIR>/")
    parser.add_argument(
        "--pair",
        default="EURUSD",
        help="Single forex pair id (EURUSD or EUR/USD — matches currency_data/<PAIR>/) (ignored if --all)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help=f"Download all platform pairs: {', '.join(DEFAULT_DOWNLOAD_PAIRS)}",
    )
    parser.add_argument(
        "--base",
        type=Path,
        default=root / "currency_data",
        help="Root folder for outputs (default: ./currency_data)",
    )
    parser.add_argument(
        "--no-public-mirror",
        action="store_true",
        help="Do not copy CSVs into public/currency_data (needed for Trading Platform offline charts)",
    )
    args = parser.parse_args()
    base = args.base if args.base.is_absolute() else (root / args.base)

    if args.all:
        pairs = DEFAULT_DOWNLOAD_PAIRS
    else:
        p = normalize_forex_pair_symbol(args.pair)
        if p not in FOREX_YAHOO:
            print(f"Unknown pair {args.pair!r} → {p!r}; keys match currency_data/<PAIR>/ (e.g. EURUSD)", file=sys.stderr)
            sys.exit(1)
        pairs = [p]
    failed: list[str] = []

    try:
        for p in pairs:
            try:
                download_pair(p, base, repo_root=root, mirror_public=not args.no_public_mirror)
            except Exception as e:  # noqa: BLE001 — keep batch going
                failed.append(p)
                print(f"FAILED {p}: {e}", file=sys.stderr)
        if failed:
            print(f"Finished with {len(failed)} failure(s): {', '.join(failed)}", file=sys.stderr)
            sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
