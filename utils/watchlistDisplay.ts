import type { DailyWatchlist } from '../types';

/** Localized date + time when the admin published this snapshot (from `created_at`). Includes seconds when the locale supports it. */
export function formatWatchlistCreatedAt(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

/** One line for headers / trading panel — primary text is publish time + calendar day (no duplicate “Created”). */
export function watchlistUserVisibleLabel(w: Pick<DailyWatchlist, 'label' | 'watchlist_date' | 'created_at'>): string {
  const base = w.label?.trim();
  if (base) return base;
  const when = formatWatchlistCreatedAt(w.created_at);
  return when ? `${when} · day ${w.watchlist_date}` : `day ${w.watchlist_date}`;
}

/** Compact text for dropdown options. */
export function watchlistSelectOptionText(
  w: Pick<DailyWatchlist, 'label' | 'watchlist_date' | 'created_at' | 'symbols'>
): string {
  const n = (w.symbols || []).length;
  const row = watchlistUserVisibleLabel(w);
  return `${row} · ${n} symbols`;
}
