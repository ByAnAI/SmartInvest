#!/usr/bin/env python3
"""
Download daily commodity OHLCV + Yahoo news headlines with simple sentiment scores.

Uses yfinance only (free, rate-limited). Output root:

  commodity_data/<ID>/
    daily_ohlcv.csv              — Datetime, Open, High, Low, Close, Volume (daily, cleaned)
    news_signals.csv             — headlines + lexicon sentiment; columns news_yahoo_symbol / price_yahoo_symbol
                                   (futures like CL=F often use ETF proxy e.g. USO for news only)
    daily_sentiment_features.csv — dense daily rows from 2025-01-01 through today (UTC):
                                   news_count, sentiment_mean, sentiment_sum

IDs match Trading Platform / services/tradingQuotes METAL_QUOTE_ROWS (XAU, XAG, OIL, XCU, NI, XPT, ALI).

Examples (repo root, backend venv):

  backend/.venv/bin/python scripts/download_commodity_history.py --id XAU
  backend/.venv/bin/python scripts/download_commodity_history.py --all
  backend/.venv/bin/python scripts/download_commodity_history.py --years 10 --all

  # Yahoo "max" history (longer than 10y where available)
  backend/.venv/bin/python scripts/download_commodity_history.py --years 0 --all
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]

# Dense daily sentiment + news_signals filter: inclusive start → today (UTC).
DEFAULT_NEWS_START_DATE = "2025-01-01"

# id, human label, Yahoo Finance symbol (same family as Finnhub rows in tradingQuotes.ts)
COMMODITY_DEFS: list[dict[str, str]] = [
    {"id": "XAU", "label": "Gold", "yahoo": "GC=F"},
    {"id": "XAG", "label": "Silver", "yahoo": "SI=F"},
    {"id": "OIL", "label": "Oil", "yahoo": "CL=F"},
    {"id": "XCU", "label": "Copper", "yahoo": "HG=F"},
    {"id": "NI", "label": "Nickel (ETF)", "yahoo": "JJN"},
    {"id": "XPT", "label": "Platinum", "yahoo": "PL=F"},
    {"id": "ALI", "label": "Aluminum", "yahoo": "ALI=F"},
]

_POS = frozenset(
    """
    gain gains gained gaining rally rallies rallied surge surges surged rise rises rose rising
    up higher high record strong strength bullish bull breakout soar soars soared rebound
    beat beats upgrade upgrades optimism optimistic demand growth surge spike positive
    """.split()
)
_NEG = frozenset(
    """
    loss losses lost fall falls fell falling drop drops dropped decline declines declined
    down lower low weak weakness bearish bear slump slumps slump crash crashes crashed
    miss misses cut cuts downgrade downgrades pessimistic supply glut negative plunge
    """.split()
)


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z]+", text.lower())


def lexicon_sentiment(text: str) -> tuple[float, str]:
    """Return (score in [-1, 1], coarse label)."""
    if not text or not str(text).strip():
        return 0.0, "neutral"
    tokens = _tokenize(str(text))
    if not tokens:
        return 0.0, "neutral"
    pos = sum(1 for t in tokens if t in _POS)
    neg = sum(1 for t in tokens if t in _NEG)
    total = pos + neg
    if total == 0:
        return 0.0, "neutral"
    raw = (pos - neg) / total
    score = max(-1.0, min(1.0, raw))
    if score > 0.15:
        label = "bullish"
    elif score < -0.15:
        label = "bearish"
    else:
        label = "neutral"
    return score, label


def _history_period_arg(years: int) -> str:
    if years <= 0:
        return "max"
    return f"{min(int(years), 50)}y"


def clean_daily_ohlcv(df) -> Any:
    import pandas as pd

    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    if not isinstance(out.index, pd.DatetimeIndex):
        return pd.DataFrame()
    if getattr(out.index, "tz", None) is not None:
        out.index = out.index.tz_convert("UTC")
    else:
        out.index = out.index.tz_localize("UTC")
    out.index.name = "Datetime"
    out = out.rename(columns=lambda c: str(c).strip())
    for col in ("Open", "High", "Low", "Close"):
        if col not in out.columns:
            return pd.DataFrame()
    if "Volume" not in out.columns:
        out["Volume"] = 0.0
    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    ohlc = ["Open", "High", "Low", "Close"]
    out[ohlc] = out[ohlc].ffill(limit=5)
    out = out.dropna(subset=["Close"])
    vol = pd.to_numeric(out["Volume"], errors="coerce").fillna(0.0)
    out["Volume"] = vol.clip(lower=0)
    out = out.reset_index()
    out["Datetime"] = pd.to_datetime(out["Datetime"], utc=True).dt.strftime("%Y-%m-%dT00:00:00Z")
    cols = ["Datetime", "Open", "High", "Low", "Close", "Volume"]
    return out[cols]


# When the price ticker is a future (=F), Yahoo often returns no `.news`. Use a liquid proxy
# (ETF / equity) for headlines; OHLCV still uses the future above. See column `news_yahoo_symbol`.
COMMODITY_NEWS_FALLBACK: dict[str, str] = {
    "XAU": "GLD",
    "XAG": "SLV",
    "OIL": "USO",
    "XCU": "CPER",
    "NI": "JJN",
    "XPT": "PPLT",
    "ALI": "AA",
}


def _news_raw_from_ticker(t: Any, *, count: int) -> list[Any]:
    """Best-effort: newer yfinance `get_news`, else `.news`."""
    out: list[Any] = []
    get_news = getattr(t, "get_news", None)
    if callable(get_news):
        try:
            raw = get_news(count=count)
            if isinstance(raw, list) and raw:
                return raw
        except Exception:  # noqa: BLE001
            pass
    try:
        raw = getattr(t, "news", None)
    except Exception:  # noqa: BLE001
        return out
    if isinstance(raw, list):
        return raw
    return out


def _news_item_to_dict(item: Any) -> dict[str, Any] | None:
    """yfinance 1.3+ uses {'content': {title, pubDate, canonicalUrl, ...}}; older builds use flat dict."""
    if isinstance(item, dict):
        c = item.get("content")
        if isinstance(c, dict):
            title = c.get("title") or c.get("summary")
            if not title:
                return None
            url_obj = c.get("canonicalUrl") or c.get("clickThroughUrl")
            link = ""
            if isinstance(url_obj, dict):
                link = str(url_obj.get("url") or "")
            prov = c.get("provider")
            publisher = ""
            if isinstance(prov, dict):
                publisher = str(prov.get("displayName") or "")
            ts = c.get("pubDate") or c.get("displayTime") or c.get("providerPublishTime")
            return {
                "title": str(title).strip(),
                "link": link,
                "publisher": publisher,
                "providerPublishTime": ts,
            }
        title = item.get("title")
        if title:
            return {
                "title": str(title).strip(),
                "link": str(item.get("link") or item.get("url") or ""),
                "publisher": str(item.get("publisher") or item.get("source") or ""),
                "providerPublishTime": item.get("providerPublishTime") or item.get("pubDate"),
            }
        return None
    title = getattr(item, "title", None)
    if not title:
        return None
    link = getattr(item, "link", None) or getattr(item, "url", None)
    publisher = getattr(item, "publisher", None) or getattr(item, "source", None)
    ts = getattr(item, "providerPublishTime", None) or getattr(item, "pubDate", None)
    if hasattr(item, "content") and ts is None:
        c = getattr(item, "content", None)
        if isinstance(c, dict):
            ts = c.get("pubDate") or c.get("providerPublishTime")
    return {
        "title": str(title),
        "link": str(link or ""),
        "publisher": str(publisher or ""),
        "providerPublishTime": ts,
    }


def fetch_yahoo_news_rows(
    ticker: Any,
    *,
    news_yahoo_symbol: str,
    price_yahoo_symbol: str,
    news_count: int,
) -> list[dict[str, Any]]:
    """Normalize yfinance news entries; tags which Yahoo symbol supplied the headline."""
    rows: list[dict[str, Any]] = []
    raw_list = _news_raw_from_ticker(ticker, count=max(20, min(500, int(news_count))))
    for item in raw_list:
        d = _news_item_to_dict(item)
        if not d:
            continue
        title = str(d.get("title") or "").strip()
        if not title:
            continue
        link = str(d.get("link") or d.get("url") or "").strip()
        publisher = str(d.get("publisher") or d.get("source") or "").strip()
        ts = d.get("providerPublishTime") or d.get("pubDate")
        published_utc: str | None = None
        if isinstance(ts, (int, float)) and ts > 1e9:
            published_utc = datetime.fromtimestamp(float(ts), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        elif isinstance(ts, str) and ts.strip():
            s = ts.strip()
            try:
                iso = s.replace("Z", "+00:00") if s.endswith("Z") else s
                dtp = datetime.fromisoformat(iso)
                if dtp.tzinfo is None:
                    dtp = dtp.replace(tzinfo=timezone.utc)
                published_utc = dtp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                published_utc = s
        score, label = lexicon_sentiment(title)
        rows.append(
            {
                "published_at_utc": published_utc or "",
                "title": title,
                "link": link,
                "publisher": publisher,
                "headline_sentiment": round(score, 4),
                "sentiment_label": label,
                "news_yahoo_symbol": news_yahoo_symbol,
                "price_yahoo_symbol": price_yahoo_symbol,
            }
        )
    return rows


def fetch_news_for_commodity(
    cid: str,
    price_yahoo: str,
    yf: Any,
    *,
    news_count: int,
) -> tuple[list[dict[str, Any]], str]:
    """
    Yahoo often attaches junk or empty news to futures (=F). Prefer ETF/proxy first for futures,
    then fall back to the price symbol. For non-futures, try price symbol first, then proxy.
    """
    fb = COMMODITY_NEWS_FALLBACK.get(cid)
    pu = str(price_yahoo).strip()
    is_future = "=F" in pu.upper()

    sequence: list[tuple[str, str]] = []
    if is_future and fb:
        sequence.append((fb, "proxy"))
    sequence.append((pu, "price"))
    if (not is_future) and fb and fb.upper() != pu.upper():
        sequence.append((fb, "proxy"))

    seen: set[str] = set()
    for sym, kind in sequence:
        key = sym.upper()
        if key in seen:
            continue
        seen.add(key)
        rows = fetch_yahoo_news_rows(
            yf.Ticker(sym),
            news_yahoo_symbol=sym,
            price_yahoo_symbol=pu,
            news_count=news_count,
        )
        if not rows:
            continue
        if kind == "proxy":
            return rows, f"news from proxy {sym} (daily OHLCV remains {pu})"
        return rows, f"news from price ticker {sym}"

    return [], "no Yahoo news (price or proxy)"


def _empty_news_columns() -> list[str]:
    return [
        "published_at_utc",
        "title",
        "link",
        "publisher",
        "headline_sentiment",
        "sentiment_label",
        "news_yahoo_symbol",
        "price_yahoo_symbol",
    ]


def news_window_bounds(news_from: str = DEFAULT_NEWS_START_DATE) -> tuple[Any, Any]:
    """Inclusive UTC calendar range [start_day, end_day] for news + daily_sentiment_features."""
    import pandas as pd

    end_day = pd.Timestamp.now(tz="UTC").normalize()
    start_day = pd.to_datetime(str(news_from).strip(), utc=True).normalize()
    if start_day > end_day:
        start_day = end_day
    return start_day, end_day


def filter_news_rows_to_window(
    news_rows: list[dict[str, Any]],
    start_day: Any,
    end_day: Any,
) -> list[dict[str, Any]]:
    import pandas as pd

    out: list[dict[str, Any]] = []
    for r in news_rows:
        pa = str(r.get("published_at_utc") or "").strip()
        if not pa:
            continue
        try:
            dt = pd.to_datetime(pa, utc=True)
        except Exception:  # noqa: BLE001
            continue
        day = dt.normalize()
        if start_day <= day <= end_day:
            out.append(r)
    return out


def aggregate_daily_sentiment(
    news_rows: list[dict[str, Any]],
    *,
    news_from: str = DEFAULT_NEWS_START_DATE,
) -> Any:
    import pandas as pd

    start_day, end_day = news_window_bounds(news_from)
    base_days = pd.DataFrame({"date_dt": pd.date_range(start=start_day, end=end_day, freq="D", tz="UTC")})

    if not news_rows:
        out = base_days.copy()
        out["news_count"] = 0
        out["sentiment_mean"] = 0.0
        out["sentiment_sum"] = 0.0
        out["date"] = out["date_dt"].dt.strftime("%Y-%m-%d")
        return out[["date", "news_count", "sentiment_mean", "sentiment_sum"]]
    parsed: list[tuple[Any, float]] = []
    for r in news_rows:
        pa = r.get("published_at_utc") or ""
        if not pa:
            continue
        try:
            dt = pd.to_datetime(pa, utc=True)
        except Exception:  # noqa: BLE001
            continue
        day = dt.normalize()
        try:
            s = float(r.get("headline_sentiment", 0.0))
        except (TypeError, ValueError):
            s = 0.0
        if day < start_day:
            continue
        parsed.append((day, s))
    if not parsed:
        out = base_days.copy()
        out["news_count"] = 0
        out["sentiment_mean"] = 0.0
        out["sentiment_sum"] = 0.0
        out["date"] = out["date_dt"].dt.strftime("%Y-%m-%d")
        return out[["date", "news_count", "sentiment_mean", "sentiment_sum"]]
    df = pd.DataFrame(parsed, columns=["date", "sentiment"])
    g = df.groupby("date", as_index=False).agg(
        news_count=("sentiment", "count"),
        sentiment_mean=("sentiment", "mean"),
        sentiment_sum=("sentiment", "sum"),
    )
    g = g.rename(columns={"date": "date_dt"})
    out = base_days.merge(g, on="date_dt", how="left")
    out["news_count"] = out["news_count"].fillna(0).astype(int)
    out["sentiment_mean"] = out["sentiment_mean"].fillna(0.0)
    out["sentiment_sum"] = out["sentiment_sum"].fillna(0.0)
    out["date"] = out["date_dt"].dt.strftime("%Y-%m-%d")
    out["sentiment_mean"] = out["sentiment_mean"].round(4)
    out["sentiment_sum"] = out["sentiment_sum"].round(4)
    return out[["date", "news_count", "sentiment_mean", "sentiment_sum"]]


def mirror_ohlcv_to_public(repo_root: Path, cid: str, ohlc_path: Path) -> None:
    """Copy daily OHLCV so Vite can serve `/commodity_data/<ID>/daily_ohlcv.csv`."""
    if not ohlc_path.is_file():
        return
    pub = repo_root / "public" / "commodity_data" / cid
    pub.mkdir(parents=True, exist_ok=True)
    dest = pub / "daily_ohlcv.csv"
    shutil.copy2(ohlc_path, dest)
    print(f"  [{cid}] mirrored OHLCV → public/commodity_data/{cid}/daily_ohlcv.csv")


def download_one(
    spec: dict[str, str],
    out_root: Path,
    years: int,
    pause_sec: float,
    news_from: str,
    news_count: int,
    mirror_public: bool,
) -> None:
    import pandas as pd
    import yfinance as yf

    cid = spec["id"]
    ysym = spec["yahoo"]
    label = spec["label"]
    sub = out_root / cid
    sub.mkdir(parents=True, exist_ok=True)

    period = _history_period_arg(years)
    print(f"[{cid}] {label} ({ysym}) period={period} → {sub.relative_to(_REPO_ROOT)}/")

    t = yf.Ticker(ysym)
    df = t.history(period=period, interval="1d", auto_adjust=False)
    daily = clean_daily_ohlcv(df)
    ohlc_path = sub / "daily_ohlcv.csv"
    if daily.empty:
        print(f"  [{cid}] WARNING: no OHLC rows after clean — wrote empty {ohlc_path.name}")
    daily.to_csv(ohlc_path, index=False)
    print(f"  [{cid}] wrote {len(daily)} daily OHLCV rows → {ohlc_path.relative_to(_REPO_ROOT)}")
    if mirror_public:
        mirror_ohlcv_to_public(_REPO_ROOT, cid, ohlc_path)

    news_rows, news_note = fetch_news_for_commodity(cid, ysym, yf, news_count=news_count)
    start_day, end_day = news_window_bounds(news_from)
    news_rows = filter_news_rows_to_window(news_rows, start_day, end_day)
    news_path = sub / "news_signals.csv"
    if news_rows:
        pd.DataFrame(news_rows).to_csv(news_path, index=False)
        print(f"  [{cid}] wrote {len(news_rows)} news rows → {news_path.relative_to(_REPO_ROOT)} ({news_note})")
    else:
        pd.DataFrame(columns=_empty_news_columns()).to_csv(news_path, index=False)
        print(
            f"  [{cid}] {news_note} — empty {news_path.name}. "
            f"Futures often have no Yahoo news; proxies: see COMMODITY_NEWS_FALLBACK in script."
        )

    agg = aggregate_daily_sentiment(news_rows, news_from=news_from)
    feat_path = sub / "daily_sentiment_features.csv"
    agg.to_csv(feat_path, index=False)
    start_s = start_day.strftime("%Y-%m-%d")
    end_s = end_day.strftime("%Y-%m-%d")
    print(
        f"  [{cid}] wrote {len(agg)} daily sentiment feature rows "
        f"(dense {start_s} → {end_s}) → {feat_path.relative_to(_REPO_ROOT)}"
    )

    time.sleep(max(0.0, pause_sec))


def main() -> None:
    root = _REPO_ROOT
    parser = argparse.ArgumentParser(description="Download commodity daily OHLCV + news/sentiment (Yahoo only)")
    parser.add_argument("--id", default="XAU", help="Commodity id: XAU, XAG, OIL, XCU, NI, XPT, ALI (ignored if --all)")
    parser.add_argument("--all", action="store_true", help="Download all configured commodities")
    parser.add_argument(
        "--years",
        type=int,
        default=10,
        help="Years of daily history (default 10). Use 0 for Yahoo 'max' where supported.",
    )
    parser.add_argument(
        "--news-from",
        type=str,
        default=DEFAULT_NEWS_START_DATE,
        help=f"Start date for news + daily_sentiment_features (YYYY-MM-DD, default {DEFAULT_NEWS_START_DATE}). End is today UTC.",
    )
    parser.add_argument(
        "--news-count",
        type=int,
        default=200,
        help="Yahoo headline pull size per symbol (default 200, max 500; Yahoo may still return only recent months).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=root / "commodity_data",
        help="Output root (default: ./commodity_data)",
    )
    parser.add_argument("--pause", type=float, default=1.5, help="Seconds between tickers (rate limit courtesy)")
    parser.add_argument(
        "--no-public-mirror",
        action="store_true",
        help="Do not copy daily_ohlcv.csv into public/commodity_data (needed for Trading Platform charts)",
    )
    args = parser.parse_args()

    out_root = args.out if args.out.is_absolute() else (root / args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    if args.all:
        specs = COMMODITY_DEFS
    else:
        want = args.id.strip().upper()
        specs = [s for s in COMMODITY_DEFS if s["id"] == want]
        if not specs:
            print(f"Unknown --id {args.id!r}. Choose one of: {', '.join(s['id'] for s in COMMODITY_DEFS)}", file=sys.stderr)
            sys.exit(1)

    failed: list[str] = []
    try:
        for spec in specs:
            try:
                download_one(
                    spec,
                    out_root=out_root,
                    years=args.years,
                    pause_sec=args.pause,
                    news_from=str(args.news_from).strip() or DEFAULT_NEWS_START_DATE,
                    news_count=max(20, int(args.news_count)),
                    mirror_public=not args.no_public_mirror,
                )
            except Exception as e:  # noqa: BLE001
                failed.append(spec["id"])
                print(f"FAILED {spec['id']}: {e}", file=sys.stderr)
        if failed:
            print(f"Finished with {len(failed)} failure(s): {', '.join(failed)}", file=sys.stderr)
            sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
