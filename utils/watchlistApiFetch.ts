import type { DailyWatchlistItem } from '../types';

/**
 * Watchlist FastAPI base URL.
 * - In dev/preview, default is same-origin `/watchlist-api` (Vite proxies to 127.0.0.1:8000) so LAN / other devices work.
 * - `VITE_WATCHLIST_API_URL` pointing at localhost:8000 is ignored in dev unless `VITE_WATCHLIST_API_DIRECT=true`.
 * - Set `VITE_WATCHLIST_API_URL` to a non-local URL to use a hosted API during dev.
 * - Production builds default to http://127.0.0.1:8000 unless you set the env var.
 */
function useViteWatchlistProxy(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window !== 'undefined' && window.location.port === '4173') return true;
  return false;
}

function isLocalhostPort8000(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return false;
    return !u.port || u.port === '8000';
  } catch {
    return false;
  }
}

export function getDefaultWatchlistApiBase(): string {
  const fromEnv = (import.meta.env.VITE_WATCHLIST_API_URL || '').trim().replace(/\/$/, '');
  const direct = import.meta.env.VITE_WATCHLIST_API_DIRECT === 'true';

  if (useViteWatchlistProxy()) {
    if (fromEnv && direct) return fromEnv;
    if (fromEnv && !isLocalhostPort8000(fromEnv)) return fromEnv;
    return '/watchlist-api';
  }

  if (fromEnv) return fromEnv;
  return 'http://127.0.0.1:8000';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return err != null ? String(err) : 'Unknown error';
}

function isNetworkFailure(err: unknown): boolean {
  const msg = errorMessage(err);
  return /failed to fetch|network error|load failed|connection refused|err_connection_refused/i.test(msg) || msg === 'Failed to fetch';
}

function alternateLocalBase(baseUrl: string): string | null {
  try {
    const trimmed = baseUrl.replace(/\/$/, '');
    const u = new URL(trimmed);
    if (u.hostname === 'localhost') {
      u.hostname = '127.0.0.1';
      return `${u.protocol}//${u.host}`;
    }
    if (u.hostname === '127.0.0.1') {
      u.hostname = 'localhost';
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Fetch from the Watchlist API; on network error, retry once swapping localhost ↔ 127.0.0.1. */
export async function fetchWatchlistApi(
  baseUrl: string,
  pathWithQuery: string,
  init?: RequestInit
): Promise<Response> {
  const base = baseUrl.replace(/\/$/, '');
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  const url = `${base}${path}`;
  try {
    return await fetch(url, init);
  } catch (e) {
    const alt = alternateLocalBase(base);
    if (!alt || !isNetworkFailure(e)) throw e;
    const altUrl = `${alt.replace(/\/$/, '')}${path}`;
    return await fetch(altUrl, init);
  }
}

const HTML_INSTEAD_OF_JSON =
  'Watchlist API returned HTML instead of JSON. VITE_WATCHLIST_API_URL must be the FastAPI server on port 8000, not the Vite app on port 3000. Set VITE_WATCHLIST_API_URL=http://127.0.0.1:8000 in .env, run npm run watchlist-api in another terminal, then restart npm run dev.';

function looksLikeHtmlResponse(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('<!') || t.toLowerCase().startsWith('<html');
}

/** Parse JSON from a Watchlist API response; detects Vite index.html (wrong port) and non-JSON errors. */
export async function readWatchlistJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (looksLikeHtmlResponse(text)) {
    throw new Error(HTML_INSTEAD_OF_JSON);
  }
  if (!res.ok) {
    let detail = trimmed.slice(0, 800);
    try {
      const j = JSON.parse(trimmed) as { detail?: unknown };
      if (j && typeof j === 'object' && 'detail' in j) {
        const d = j.detail;
        detail = typeof d === 'string' ? d : Array.isArray(d) ? JSON.stringify(d) : String(d);
      }
    } catch {
      /* use raw text */
    }
    let suffix =
      detail ||
      (trimmed ? trimmed.slice(0, 200) : res.statusText ? String(res.statusText) : 'empty response body');
    /** Vite’s proxy often returns plain “Internal Server Error” when nothing listens on port 8000 (ECONNREFUSED). */
    if (/^internal server error$/i.test(suffix.trim()) && (res.status === 500 || res.status === 502)) {
      suffix =
        'Cannot reach the Watchlist API on port 8000. Run npm run dev:all (frontend + API together), or npm run watchlist-api in a second terminal — then curl http://127.0.0.1:8000/api/health';
    }
    throw new Error(`Watchlist API error ${res.status}: ${suffix}`);
  }
  if (trimmed === '') {
    return null as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    if (looksLikeHtmlResponse(text)) throw new Error(HTML_INSTEAD_OF_JSON);
    throw new Error(`Watchlist API returned invalid JSON. First bytes: ${text.slice(0, 120)}`);
  }
}

export type WatchlistExportResult = {
  path?: string;
  dir?: string;
  file?: string;
  count?: number;
  watchlist_date?: string | null;
  skipped?: boolean;
  reason?: string;
};

export type WatchlistSnapshotCsvResult = {
  dir?: string;
  stamp?: string;
  written?: string[];
  count_full?: number;
  count_symbols?: number;
  skipped?: boolean;
  reason?: string;
};

/**
 * Save full / top10 / worst10 (or symbols-only) CSVs on the host running the Watchlist API
 * (see POST /api/watchlist/snapshot-csv and SMARTINVEST_WATCHLIST_CSV_DIR).
 */
export async function postWatchlistSnapshotCsvBundles(
  baseUrl: string,
  payload: {
    started_at_iso: string;
    /** Same stamp segment as watchlistCsvFilenameBase / watchlistFileStampLocal for matching filenames. */
    csv_stamp?: string;
    items?: DailyWatchlistItem[];
    symbols?: string[];
    watchlist_date?: string;
  }
): Promise<WatchlistSnapshotCsvResult> {
  const res = await fetchWatchlistApi(baseUrl, '/api/watchlist/snapshot-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      started_at_iso: payload.started_at_iso,
      csv_stamp: payload.csv_stamp,
      items: payload.items,
      symbols: payload.symbols,
      watchlist_date: payload.watchlist_date,
    }),
  });
  return readWatchlistJson<WatchlistSnapshotCsvResult>(res);
}

/** Writes symbols on the host running the Watchlist API (see POST /api/watchlist/export). */
export async function exportWatchlistToLocalDir(
  baseUrl: string,
  symbols: string[],
  watchlistDateYmd?: string
): Promise<WatchlistExportResult> {
  const normalized = symbols.map((s) => String(s).toUpperCase().trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error('No symbols to export.');
  }
  const res = await fetchWatchlistApi(baseUrl, '/api/watchlist/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbols: normalized,
      watchlist_date: watchlistDateYmd ?? null,
    }),
  });
  return readWatchlistJson<WatchlistExportResult>(res);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Yahoo calls are sequential on the server; smaller chunks reduce peak memory and proxy payload size. */
const DEFAULT_FINANCIALS_BATCH_CHUNK = 8;

const CHUNK_ATTEMPTS = 3;

function resolveFinancialsChunkSize(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit)) {
    return Math.max(1, Math.min(5000, Math.floor(explicit)));
  }
  const raw = import.meta.env.VITE_WATCHLIST_FINANCIALS_CHUNK;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(5000, Math.floor(n)));
  }
  return DEFAULT_FINANCIALS_BATCH_CHUNK;
}

/**
 * POST /api/financials/batch in slices, merges results in order. Retries each chunk on failure (Yahoo is flaky).
 * Chunk size: pass explicit, or set `VITE_WATCHLIST_FINANCIALS_CHUNK` (default 8).
 */
export async function fetchFinancialsBatchChunked(
  baseUrl: string,
  tickers: string[],
  chunkSize?: number
): Promise<unknown[]> {
  const normalized = tickers.map((t) => String(t).toUpperCase().trim()).filter(Boolean);
  const out: unknown[] = [];
  const size = resolveFinancialsChunkSize(chunkSize);
  for (let i = 0; i < normalized.length; i += size) {
    const chunk = normalized.slice(i, i + size);
    let lastErr: unknown;
    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt++) {
      try {
        const res = await fetchWatchlistApi(baseUrl, '/api/financials/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: chunk }),
        });
        const data = await readWatchlistJson<unknown[]>(res);
        if (Array.isArray(data)) {
          out.push(...data);
        }
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < CHUNK_ATTEMPTS - 1) {
          await sleep(900 * (attempt + 1));
        }
      }
    }
    if (lastErr !== undefined) throw lastErr;
  }
  return out;
}
