/**
 * Daily OHLC from `public/commodity_data/<ID>/daily_ohlcv.csv`
 * (mirrored by `scripts/download_commodity_history.py`).
 */

import type { OhlcBar } from './forexCandles';

function trimBaseUrl(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.replace(/\/$/, '');
}

function parseDailyOhlcvCsv(text: string): OhlcBar[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const out: OhlcBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const ts = Date.parse(parts[0]);
    if (!Number.isFinite(ts)) continue;
    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    if (![open, high, low, close].every((x) => Number.isFinite(x))) continue;
    out.push({ time: Math.floor(ts / 1000), open, high, low, close });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Load daily bars for a commodity id (XAU, OIL, …). */
export async function fetchLocalCommodityDailyBars(commodityId: string): Promise<OhlcBar[]> {
  const id = commodityId.trim().toUpperCase();
  if (!id) return [];
  const base = trimBaseUrl();
  const url = `${base}/commodity_data/${id}/daily_ohlcv.csv`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return [];
    return parseDailyOhlcvCsv(await r.text());
  } catch {
    return [];
  }
}
