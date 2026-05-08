#!/usr/bin/env node
/**
 * Build a "watchlist of today" snapshot from the same sources as the admin UI:
 *   SP500 list (Watchlist API) → Yahoo financials batch → CSV + JSON snapshot on disk.
 *
 * No Supabase login required. Use the JSON file in Admin → Team watchlist → Import snapshot;
 * or use the full CSV as a data export. Start the Watchlist API first: npm run watchlist-api
 *
 * Usage:
 *   node scripts/watchlist-today-cli.mjs                    (all tickers from SP500 CSV)
 *   node scripts/watchlist-today-cli.mjs --limit 50        (first N only)
 *   node scripts/watchlist-today-cli.mjs --out ~/SmartInvest/exports
 *
 * Env:
 *   VITE_WATCHLIST_API_URL   (default http://127.0.0.1:8000)
 *   VITE_WATCHLIST_FINANCIALS_CHUNK  (default 8)
 *   WATCHLIST_CLI_OUTPUT_DIR  (optional; default: <project>/watchlist)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WATCHLIST_SNAPSHOT_FORMAT = 'smartinvest-watchlist-snapshot-v1';

const WATCHLIST_SNAPSHOT_CSV_COLUMNS = [
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

function parseEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (let line of raw.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* skip */
  }
}

parseEnvFile(path.join(ROOT, '.env'));
parseEnvFile(path.join(ROOT, '.env.local'));

function localCalendarDateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function watchlistFileStampLocal(isoUtc) {
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

function expandHome(p) {
  if (!p || typeof p !== 'string') return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function getWatchlistApiBase() {
  const fromEnv = String(process.env.VITE_WATCHLIST_API_URL ?? '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return 'http://127.0.0.1:8000';
}

function resolveFinancialsChunkSize() {
  const raw = process.env.VITE_WATCHLIST_FINANCIALS_CHUNK;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(5000, Math.floor(n)));
  }
  return 8;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeHtml(text) {
  const t = text.trimStart();
  return t.startsWith('<!') || t.toLowerCase().startsWith('<html');
}

async function readWatchlistJson(res) {
  const text = await res.text();
  const trimmed = text.trim();
  if (looksLikeHtml(text)) {
    throw new Error(
      'Watchlist API returned HTML. Point VITE_WATCHLIST_API_URL at the FastAPI server (port 8000), not the Vite app. Run: npm run watchlist-api'
    );
  }
  if (!res.ok) {
    throw new Error(`Watchlist API error ${res.status}: ${trimmed.slice(0, 600)}`);
  }
  if (trimmed === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from Watchlist API: ${text.slice(0, 200)}`);
  }
}

function explainFetchFailure(baseUrl, err) {
  const msg = err instanceof Error ? err.message : String(err);
  let causeText = '';
  const c = err && typeof err === 'object' && 'cause' in err ? err.cause : undefined;
  if (c instanceof Error) causeText = c.message;
  else if (c != null) causeText = String(c);
  const combined = `${msg}${causeText ? ` (${causeText})` : ''}`;
  const looksUnreachable =
    /fetch failed|ECONNREFUSED|ECONNRESET|EPIPE|ENOTFOUND|ETIMEDOUT|network|connection refused/i.test(combined);
  if (looksUnreachable) {
    return new Error(
      `Cannot reach Watchlist API at ${baseUrl}\n` +
        `  (${combined})\n` +
        `  Fix: open another terminal, cd to the project root, run:\n` +
        `       npm run watchlist-api\n` +
        `  Wait until you see Uvicorn listening on port 8000, then run watchlist:today again.\n` +
        `  Check: curl -s ${baseUrl.replace(/\/$/, '')}/api/health`
    );
  }
  return err instanceof Error ? err : new Error(combined);
}

async function fetchWatchlistApi(baseUrl, pathWithQuery, init) {
  const base = baseUrl.replace(/\/$/, '');
  const p = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  const url = `${base}${p}`;
  try {
    return await fetch(url, { ...init });
  } catch (e) {
    throw explainFetchFailure(baseUrl, e);
  }
}

async function fetchSp500List(base, limit) {
  const q = limit > 0 ? `?limit=${limit}` : '';
  const res = await fetchWatchlistApi(base, `/api/lists/sp500${q}`);
  const data = await readWatchlistJson(res);
  if (!Array.isArray(data)) throw new Error('SP500 list response is not an array.');
  return data.map((r) => ({
    ticker: String(r.ticker || '').toUpperCase().trim(),
    company: typeof r.company === 'string' ? r.company : '',
    sector: undefined,
    short_name: undefined,
    current_price: undefined,
    total_assets: null,
    total_liabilities: null,
    total_revenue: null,
    net_income: null,
    operating_cash_flow: null,
    free_cash_flow: null,
    iv_dcf: null,
    iv_ri: null,
    iv_multiples: null,
    iv_quality_score: null,
    iv_ensemble: null,
    iv_upside_pct: null,
    torchlight_score: null,
    torchlight_rank_factors: '',
    ctr_total_return: null,
    ctr_annualized: null,
    risk_daily_return_mean: null,
    risk_volatility_daily: null,
    risk_volatility_annual: null,
    risk_sharpe: null,
    risk_sortino: null,
    risk_max_drawdown: null,
    risk_var_95_hist: null,
    risk_var_99_hist: null,
    risk_var_95_param: null,
    risk_var_99_param: null,
    risk_cvar_95: null,
    risk_beta: null,
    risk_summary_score: null,
  })).filter((r) => r.ticker);
}

const CHUNK_ATTEMPTS = 3;

/** Simple tqdm-style bar for the terminal (Unicode block / light shade). */
function formatProgressBar(done, total, width = 22) {
  if (total <= 0) return '[' + '░'.repeat(width) + ']';
  const f = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(f * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

async function fetchFinancialsBatchChunked(baseUrl, tickers, chunkSize, options = {}) {
  const { quiet = false } = options;
  const normalized = tickers.map((t) => String(t).toUpperCase().trim()).filter(Boolean);
  const out = [];
  const totalChunks = Math.max(1, Math.ceil(normalized.length / chunkSize));

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize) + 1;
    const t0 = Date.now();
    let lastErr;
    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt++) {
      if (!quiet) {
        if (attempt === 0) {
          const preview =
            chunk.length <= 6 ? chunk.join(', ') : `${chunk.slice(0, 5).join(', ')}, +${chunk.length - 5} more`;
          console.info(
            `  ▶ Yahoo batch ${chunkIndex}/${totalChunks}  [${preview}]  requesting…`
          );
        } else {
          const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
          console.info(
            `     … retry ${attempt + 1}/${CHUNK_ATTEMPTS} (${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''})`
          );
        }
      }
      try {
        const res = await fetchWatchlistApi(baseUrl, '/api/financials/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: chunk }),
        });
        const data = await readWatchlistJson(res);
        if (Array.isArray(data)) out.push(...data);
        lastErr = undefined;
        const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
        const pct = Math.round((100 * chunkIndex) / totalChunks);
        if (!quiet) {
          const bar = formatProgressBar(chunkIndex, totalChunks);
          const n = Array.isArray(data) ? data.length : 0;
          console.info(
            `  ${bar} ${pct}%  chunk ${chunkIndex}/${totalChunks}  ${n} rows in ${elapsedSec}s`
          );
        }
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < CHUNK_ATTEMPTS - 1) await sleep(900 * (attempt + 1));
      }
    }
    if (lastErr !== undefined) throw lastErr;
  }
  return out;
}

function yahooRowToFields(r) {
  const num = (v) => (v != null && v !== '' ? Number(v) : null);
  return {
    current_price: typeof r.current_price === 'number' ? r.current_price : undefined,
    sector: typeof r.sector === 'string' ? r.sector : undefined,
    short_name: typeof r.short_name === 'string' ? r.short_name : undefined,
    total_assets: num(r.total_assets),
    total_liabilities: num(r.total_liabilities),
    total_revenue: num(r.total_revenue),
    net_income: num(r.net_income),
    operating_cash_flow: num(r.operating_cash_flow),
    free_cash_flow: num(r.free_cash_flow),
    iv_dcf: num(r.iv_dcf),
    iv_ri: num(r.iv_ri),
    iv_multiples: num(r.iv_multiples),
    iv_quality_score: num(r.iv_quality_score),
    iv_ensemble: num(r.iv_ensemble),
    iv_upside_pct: num(r.iv_upside_pct),
    torchlight_score: num(r.torchlight_score),
    torchlight_rank_factors: typeof r.torchlight_rank_factors === 'string' ? r.torchlight_rank_factors : '',
    ctr_total_return: num(r.ctr_total_return),
    ctr_annualized: num(r.ctr_annualized),
    risk_daily_return_mean: num(r.risk_daily_return_mean),
    risk_volatility_daily: num(r.risk_volatility_daily),
    risk_volatility_annual: num(r.risk_volatility_annual),
    risk_sharpe: num(r.risk_sharpe),
    risk_sortino: num(r.risk_sortino),
    risk_max_drawdown: num(r.risk_max_drawdown),
    risk_var_95_hist: num(r.risk_var_95_hist),
    risk_var_99_hist: num(r.risk_var_99_hist),
    risk_var_95_param: num(r.risk_var_95_param),
    risk_var_99_param: num(r.risk_var_99_param),
    risk_cvar_95: num(r.risk_cvar_95),
    risk_beta: num(r.risk_beta),
    risk_summary_score: num(r.risk_summary_score),
  };
}

function mergeYahoo(rows, yahooList) {
  const byTicker = {};
  for (const r of yahooList || []) {
    const t = String(r.ticker || '').toUpperCase().trim();
    if (!t) continue;
    byTicker[t] = yahooRowToFields(r);
  }
  return rows.map((r) => {
    const b = byTicker[r.ticker];
    if (!b) return r;
    return {
      ...r,
      current_price: b.current_price ?? r.current_price,
      sector: b.sector ?? r.sector,
      short_name: b.short_name ?? r.company,
      total_assets: b.total_assets,
      total_liabilities: b.total_liabilities,
      total_revenue: b.total_revenue,
      net_income: b.net_income,
      operating_cash_flow: b.operating_cash_flow,
      free_cash_flow: b.free_cash_flow,
      iv_dcf: b.iv_dcf,
      iv_ri: b.iv_ri,
      iv_multiples: b.iv_multiples,
      iv_quality_score: b.iv_quality_score,
      iv_ensemble: b.iv_ensemble,
      iv_upside_pct: b.iv_upside_pct,
      torchlight_score: b.torchlight_score,
      torchlight_rank_factors: b.torchlight_rank_factors,
      ctr_total_return: b.ctr_total_return,
      ctr_annualized: b.ctr_annualized,
      risk_daily_return_mean: b.risk_daily_return_mean,
      risk_volatility_daily: b.risk_volatility_daily,
      risk_volatility_annual: b.risk_volatility_annual,
      risk_sharpe: b.risk_sharpe,
      risk_sortino: b.risk_sortino,
      risk_max_drawdown: b.risk_max_drawdown,
      risk_var_95_hist: b.risk_var_95_hist,
      risk_var_99_hist: b.risk_var_99_hist,
      risk_var_95_param: b.risk_var_95_param,
      risk_var_99_param: b.risk_var_99_param,
      risk_cvar_95: b.risk_cvar_95,
      risk_beta: b.risk_beta,
      risk_summary_score: b.risk_summary_score,
    };
  });
}

function loadedRowsToDailySnapshotItems(rows, createdAtIso) {
  const d = localCalendarDateStamp();
  return rows.map((r) => ({
    watchlist_date: d,
    symbol: r.ticker,
    company: r.short_name || r.company || '',
    sector: r.sector || '',
    industry: '',
    location: '',
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
    torchlight_momentum: null,
    torchlight_valuation_edge: null,
    torchlight_quality: null,
    torchlight_growth: null,
    torchlight_sentiment: null,
    torchlight_macro_fit: null,
    torchlight_execution_feasibility: null,
    torchlight_risk_adjusted_alpha: null,
    torchlight_capital_efficiency: null,
    torchlight_analyst_drift: null,
    ctr_total_return: r.ctr_total_return ?? null,
    ctr_price_return: null,
    ctr_cash_return: null,
    ctr_annualized: r.ctr_annualized ?? null,
    torchlight_ctr_score: null,
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
    created_at: createdAtIso,
  }));
}

function escapeCsvCell(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function snapshotCsvText(items) {
  const header = WATCHLIST_SNAPSHOT_CSV_COLUMNS.map((k) => escapeCsvCell(String(k))).join(',');
  const lines = items.map((row) =>
    WATCHLIST_SNAPSHOT_CSV_COLUMNS.map((k) => escapeCsvCell(row[k])).join(',')
  );
  return `\uFEFF${header}\r\n${lines.join('\r\n')}`;
}

function parseArgs(argv) {
  const out = {
    full: false,
    limit: 0,
    symbolsOnly: false,
    outDir: null,
    help: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--full') out.full = true;
    else if (a === '--symbols-only') out.symbolsOnly = true;
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--limit') out.limit = Math.max(0, parseInt(argv[++i] || '0', 10) || 0);
    else if (a === '--out') out.outDir = expandHome(argv[++i] || '');
  }
  if (out.full) out.limit = 0;
  return out;
}

function printHelp() {
  console.log(`
watchlist-today-cli — build SP500 watchlist snapshot (same pipeline as admin Prepare + Yahoo)

Requires Watchlist API: npm run watchlist-api  (default http://127.0.0.1:8000)

Options:
  --full           Same as default: entire SP500 CSV from API (no limit query)
  --limit N        Max tickers from SP500 list (default: all; ignored if --full)
  --symbols-only   Skip Yahoo financials; symbols + date only (fast)
  --out DIR        Output directory (default: <project>/watchlist/ or WATCHLIST_CLI_OUTPUT_DIR)
  -q, --quiet      No progress lines (still prints final paths)
  -h, --help       This message

Env:
  VITE_WATCHLIST_API_URL
  VITE_WATCHLIST_FINANCIALS_CHUNK
  WATCHLIST_CLI_OUTPUT_DIR

Writes:
  watchlist-{YYYY-MM-DD-HHMMSS}.csv
  watchlist-snapshot-{YYYY-MM-DD-HHMMSS}.json   (import in Admin → Team watchlist → Import snapshot)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const base = getWatchlistApiBase();
  const startedAtIso = new Date().toISOString();
  const stamp = watchlistFileStampLocal(startedAtIso);
  const quiet = args.quiet;

  /** Default: repo `watchlist/` so files show next to the project (not ~/SmartInvest/watchlist, which is easy to confuse with a different path). */
  const defaultOut = path.join(ROOT, 'watchlist');
  const outDir = path.resolve(expandHome(args.outDir || process.env.WATCHLIST_CLI_OUTPUT_DIR || defaultOut));

  if (!quiet) {
    console.info(`Watchlist API: ${base}`);
    console.info(`Output dir:    ${outDir}`);
    console.info('');
  }

  fs.mkdirSync(outDir, { recursive: true });

  const sp500Limit = args.full ? 0 : args.limit;
  if (!quiet) {
    console.info(`[1/3] SP500 list ${sp500Limit > 0 ? `(limit ${sp500Limit})` : '(full list)'} …`);
  }
  const tSp500 = Date.now();
  let rows = await fetchSp500List(base, sp500Limit);
  if (rows.length === 0) throw new Error('SP500 list is empty — is backend/data/sp500.csv present?');
  if (!quiet) {
    console.info(`      ✓ ${rows.length} tickers in ${((Date.now() - tSp500) / 1000).toFixed(1)}s\n`);
  }

  if (!args.symbolsOnly) {
    const chunk = resolveFinancialsChunkSize();
    const totalChunks = Math.max(1, Math.ceil(rows.length / chunk));
    if (!quiet) {
      console.info(
        `[2/3] Yahoo financials — ${rows.length} tickers in ${totalChunks} batch(es) of up to ${chunk} …\n`
      );
    }
    const yahoo = await fetchFinancialsBatchChunked(base, rows.map((r) => r.ticker), chunk, {
      quiet,
    });
    rows = mergeYahoo(rows, yahoo);
    if (!quiet) console.info('');
  } else if (!quiet) {
    console.info('[2/3] Skipping Yahoo (--symbols-only)\n');
  }

  if (!quiet) console.info('[3/3] Writing CSV + JSON snapshot …\n');

  const snapshotItems = loadedRowsToDailySnapshotItems(rows, startedAtIso);
  const symbols = rows.map((r) => r.ticker);

  const watchlistDate = localCalendarDateStamp();
  const csvPath = path.join(outDir, `watchlist-${stamp}.csv`);
  const jsonPath = path.join(outDir, `watchlist-snapshot-${stamp}.json`);

  fs.writeFileSync(csvPath, snapshotCsvText(snapshotItems), 'utf8');

  const snapshotJson = {
    format: WATCHLIST_SNAPSHOT_FORMAT,
    exported_at: startedAtIso,
    watchlist_date: watchlistDate,
    label: `CLI ${watchlistDate} ${stamp}`,
    symbols,
    items: snapshotItems.length > 0 ? snapshotItems : undefined,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(snapshotJson, null, 2)}\n`, 'utf8');

  console.info(`Wrote ${snapshotItems.length} rows`);
  console.info(`  CSV:  ${csvPath}`);
  console.info(`  JSON: ${jsonPath}`);
  console.info('');
  console.info('Import JSON in the app: Admin → Team watchlist → Import snapshot (or Share & offline).');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
