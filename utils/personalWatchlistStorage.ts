import type { DailyWatchlistItem } from '../types';
import { localCalendarDateStamp } from '../services/supabaseService';
import type { WatchlistSnapshotFileV1 } from './watchlistSnapshotJson';

export const PERSONAL_WATCHLIST_SNAPSHOT_KEY = 'smartinvest_user_personal_watchlist_snapshot_v1';
export const PERSONAL_WATCHLIST_FILENAME_KEY = 'smartinvest_user_personal_watchlist_filename_v1';
/** sessionStorage: which source the Trading S&P panel uses */
export const TRADING_WATCHLIST_SOURCE_KEY = 'smartinvest_trading_watchlist_source';

export type TradingWatchlistSource = 'team' | 'personal';

export function getTradingWatchlistSource(): TradingWatchlistSource {
  try {
    const v = sessionStorage.getItem(TRADING_WATCHLIST_SOURCE_KEY);
    return v === 'personal' ? 'personal' : 'team';
  } catch {
    return 'team';
  }
}

export function setTradingWatchlistSource(source: TradingWatchlistSource): void {
  try {
    sessionStorage.setItem(TRADING_WATCHLIST_SOURCE_KEY, source);
  } catch {
    /* ignore */
  }
}

export function getPersonalWatchlistSnapshot(): WatchlistSnapshotFileV1 | null {
  try {
    const raw = localStorage.getItem(PERSONAL_WATCHLIST_SNAPSHOT_KEY);
    if (!raw?.trim()) return null;
    const o = JSON.parse(raw) as WatchlistSnapshotFileV1;
    if (!o || o.format !== 'smartinvest-watchlist-snapshot-v1' || !Array.isArray(o.symbols)) return null;
    return o;
  } catch {
    return null;
  }
}

export function savePersonalWatchlistSnapshot(snap: WatchlistSnapshotFileV1, uploadedFileName?: string): void {
  localStorage.setItem(PERSONAL_WATCHLIST_SNAPSHOT_KEY, JSON.stringify(snap));
  if (uploadedFileName?.trim()) {
    localStorage.setItem(PERSONAL_WATCHLIST_FILENAME_KEY, uploadedFileName.trim());
  } else {
    localStorage.removeItem(PERSONAL_WATCHLIST_FILENAME_KEY);
  }
}

export function getPersonalWatchlistFileName(): string | null {
  try {
    return localStorage.getItem(PERSONAL_WATCHLIST_FILENAME_KEY);
  } catch {
    return null;
  }
}

export function clearPersonalWatchlist(): void {
  localStorage.removeItem(PERSONAL_WATCHLIST_SNAPSHOT_KEY);
  localStorage.removeItem(PERSONAL_WATCHLIST_FILENAME_KEY);
}

/** Snapshot rows ready for tables / Finnhub (same shape as server watchlist items). */
export function snapshotToDailyWatchlistItems(snap: WatchlistSnapshotFileV1): DailyWatchlistItem[] {
  const d = snap.watchlist_date || localCalendarDateStamp();
  if (snap.items && snap.items.length > 0) {
    return snap.items.map((it) => ({
      ...it,
      watchlist_date: it.watchlist_date || d,
      symbol: String(it.symbol || '').toUpperCase().trim(),
    }));
  }
  return snap.symbols.map((sym) => ({
    watchlist_date: d,
    symbol: String(sym).toUpperCase().trim(),
    company: '',
  }));
}
