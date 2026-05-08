
import React, { useState, useEffect, useCallback } from 'react';
import {
  getAllUsers,
  initializeUser,
  updateUserStatus,
  updateUserRole,
  deleteUserFully,
  batchUploadMarketData,
  createOrUpdateDailyWatchlist,
  getDailyWatchlist,
  getAllDailyWatchlists,
  getDailyWatchlistItems,
  getCompanyFundamentals,
  upsertCompanyFundamentals,
  updateCompanyFundamental,
  deleteCompanyFundamental,
  buildWatchlistLabel,
  localCalendarDateStamp,
} from '../services/supabaseService';
import { UserMetadata, CompanyFundamental, DailyWatchlistItem, DailyWatchlist, InsightResponse } from '../types';
import { supabase } from '../services/supabase';
import {
  exportWatchlistToLocalDir,
  fetchFinancialsBatchChunked,
  fetchWatchlistApi,
  getDefaultWatchlistApiBase,
  postWatchlistSnapshotCsvBundles,
  readWatchlistJson,
} from '../utils/watchlistApiFetch';
import {
  downloadWatchlistSnapshotCsv,
  downloadWatchlistSymbolsOnlyCsv,
  watchlistCsvFilenameBase,
  watchlistFileStampLocal,
  watchlistSnapshotCsvBlob,
  watchlistSymbolsOnlyCsvBlob,
} from '../utils/watchlistCsvDownload';
import {
  canSaveWatchlistToChosenFolder,
  writeBlobToChosenDirectory,
  type WindowWithDirectoryPicker,
} from '../utils/watchlistFolderSave';
import {
  WATCHLIST_SNAPSHOT_STORAGE_KEY,
  buildWatchlistSnapshotFile,
  downloadWatchlistSnapshotJson,
  parseWatchlistSnapshotJson,
  snapshotToLoadedRows,
} from '../utils/watchlistSnapshotJson';
import {
  parseExcelSheetToMarketAssets,
  parseTickerListCsv,
  type MarketAssetRow,
} from '../utils/sp500WatchlistUpload';
import * as XLSX from 'xlsx';
import { FOREX_TICKERS } from './ForexData';
import { fetchForexSentinelContext, postForexRefresh } from '../services/forexSentinel';
import { getForexSentinelInsight } from '../services/geminiService';
import { fetchFinnhubCompanyNewsBundle } from '../services/finnhubCompanyNews';

/** `limit` 0 = entire CSV (omit query param so API returns every row). */
function sp500ListQuery(limit: number): string {
  if (limit <= 0) return '/api/lists/sp500';
  return `/api/lists/sp500?limit=${limit}`;
}

/**
 * Caps admin watchlist batch work (Yahoo + Supabase) for faster dev runs.
 * - Set `VITE_ADMIN_WATCHLIST_MAX_TICKERS` to a positive integer to force a cap (use `0` in .env to mean "no env cap" — see parser below).
 * - In Vite dev, defaults to **50** when the var is unset.
 * - Production build: no cap unless the env var is set.
 */
function getWatchlistTickerCap(): number | null {
  const raw = import.meta.env.VITE_ADMIN_WATCHLIST_MAX_TICKERS;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    /** `0` = explicitly no cap (overrides dev default). */
    if (Number.isFinite(n) && n <= 0) return null;
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return null;
  }
  if (import.meta.env.DEV) return 50;
  return null;
}

type WatchlistCapOpts = { ignoreAdminCap?: boolean };

function applyWatchlistCap<T extends { ticker: string }>(
  rows: T[],
  opts?: WatchlistCapOpts
): { rows: T[]; capped: boolean; before: number } {
  const before = rows.length;
  if (opts?.ignoreAdminCap) return { rows, capped: false, before };
  const cap = getWatchlistTickerCap();
  if (cap == null || before <= cap) return { rows, capped: false, before };
  return { rows: rows.slice(0, cap), capped: true, before };
}

/** First N tickers from CSV for Prepare (memory-friendly). Used when List size is 0. */
const DEFAULT_PREPARE_SP500_LIMIT = 50;

/** SP500 GET limit: 0 = entire CSV. Prepare watchlist uses a bounded default unless “full S&P”. */
function resolvePrepareSp500ListLimit(fullSp500Universe: boolean, listSizeField: number): number {
  if (fullSp500Universe) return 0;
  if (listSizeField > 0) return Math.min(5000, Math.floor(listSizeField));
  return getWatchlistTickerCap() ?? DEFAULT_PREPARE_SP500_LIMIT;
}

/** Coerce JSON/API values (often strings) so we never call `.toFixed` on a string — that crashes React render. */
function asFiniteNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatWatchlistTableNum(v: number | null | undefined, decimals: number): string {
  const n = v == null ? NaN : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}

function formatStatementNum(val: number | null | undefined | unknown): string {
  const n0 = asFiniteNumber(val);
  if (n0 == null) return '—';
  const abs = Math.abs(n0);
  if (abs >= 1e12) return `${(n0 / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n0 / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n0 / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n0 / 1e3).toFixed(2)}K`;
  return !Number.isInteger(n0) ? n0.toFixed(2) : String(n0);
}

function fmtUsd(v: unknown): string {
  const n = asFiniteNumber(v);
  return n != null ? `$${n.toFixed(2)}` : '—';
}

function fmtPct01(v: unknown, decimals: number): string {
  const n = asFiniteNumber(v);
  return n != null ? `${(n * 100).toFixed(decimals)}%` : '—';
}

function fmtDecimal(v: unknown, decimals: number): string {
  const n = asFiniteNumber(v);
  return n != null ? n.toFixed(decimals) : '—';
}

function StatementTable({ data }: { data: { index: unknown[]; columns: unknown[]; data: unknown[][] } }) {
  const idx = data.index || [];
  const cols = data.columns || [];
  const rows = data.data || [];
  const formatVal = (v: unknown) => (v == null || v === '') ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-xs border-collapse">
        <thead className="bg-slate-100">
          <tr>
            <th className="p-2 font-bold text-slate-600">Item</th>
            {cols.map((c, j) => (
              <th key={j} className="p-2 font-bold text-slate-600">{String(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {idx.map((label, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="p-2 font-medium text-slate-800">{String(label)}</td>
              {(rows[i] || []).map((cell, j) => (
                <td key={j} className="p-2 text-slate-600 font-mono">{formatVal(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rows in the admin “loaded short list” table (S&P prep + Yahoo merge + manual save). */
type AdminLoadedShortListRow = {
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

function loadedShortRowsToDailySnapshotItems(rows: AdminLoadedShortListRow[]): DailyWatchlistItem[] {
  const d = localCalendarDateStamp();
  return rows.map((r) => ({
    watchlist_date: d,
    symbol: r.ticker,
    company: r.short_name || r.company || '',
    sector: r.sector || '',
    current_price: r.current_price ?? null,
    total_assets: r.total_assets ?? null,
    total_liabilities: r.total_liabilities ?? null,
    total_revenue: r.total_revenue ?? null,
    net_income: r.net_income ?? null,
    operating_cash_flow: r.operating_cash_flow ?? null,
    free_cash_flow: r.free_cash_flow ?? null,
    iv_dcf: r.iv_dcf ?? null,
    iv_ri: r.iv_ri ?? null,
    iv_multiples: r.iv_multiples ?? null,
    iv_quality_score: r.iv_quality_score ?? null,
    iv_ensemble: r.iv_ensemble ?? null,
    iv_upside_pct: r.iv_upside_pct ?? null,
    torchlight_score: r.torchlight_score ?? null,
    torchlight_rank_factors: r.torchlight_rank_factors ?? 'W1..W8 equal',
    ctr_total_return: r.ctr_total_return ?? null,
    ctr_annualized: r.ctr_annualized ?? null,
    risk_daily_return_mean: r.risk_daily_return_mean ?? null,
    risk_volatility_daily: r.risk_volatility_daily ?? null,
    risk_volatility_annual: r.risk_volatility_annual ?? null,
    risk_sharpe: r.risk_sharpe ?? null,
    risk_sortino: r.risk_sortino ?? null,
    risk_max_drawdown: r.risk_max_drawdown ?? null,
    risk_var_95_hist: r.risk_var_95_hist ?? null,
    risk_var_99_hist: r.risk_var_99_hist ?? null,
    risk_var_95_param: r.risk_var_95_param ?? null,
    risk_var_99_param: r.risk_var_99_param ?? null,
    risk_cvar_95: r.risk_cvar_95 ?? null,
    risk_beta: r.risk_beta ?? null,
    risk_summary_score: r.risk_summary_score ?? null,
  }));
}

/** Same Supabase user object App.tsx holds — single source of truth (no duplicate getSession/getUser race). */
export type AdminDashboardSessionUser = {
  id: string;
  email?: string | null;
  user_metadata?: { full_name?: string };
};

type AdminDashboardProps = {
  sessionUser: AdminDashboardSessionUser | null;
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ sessionUser }) => {
  const currentUser = sessionUser;
  const [users, setUsers] = useState<UserMetadata[]>([]);
  /** User-registry fetch only — start false so we never block the whole panel on `getUser` / Web Locks. */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // Market Data State
  const [selectedMarket, setSelectedMarket] = useState('SP500');
  const [uploadingMarket, setUploadingMarket] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);
  const [dailyWatchlistSymbols, setDailyWatchlistSymbols] = useState('');
  const [todayWatchlist, setTodayWatchlist] = useState<string[]>([]);
  const [todayWatchlistLabel, setTodayWatchlistLabel] = useState<string>('');
  const [dailyWatchlistTableMissing, setDailyWatchlistTableMissing] = useState(false);
  const [allWatchlists, setAllWatchlists] = useState<DailyWatchlist[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>('');
  const [selectedWatchlistItems, setSelectedWatchlistItems] = useState<DailyWatchlistItem[]>([]);
  const [loadingWatchlistHistory, setLoadingWatchlistHistory] = useState(false);
  /** After a successful save, trigger a browser download of the watchlist as CSV (optional). */
  const [downloadWatchlistCsvAfterSave, setDownloadWatchlistCsvAfterSave] = useState(false);
  /** POST to Watchlist API: write CSV bundles + symbols.txt on the API host (same machine as `npm run watchlist-api`). */
  const [saveWatchlistToApiFoldersAfterSave, setSaveWatchlistToApiFoldersAfterSave] = useState(false);
  /** Payload for the explicit “Download CSV” button (last successful save this session). */
  const [lastSavedWatchlistExport, setLastSavedWatchlistExport] = useState<{
    snapshotItems?: DailyWatchlistItem[];
    symbols: string[];
    startedAtIso: string;
  } | null>(null);

  // Create short list from company list (SP500 via FastAPI) and save to daily watchlist
  const [watchlistApiUrl, setWatchlistApiUrl] = useState(() => getDefaultWatchlistApiBase());
  const [shortListLimit, setShortListLimit] = useState(50);
  const [loadedShortList, setLoadedShortList] = useState<AdminLoadedShortListRow[]>([]);
  const [loadingShortList, setLoadingShortList] = useState(false);
  const [loadingYahooData, setLoadingYahooData] = useState(false);
  const [savingShortListToDaily, setSavingShortListToDaily] = useState(false);
  const [preparingWatchlistOfToday, setPreparingWatchlistOfToday] = useState(false);
  const [exportingWatchlistToFolder, setExportingWatchlistToFolder] = useState(false);
  /** After “Prepare full S&P”, Yahoo fetch / save / export use every row in the table (ignores dev speed cap). */
  const [ignoreAdminWatchlistCap, setIgnoreAdminWatchlistCap] = useState(false);
  const [companyStatementsTicker, setCompanyStatementsTicker] = useState<string | null>(null);
  const [companyStatementsData, setCompanyStatementsData] = useState<{
    balance_sheet: { index: unknown[]; columns: unknown[]; data: unknown[][] } | null;
    income_statement: { index: unknown[]; columns: unknown[]; data: unknown[][] } | null;
    cash_flow: { index: unknown[]; columns: unknown[]; data: unknown[][] } | null;
  } | null>(null);
  const [loadingStatements, setLoadingStatements] = useState(false);

  /** Forex: refresh OHLC CSVs + HMM “Forex Sentinel Alpha” (Watchlist API must run backend with hmmlearn). */
  const [adminForexPair, setAdminForexPair] = useState('EURUSD');
  const [adminForexCurrency, setAdminForexCurrency] = useState('');
  const [forexRefreshBusy, setForexRefreshBusy] = useState(false);
  const [forexSentinelBusy, setForexSentinelBusy] = useState(false);
  const [forexSentinelObs, setForexSentinelObs] = useState<Record<string, unknown> | null>(null);
  const [forexSentinelInsight, setForexSentinelInsight] = useState<InsightResponse | null>(null);
  const [savingForexWatchlist, setSavingForexWatchlist] = useState(false);

  /** Writes under dirs configured in repo-root `.env` read by Python (SMARTINVEST_WATCHLIST_CSV_DIR, ALPACA_WATCHLIST_EXPORT_DIR). */
  const maybeSaveWatchlistToApiFolders = async (
    snapshotItems: DailyWatchlistItem[] | undefined,
    symbolList: string[],
    startedAtIso: string
  ): Promise<boolean> => {
    if (!saveWatchlistToApiFoldersAfterSave) return false;
    const base = watchlistApiUrl.replace(/\/$/, '');
    const watchlistDate = localCalendarDateStamp(new Date(startedAtIso));
    const symbols = symbolList.map((s) => String(s).toUpperCase().trim()).filter(Boolean);
    const items = snapshotItems && snapshotItems.length > 0 ? snapshotItems : undefined;
    await postWatchlistSnapshotCsvBundles(base, {
      started_at_iso: startedAtIso,
      csv_stamp: watchlistFileStampLocal(startedAtIso),
      items,
      symbols: items ? undefined : symbols,
      watchlist_date: watchlistDate,
    });
    await exportWatchlistToLocalDir(base, symbols, watchlistDate);
    return true;
  };

  /** Optional browser-only CSV download after save (off by default). Does not affect Supabase cloud storage. */
  const maybeDownloadWatchlistCsv = (
    snapshotItems: DailyWatchlistItem[] | undefined,
    symbolList: string[],
    startedAtIso: string
  ) => {
    if (!downloadWatchlistCsvAfterSave) return;
    const base = watchlistCsvFilenameBase(startedAtIso);
    if (snapshotItems && snapshotItems.length > 0) {
      downloadWatchlistSnapshotCsv(snapshotItems, base);
      return;
    }
    if (symbolList.length > 0) {
      downloadWatchlistSymbolsOnlyCsv(symbolList, localCalendarDateStamp(new Date(startedAtIso)), base);
    }
  };

  const downloadLastSavedWatchlistCsv = () => {
    if (!lastSavedWatchlistExport) return;
    const { snapshotItems, symbols, startedAtIso } = lastSavedWatchlistExport;
    const base = watchlistCsvFilenameBase(startedAtIso);
    if (snapshotItems && snapshotItems.length > 0) {
      downloadWatchlistSnapshotCsv(snapshotItems, base);
    } else if (symbols.length > 0) {
      downloadWatchlistSymbolsOnlyCsv(symbols, localCalendarDateStamp(new Date(startedAtIso)), base);
    }
  };

  const exportWatchlistCsvToChosenFolder = async () => {
    setExportingWatchlistToFolder(true);
    setError(null);
    try {
      if (!canSaveWatchlistToChosenFolder()) {
        showFeedback(
          'Your browser does not support picking a save folder (use Chrome or Edge, or use Download CSV).',
        );
        return;
      }
      let snapshotItems: DailyWatchlistItem[] | undefined;
      let symbols: string[] = [];
      let startedAtIso = new Date().toISOString();

      if (loadedShortList.length > 0) {
        const { rows } = applyWatchlistCap<AdminLoadedShortListRow>(loadedShortList, {
          ignoreAdminCap: ignoreAdminWatchlistCap,
        });
        snapshotItems = loadedShortRowsToDailySnapshotItems(rows);
        symbols = rows.map((r) => r.ticker).filter(Boolean);
      } else if (lastSavedWatchlistExport) {
        ({ snapshotItems, symbols, startedAtIso } = lastSavedWatchlistExport);
      } else {
        showFeedback('Load a list in the table (or save a watchlist once) before exporting to a folder.');
        return;
      }

      const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
      if (!picker) return;
      const dirHandle = await picker.call(window, { mode: 'readwrite' });
      const base = watchlistCsvFilenameBase(startedAtIso);
      const filename = `${base}.csv`;
      if (snapshotItems && snapshotItems.length > 0) {
        await writeBlobToChosenDirectory(dirHandle, filename, watchlistSnapshotCsvBlob(snapshotItems));
      } else if (symbols.length > 0) {
        const watchlistDate = localCalendarDateStamp(new Date(startedAtIso));
        await writeBlobToChosenDirectory(dirHandle, filename, watchlistSymbolsOnlyCsvBlob(symbols, watchlistDate));
      } else {
        showFeedback('Nothing to export.');
        return;
      }
      showFeedback(`Saved ${filename} to the folder you chose.`);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'AbortError') return;
      setError(getErrorMessage(e));
    } finally {
      setExportingWatchlistToFolder(false);
    }
  };

  const getErrorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    return err != null ? String(err) : 'Unknown error';
  };

  const watchlistApiError = (err: unknown, url: string): string => {
    const msg = getErrorMessage(err);
    /** One short message — do not append to Vite’s long 503 JSON `detail` (would duplicate instructions). */
    if (/Watchlist API error 503/i.test(msg) || /not running on port/i.test(msg)) {
      return (
        'Watchlist API is not running (nothing listening for the Vite proxy). ' +
        'Terminal: npm run watchlist-api:setup once, then npm run watchlist-api — or npm run dev:all. ' +
        'If not port 8000, set WATCHLIST_API_PORT in .env and restart npm run dev. ' +
        'Without Python: Import snapshot (.json) below, then Save watchlist of today.'
      );
    }
    if (/failed to fetch|network error|load failed|connection refused|err_connection_refused/i.test(msg) || msg === 'Failed to fetch') {
      return `Cannot reach the Watchlist API (${url}). Use npm run dev:all (Vite + API), or npm run watchlist-api in another terminal (npm run watchlist-api:setup once). Docker: npm run watchlist-api:docker. Check: curl http://127.0.0.1:8000/api/health`;
    }
    return msg || 'Request failed.';
  };

  const buildSnapshotFromTableOrLastSave = (): ReturnType<typeof buildWatchlistSnapshotFile> | null => {
    if (loadedShortList.length > 0) {
      const { rows } = applyWatchlistCap<AdminLoadedShortListRow>(loadedShortList, {
        ignoreAdminCap: ignoreAdminWatchlistCap,
      });
      const symbols = rows.map((r) => r.ticker).filter(Boolean);
      const items = loadedShortRowsToDailySnapshotItems(rows);
      return buildWatchlistSnapshotFile({
        symbols,
        items,
        watchlist_date: localCalendarDateStamp(),
        label: todayWatchlistLabel || undefined,
      });
    }
    if (lastSavedWatchlistExport?.symbols?.length) {
      const { symbols, snapshotItems, startedAtIso } = lastSavedWatchlistExport;
      return buildWatchlistSnapshotFile({
        symbols,
        items: snapshotItems,
        watchlist_date: localCalendarDateStamp(new Date(startedAtIso)),
      });
    }
    return null;
  };

  const exportWatchlistSnapshotJsonFile = () => {
    const snap = buildSnapshotFromTableOrLastSave();
    if (!snap) {
      showFeedback('Load a list (Prepare, or Import snapshot), or save once — then export JSON.');
      return;
    }
    const date = snap.watchlist_date || localCalendarDateStamp();
    downloadWatchlistSnapshotJson(`watchlist-snapshot-${date}.json`, snap);
    try {
      localStorage.setItem(WATCHLIST_SNAPSHOT_STORAGE_KEY, JSON.stringify(snap));
    } catch {
      /* ignore quota */
    }
    showFeedback('Snapshot JSON downloaded (also cached in this browser for quick reload). Share the file; recipients Import, then Save to Supabase.');
  };

  const rememberWatchlistSnapshotLocal = () => {
    const snap = buildSnapshotFromTableOrLastSave();
    if (!snap) {
      showFeedback('Nothing to save — load a list or import a snapshot first.');
      return;
    }
    try {
      localStorage.setItem(WATCHLIST_SNAPSHOT_STORAGE_KEY, JSON.stringify(snap));
      showFeedback('Snapshot stored in this browser only. Use “Load cached snapshot” on this machine to restore.');
    } catch {
      showFeedback('Could not write to local storage (quota or private mode). Use Download snapshot instead.');
    }
  };

  const loadCachedWatchlistSnapshot = () => {
    setError(null);
    try {
      const raw = localStorage.getItem(WATCHLIST_SNAPSHOT_STORAGE_KEY);
      if (!raw?.trim()) {
        showFeedback('No cached snapshot — Download or Remember first.');
        return;
      }
      const parsed = parseWatchlistSnapshotJson(raw);
      const rows = snapshotToLoadedRows(parsed) as AdminLoadedShortListRow[];
      setLoadedShortList(rows);
      setIgnoreAdminWatchlistCap(false);
      showFeedback(`Loaded ${rows.length} tickers from browser cache. Click Save watchlist of today to publish.`);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  const importWatchlistSnapshotFromFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseWatchlistSnapshotJson(text);
      const rows = snapshotToLoadedRows(parsed) as AdminLoadedShortListRow[];
      setLoadedShortList(rows);
      setIgnoreAdminWatchlistCap(false);
      try {
        localStorage.setItem(WATCHLIST_SNAPSHOT_STORAGE_KEY, text.trim());
      } catch {
        /* ignore */
      }
      showFeedback(
        `Imported ${rows.length} ticker${rows.length === 1 ? '' : 's'}${parsed.label ? ` · ${parsed.label}` : ''}. Save watchlist of today publishes to Supabase for all users.`,
      );
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };


  /** True only when the table truly does not exist — do not match RLS messages that mention daily_watchlist. */
  const isDailyWatchlistTableMissingError = (msg: string): boolean =>
    /schema cache|could not find the table|relation\s+"public\.daily_watchlist"\s+does not exist|relation\s+daily_watchlist\s+does not exist/i.test(
      msg
    );

  const refreshWatchlistsFromServer = useCallback(async () => {
    setLoadingWatchlistHistory(true);
    try {
      const w = await getDailyWatchlist();
      if (w) {
        setTodayWatchlist(w.symbols);
        setTodayWatchlistLabel(w.label || buildWatchlistLabel(w.watchlist_date, w.created_at));
      } else {
        setTodayWatchlist([]);
        setTodayWatchlistLabel('');
      }
      const all = await getAllDailyWatchlists();
      setAllWatchlists(all);
      const firstId = all[0]?.id ? String(all[0].id) : '';
      setSelectedWatchlistId((prev) => {
        const prevStr = prev ? String(prev) : '';
        if (prevStr && all.some((x) => String(x.id) === prevStr)) return prevStr;
        return firstId;
      });
    } catch (e: unknown) {
      console.warn('AdminDashboard: refreshWatchlistsFromServer', e);
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === 'object' && 'message' in e && typeof (e as { message?: unknown }).message === 'string'
            ? (e as { message: string }).message
            : e != null
              ? String(e)
              : 'Unknown error';
      setError((prev) => prev ?? msg);
    } finally {
      setLoadingWatchlistHistory(false);
    }
  }, []);

  // Company fundamentals (admin-only)
  const [companyFundamentals, setCompanyFundamentals] = useState<CompanyFundamental[]>([]);
  const [fundamentalsLoading, setFundamentalsLoading] = useState(false);
  const [companyFundamentalsTableMissing, setCompanyFundamentalsTableMissing] = useState(false);
  const [fundamentalsFetchError, setFundamentalsFetchError] = useState<string | null>(null);
  const [fundamentalsSearch, setFundamentalsSearch] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [editFundamental, setEditFundamental] = useState<CompanyFundamental | null>(null);
  const [showFundamentalModal, setShowFundamentalModal] = useState(false);
  const [fundamentalForm, setFundamentalForm] = useState<CompanyFundamental>({
    ticker: '',
    company: '',
    sector: '',
    location: '',
    industry: '',
    website: '',
  });

  useEffect(() => {
    const loadTodayWatchlist = async () => {
      const { error } = await supabase.from('daily_watchlist').select('id').limit(1);
      if (error) {
        if (isDailyWatchlistTableMissingError(error.message || '')) {
          setDailyWatchlistTableMissing(true);
          return;
        }
      }
      setDailyWatchlistTableMissing(false);
      await refreshWatchlistsFromServer();
    };
    loadTodayWatchlist();
  }, [preparingWatchlistOfToday, savingShortListToDaily, refreshWatchlistsFromServer]);

  useEffect(() => {
    const loadSelectedWatchlist = async () => {
      if (!selectedWatchlistId) {
        setSelectedWatchlistItems([]);
        return;
      }
      const sid = String(selectedWatchlistId);
      const selected = allWatchlists.find((w) => String(w.id) === sid);
      if (!selected) {
        setSelectedWatchlistItems([]);
        return;
      }
      setLoadingWatchlistHistory(true);
      try {
        const items = await getDailyWatchlistItems(selected.id, selected.watchlist_date);
        setSelectedWatchlistItems(items);
      } catch (err: unknown) {
        console.warn('AdminDashboard: loadSelectedWatchlist', err);
        setSelectedWatchlistItems([]);
      } finally {
        setLoadingWatchlistHistory(false);
      }
    };
    loadSelectedWatchlist();
  }, [selectedWatchlistId, allWatchlists]);

  const fetchCompanyFundamentals = async () => {
    setFundamentalsLoading(true);
    setCompanyFundamentalsTableMissing(false);
    setFundamentalsFetchError(null);
    try {
      const data = await getCompanyFundamentals({
        limit: 500,
        search: fundamentalsSearch || undefined,
      });
      setCompanyFundamentals(data);
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (/schema cache|could not find the table|relation.*does not exist|company_fundamentals/i.test(msg)) {
        setCompanyFundamentalsTableMissing(true);
        setCompanyFundamentals([]);
      } else {
        setFundamentalsFetchError(msg || 'Failed to load company fundamentals.');
      }
    } finally {
      setFundamentalsLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionUser?.id) return;
    fetchCompanyFundamentals();
  }, [sessionUser?.id]);

  const fetchUsers = async (forceRefresh = false) => {
    if (forceRefresh) setIsSyncing(true);
    setLoading(true);
    setError(null);
    try {
      let data = await getAllUsers();
      if (data.length === 0 && currentUser) {
        await initializeUser(
          currentUser.id,
          currentUser.email ?? null,
          currentUser.user_metadata?.full_name ?? currentUser.email?.split('@')[0] ?? null
        );
        data = await getAllUsers();
      }
      setUsers(data);
    } catch (err: any) {
      console.error("AdminDashboard: Access Error:", err);
      let errorMessage = "Access Denied.";
      if (err.code === 'permission-denied') {
        errorMessage = `Security Policy Restriction: Access for ${currentUser?.email} was rejected by Cloud Rules.`;
      } else {
        errorMessage = err.message || "An internal error occurred during data retrieval.";
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!sessionUser?.id) return;
    void fetchUsers();
  }, [sessionUser?.id]);

  // Exclude current user from the list so admin only sees other users
  const otherUsers = users.filter((u) => u.uid !== currentUser?.id);

  const showFeedback = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  // --- Market Data Upload Logic ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const processMarketUpload = async () => {
    if (!file) return alert('Please select a file first.');
    setUploadingMarket(true);
    setError(null);
    try {
      const lower = file.name.toLowerCase();
      let assets: MarketAssetRow[] = [];
      let sp500TableRows: AdminLoadedShortListRow[] | null = null;
      let jsonSnapshotText: string | null = null;

      if (lower.endsWith('.json')) {
        if (selectedMarket !== 'SP500') {
          throw new Error('JSON watchlist snapshots are only supported when Target Database is S&P 500.');
        }
        const text = await file.text();
        jsonSnapshotText = text;
        const parsed = parseWatchlistSnapshotJson(text);
        sp500TableRows = snapshotToLoadedRows(parsed) as AdminLoadedShortListRow[];
        assets = sp500TableRows.map((r) => {
          const sym = String(r.ticker || '').toUpperCase().trim();
          const nm = (r.short_name || r.company || sym).trim() || sym;
          return { symbol: sym, name: nm };
        });
      } else if (lower.endsWith('.csv')) {
        if (selectedMarket !== 'SP500') {
          throw new Error('CSV ticker lists are only supported when Target Database is S&P 500.');
        }
        const text = await file.text();
        assets = parseTickerListCsv(text);
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
        assets = parseExcelSheetToMarketAssets(jsonData);
      } else {
        throw new Error(
          `Unsupported file type. Use .xlsx or .xls${selectedMarket === 'SP500' ? ', .csv (tickers), or .json (watchlist snapshot).' : '.'}`
        );
      }

      if (assets.length === 0) {
        throw new Error(
          lower.endsWith('.csv')
            ? 'No tickers found. Use one symbol per line or Symbol,Name columns.'
            : lower.endsWith('.json')
              ? 'Snapshot had no symbols.'
              : 'No valid rows. Ensure a Symbol/Ticker column (Name optional).'
        );
      }

      console.log(`Uploading ${assets.length} entries to ${selectedMarket}...`);
      await batchUploadMarketData(selectedMarket, assets);

      if (selectedMarket === 'SP500') {
        if (sp500TableRows) {
          setLoadedShortList(sp500TableRows);
          if (jsonSnapshotText) {
            try {
              localStorage.setItem(WATCHLIST_SNAPSHOT_STORAGE_KEY, jsonSnapshotText.trim());
            } catch {
              /* quota */
            }
          }
        } else {
          setLoadedShortList(
            assets.map((a) => ({
              ticker: a.symbol,
              company: a.name !== a.symbol ? a.name : undefined,
              short_name: a.name !== a.symbol ? a.name : undefined,
            }))
          );
        }
        setIgnoreAdminWatchlistCap(false);
        showFeedback(
          `Uploaded ${assets.length} symbols to S&P 500 — table updated below. Fetch Yahoo data, then Save watchlist of today if needed.`
        );
      } else {
        showFeedback(`Successfully uploaded ${assets.length} assets to ${selectedMarket} database.`);
      }

      setFile(null);
      const fileInput = document.getElementById('excel-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (err: unknown) {
      console.error('Upload failed', err);
      setError('Upload Failed: ' + getErrorMessage(err));
    } finally {
      setUploadingMarket(false);
    }
  };


  // --- User Management Logic ---

  const handleToggleStatus = async (uid: string, currentStatus: string) => {
    if (uid === currentUser?.id) return alert("You cannot suspend yourself.");
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      await updateUserStatus(uid, newStatus as 'active' | 'disabled');
      setUsers(users.map(u => u.uid === uid ? { ...u, status: newStatus as 'active' | 'disabled' } : u));
      showFeedback(newStatus === 'disabled' ? "User suspended." : "User activated.");
    } catch (err: any) {
      setError("Failed to update status: " + err.message);
    }
  };

  const handleRoleChange = async (uid: string, currentRole: string) => {
    if (uid === currentUser?.id) return alert("System Integrity Check: Self-role modification is disabled for security.");
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await updateUserRole(uid, newRole as 'user' | 'admin');
      setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole as 'user' | 'admin' } : u));
      showFeedback(`User role escalated to ${newRole.toUpperCase()}`);
    } catch (err: any) {
      setError("Role modification failed: " + err.message);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (uid === currentUser?.id) return alert("You cannot delete yourself.");
    if (!window.confirm("Permanently delete this user? They will be removed from the system and must sign up again to use the app. This cannot be undone.")) return;

    try {
      const result = await deleteUserFully(uid);
      setUsers(users.filter(u => u.uid !== uid));
      showFeedback(
        result.permanent !== false
          ? "User deleted. They must sign up again to use the app."
          : "User removed from list. They can still sign in until the delete-user Edge Function is reachable (check VITE_SUPABASE_URL and deploy the function)."
      );
    } catch (err: any) {
      setError("Delete failed: " + (err?.message ?? String(err)));
    }
  };

  /** Create or update watchlist of the day — only manager can create; all users can see it. */
  const handleCreateWatchlistOfToday = async () => {
    if (!currentUser?.id) return;
    let symbols = dailyWatchlistSymbols.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) {
      setError("Enter at least one symbol (comma or newline separated).");
      return;
    }
    const capSym = getWatchlistTickerCap();
    const symBefore = symbols.length;
    if (capSym && symbols.length > capSym) symbols = symbols.slice(0, capSym);
    setCreatingWatchlist(true);
    setError(null);
    const startedAtIso = new Date().toISOString();
    try {
      await createOrUpdateDailyWatchlist(currentUser.id, symbols, startedAtIso);
      setTodayWatchlist(symbols.map(s => s.toUpperCase()));
      setTodayWatchlistLabel(buildWatchlistLabel(localCalendarDateStamp(), startedAtIso));
      setDailyWatchlistSymbols('');
      const upper = symbols.map((s) => s.toUpperCase());
      setLastSavedWatchlistExport({ symbols: upper, startedAtIso });
      maybeDownloadWatchlistCsv(undefined, upper, startedAtIso);
      let folderNote = '';
      try {
        if (await maybeSaveWatchlistToApiFolders(undefined, upper, startedAtIso)) {
          folderNote = ' Also wrote CSV bundles + symbols.txt on the Watchlist API host.';
        }
      } catch (fe: unknown) {
        setError(`Saved to Supabase. API folder export failed: ${getErrorMessage(fe)}`);
      }
      showFeedback(
        `Today's watchlist saved (${symbols.length}${capSym && symBefore > capSym ? ` of ${symBefore} entered` : ''}). Everyone signed in will see it in Trading Platform, Portfolio, and AI Analysis (stored in Supabase).${folderNote}${
          capSym && symBefore > capSym
            ? ` Capped at ${capSym} tickers for speed (set VITE_ADMIN_WATCHLIST_MAX_TICKERS or use production build for full list).`
            : ''
        }`
      );
      await refreshWatchlistsFromServer();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Watchlist creation failed.");
    } finally {
      setCreatingWatchlist(false);
    }
  };

  // --- Company fundamentals (admin-only) ---
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

  const handleUploadCsv = async () => {
    if (!csvFile) return;
    setUploadingCsv(true);
    setError(null);
    try {
      const text = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsText(csvFile);
      });
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');
      const header = parseCsvLine(lines[0]);
      const rows = lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const row: Record<string, string> = {};
        header.forEach((h, i) => {
          row[h] = values[i] ?? '';
        });
        return row;
      });
      const records: CompanyFundamental[] = rows.map((r) => ({
        ticker: (r.Ticker || '').trim(),
        company: (r.Company || '').trim(),
        sector: (r.Sector || '').trim(),
        location: (r.Location || '').trim(),
        industry: (r.Industry || '').trim(),
        website: (r.Website || '').trim(),
      })).filter((r) => r.ticker);
      await upsertCompanyFundamentals(records);
      setCsvFile(null);
      const fileInput = document.getElementById('csv-fundamentals-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      showFeedback(`Uploaded ${records.length} company fundamentals.`);
      fetchCompanyFundamentals();
    } catch (err: any) {
      setError(err?.message ?? 'CSV upload failed.');
    } finally {
      setUploadingCsv(false);
    }
  };

  const handleSaveFundamental = async () => {
    const { ticker, company, sector, location, industry, website } = fundamentalForm;
    if (!ticker.trim()) {
      setError('Ticker is required.');
      return;
    }
    setError(null);
    try {
      if (editFundamental) {
        await updateCompanyFundamental(editFundamental.ticker, { company, sector, location, industry, website });
        showFeedback('Company fundamental updated.');
      } else {
        await upsertCompanyFundamentals([{ ticker: ticker.trim(), company, sector, location, industry, website }]);
        showFeedback('Company fundamental added.');
      }
      setShowFundamentalModal(false);
      setEditFundamental(null);
      setFundamentalForm({ ticker: '', company: '', sector: '', location: '', industry: '', website: '' });
      fetchCompanyFundamentals();
    } catch (err: any) {
      setError(err?.message ?? 'Save failed.');
    }
  };

  const handleDeleteFundamental = async (ticker: string) => {
    if (!window.confirm(`Delete company fundamental "${ticker}"?`)) return;
    try {
      await deleteCompanyFundamental(ticker);
      showFeedback('Company fundamental deleted.');
      if (editFundamental?.ticker === ticker) {
        setShowFundamentalModal(false);
        setEditFundamental(null);
        setFundamentalForm({ ticker: '', company: '', sector: '', location: '', industry: '', website: '' });
      }
      fetchCompanyFundamentals();
    } catch (err: any) {
      setError(err?.message ?? 'Delete failed.');
    }
  };

  const loadSp500FromApi = async () => {
    setLoadingShortList(true);
    setError(null);
    try {
      const res = await fetchWatchlistApi(watchlistApiUrl, sp500ListQuery(shortListLimit));
      const data = await readWatchlistJson<unknown[]>(res);
      const mapped = (data || []).map((r: { ticker: string; company?: string }) => ({ ticker: r.ticker, company: r.company }));
      setIgnoreAdminWatchlistCap(false);
      const { rows: cappedList, capped, before } = applyWatchlistCap(mapped);
      setLoadedShortList(cappedList);
      const cap = getWatchlistTickerCap();
      showFeedback(
        `Loaded ${cappedList.length} ticker${cappedList.length === 1 ? '' : 's'} from SP500 list.${capped && cap ? ` (Capped at ${cap} of ${before} for speed — adjust VITE_ADMIN_WATCHLIST_MAX_TICKERS or production build.)` : ''}`
      );
    } catch (err: unknown) {
      setError(watchlistApiError(err, watchlistApiUrl));
      setLoadedShortList([]);
    } finally {
      setLoadingShortList(false);
    }
  };

  const fetchYahooDataForShortList = async () => {
    if (loadedShortList.length === 0) return;
    setLoadingYahooData(true);
    setError(null);
    try {
      const { rows: yahooRows } = applyWatchlistCap(loadedShortList, {
        ignoreAdminCap: ignoreAdminWatchlistCap,
      });
      let data = (await fetchFinancialsBatchChunked(
        watchlistApiUrl,
        yahooRows.map((r) => r.ticker)
      )) as unknown[];
      const byTicker: Record<string, {
        current_price?: number; sector?: string; short_name?: string;
        total_assets?: number | null; total_liabilities?: number | null;
        total_revenue?: number | null; net_income?: number | null;
        operating_cash_flow?: number | null; free_cash_flow?: number | null;
        iv_dcf?: number | null; iv_ri?: number | null; iv_multiples?: number | null;
        iv_quality_score?: number | null; iv_ensemble?: number | null; iv_upside_pct?: number | null;
        torchlight_score?: number | null; torchlight_rank_factors?: string;
        ctr_total_return?: number | null; ctr_annualized?: number | null;
        risk_daily_return_mean?: number | null; risk_volatility_daily?: number | null; risk_volatility_annual?: number | null;
        risk_sharpe?: number | null; risk_sortino?: number | null; risk_max_drawdown?: number | null;
        risk_var_95_hist?: number | null; risk_var_99_hist?: number | null; risk_var_95_param?: number | null; risk_var_99_param?: number | null;
        risk_cvar_95?: number | null; risk_beta?: number | null; risk_summary_score?: number | null;
      }> = {};
      (data || []).forEach((r: Record<string, unknown>) => {
        const t = String(r.ticker || '').toUpperCase();
        if (!t) return;
        byTicker[t] = {
          current_price: typeof r.current_price === 'number' ? r.current_price : undefined,
          sector: typeof r.sector === 'string' ? r.sector : undefined,
          short_name: typeof r.short_name === 'string' ? r.short_name : undefined,
          total_assets: r.total_assets != null ? Number(r.total_assets) : null,
          total_liabilities: r.total_liabilities != null ? Number(r.total_liabilities) : null,
          total_revenue: r.total_revenue != null ? Number(r.total_revenue) : null,
          net_income: r.net_income != null ? Number(r.net_income) : null,
          operating_cash_flow: r.operating_cash_flow != null ? Number(r.operating_cash_flow) : null,
          free_cash_flow: r.free_cash_flow != null ? Number(r.free_cash_flow) : null,
          iv_dcf: r.iv_dcf != null ? Number(r.iv_dcf) : null,
          iv_ri: r.iv_ri != null ? Number(r.iv_ri) : null,
          iv_multiples: r.iv_multiples != null ? Number(r.iv_multiples) : null,
          iv_quality_score: r.iv_quality_score != null ? Number(r.iv_quality_score) : null,
          iv_ensemble: r.iv_ensemble != null ? Number(r.iv_ensemble) : null,
          iv_upside_pct: r.iv_upside_pct != null ? Number(r.iv_upside_pct) : null,
          torchlight_score: r.torchlight_score != null ? Number(r.torchlight_score) : null,
          torchlight_rank_factors: typeof r.torchlight_rank_factors === 'string' ? r.torchlight_rank_factors : '',
          ctr_total_return: r.ctr_total_return != null ? Number(r.ctr_total_return) : null,
          ctr_annualized: r.ctr_annualized != null ? Number(r.ctr_annualized) : null,
          risk_daily_return_mean: r.risk_daily_return_mean != null ? Number(r.risk_daily_return_mean) : null,
          risk_volatility_daily: r.risk_volatility_daily != null ? Number(r.risk_volatility_daily) : null,
          risk_volatility_annual: r.risk_volatility_annual != null ? Number(r.risk_volatility_annual) : null,
          risk_sharpe: r.risk_sharpe != null ? Number(r.risk_sharpe) : null,
          risk_sortino: r.risk_sortino != null ? Number(r.risk_sortino) : null,
          risk_max_drawdown: r.risk_max_drawdown != null ? Number(r.risk_max_drawdown) : null,
          risk_var_95_hist: r.risk_var_95_hist != null ? Number(r.risk_var_95_hist) : null,
          risk_var_99_hist: r.risk_var_99_hist != null ? Number(r.risk_var_99_hist) : null,
          risk_var_95_param: r.risk_var_95_param != null ? Number(r.risk_var_95_param) : null,
          risk_var_99_param: r.risk_var_99_param != null ? Number(r.risk_var_99_param) : null,
          risk_cvar_95: r.risk_cvar_95 != null ? Number(r.risk_cvar_95) : null,
          risk_beta: r.risk_beta != null ? Number(r.risk_beta) : null,
          risk_summary_score: r.risk_summary_score != null ? Number(r.risk_summary_score) : null,
        };
      });
      data = [];
      setLoadedShortList((prev) =>
        prev.map((r) => {
          const b = byTicker[r.ticker];
          return {
            ...r,
            current_price: b?.current_price ?? r.current_price,
            sector: b?.sector ?? r.sector,
            short_name: b?.short_name ?? r.company,
            total_assets: b?.total_assets,
            total_liabilities: b?.total_liabilities,
            total_revenue: b?.total_revenue,
            net_income: b?.net_income,
            operating_cash_flow: b?.operating_cash_flow,
            free_cash_flow: b?.free_cash_flow,
            iv_dcf: b?.iv_dcf,
            iv_ri: b?.iv_ri,
            iv_multiples: b?.iv_multiples,
            iv_quality_score: b?.iv_quality_score,
            iv_ensemble: b?.iv_ensemble,
            iv_upside_pct: b?.iv_upside_pct,
            torchlight_score: b?.torchlight_score,
            torchlight_rank_factors: b?.torchlight_rank_factors,
            ctr_total_return: b?.ctr_total_return,
            ctr_annualized: b?.ctr_annualized,
            risk_daily_return_mean: b?.risk_daily_return_mean,
            risk_volatility_daily: b?.risk_volatility_daily,
            risk_volatility_annual: b?.risk_volatility_annual,
            risk_sharpe: b?.risk_sharpe,
            risk_sortino: b?.risk_sortino,
            risk_max_drawdown: b?.risk_max_drawdown,
            risk_var_95_hist: b?.risk_var_95_hist,
            risk_var_99_hist: b?.risk_var_99_hist,
            risk_var_95_param: b?.risk_var_95_param,
            risk_var_99_param: b?.risk_var_99_param,
            risk_cvar_95: b?.risk_cvar_95,
            risk_beta: b?.risk_beta,
            risk_summary_score: b?.risk_summary_score,
          };
        })
      );
      showFeedback('Fetched current data from Yahoo Finance.');
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (isDailyWatchlistTableMissingError(msg)) {
        setDailyWatchlistTableMissing(true);
        setError('Watchlist tables are missing from this Supabase project.');
      } else {
        setError(watchlistApiError(err, watchlistApiUrl));
      }
    } finally {
      setLoadingYahooData(false);
    }
  };

  const prepareSp500WatchlistOfToday = async (fullSp500Universe: boolean) => {
    setPreparingWatchlistOfToday(true);
    setIgnoreAdminWatchlistCap(fullSp500Universe);
    setError(null);
    try {
      const apiLimit = resolvePrepareSp500ListLimit(fullSp500Universe, shortListLimit);
      const res = await fetchWatchlistApi(watchlistApiUrl, sp500ListQuery(apiLimit));
      let rawRows = await readWatchlistJson<unknown[]>(res);
      const mappedFull = (rawRows || []).map((r: { ticker: string; company?: string }) => ({
        ticker: r.ticker,
        company: r.company,
      }));
      rawRows = [];
      const { rows: list, capped: listCapped, before: listBefore } = applyWatchlistCap(mappedFull, {
        ignoreAdminCap: fullSp500Universe,
      });
      setLoadedShortList(list);
      if (list.length === 0) {
        setIgnoreAdminWatchlistCap(false);
        showFeedback('API returned 0 tickers. Check Watchlist API uses backend/data/sp500.csv.');
        return;
      }
      let yahooData: unknown[] = [];
      let yahooSkippedMessage: string | null = null;
      try {
        yahooData = (await fetchFinancialsBatchChunked(
          watchlistApiUrl,
          list.map((r) => r.ticker)
        )) as unknown[];
      } catch (e) {
        yahooSkippedMessage = getErrorMessage(e);
      }
      {
        const batchRows = yahooData;
        const byTicker: Record<string, {
          current_price?: number; sector?: string; short_name?: string;
          total_assets?: number | null; total_liabilities?: number | null;
          total_revenue?: number | null; net_income?: number | null;
          operating_cash_flow?: number | null; free_cash_flow?: number | null;
          iv_dcf?: number | null; iv_ri?: number | null; iv_multiples?: number | null;
          iv_quality_score?: number | null; iv_ensemble?: number | null; iv_upside_pct?: number | null;
          torchlight_score?: number | null; torchlight_rank_factors?: string;
          ctr_total_return?: number | null; ctr_annualized?: number | null;
          risk_daily_return_mean?: number | null; risk_volatility_daily?: number | null; risk_volatility_annual?: number | null;
          risk_sharpe?: number | null; risk_sortino?: number | null; risk_max_drawdown?: number | null;
          risk_var_95_hist?: number | null; risk_var_99_hist?: number | null; risk_var_95_param?: number | null; risk_var_99_param?: number | null;
          risk_cvar_95?: number | null; risk_beta?: number | null; risk_summary_score?: number | null;
        }> = {};
        (batchRows || []).forEach((r: Record<string, unknown>) => {
          const t = String(r.ticker || '').toUpperCase();
          if (!t) return;
          byTicker[t] = {
            current_price: typeof r.current_price === 'number' ? r.current_price : undefined,
            sector: typeof r.sector === 'string' ? r.sector : undefined,
            short_name: typeof r.short_name === 'string' ? r.short_name : undefined,
            total_assets: r.total_assets != null ? Number(r.total_assets) : null,
            total_liabilities: r.total_liabilities != null ? Number(r.total_liabilities) : null,
            total_revenue: r.total_revenue != null ? Number(r.total_revenue) : null,
            net_income: r.net_income != null ? Number(r.net_income) : null,
            operating_cash_flow: r.operating_cash_flow != null ? Number(r.operating_cash_flow) : null,
            free_cash_flow: r.free_cash_flow != null ? Number(r.free_cash_flow) : null,
            iv_dcf: r.iv_dcf != null ? Number(r.iv_dcf) : null,
            iv_ri: r.iv_ri != null ? Number(r.iv_ri) : null,
            iv_multiples: r.iv_multiples != null ? Number(r.iv_multiples) : null,
            iv_quality_score: r.iv_quality_score != null ? Number(r.iv_quality_score) : null,
            iv_ensemble: r.iv_ensemble != null ? Number(r.iv_ensemble) : null,
            iv_upside_pct: r.iv_upside_pct != null ? Number(r.iv_upside_pct) : null,
            torchlight_score: r.torchlight_score != null ? Number(r.torchlight_score) : null,
            torchlight_rank_factors: typeof r.torchlight_rank_factors === 'string' ? r.torchlight_rank_factors : '',
            ctr_total_return: r.ctr_total_return != null ? Number(r.ctr_total_return) : null,
            ctr_annualized: r.ctr_annualized != null ? Number(r.ctr_annualized) : null,
            risk_daily_return_mean: r.risk_daily_return_mean != null ? Number(r.risk_daily_return_mean) : null,
            risk_volatility_daily: r.risk_volatility_daily != null ? Number(r.risk_volatility_daily) : null,
            risk_volatility_annual: r.risk_volatility_annual != null ? Number(r.risk_volatility_annual) : null,
            risk_sharpe: r.risk_sharpe != null ? Number(r.risk_sharpe) : null,
            risk_sortino: r.risk_sortino != null ? Number(r.risk_sortino) : null,
            risk_max_drawdown: r.risk_max_drawdown != null ? Number(r.risk_max_drawdown) : null,
            risk_var_95_hist: r.risk_var_95_hist != null ? Number(r.risk_var_95_hist) : null,
            risk_var_99_hist: r.risk_var_99_hist != null ? Number(r.risk_var_99_hist) : null,
            risk_var_95_param: r.risk_var_95_param != null ? Number(r.risk_var_95_param) : null,
            risk_var_99_param: r.risk_var_99_param != null ? Number(r.risk_var_99_param) : null,
            risk_cvar_95: r.risk_cvar_95 != null ? Number(r.risk_cvar_95) : null,
            risk_beta: r.risk_beta != null ? Number(r.risk_beta) : null,
            risk_summary_score: r.risk_summary_score != null ? Number(r.risk_summary_score) : null,
          };
        });
        yahooData.length = 0;
        setLoadedShortList((prev) =>
          prev.map((r) => {
            const b = byTicker[r.ticker];
            return {
              ...r,
              current_price: b?.current_price ?? r.current_price,
              sector: b?.sector ?? r.sector,
              short_name: b?.short_name ?? r.company,
              total_assets: b?.total_assets,
              total_liabilities: b?.total_liabilities,
              total_revenue: b?.total_revenue,
              net_income: b?.net_income,
              operating_cash_flow: b?.operating_cash_flow,
              free_cash_flow: b?.free_cash_flow,
              iv_dcf: b?.iv_dcf,
              iv_ri: b?.iv_ri,
              iv_multiples: b?.iv_multiples,
              iv_quality_score: b?.iv_quality_score,
              iv_ensemble: b?.iv_ensemble,
              iv_upside_pct: b?.iv_upside_pct,
              torchlight_score: b?.torchlight_score,
              torchlight_rank_factors: b?.torchlight_rank_factors,
              ctr_total_return: b?.ctr_total_return,
              ctr_annualized: b?.ctr_annualized,
              risk_daily_return_mean: b?.risk_daily_return_mean,
              risk_volatility_daily: b?.risk_volatility_daily,
              risk_volatility_annual: b?.risk_volatility_annual,
              risk_sharpe: b?.risk_sharpe,
              risk_sortino: b?.risk_sortino,
              risk_max_drawdown: b?.risk_max_drawdown,
              risk_var_95_hist: b?.risk_var_95_hist,
              risk_var_99_hist: b?.risk_var_99_hist,
              risk_var_95_param: b?.risk_var_95_param,
              risk_var_99_param: b?.risk_var_99_param,
              risk_cvar_95: b?.risk_cvar_95,
              risk_beta: b?.risk_beta,
              risk_summary_score: b?.risk_summary_score,
            };
          })
        );
      }
      const symbols = list.map((r) => r.ticker).filter(Boolean);
      const shortYahoo =
        yahooSkippedMessage && yahooSkippedMessage.length > 200
          ? `${yahooSkippedMessage.slice(0, 200)}…`
          : yahooSkippedMessage;
      const cap = getWatchlistTickerCap();
      let doneMsg = yahooSkippedMessage
        ? `Prepared ${symbols.length} tickers in the table (Yahoo metrics missing for some rows: ${shortYahoo}). Click “Save watchlist of today” to publish to Supabase — the save time becomes the snapshot timestamp.`
        : `Prepared ${symbols.length} tickers in the table. Click “Save watchlist of today” to publish to Supabase — the save time becomes the snapshot timestamp.`;
      if (fullSp500Universe) {
        doneMsg += ` Full S&P list from the API (no admin ticker cap); Yahoo may take several minutes for ~500 names.`;
      } else if (listCapped && cap) {
        doneMsg += ` (Processed first ${list.length} of ${listBefore} from API — cap for speed; change VITE_ADMIN_WATCHLIST_MAX_TICKERS or use production build for full S&P.)`;
      }
      showFeedback(doneMsg);
    } catch (err: unknown) {
      setIgnoreAdminWatchlistCap(false);
      const msg = getErrorMessage(err);
      if (isDailyWatchlistTableMissingError(msg)) {
        setDailyWatchlistTableMissing(true);
        setError('Watchlist tables are missing from this Supabase project.');
      } else {
        setError(watchlistApiError(err, watchlistApiUrl));
      }
    } finally {
      setPreparingWatchlistOfToday(false);
    }
  };

  const prepareWatchlistOfToday = () => prepareSp500WatchlistOfToday(false);
  const prepareFullSp500WatchlistOfToday = () => prepareSp500WatchlistOfToday(true);

  const saveShortListToDailyWatchlist = async () => {
    if (loadedShortList.length === 0 || !currentUser?.id) return;
    setSavingShortListToDaily(true);
    setError(null);
    const startedAtIso = new Date().toISOString();
    try {
      const { rows: shortRows, capped: shortCapped, before: shortBefore } = applyWatchlistCap<AdminLoadedShortListRow>(
        loadedShortList,
        { ignoreAdminCap: ignoreAdminWatchlistCap },
      );
      const symbols = shortRows.map((r) => r.ticker).filter(Boolean);
      const snapshotItems = loadedShortRowsToDailySnapshotItems(shortRows);
      await createOrUpdateDailyWatchlist(currentUser.id, symbols, startedAtIso, snapshotItems);
      setTodayWatchlist(symbols.map((s) => s.toUpperCase()));
      setTodayWatchlistLabel(buildWatchlistLabel(localCalendarDateStamp(), startedAtIso));
      const capShort = getWatchlistTickerCap();
      const publishedAt = new Date(startedAtIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      let shortMsg = `Saved ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} · calendar day ${localCalendarDateStamp()} · publish time ${publishedAt} · visible to all signed-in users in Supabase.${
        shortCapped && capShort ? ` (First ${symbols.length} of ${shortBefore} in table — speed cap.)` : ''
      }`;
      setLastSavedWatchlistExport({ snapshotItems, symbols, startedAtIso });
      maybeDownloadWatchlistCsv(snapshotItems, symbols, startedAtIso);
      try {
        if (await maybeSaveWatchlistToApiFolders(snapshotItems, symbols, startedAtIso)) {
          shortMsg += ' Also wrote CSV bundles + symbols.txt on the Watchlist API host.';
        }
      } catch (fe: unknown) {
        setError(`Saved to Supabase. API folder export failed: ${getErrorMessage(fe)}`);
      }
      showFeedback(shortMsg);
      await refreshWatchlistsFromServer();
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (isDailyWatchlistTableMissingError(msg)) {
        setDailyWatchlistTableMissing(true);
        setError('Watchlist tables are missing from this Supabase project.');
      } else {
        setError(msg || 'Failed to save to daily watchlist.');
      }
    } finally {
      setSavingShortListToDaily(false);
    }
  };

  const runAdminForexRefresh = async () => {
    setForexRefreshBusy(true);
    setError(null);
    try {
      const cur = adminForexCurrency.trim().toUpperCase();
      const r = await postForexRefresh(watchlistApiUrl, {
        pair: cur ? undefined : adminForexPair.trim().toUpperCase(),
        currency: cur || undefined,
      });
      const errTail = r.errors.length ? ` Some errors: ${r.errors.slice(0, 3).join('; ')}` : '';
      showFeedback(
        `Forex CSV refresh: ${r.count} pair(s) (${r.refreshed.join(', ') || 'none'}).${errTail} HMM cache cleared for refreshed pairs.`
      );
    } catch (err: unknown) {
      setError(watchlistApiError(err, watchlistApiUrl));
    } finally {
      setForexRefreshBusy(false);
    }
  };

  const loadAdminForexSentinelContext = async () => {
    setForexSentinelBusy(true);
    setForexSentinelInsight(null);
    setError(null);
    try {
      let score = 0;
      let conf = 0;
      try {
        const bundle = await fetchFinnhubCompanyNewsBundle(adminForexPair.trim().toUpperCase());
        if (bundle.status === 'ok' && bundle.articles?.length) {
          conf = Math.min(1, bundle.articles.length / 25);
        }
      } catch {
        /* Finnhub optional */
      }
      const obs = await fetchForexSentinelContext(watchlistApiUrl, adminForexPair, {
        score,
        confidence: conf,
      });
      setForexSentinelObs(obs);
      showFeedback('Forex Sentinel context loaded (HMM + technicals; Finnhub confidence when available).');
    } catch (err: unknown) {
      setForexSentinelObs(null);
      setError(getErrorMessage(err));
    } finally {
      setForexSentinelBusy(false);
    }
  };

  const runAdminForexSentinelLlm = async () => {
    if (!forexSentinelObs) {
      setError('Load Sentinel context first.');
      return;
    }
    setForexSentinelBusy(true);
    setError(null);
    try {
      const insight = await getForexSentinelInsight(forexSentinelObs);
      setForexSentinelInsight(insight);
      showFeedback('Forex Sentinel Alpha (LLM) completed.');
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setForexSentinelBusy(false);
    }
  };

  const saveForexWatchlistSnapshot = async () => {
    if (!currentUser?.id || dailyWatchlistTableMissing) return;
    const pair = adminForexPair.trim().toUpperCase();
    if (!pair) return;
    setSavingForexWatchlist(true);
    setError(null);
    const startedAtIso = new Date().toISOString();
    try {
      const meta = FOREX_TICKERS.find((x) => x.symbol === pair);
      const snapshotItems: DailyWatchlistItem[] = [
        {
          watchlist_date: localCalendarDateStamp(),
          symbol: pair,
          company: meta?.name || pair,
          sector: 'FOREX',
        },
      ];
      await createOrUpdateDailyWatchlist(currentUser.id, [pair], startedAtIso, snapshotItems);
      setTodayWatchlist([pair]);
      setTodayWatchlistLabel(buildWatchlistLabel(localCalendarDateStamp(), startedAtIso));
      let msg = `Saved forex watchlist (${pair}) for all users.`;
      setLastSavedWatchlistExport({ snapshotItems, symbols: [pair], startedAtIso });
      maybeDownloadWatchlistCsv(snapshotItems, [pair], startedAtIso);
      try {
        if (await maybeSaveWatchlistToApiFolders(snapshotItems, [pair], startedAtIso)) {
          msg += ' Also wrote CSV bundles on the API host.';
        }
      } catch (fe: unknown) {
        setError(`Saved to Supabase. API folder export failed: ${getErrorMessage(fe)}`);
      }
      showFeedback(msg);
      await refreshWatchlistsFromServer();
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (isDailyWatchlistTableMissingError(msg)) {
        setDailyWatchlistTableMissing(true);
        setError('Watchlist tables are missing from this Supabase project.');
      } else {
        setError(msg || 'Failed to save forex watchlist.');
      }
    } finally {
      setSavingForexWatchlist(false);
    }
  };

  const openCompanyStatements = async (ticker: string) => {
    setCompanyStatementsTicker(ticker);
    setCompanyStatementsData(null);
    setLoadingStatements(true);
    setError(null);
    try {
      const res = await fetchWatchlistApi(
        watchlistApiUrl,
        `/api/financials/${encodeURIComponent(ticker)}/statements`
      );
      const data = await readWatchlistJson<{
        balance_sheet?: unknown;
        income_statement?: unknown;
        cash_flow?: unknown;
      } | null>(res);
      if (data) {
        setCompanyStatementsData({
          balance_sheet: data.balance_sheet ?? null,
          income_statement: data.income_statement ?? null,
          cash_flow: data.cash_flow ?? null,
        });
      } else {
        setCompanyStatementsData(null);
      }
    } catch (err: unknown) {
      setError(watchlistApiError(err, watchlistApiUrl));
    } finally {
      setLoadingStatements(false);
    }
  };

  const closeCompanyStatements = () => {
    setCompanyStatementsTicker(null);
    setCompanyStatementsData(null);
  };

  const handleWipeRegistry = async () => {
    const uidsToPurge = users.filter(u => u.uid !== currentUser?.id).map(u => u.uid);
    if (uidsToPurge.length === 0) return alert("Registry is already clean (excluding your master account).");

    const firstConfirm = window.confirm(`NUCLEAR OPTION: You are about to purge ${uidsToPurge.length} identity records from Auth and Database. This action is irreversible. Continue?`);
    if (!firstConfirm) return;

    const secondConfirm = window.prompt("To proceed with the total registry wipe, please type: PURGE ALL DATA");
    if (secondConfirm !== "PURGE ALL DATA") return alert("Verification failed. Wipe sequence aborted.");

    setIsPurging(true);
    try {
      for (const uid of uidsToPurge) {
        await deleteUserFully(uid);
      }
      setUsers(users.filter(u => u.uid === currentUser?.id));
      showFeedback("Institutional registry has been purged.");
    } catch (err: any) {
      setError("Bulk purge failed: " + err.message);
    } finally {
      setIsPurging(false);
    }
  };

  const isBusy =
    loading ||
    isSyncing ||
    uploadingMarket ||
    creatingWatchlist ||
    loadingShortList ||
    loadingYahooData ||
    preparingWatchlistOfToday ||
    exportingWatchlistToFolder ||
    savingShortListToDaily ||
    isPurging ||
    fundamentalsLoading ||
    uploadingCsv;

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20 relative">
      {isBusy && (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 py-3 px-4 bg-amber-500 text-amber-950 font-bold text-sm uppercase tracking-widest rounded-b-xl shadow-lg animate-pulse">
          <span className="w-4 h-4 border-2 border-amber-800 border-t-transparent rounded-full animate-spin" aria-hidden />
          System busy — not ready yet. Please wait...
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-900 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5 text-9xl">🛡️</div>
        <div className="relative z-10">
          <h2 className="text-3xl font-black tracking-tight">System Authority</h2>
          <p className="text-slate-400 mt-2 max-w-lg font-medium">Root-level directory for institutional identity management and network oversight.</p>
        </div>
        <div className="relative z-10 mt-6 md:mt-0">
          <button
            onClick={() => fetchUsers(true)}
            disabled={isSyncing}
            className="group flex items-center space-x-3 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all"
          >
            <span className={isSyncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}>🔄</span>
            <span>{isSyncing ? 'Authorizing...' : 'Sync Registry'}</span>
          </button>
        </div>
      </div>

      {loading && users.length === 0 && !error && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm text-indigo-900 font-medium">
          Loading user registry… If this hangs, open the browser console (F12); RLS may block{' '}
          <code className="text-xs">get_all_profiles_for_admin</code> until policies are applied.
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl shadow-xl shadow-rose-900/5">
          <h4 className="font-bold text-rose-900 text-lg">Operation Failed</h4>
          <p className="text-rose-600 text-sm font-medium mt-1">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 p-4 rounded-2xl text-center font-bold text-sm">
          ✓ {success}
        </div>
      )}

      {lastSavedWatchlistExport && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-indigo-50 border border-indigo-100 p-5 rounded-2xl">
          <div>
            <p className="font-bold text-indigo-950 text-sm">Latest watchlist saved</p>
            <p className="text-xs text-indigo-800/80 mt-1">
              Download the same data as CSV (full columns when Yahoo snapshot exists; otherwise symbol + date).{' '}
              <strong>Save to folder</strong> uses Chrome or Edge to write the same CSV into a directory you pick. Other users refresh automatically via live updates; they can also switch tabs or wait up to ~1 min.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={downloadLastSavedWatchlistCsv}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-md"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={exportWatchlistCsvToChosenFolder}
              disabled={exportingWatchlistToFolder}
              className="px-6 py-3 bg-white border border-indigo-200 text-indigo-900 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-50 shadow-sm disabled:opacity-50"
            >
              {exportingWatchlistToFolder ? 'Saving…' : 'Save to folder…'}
            </button>
          </div>
        </div>
      )}

      {/* Primary: publish today’s team watchlist from tickers only (Supabase calendar day = your local date). */}
      <div className="bg-white rounded-3xl border-2 border-indigo-100 shadow-lg shadow-indigo-100/40 p-8 relative overflow-hidden ring-1 ring-indigo-50">
        <div className="absolute top-3 right-4 text-4xl opacity-[0.08] pointer-events-none">📋</div>
        {dailyWatchlistTableMissing && (
          <div className="mb-6 p-6 rounded-2xl bg-amber-50 border border-amber-200">
            <p className="font-bold text-amber-900 text-sm">Watchlist tables are missing.</p>
            <p className="text-amber-800 text-xs mt-2">
              Run <code className="font-mono text-[10px] bg-amber-100 px-1 rounded">supabase-daily-watchlist.sql</code> in the Supabase SQL editor, then reload.
            </p>
          </div>
        )}
        <div className="space-y-4 relative z-10">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Admin · fastest path</p>
            <h3 className="font-bold text-slate-900 text-lg mt-1">Create today&apos;s watchlist</h3>
            <p className="text-sm text-slate-600 mt-2 max-w-3xl">
              Type tickers and save. This writes a new row to <span className="font-semibold">daily_watchlist</span> for{' '}
              <span className="font-mono font-bold text-indigo-800">{localCalendarDateStamp()}</span> (your local calendar day). All signed-in
              users can read it. No Watchlist API is required for this shortcut. For full S&amp;P + Yahoo metrics (IV, Torchlight, etc.), use{' '}
              <span className="font-semibold text-slate-800">Team watchlist · today</span> below.
            </p>
            <label className="mt-3 flex items-start gap-2 cursor-pointer text-xs text-slate-600 select-none max-w-3xl">
              <input
                type="checkbox"
                checked={downloadWatchlistCsvAfterSave}
                onChange={(e) => setDownloadWatchlistCsvAfterSave(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>After saving, also download a CSV in this browser (optional).</span>
            </label>
            <label className="mt-2 flex items-start gap-2 cursor-pointer text-xs text-slate-600 select-none max-w-3xl">
              <input
                type="checkbox"
                checked={saveWatchlistToApiFoldersAfterSave}
                onChange={(e) => setSaveWatchlistToApiFoldersAfterSave(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>
                After saving, also write CSV bundles + symbols.txt on the Watchlist API host (see repo <code className="font-mono text-[11px] bg-slate-100 px-1 rounded">.env</code>).
              </span>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                Symbols (comma or newline separated)
              </label>
              <textarea
                value={dailyWatchlistSymbols}
                onChange={(e) => setDailyWatchlistSymbols(e.target.value)}
                placeholder="e.g. AAPL, MSFT, GOOGL"
                rows={3}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 resize-y min-h-[72px]"
              />
            </div>
            <button
              type="button"
              onClick={handleCreateWatchlistOfToday}
              disabled={creatingWatchlist || !dailyWatchlistSymbols.trim() || dailyWatchlistTableMissing}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {creatingWatchlist ? 'Saving…' : 'Save today’s watchlist'}
            </button>
          </div>
          {todayWatchlist.length > 0 && (
            <div className="text-xs text-slate-600 space-y-2 pt-2 border-t border-slate-100">
              {todayWatchlistLabel && (
                <p className="font-medium">
                  <span className="text-slate-400">Last saved label:</span>{' '}
                  <span className="font-bold text-indigo-700">{todayWatchlistLabel}</span>
                </p>
              )}
              <p className="font-black text-slate-900 text-sm">{todayWatchlist.length} tickers in last publish</p>
              <pre className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] font-mono leading-relaxed text-slate-800 whitespace-pre-wrap break-all">
                {todayWatchlist.join('\n')}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* --- MARKET DATA UPLOAD SECTION --- */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 relative overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-bold text-slate-900 uppercase tracking-widest text-sm">Market Data Ingestion</h3>
            <p className="text-xs text-slate-400 font-bold mt-1">
              Upload files to populate market databases. With <strong className="text-slate-600">S&amp;P 500</strong> you can use Excel, a ticker CSV, or a SmartInvest watchlist JSON snapshot.
            </p>
          </div>
          <div className="text-3xl opacity-20">📊</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end bg-slate-50 p-6 rounded-2xl border border-slate-200/60">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Database</label>
            <select
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
              className="w-full px-5 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
            >
              <option value="SP500">S&P 500</option>
              <option value="NASDAQ">Nasdaq</option>
              <option value="ASIA">Asian Markets</option>
              <option value="CRYPTO">Cryptocurrency</option>
              <option value="COMMODITY">Commodities</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              {selectedMarket === 'SP500' ? 'Source file (.xlsx, .csv, .json)' : 'Source file (.xlsx)'}
            </label>
            <input
              id="excel-upload"
              type="file"
              accept={
                selectedMarket === 'SP500'
                  ? '.xlsx,.xls,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/json'
                  : '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'
              }
              onChange={handleFileChange}
              className="w-full text-xs file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 text-slate-500 font-medium cursor-pointer"
            />
          </div>

          <button
            onClick={processMarketUpload}
            disabled={uploadingMarket || !file}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {uploadingMarket ? 'Ingesting Data...' : 'Process & Upload'}
          </button>
        </div>
        <p className="mt-4 text-[10px] text-slate-400 font-medium italic">
          {selectedMarket === 'SP500' ? (
            <>
              * Excel: Symbol/Ticker column required; Name optional (defaults to ticker). CSV: one ticker per line or{' '}
              <code className="font-mono text-[9px]">SYMBOL,Name</code>. JSON: exported SmartInvest watchlist snapshot (
              <code className="font-mono text-[9px]">smartinvest-watchlist-snapshot-v1</code>
              ).
            </>
          ) : (
            <>* Excel must include a Symbol/Ticker column; Name optional.</>
          )}
        </p>
      </div>

      {/* Prepare full S&P table + Yahoo, then explicit “Save watchlist of today” (timestamp at save) */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 relative overflow-hidden">
        {dailyWatchlistTableMissing && (
          <div className="mb-6 p-6 rounded-2xl bg-amber-50 border border-amber-200">
            <p className="font-bold text-amber-900 text-sm">Watchlist tables are missing.</p>
            <p className="text-amber-800 text-xs mt-2">This app’s Supabase project does not have `daily_watchlist` / `daily_watchlist_items` yet.</p>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <h3 className="font-bold text-slate-900 uppercase tracking-widest text-sm">Team watchlist · today</h3>
            <p className="text-xs text-slate-400 font-bold mt-1">
              <strong>Prepare watchlist of today</strong> requests only the first N names from the S&amp;P CSV (see <em>List size</em>, default 50) so memory and Yahoo batch traffic stay small; then merges Yahoo into the table.{' '}
              <strong>Prepare full S&amp;P</strong> loads the entire CSV and every constituent (slow). <strong>Save watchlist of today</strong> publishes the same Supabase + CSV/JSON formats as before. Financials are fetched in small chunks (default 8 tickers; set{' '}
              <code className="font-mono text-[10px] bg-slate-100 px-1 rounded">VITE_WATCHLIST_FINANCIALS_CHUNK</code> to tune).
            </p>
            {ignoreAdminWatchlistCap ? (
              <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Full-table mode: Fetch Yahoo and Save use all rows currently in the table (ignores Vite dev cap). Use <strong>Prepare</strong> or <strong>Load list only</strong> to return to capped runs.
              </p>
            ) : null}
            <label className="mt-3 flex items-start gap-2 cursor-pointer text-xs text-slate-600 select-none max-w-3xl">
              <input
                type="checkbox"
                checked={downloadWatchlistCsvAfterSave}
                onChange={(e) => setDownloadWatchlistCsvAfterSave(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>
                After saving, also download a CSV in this browser (optional). Team watchlist data lives in Supabase only unless you check this box.
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 cursor-pointer text-xs text-slate-600 select-none max-w-3xl">
              <input
                type="checkbox"
                checked={saveWatchlistToApiFoldersAfterSave}
                onChange={(e) => setSaveWatchlistToApiFoldersAfterSave(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>
                After saving, also write CSV bundles + <code className="font-mono text-[11px] bg-slate-100 px-1 rounded">symbols.txt</code> on the host running the Watchlist API (paths from repo-root <code className="font-mono text-[11px]">.env</code>:{' '}
                <code className="font-mono text-[11px]">SMARTINVEST_WATCHLIST_CSV_DIR</code>,                 <code className="font-mono text-[11px]">ALPACA_WATCHLIST_EXPORT_DIR</code>). Requires API reachable at the URL below.
              </span>
            </label>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3">
              <p className="text-xs font-bold text-slate-800">Share &amp; offline — no Python API required</p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                If you get <span className="font-mono text-slate-700">503</span> / “Watchlist API is not running”, start the server in another terminal:{' '}
                <code className="font-mono text-[10px] bg-white/80 px-1 rounded">npm run watchlist-api:setup</code> once, then{' '}
                <code className="font-mono text-[10px] bg-white/80 px-1 rounded">npm run watchlist-api</code> (or <code className="font-mono text-[10px]">npm run dev:all</code>
                ). Or use this: export a JSON snapshot, share the file, import it here, then click <strong>Save watchlist of today</strong> — that publishes to Supabase for everyone signed in.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={exportWatchlistSnapshotJsonFile}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-[11px] uppercase tracking-wider hover:bg-indigo-700"
                >
                  Download snapshot (.json)
                </button>
                <button
                  type="button"
                  onClick={rememberWatchlistSnapshotLocal}
                  className="px-4 py-2 bg-white border border-indigo-200 text-indigo-800 rounded-lg font-bold text-[11px] uppercase tracking-wider hover:bg-indigo-50"
                >
                  Save in browser
                </button>
                <button
                  type="button"
                  onClick={loadCachedWatchlistSnapshot}
                  className="px-4 py-2 bg-white border border-indigo-200 text-indigo-800 rounded-lg font-bold text-[11px] uppercase tracking-wider hover:bg-indigo-50"
                >
                  Load cached snapshot
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-dashed border-indigo-300 text-indigo-800 rounded-lg font-bold text-[11px] uppercase tracking-wider cursor-pointer hover:bg-indigo-50">
                  Import snapshot (.json)
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      void importWatchlistSnapshotFromFile(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Watchlist API URL</label>
              <input
                type="url"
                value={watchlistApiUrl}
                onChange={(e) => setWatchlistApiUrl(e.target.value.replace(/\/$/, ''))}
                placeholder="/watchlist-api (dev) or http://127.0.0.1:8000"
                className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-mono text-slate-700"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                List size (0 = full CSV on Load only; Prepare uses 50 or env cap when 0)
              </label>
              <input
                type="number"
                min={0}
                max={5000}
                value={shortListLimit}
                onChange={(e) => setShortListLimit(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl font-bold text-slate-700"
              />
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <button
                type="button"
                onClick={() => void prepareWatchlistOfToday()}
                disabled={preparingWatchlistOfToday || dailyWatchlistTableMissing}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 shadow-lg shadow-indigo-200"
              >
                {preparingWatchlistOfToday ? 'Preparing…' : 'Prepare watchlist of today'}
              </button>
              <button
                type="button"
                onClick={() => void prepareFullSp500WatchlistOfToday()}
                disabled={preparingWatchlistOfToday || dailyWatchlistTableMissing}
                className="px-6 py-3 bg-violet-700 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-violet-600 disabled:opacity-50 shadow-lg shadow-violet-200"
              >
                {preparingWatchlistOfToday ? 'Preparing…' : 'Prepare full S&P'}
              </button>
              <button
                type="button"
                onClick={saveShortListToDailyWatchlist}
                disabled={
                  savingShortListToDaily ||
                  loadedShortList.length === 0 ||
                  !currentUser?.id ||
                  dailyWatchlistTableMissing
                }
                className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 shadow-lg shadow-emerald-200"
              >
                {savingShortListToDaily ? 'Saving…' : 'Save watchlist of today'}
              </button>
              <span className="text-[10px] text-slate-400 max-w-md">
                Full CSV → Yahoo → Save (timestamp = click time). <strong>Prepare full S&amp;P</strong> = all constituents, no dev cap.
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadSp500FromApi}
              disabled={loadingShortList}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 disabled:opacity-50"
            >
              {loadingShortList ? 'Loading...' : 'Load list only'}
            </button>
            <button
              type="button"
              onClick={fetchYahooDataForShortList}
              disabled={loadingYahooData || loadedShortList.length === 0}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 disabled:opacity-50"
            >
              {loadingYahooData ? 'Fetching...' : 'Fetch Yahoo data'}
            </button>
            <button
              type="button"
              onClick={saveShortListToDailyWatchlist}
              disabled={savingShortListToDaily || loadedShortList.length === 0 || !currentUser?.id || dailyWatchlistTableMissing}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 disabled:opacity-50"
            >
              {savingShortListToDaily ? 'Saving...' : 'Save watchlist of today'}
            </button>
            <button
              type="button"
              onClick={exportWatchlistCsvToChosenFolder}
              disabled={
                exportingWatchlistToFolder ||
                (loadedShortList.length === 0 && !lastSavedWatchlistExport)
              }
              className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-slate-200 disabled:opacity-50"
              title="Chrome or Edge: pick a folder on your machine and save the same CSV as Download CSV."
            >
              {exportingWatchlistToFolder ? 'Saving…' : 'Save CSV to folder…'}
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200 space-y-4">
            <div>
              <h4 className="font-black text-xs uppercase tracking-widest text-slate-700">Forex · refresh data &amp; Sentinel Alpha</h4>
              <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">
                Step 1: Download/update OHLC CSVs for the chosen pair or for <strong>all pairs</strong> that contain a currency code (updates{' '}
                <code className="font-mono text-[10px] bg-slate-100 px-1 rounded">currency_data/</code> and{' '}
                <code className="font-mono text-[10px] bg-slate-100 px-1 rounded">public/currency_data/</code>, clears HMM cache). Step 2: Load HMM + technical context. Step 3: Run the LLM decision layer (requires{' '}
                <code className="font-mono text-[10px]">VITE_HF_API_TOKEN</code>). Step 4: Publish a one-symbol forex daily watchlist.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Forex pair</label>
                <select
                  value={adminForexPair}
                  onChange={(e) => setAdminForexPair(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
                >
                  {FOREX_TICKERS.map((row) => (
                    <option key={row.symbol} value={row.symbol}>
                      {row.symbol} — {row.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Or currency (optional)
                </label>
                <input
                  type="text"
                  value={adminForexCurrency}
                  onChange={(e) => setAdminForexCurrency(e.target.value.toUpperCase())}
                  placeholder="e.g. EUR — refreshes every pair with EUR"
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 placeholder:text-slate-400"
                  maxLength={3}
                />
              </div>
              <button
                type="button"
                onClick={runAdminForexRefresh}
                disabled={forexRefreshBusy}
                className="px-4 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50"
              >
                {forexRefreshBusy ? 'Refreshing…' : '1 · Refresh OHLC CSVs'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={loadAdminForexSentinelContext}
                disabled={forexSentinelBusy}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50"
              >
                {forexSentinelBusy ? 'Working…' : '2 · Load HMM + technicals'}
              </button>
              <button
                type="button"
                onClick={runAdminForexSentinelLlm}
                disabled={forexSentinelBusy || !forexSentinelObs}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
              >
                3 · Run Forex Sentinel Alpha (LLM)
              </button>
              <button
                type="button"
                onClick={saveForexWatchlistSnapshot}
                disabled={savingForexWatchlist || !currentUser?.id || dailyWatchlistTableMissing}
                className="px-4 py-2 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-700 disabled:opacity-50"
              >
                {savingForexWatchlist ? 'Saving…' : '4 · Save forex watchlist'}
              </button>
            </div>
            {forexSentinelObs && (
              <details className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px]">
                <summary className="cursor-pointer font-black text-slate-600">Sentinel observation JSON</summary>
                <pre className="mt-2 overflow-x-auto text-[10px] text-slate-700 whitespace-pre-wrap break-all">
                  {JSON.stringify(forexSentinelObs, null, 2)}
                </pre>
              </details>
            )}
            {forexSentinelInsight && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-sm space-y-2">
                <p className="font-black text-emerald-900">{forexSentinelInsight.sentiment}</p>
                <p className="text-slate-700">{forexSentinelInsight.summary}</p>
                <p className="text-[11px] text-slate-600">{forexSentinelInsight.recommendation}</p>
              </div>
            )}
          </div>

          {loadedShortList.length > 0 && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Loaded list ({loadedShortList.length}) — Balance sheet, Cash flow, Earnings / Income statement from Yahoo Finance
              </p>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[900px]">
                  <thead className="sticky top-0 bg-slate-100 z-10">
                    <tr>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Ticker</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Name</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Price</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Sector</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Balance sheet — Total Assets</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Balance sheet — Total Liab.</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Income — Revenue</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Earnings — Net Income</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Cash flow — Operating</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Cash flow — Free</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">CTR Total %</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">CTR Ann. %</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Mean Daily %</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Vol Daily %</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Vol Ann. %</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Sharpe</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Sortino</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Max DD %</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">VaR 95% (Hist)</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">VaR 99% (Hist)</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">VaR 95% (Param)</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">VaR 99% (Param)</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">CVaR 95%</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Beta</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Risk Summary (0-100)</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Torchlight (0-100)</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Full statements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadedShortList.map((r) => (
                      <tr key={r.ticker} className="border-t border-slate-200">
                        <td className="p-2 font-mono font-bold text-slate-800">{r.ticker}</td>
                        <td className="p-2 text-slate-600 max-w-[120px] truncate" title={r.short_name || r.company || ''}>{r.short_name || r.company || '—'}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtUsd(r.current_price)}</td>
                        <td className="p-2 text-slate-500">{r.sector || '—'}</td>
                        <td className="p-2 font-mono text-slate-700">{formatStatementNum(r.total_assets)}</td>
                        <td className="p-2 font-mono text-slate-700">{formatStatementNum(r.total_liabilities)}</td>
                        <td className="p-2 font-mono text-slate-700">{formatStatementNum(r.total_revenue)}</td>
                        <td className="p-2 font-mono text-slate-700">{formatStatementNum(r.net_income)}</td>
                        <td className="p-2 font-mono text-slate-700">{formatStatementNum(r.operating_cash_flow)}</td>
                        <td className="p-2 font-mono text-slate-700">{formatStatementNum(r.free_cash_flow)}</td>
                        <td className={`p-2 font-mono font-bold ${(asFiniteNumber(r.ctr_total_return) ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {fmtPct01(r.ctr_total_return, 2)}
                        </td>
                        <td className={`p-2 font-mono font-bold ${(asFiniteNumber(r.ctr_annualized) ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {fmtPct01(r.ctr_annualized, 2)}
                        </td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_daily_return_mean, 3)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_volatility_daily, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_volatility_annual, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtDecimal(r.risk_sharpe, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtDecimal(r.risk_sortino, 2)}</td>
                        <td className={`p-2 font-mono font-bold ${(asFiniteNumber(r.risk_max_drawdown) ?? 0) <= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {fmtPct01(r.risk_max_drawdown, 2)}
                        </td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_var_95_hist, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_var_99_hist, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_var_95_param, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_var_99_param, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtPct01(r.risk_cvar_95, 2)}</td>
                        <td className="p-2 font-mono text-slate-700">{fmtDecimal(r.risk_beta, 2)}</td>
                        <td className="p-2 font-mono font-bold text-slate-700">{fmtDecimal(r.risk_summary_score, 1)}</td>
                        <td className="p-2 font-mono font-bold text-indigo-700">{fmtDecimal(r.torchlight_score, 1)}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => openCompanyStatements(r.ticker)}
                            className="text-indigo-600 font-bold hover:underline text-[10px]"
                          >
                            View all
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modal: company financial statements (balance_sheet, income_statement, cash_flow) */}
          {companyStatementsTicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={closeCompanyStatements}>
              <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                  <h4 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                    {loadedShortList.find((r) => r.ticker === companyStatementsTicker)?.short_name ||
                      loadedShortList.find((r) => r.ticker === companyStatementsTicker)?.company ||
                      companyStatementsTicker}{' '}
                    — balance_sheet, income_statement, cash_flow
                  </h4>
                  <button type="button" onClick={closeCompanyStatements} className="text-slate-500 hover:text-slate-800 font-bold text-lg leading-none">×</button>
                </div>
                <div className="p-4 overflow-y-auto flex-1 space-y-6">
                  {loadingStatements && (
                    <p className="text-slate-500 font-medium">Loading statements…</p>
                  )}
                  {!loadingStatements && companyStatementsData && (
                    <>
                      {companyStatementsData.balance_sheet && (
                        <div>
                          <h5 className="font-bold text-slate-700 uppercase text-xs tracking-widest mb-2">Balance sheet</h5>
                          <StatementTable data={companyStatementsData.balance_sheet} />
                        </div>
                      )}
                      {companyStatementsData.income_statement && (
                        <div>
                          <h5 className="font-bold text-slate-700 uppercase text-xs tracking-widest mb-2">Income statement</h5>
                          <StatementTable data={companyStatementsData.income_statement} />
                        </div>
                      )}
                      {companyStatementsData.cash_flow && (
                        <div>
                          <h5 className="font-bold text-slate-700 uppercase text-xs tracking-widest mb-2">Cash flow</h5>
                          <StatementTable data={companyStatementsData.cash_flow} />
                        </div>
                      )}
                      {!companyStatementsData.balance_sheet && !companyStatementsData.income_statement && !companyStatementsData.cash_flow && (
                        <p className="text-slate-500">No statement data available for this ticker.</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Saved watchlists history (admin can inspect all created watchlists) */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 relative overflow-hidden">
        <div className="space-y-4">
          <div>
            <h3 className="font-bold text-slate-900 uppercase tracking-widest text-sm">Saved watchlists (history)</h3>
            <p className="text-xs text-slate-400 font-bold mt-1">Admin can view the latest watchlist and all previous watchlists created.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select watchlist</label>
              <select
                value={selectedWatchlistId}
                onChange={(e) => setSelectedWatchlistId(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {allWatchlists.length === 0 && <option value="">No saved watchlists</option>}
                {allWatchlists.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label || buildWatchlistLabel(w.watchlist_date, w.created_at)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={async () => {
                setLoadingWatchlistHistory(true);
                try {
                  const all = await getAllDailyWatchlists();
                  setAllWatchlists(all);
                } finally {
                  setLoadingWatchlistHistory(false);
                }
              }}
              className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 disabled:opacity-50"
              disabled={loadingWatchlistHistory}
            >
              {loadingWatchlistHistory ? 'Loading...' : 'Refresh history'}
            </button>
          </div>

          {selectedWatchlistId && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Selected watchlist items ({selectedWatchlistItems.length})
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const w = allWatchlists.find((x) => String(x.id) === String(selectedWatchlistId));
                    const base = w?.created_at
                      ? watchlistCsvFilenameBase(w.created_at)
                      : watchlistCsvFilenameBase(new Date().toISOString());
                    downloadWatchlistSnapshotCsv(selectedWatchlistItems, base);
                  }}
                  disabled={selectedWatchlistItems.length === 0}
                  className="px-3 py-1.5 bg-indigo-50 text-indigo-800 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed border border-indigo-100"
                >
                  Download CSV (all columns)
                </button>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[700px]">
                  <thead className="sticky top-0 bg-slate-100 z-10">
                    <tr>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Ticker</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Company</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Sector</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Price</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Torchlight</th>
                      <th className="p-2 font-black text-slate-600 uppercase whitespace-nowrap">Risk Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWatchlistItems.map((r) => (
                      <tr key={`${r.watchlist_id || r.watchlist_date}-${r.symbol}`} className="border-t border-slate-200">
                        <td className="p-2 font-mono font-bold text-slate-800">{r.symbol}</td>
                        <td className="p-2 text-slate-600">{r.company || '—'}</td>
                        <td className="p-2 text-slate-500">{r.sector || '—'}</td>
                        <td className="p-2 font-mono text-slate-700">
                          {(() => {
                            const s = formatWatchlistTableNum(r.current_price, 2);
                            return s === '—' ? '—' : `$${s}`;
                          })()}
                        </td>
                        <td className="p-2 font-mono font-bold text-indigo-700">{formatWatchlistTableNum(r.torchlight_score, 1)}</td>
                        <td className="p-2 font-mono font-bold text-slate-700">{formatWatchlistTableNum(r.risk_summary_score, 1)}</td>
                      </tr>
                    ))}
                    {!loadingWatchlistHistory && selectedWatchlistItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-500">
                          No snapshot rows found for this watchlist.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Company fundamentals (admin-only): upload CSV or edit rows */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 relative overflow-hidden">
        {companyFundamentalsTableMissing && (
          <div className="mb-6 p-6 rounded-2xl bg-amber-50 border border-amber-200">
            <p className="font-bold text-amber-900 text-sm">Company fundamentals table is missing.</p>
            <p className="text-amber-800 text-xs mt-2">This project does not have `company_fundamentals` yet.</p>
          </div>
        )}
        {fundamentalsFetchError && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-100">
            <p className="font-bold text-rose-900 text-sm">Could not load fundamentals</p>
            <p className="text-rose-700 text-xs mt-1">{fundamentalsFetchError}</p>
          </div>
        )}
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <div>
            <h3 className="font-bold text-slate-900 uppercase tracking-widest text-sm">Company fundamentals</h3>
            <p className="text-xs text-slate-400 font-bold mt-1">Reference data. Only admins can upload CSV or edit rows. All users can read.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search ticker, company, sector..."
              value={fundamentalsSearch}
              onChange={(e) => setFundamentalsSearch(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder-slate-400 w-48 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setEditFundamental(null);
                setFundamentalForm({ ticker: '', company: '', sector: '', location: '', industry: '', website: '' });
                setShowFundamentalModal(true);
              }}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-700"
            >
              Add row
            </button>
            <button
              type="button"
              onClick={fetchCompanyFundamentals}
              disabled={fundamentalsLoading}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 disabled:opacity-50"
            >
              {fundamentalsLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
          <div className="md:col-span-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Upload CSV (Ticker, Company, Sector, Location, Industry, Website)</label>
            <input
              id="csv-fundamentals-upload"
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-xs file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={handleUploadCsv}
            disabled={uploadingCsv || !csvFile}
            className="py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadingCsv ? 'Uploading...' : 'Upload & replace'}
          </button>
        </div>
        <div className="overflow-x-auto border border-slate-100 rounded-2xl">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/50">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Sector</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3">Website</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {fundamentalsLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading...</td>
                </tr>
              ) : (
                (() => {
                  const search = fundamentalsSearch.trim().toLowerCase();
                  const filtered = search
                    ? companyFundamentals.filter(
                        (r) =>
                          r.ticker.toLowerCase().includes(search) ||
                          r.company.toLowerCase().includes(search) ||
                          r.sector.toLowerCase().includes(search) ||
                          r.industry.toLowerCase().includes(search)
                      )
                    : companyFundamentals;
                  return filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No company fundamentals. Upload a CSV or add rows.</td>
                    </tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={r.ticker} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-800">{r.ticker}</td>
                        <td className="px-4 py-3 text-slate-700">{r.company}</td>
                        <td className="px-4 py-3 text-slate-600">{r.sector}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[180px] truncate" title={r.location}>{r.location}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate" title={r.industry}>{r.industry}</td>
                        <td className="px-4 py-3">
                          <a href={r.website} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline text-xs truncate block max-w-[120px]">
                            {r.website || '—'}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setEditFundamental(r);
                              setFundamentalForm({ ...r });
                              setShowFundamentalModal(true);
                            }}
                            className="text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded text-xs font-bold mr-1"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteFundamental(r.ticker)}
                            className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded text-xs font-bold"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  );
                })()
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add/Edit company fundamental */}
      {showFundamentalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => {
          setShowFundamentalModal(false);
          setEditFundamental(null);
          setFundamentalForm({ ticker: '', company: '', sector: '', location: '', industry: '', website: '' });
        }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">
              {editFundamental ? 'Edit company fundamental' : 'Add company fundamental'}
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ticker</label>
                <input
                  type="text"
                  value={fundamentalForm.ticker}
                  onChange={(e) => setFundamentalForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                  disabled={!!editFundamental}
                  placeholder="e.g. AAPL"
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl font-mono font-bold disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Company</label>
                <input
                  type="text"
                  value={fundamentalForm.company}
                  onChange={(e) => setFundamentalForm((f) => ({ ...f, company: e.target.value }))}
                  placeholder="Company name"
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sector</label>
                <input
                  type="text"
                  value={fundamentalForm.sector}
                  onChange={(e) => setFundamentalForm((f) => ({ ...f, sector: e.target.value }))}
                  placeholder="e.g. Technology"
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Location</label>
                <input
                  type="text"
                  value={fundamentalForm.location}
                  onChange={(e) => setFundamentalForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="City, State, Country"
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Industry</label>
                <input
                  type="text"
                  value={fundamentalForm.industry}
                  onChange={(e) => setFundamentalForm((f) => ({ ...f, industry: e.target.value }))}
                  placeholder="e.g. Software - Application"
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Website</label>
                <input
                  type="url"
                  value={fundamentalForm.website}
                  onChange={(e) => setFundamentalForm((f) => ({ ...f, website: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleSaveFundamental}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowFundamentalModal(false);
                  setEditFundamental(null);
                  setFundamentalForm({ ticker: '', company: '', sector: '', location: '', industry: '', website: '' });
                }}
                className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 bg-slate-50/30">
              <h3 className="font-bold text-slate-800 uppercase tracking-widest text-xs">Other users ({otherUsers.length})</h3>
              <p className="text-slate-500 text-xs mt-1 font-medium">Manage other users. You are not shown in this list.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/20">
                    <th className="px-8 py-5">User</th>
                    <th className="px-8 py-5">Role</th>
                    <th className="px-8 py-5">Status</th>
                    <th className="px-8 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {otherUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-8 py-12 text-center text-slate-500 text-sm font-medium">
                        No other users listed. Try &quot;Sync Registry&quot; after new sign-ups.
                      </td>
                    </tr>
                  ) : (
                    otherUsers.map(user => (
                      <tr key={user.uid} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-8 py-5">
                          <div className="flex items-center space-x-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm border-2 ${user.role === 'admin' ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                              }`}>
                              {(user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">{user.displayName || 'Anonymous'}</p>
                              <p className="text-xs text-slate-400 font-medium">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <button
                            onClick={() => handleRoleChange(user.uid, user.role)}
                            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${user.role === 'admin'
                              ? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                              : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100'
                              }`}
                          >
                            {user.role}
                          </button>
                        </td>
                        <td className="px-8 py-5">
                          <button
                            onClick={() => handleToggleStatus(user.uid, user.status)}
                            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${user.status === 'active'
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100'
                              }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${user.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                            {user.status === 'active' ? 'Active' : 'Suspended'}
                          </button>
                          <span className="block mt-1 text-[9px] text-slate-400 font-medium">
                            {user.status === 'active' ? 'Click to suspend' : 'Click to activate'}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <button
                            onClick={() => handleDeleteUser(user.uid)}
                            title="Delete this user"
                            className="inline-flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all text-xs font-bold uppercase tracking-wider"
                          >
                            <span aria-hidden>🗑️</span>
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

      {/* DANGER ZONE */}
          <div className="bg-rose-50 border border-rose-100 p-8 rounded-3xl mt-12 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-8xl grayscale">☢️</div>
            <div className="relative z-10">
              <h3 className="text-rose-900 font-black text-xs uppercase tracking-[0.2em] mb-4">Institutional Risk Protocol (Danger Zone)</h3>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="max-w-xl">
                  <p className="text-rose-800 font-bold text-lg leading-tight">Wipe Institutional Registry</p>
                  <p className="text-rose-600 text-xs mt-2 font-medium leading-relaxed">
                    This directive will permanently purge all cloud asset data and identity metadata for every user in the database, excluding your own master account. This action cannot be undone.
                  </p>
                </div>
                <button
                  onClick={handleWipeRegistry}
                  disabled={isPurging || otherUsers.length === 0}
                  className={`px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl ${isPurging || otherUsers.length === 0
                    ? 'bg-rose-200 text-rose-400 cursor-not-allowed'
                    : 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-900/10'
                    }`}
                >
                  {isPurging ? 'Purging Registry...' : 'Wipe All Identities'}
                </button>
              </div>
            </div>
          </div>
    </div>
  );
};

export default AdminDashboard;
