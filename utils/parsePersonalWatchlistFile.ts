import { localCalendarDateStamp } from '../services/supabaseService';
import type { DailyWatchlistItem } from '../types';
import { parseTickerListCsv } from './sp500WatchlistUpload';
import { WATCHLIST_SNAPSHOT_FORMAT, parseWatchlistSnapshotJson, type WatchlistSnapshotFileV1 } from './watchlistSnapshotJson';
import { WATCHLIST_SNAPSHOT_CSV_COLUMNS } from './watchlistCsvDownload';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function numCell(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Full export CSV (UTF-8 BOM ok) with header matching WATCHLIST_SNAPSHOT_CSV_COLUMNS. */
function parseFullSnapshotCsv(text: string, fallbackFileName: string): WatchlistSnapshotFileV1 {
  const stripped = text.replace(/^\uFEFF/, '');
  const lines = stripped.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows.');
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const symIdx = header.indexOf('symbol');
  if (symIdx < 0) throw new Error('CSV must include a symbol column.');
  const items: DailyWatchlistItem[] = [];
  const symbols: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, j) => {
      row[h] = values[j] ?? '';
    });
    const sym = String(row.symbol || '').toUpperCase().trim();
    if (!sym) continue;
    symbols.push(sym);
    const stringKeys = new Set(
      'watchlist_date symbol company sector industry location torchlight_rank_factors created_at'.split(' ')
    );
    const item: Record<string, unknown> = {};
    for (const col of WATCHLIST_SNAPSHOT_CSV_COLUMNS) {
      const key = col as string;
      const raw = row[key] ?? '';
      if (stringKeys.has(key)) {
        item[key] = raw;
      } else {
        item[key] = numCell(raw);
      }
    }
    items.push(item as unknown as DailyWatchlistItem);
  }
  if (symbols.length === 0) throw new Error('No symbols found in CSV.');
  const wlDate =
    items[0]?.watchlist_date && /^\d{4}-\d{2}-\d{2}$/.test(String(items[0].watchlist_date))
      ? String(items[0].watchlist_date)
      : localCalendarDateStamp();
  return {
    format: WATCHLIST_SNAPSHOT_FORMAT,
    exported_at: new Date().toISOString(),
    watchlist_date: wlDate,
    label: `Uploaded CSV · ${fallbackFileName}`,
    symbols: [...new Set(symbols)],
    items,
  };
}

function symbolsOnlyCsvToSnapshot(text: string, fallbackFileName: string): WatchlistSnapshotFileV1 {
  const rows = parseTickerListCsv(text);
  if (rows.length === 0) throw new Error('No tickers found in CSV (use one symbol per line or Symbol,Name).');
  const d = localCalendarDateStamp();
  const symbols = rows.map((r) => r.symbol);
  return {
    format: WATCHLIST_SNAPSHOT_FORMAT,
    exported_at: new Date().toISOString(),
    watchlist_date: d,
    label: `Uploaded tickers · ${fallbackFileName}`,
    symbols,
    items: rows.map((r) => ({
      watchlist_date: d,
      symbol: r.symbol,
      company: r.name !== r.symbol ? r.name : '',
    })),
  };
}

/**
 * Accepts SmartInvest snapshot JSON, full snapshot CSV, or ticker CSV (same as CLI / admin).
 */
export async function parsePersonalWatchlistFile(file: File): Promise<WatchlistSnapshotFileV1> {
  const lower = file.name.toLowerCase();
  const text = await file.text();

  if (lower.endsWith('.json')) {
    const snap = parseWatchlistSnapshotJson(text);
    return {
      ...snap,
      label: snap.label || `Uploaded · ${file.name}`,
    };
  }

  if (lower.endsWith('.csv')) {
    const stripped = text.replace(/^\uFEFF/, '').trim();
    const firstLine = stripped.split(/\r?\n/)[0] ?? '';
    const headLower = firstLine.toLowerCase();
    if (headLower.includes('watchlist_date') && headLower.includes('symbol') && firstLine.split(',').length >= 5) {
      return parseFullSnapshotCsv(text, file.name);
    }
    return symbolsOnlyCsvToSnapshot(text, file.name);
  }

  try {
    const snap = parseWatchlistSnapshotJson(text);
    return { ...snap, label: snap.label || `Uploaded · ${file.name}` };
  } catch {
    /* fall through */
  }

  try {
    const stripped = text.replace(/^\uFEFF/, '').trim();
    const firstLine = stripped.split(/\r?\n/)[0] ?? '';
    const headLower = firstLine.toLowerCase();
    if (headLower.includes('watchlist_date') && headLower.includes('symbol')) {
      return parseFullSnapshotCsv(text, file.name);
    }
    return symbolsOnlyCsvToSnapshot(text, file.name);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not read watchlist file: ${msg}`);
  }
}
