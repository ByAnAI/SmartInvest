/**
 * Load OHLC from CSV files produced by `scripts/download_forex_history.py`.
 * Files must be served from `public/currency_data/<PAIR>/` (mirrored by the download script).
 */

import type { FxChartResolutionId, OhlcBar } from './forexCandles';

/** CSV stem suffix per chart resolution (matches downloaded filenames). */
const LOCAL_FOREX_FILE_SUFFIX: Partial<Record<FxChartResolutionId, string>> = {
  /** No 1m/15m files — use 1h as closest preview */
  '1': '1h',
  '15': '1h',
  '60': '1h',
  '240': '4h',
  D: '1d',
  W: '1wk',
  M: '1mo',
};

function trimBaseUrl(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.replace(/\/$/, '');
}

function parseCsv(text: string): OhlcBar[] {
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

/**
 * Fetch bars from `/currency_data/<PAIR>/<PAIR>_<suffix>.csv` if present (HTTP 200).
 */
export async function fetchLocalForexBars(
  pairId: string,
  resolution: FxChartResolutionId
): Promise<OhlcBar[]> {
  const suffix = LOCAL_FOREX_FILE_SUFFIX[resolution];
  if (!suffix) return [];

  const pair = pairId.trim().toUpperCase();
  const base = trimBaseUrl();
  const url = `${base}/currency_data/${pair}/${pair}_${suffix}.csv`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return [];
    const text = await r.text();
    return parseCsv(text);
  } catch {
    return [];
  }
}
