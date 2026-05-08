import type { DailyWatchlistItem } from '../types';
import { localCalendarDateStamp } from '../services/supabaseService';

export const WATCHLIST_SNAPSHOT_FORMAT = 'smartinvest-watchlist-snapshot-v1' as const;
export const WATCHLIST_SNAPSHOT_STORAGE_KEY = 'smartinvest_watchlist_snapshot_v1';

export type WatchlistSnapshotFileV1 = {
  format: typeof WATCHLIST_SNAPSHOT_FORMAT;
  /** When this file was written (ISO). */
  exported_at: string;
  /** Trading calendar day for the list (YYYY-MM-DD). */
  watchlist_date?: string;
  label?: string;
  symbols: string[];
  /** Full metric rows when available (from admin prepare + Yahoo, or a prior export). */
  items?: DailyWatchlistItem[];
};

/** Rows compatible with the admin “loaded short list” table. */
export type WatchlistSnapshotLoadedRow = {
  ticker: string;
  company?: string;
  current_price?: number;
  sector?: string;
  short_name?: string;
  total_assets?: number | null;
  total_liabilities?: number | null;
  total_revenue?: number | null;
  net_income?: number | null;
  operating_cash_flow?: number | null;
  free_cash_flow?: number | null;
  iv_dcf?: number | null;
  iv_ri?: number | null;
  iv_multiples?: number | null;
  iv_quality_score?: number | null;
  iv_ensemble?: number | null;
  iv_upside_pct?: number | null;
  torchlight_score?: number | null;
  torchlight_rank_factors?: string;
  ctr_total_return?: number | null;
  ctr_annualized?: number | null;
  risk_daily_return_mean?: number | null;
  risk_volatility_daily?: number | null;
  risk_volatility_annual?: number | null;
  risk_sharpe?: number | null;
  risk_sortino?: number | null;
  risk_max_drawdown?: number | null;
  risk_var_95_hist?: number | null;
  risk_var_99_hist?: number | null;
  risk_var_95_param?: number | null;
  risk_var_99_param?: number | null;
  risk_cvar_95?: number | null;
  risk_beta?: number | null;
  risk_summary_score?: number | null;
};

function normalizeSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((s) => String(s ?? '').toUpperCase().trim()).filter(Boolean))].sort();
}

export function parseWatchlistSnapshotJson(text: string): WatchlistSnapshotFileV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Snapshot file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Snapshot file must be a JSON object.');
  }
  const o = parsed as Record<string, unknown>;
  if (o.format !== WATCHLIST_SNAPSHOT_FORMAT) {
    throw new Error(`Unsupported snapshot format (expected "${WATCHLIST_SNAPSHOT_FORMAT}").`);
  }
  const symbols = normalizeSymbols(o.symbols);
  if (symbols.length === 0) {
    throw new Error('Snapshot has no symbols.');
  }
  const exported_at = typeof o.exported_at === 'string' && o.exported_at.trim() ? o.exported_at.trim() : new Date().toISOString();
  const watchlist_date =
    typeof o.watchlist_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.watchlist_date.trim())
      ? o.watchlist_date.trim()
      : undefined;
  const label = typeof o.label === 'string' ? o.label.trim() : undefined;
  let items: DailyWatchlistItem[] | undefined;
  if (Array.isArray(o.items)) {
    items = o.items.filter((row): row is DailyWatchlistItem => {
      if (!row || typeof row !== 'object') return false;
      const sym = String((row as DailyWatchlistItem).symbol || '').trim();
      return Boolean(sym);
    }) as DailyWatchlistItem[];
  }
  return {
    format: WATCHLIST_SNAPSHOT_FORMAT,
    exported_at,
    watchlist_date,
    label,
    symbols,
    items,
  };
}

export function snapshotToLoadedRows(snapshot: WatchlistSnapshotFileV1): WatchlistSnapshotLoadedRow[] {
  const d = snapshot.watchlist_date || localCalendarDateStamp();
  if (snapshot.items && snapshot.items.length > 0) {
    const bySym = new Map<string, DailyWatchlistItem>();
    for (const it of snapshot.items) {
      const t = String(it.symbol || '').toUpperCase().trim();
      if (t) bySym.set(t, { ...it, watchlist_date: it.watchlist_date || d });
    }
    return snapshot.symbols
      .map((sym) => {
        const it = bySym.get(sym);
        if (it) return dailyItemToLoadedRow(it);
        return { ticker: sym, company: '' };
      })
      .filter((r) => r.ticker);
  }
  return snapshot.symbols.map((ticker) => ({ ticker, company: '' }));
}

function dailyItemToLoadedRow(it: DailyWatchlistItem): WatchlistSnapshotLoadedRow {
  return {
    ticker: String(it.symbol || '').toUpperCase().trim(),
    company: it.company || '',
    current_price: it.current_price ?? undefined,
    sector: it.sector || '',
    short_name: it.company || '',
    total_assets: it.total_assets ?? null,
    total_liabilities: it.total_liabilities ?? null,
    total_revenue: it.total_revenue ?? null,
    net_income: it.net_income ?? null,
    operating_cash_flow: it.operating_cash_flow ?? null,
    free_cash_flow: it.free_cash_flow ?? null,
    iv_dcf: it.iv_dcf ?? null,
    iv_ri: it.iv_ri ?? null,
    iv_multiples: it.iv_multiples ?? null,
    iv_quality_score: it.iv_quality_score ?? null,
    iv_ensemble: it.iv_ensemble ?? null,
    iv_upside_pct: it.iv_upside_pct ?? null,
    torchlight_score: it.torchlight_score ?? null,
    torchlight_rank_factors: it.torchlight_rank_factors ?? undefined,
    ctr_total_return: it.ctr_total_return ?? null,
    ctr_annualized: it.ctr_annualized ?? null,
    risk_daily_return_mean: it.risk_daily_return_mean ?? null,
    risk_volatility_daily: it.risk_volatility_daily ?? null,
    risk_volatility_annual: it.risk_volatility_annual ?? null,
    risk_sharpe: it.risk_sharpe ?? null,
    risk_sortino: it.risk_sortino ?? null,
    risk_max_drawdown: it.risk_max_drawdown ?? null,
    risk_var_95_hist: it.risk_var_95_hist ?? null,
    risk_var_99_hist: it.risk_var_99_hist ?? null,
    risk_var_95_param: it.risk_var_95_param ?? null,
    risk_var_99_param: it.risk_var_99_param ?? null,
    risk_cvar_95: it.risk_cvar_95 ?? null,
    risk_beta: it.risk_beta ?? null,
    risk_summary_score: it.risk_summary_score ?? null,
  };
}

export function buildWatchlistSnapshotFile(opts: {
  symbols: string[];
  items?: DailyWatchlistItem[];
  watchlist_date?: string;
  label?: string;
}): WatchlistSnapshotFileV1 {
  const symbols = normalizeSymbols(opts.symbols);
  return {
    format: WATCHLIST_SNAPSHOT_FORMAT,
    exported_at: new Date().toISOString(),
    watchlist_date: opts.watchlist_date || localCalendarDateStamp(),
    label: opts.label,
    symbols,
    items: opts.items && opts.items.length > 0 ? opts.items : undefined,
  };
}

export function downloadWatchlistSnapshotJson(filename: string, snapshot: WatchlistSnapshotFileV1): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.\-]+/g, '_') || 'watchlist-snapshot.json';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
