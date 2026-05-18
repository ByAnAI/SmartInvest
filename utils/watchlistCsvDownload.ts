import type { DailyWatchlistItem } from '../types';

/** Column order aligned with `daily_watchlist_items` / admin snapshot fields. */
export const WATCHLIST_SNAPSHOT_CSV_COLUMNS: (keyof DailyWatchlistItem)[] = [
  'watchlist_date',
  'symbol',
  'company',
  'sector',
  'industry',
  'location',
  'current_price',
  'total_assets',
  'total_liabilities',
  'total_revenue',
  'net_income',
  'operating_cash_flow',
  'free_cash_flow',
  'iv_dcf',
  'iv_ri',
  'iv_multiples',
  'iv_quality_score',
  'iv_ensemble',
  'iv_upside_pct',
  'torchlight_score',
  'torchlight_rank_factors',
  'torchlight_momentum',
  'torchlight_valuation_edge',
  'torchlight_quality',
  'torchlight_growth',
  'torchlight_sentiment',
  'torchlight_macro_fit',
  'torchlight_execution_feasibility',
  'torchlight_risk_adjusted_alpha',
  'torchlight_capital_efficiency',
  'torchlight_analyst_drift',
  'ctr_total_return',
  'ctr_price_return',
  'ctr_cash_return',
  'ctr_annualized',
  'torchlight_ctr_score',
  'risk_daily_return_mean',
  'risk_volatility_daily',
  'risk_volatility_annual',
  'risk_sharpe',
  'risk_sortino',
  'risk_max_drawdown',
  'risk_var_95_hist',
  'risk_var_99_hist',
  'risk_var_95_param',
  'risk_var_99_param',
  'risk_cvar_95',
  'risk_beta',
  'risk_summary_score',
  'created_at',
];

function escapeCsvCell(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function triggerDownload(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function snapshotCsvText(items: DailyWatchlistItem[]): string {
  const header = WATCHLIST_SNAPSHOT_CSV_COLUMNS.map((k) => escapeCsvCell(String(k))).join(',');
  const lines = items.map((row) =>
    WATCHLIST_SNAPSHOT_CSV_COLUMNS.map((k) =>
      escapeCsvCell((row as unknown as Record<string, unknown>)[k as string]),
    ).join(',')
  );
  return `\uFEFF${header}\r\n${lines.join('\r\n')}`;
}

function symbolsOnlyCsvText(symbols: string[], watchlistDate: string): string {
  const header = ['watchlist_date', 'symbol'].map(escapeCsvCell).join(',');
  const rows = symbols.map((s) =>
    [escapeCsvCell(watchlistDate), escapeCsvCell(String(s).toUpperCase().trim())].join(',')
  );
  return `\uFEFF${header}\r\n${rows.join('\r\n')}`;
}

export function watchlistSnapshotCsvBlob(items: DailyWatchlistItem[]): Blob {
  return new Blob([snapshotCsvText(items)], { type: 'text/csv;charset=utf-8' });
}

export function watchlistSymbolsOnlyCsvBlob(symbols: string[], watchlistDate: string): Blob {
  return new Blob([symbolsOnlyCsvText(symbols, watchlistDate)], { type: 'text/csv;charset=utf-8' });
}

/** Full snapshot: one row per item, all columns (empty cells where missing). */
export function downloadWatchlistSnapshotCsv(items: DailyWatchlistItem[], filenameBase: string): void {
  if (items.length === 0) return;
  triggerDownload(watchlistSnapshotCsvBlob(items), `${filenameBase}.csv`);
}

/** Manual entry: symbols only + date. */
export function downloadWatchlistSymbolsOnlyCsv(symbols: string[], watchlistDate: string, filenameBase: string): void {
  if (symbols.length === 0) return;
  triggerDownload(watchlistSymbolsOnlyCsvBlob(symbols, watchlistDate), `${filenameBase}.csv`);
}

/** `YYYY-MM-DD-HHMMSS` in the user's local timezone (matches UI publish time when `isoUtc` is from `Date.toISOString()`). */
export function watchlistFileStampLocal(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc.slice(0, 10);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${day}-${hh}${mm}${ss}`;
}

/** Basename for `watchlist-{stamp}.csv` next to legacy repo files; stamp = local created time for full ISO timestamps. */
export function watchlistCsvFilenameBase(isoOrDate: string): string {
  if (isoOrDate.length >= 19 && /^\d{4}-\d{2}-\d{2}T/.test(isoOrDate)) {
    return `watchlist-${watchlistFileStampLocal(isoOrDate)}`;
  }
  const d = isoOrDate.slice(0, 10);
  return d ? `watchlist-${d}` : 'watchlist-export';
}
