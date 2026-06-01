/**
 * OHLC candles for forex: Finnhub `/forex/candle` (OANDA symbols), optional Yahoo Chart v8 fallback (dev proxy or CORS-permitting).
 */

import { getFinnhubToken } from './tradingQuotes';
import { fetchLocalCommodityDailyBars } from './localCommodityCsv';
import { fetchLocalForexBars } from './localForexCsv';

export type FxChartResolutionId = '1' | '15' | '60' | '240' | 'D' | 'W' | 'M';

export const FX_CHART_RESOLUTIONS: { id: FxChartResolutionId; label: string }[] = [
  { id: '1', label: '1m' },
  { id: '15', label: '15m' },
  { id: '60', label: '1h' },
  { id: '240', label: '4h' },
  { id: 'D', label: '1D' },
  { id: 'W', label: '1W' },
  { id: 'M', label: '1M' },
];

/** Polling interval for live-style updates — matches the bar size to limit API load. */
export function fxChartRefreshIntervalMs(resolution: FxChartResolutionId): number {
  switch (resolution) {
    case '1':
      return 60_000;
    case '15':
      return 15 * 60_000;
    case '60':
      return 60 * 60_000;
    case '240':
      return 4 * 60 * 60_000;
    case 'D':
      return 24 * 60 * 60_000;
    case 'W':
      return 7 * 24 * 60 * 60_000;
    case 'M':
      return 30 * 24 * 60 * 60_000;
    default:
      return 60_000;
  }
}

export type OhlcBar = { time: number; open: number; high: number; low: number; close: number };

/**
 * Sort, dedupe by timestamp, fix OHLC invariants. Reduces jitter when polling W/M series.
 */
export function normalizeOhlcBars(bars: OhlcBar[]): OhlcBar[] {
  const byTime = new Map<number, OhlcBar>();
  for (const b of bars) {
    let { time: t, open: o, high: h, low: l, close: c } = b;
    if (![o, h, l, c].every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
    const bodyTop = Math.max(o, c);
    const bodyBot = Math.min(o, c);
    h = Math.max(h, bodyTop);
    l = Math.min(l, bodyBot);
    if (l > h) [l, h] = [h, l];
    byTime.set(t, { time: t, open: o, high: h, low: l, close: c });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

const FINNHUB_FOREX_CANDLE = 'https://finnhub.io/api/v1/forex/candle';

/** Finnhub OANDA symbols for TRADING_FOREX_DISPLAY ids */
export const FOREX_PAIR_FINNHUB: Record<string, string> = {
  EURUSD: 'OANDA:EUR_USD',
  GBPUSD: 'OANDA:GBP_USD',
  USDCAD: 'OANDA:USD_CAD',
  USDCHF: 'OANDA:USD_CHF',
  EURCHF: 'OANDA:EUR_CHF',
  GBPEUR: 'OANDA:GBP_EUR',
  USDJPY: 'OANDA:USD_JPY',
  EURJPY: 'OANDA:EUR_JPY',
  GBPJPY: 'OANDA:GBP_JPY',
};

/** Yahoo Finance chart symbols (≈ spot FX) */
function yahooChartSymbol(pairId: string): string | null {
  const y: Record<string, string> = {
    EURUSD: 'EURUSD=X',
    GBPUSD: 'GBPUSD=X',
    USDCAD: 'USDCAD=X',
    USDCHF: 'USDCHF=X',
    EURCHF: 'EURCHF=X',
    GBPEUR: 'GBPEUR=X',
    USDJPY: 'USDJPY=X',
    EURJPY: 'EURJPY=X',
    GBPJPY: 'GBPJPY=X',
  };
  return y[pairId] ?? null;
}

function finnhubResolutionString(id: FxChartResolutionId): string {
  return id;
}

/** Approximate lookback window (seconds) for Finnhub from/to */
function finnhubTimeWindow(id: FxChartResolutionId): { from: number; to: number } {
  const to = Math.floor(Date.now() / 1000);
  const d = 86400;
  switch (id) {
    case '1':
      return { from: to - d * 3, to };
    case '15':
      return { from: to - d * 21, to };
    case '60':
      return { from: to - d * 90, to };
    case '240':
      return { from: to - d * 180, to };
    case 'D':
      return { from: to - d * 730, to };
    case 'W':
      return { from: to - d * 365 * 5, to };
    case 'M':
      return { from: to - d * 365 * 10, to };
    default:
      return { from: to - d * 30, to };
  }
}

function parseFinnhubCandles(data: {
  s?: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
}): OhlcBar[] {
  if (data.s !== 'ok' || !Array.isArray(data.t) || !data.t.length) return [];
  const out: OhlcBar[] = [];
  const n = data.t.length;
  for (let i = 0; i < n; i++) {
    const t = data.t[i];
    const o = data.o?.[i];
    const h = data.h?.[i];
    const l = data.l?.[i];
    const c = data.c?.[i];
    if (
      t == null ||
      o == null ||
      h == null ||
      l == null ||
      c == null ||
      ![o, h, l, c].every((x) => Number.isFinite(x))
    ) {
      continue;
    }
    out.push({ time: t, open: o, high: h, low: l, close: c });
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function fetchFinnhubForexCandles(
  pairId: string,
  resolution: FxChartResolutionId,
  token?: string
): Promise<OhlcBar[]> {
  const key = (token || getFinnhubToken() || '').trim();
  if (!key) return [];

  const symbol = FOREX_PAIR_FINNHUB[pairId];
  if (!symbol) return [];

  const { from, to } = finnhubTimeWindow(resolution);
  let res = finnhubResolutionString(resolution);

  const tryFetch = async (resolutionStr: string): Promise<OhlcBar[]> => {
    const url = `${FINNHUB_FOREX_CANDLE}?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(
      resolutionStr
    )}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    const data = await r.json();
    return parseFinnhubCandles(data);
  };

  let bars = await tryFetch(res);
  if (bars.length === 0 && resolution === '240') {
    bars = await tryFetch('60');
  }
  return bars;
}

/**
 * Yahoo blocks cross-origin browser requests (no CORS). Use same-origin `/yahoo-chart`
 * → proxied to Yahoo (vite.config server + preview). In browser always use the proxy path.
 * SSR / Node tests can hit Yahoo directly.
 */
/**
 * Same-origin proxy path. Must match `vite.config` → `proxy['/yahoo-chart']`.
 * Respect Vite `base` when the app is served under a subpath.
 */
export function yahooProxyBase(): string {
  if (typeof window === 'undefined') return 'https://query1.finance.yahoo.com';
  const raw = import.meta.env.BASE_URL || '/';
  const trimmed = raw.replace(/\/$/, '');
  return trimmed ? `${trimmed}/yahoo-chart` : '/yahoo-chart';
}

function yahooChartBaseUrl(): string {
  if (typeof window !== 'undefined') return yahooProxyBase();
  return 'https://query1.finance.yahoo.com';
}

/** Yahoo returns 429 if we chain many `/v8/finance/chart` calls per refresh — cache, dedupe, and bail on first 429. */
const YAHOO_CACHE_FRESH_MS = 120_000;
const YAHOO_CACHE_STALE_MS = 900_000;
const YAHOO_COOLDOWN_MS = 120_000;
const YAHOO_RETRY_GAP_MS = 450;
/** First `/chart` call sometimes returns 429 — one pause + retry before giving up */
const YAHOO_429_RANGE_RETRY_MS = 3_500;
const YAHOO_DISK_PREFIX = 'si-yahoo-fx-v1:';
const YAHOO_DISK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const YAHOO_DISK_MAX_BARS = 2_500;

type YahooCacheEntry = { bars: OhlcBar[]; fetchedAt: number };
const yahooBarCache = new Map<string, YahooCacheEntry>();
let yahooCooldownUntil = 0;
const yahooInflight = new Map<string, Promise<{ bars: OhlcBar[]; lastError?: string }>>();

function yahooCacheKey(pairId: string, resolution: FxChartResolutionId): string {
  return `${pairId}:${resolution}`;
}

function getYahooCached(pairId: string, resolution: FxChartResolutionId): OhlcBar[] | null {
  const e = yahooBarCache.get(yahooCacheKey(pairId, resolution));
  if (!e?.bars.length) return null;
  const age = Date.now() - e.fetchedAt;
  if (age < YAHOO_CACHE_FRESH_MS) return e.bars;
  const cooling = Date.now() < yahooCooldownUntil;
  if (cooling && age < YAHOO_CACHE_STALE_MS) return e.bars;
  return null;
}

function setYahooCached(pairId: string, resolution: FxChartResolutionId, bars: OhlcBar[]): void {
  if (bars.length === 0) return;
  yahooBarCache.set(yahooCacheKey(pairId, resolution), { bars, fetchedAt: Date.now() });
  writeYahooDisk(pairId, resolution, bars);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readYahooDisk(pairId: string, resolution: FxChartResolutionId): OhlcBar[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(YAHOO_DISK_PREFIX + yahooCacheKey(pairId, resolution));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { bars?: OhlcBar[]; fetchedAt?: number };
    if (!Array.isArray(parsed.bars) || !parsed.bars.length || typeof parsed.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > YAHOO_DISK_MAX_AGE_MS) return null;
    return parsed.bars;
  } catch {
    return null;
  }
}

function writeYahooDisk(pairId: string, resolution: FxChartResolutionId, bars: OhlcBar[]): void {
  if (typeof localStorage === 'undefined' || bars.length === 0) return;
  try {
    const trimmed = bars.length > YAHOO_DISK_MAX_BARS ? bars.slice(-YAHOO_DISK_MAX_BARS) : bars;
    localStorage.setItem(
      YAHOO_DISK_PREFIX + yahooCacheKey(pairId, resolution),
      JSON.stringify({ bars: trimmed, fetchedAt: Date.now() })
    );
  } catch {
    // quota / private mode
  }
}

/** After 429 or exhaustion: show last saved candles if any; else enter cooldown + error */
function yahooDiskOrCooldown(pairId: string, resolution: FxChartResolutionId, lastErr: string): {
  bars: OhlcBar[];
  lastError?: string;
} {
  const disk = readYahooDisk(pairId, resolution);
  if (disk?.length) {
    yahooBarCache.set(yahooCacheKey(pairId, resolution), { bars: disk, fetchedAt: Date.now() });
    return { bars: disk };
  }
  yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
  return { bars: [], lastError: lastErr };
}

/** Yahoo chart path must keep `=` in symbols (e.g. EURUSD=X, GC=F, CL=F). `encodeURIComponent` turns `=` into `%3D` and breaks requests. */
function yahooChartPathSymbol(sym: string): string {
  if (/^[A-Z]{6}=X$/.test(sym)) return sym;
  if (sym.includes('=')) return sym;
  return encodeURIComponent(sym);
}

function yahooIntervalAndRange(res: FxChartResolutionId): { interval: string; range: string } {
  switch (res) {
    case '1':
      return { interval: '1m', range: '5d' };
    case '15':
      return { interval: '15m', range: '1mo' };
    case '60':
      return { interval: '60m', range: '2y' };
    case '240':
      return { interval: '4h', range: '2y' };
    case 'D':
      return { interval: '1d', range: 'max' };
    case 'W':
      return { interval: '1wk', range: 'max' };
    case 'M':
      return { interval: '1mo', range: 'max' };
    default:
      return { interval: '1d', range: '1y' };
  }
}

function parseYahooChart(json: unknown): OhlcBar[] {
  const root = json as {
    chart?: { error?: unknown; result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, (number | null)[]>> } }> };
  };
  if (root?.chart?.error) return [];
  const result = root?.chart?.result?.[0];
  if (!result?.timestamp?.length) return [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];
  const open = quote.open ?? [];
  const high = quote.high ?? [];
  const low = quote.low ?? [];
  const close = quote.close ?? [];
  const ts = result.timestamp;
  const out: OhlcBar[] = [];
  let prevClose: number | null = null;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const c = close[i];
    if (t == null || c == null || typeof c !== 'number' || !Number.isFinite(c)) continue;
    const oRaw = open[i];
    const hRaw = high[i];
    const lRaw = low[i];
    /** Missing open is common on Yahoo d/wk/mo — use prior close so bodies aren’t all flat/green. */
    const o =
      typeof oRaw === 'number' && Number.isFinite(oRaw) ? oRaw : prevClose !== null ? prevClose : c;
    let h = typeof hRaw === 'number' && Number.isFinite(hRaw) ? hRaw : c;
    let l = typeof lRaw === 'number' && Number.isFinite(lRaw) ? lRaw : c;
    if (h < Math.max(o, c)) h = Math.max(o, c);
    if (l > Math.min(o, c)) l = Math.min(o, c);
    out.push({ time: t, open: o, high: h, low: l, close: c });
    prevClose = c;
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Unix bounds for Yahoo `period1` / `period2` when `range=` returns empty */
function yahooPeriodBounds(resolution: FxChartResolutionId): { period1: number; period2: number } {
  const period2 = Math.floor(Date.now() / 1000);
  const d = 86400;
  switch (resolution) {
    case '1':
      return { period1: period2 - d * 10, period2 };
    case '15':
      return { period1: period2 - d * 90, period2 };
    case '60':
    case '240':
      return { period1: period2 - d * 730, period2 };
    case 'D':
      return { period1: period2 - d * 365 * 12, period2 };
    case 'W':
      return { period1: period2 - d * 365 * 25, period2 };
    case 'M':
      return { period1: period2 - d * 365 * 40, period2 };
    default:
      return { period1: period2 - d * 365, period2 };
  }
}

async function fetchYahooChartJson(url: string): Promise<{ json: unknown | null; status: number; err?: string }> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { json: null, status: r.status, err: t.slice(0, 120) || r.statusText };
    }
    return { json: await r.json(), status: r.status };
  } catch (e) {
    return { json: null, status: 0, err: e instanceof Error ? e.message : 'network error' };
  }
}

/**
 * Yahoo chart candles for any Yahoo symbol (FX `EURUSD=X`, futures `GC=F`, equities `JJN`).
 * `cacheId` isolates browser cache / inflight keys (e.g. forex pair id or `COMM:XAU`).
 */
export async function fetchYahooChartCandlesBySymbol(
  cacheId: string,
  yahooSymbol: string,
  resolution: FxChartResolutionId
): Promise<{ bars: OhlcBar[]; lastError?: string }> {
  const sym = String(yahooSymbol || '').trim();
  if (!sym) return { bars: [] };

  const cached = getYahooCached(cacheId, resolution);
  if (cached) return { bars: cached };

  if (Date.now() < yahooCooldownUntil) {
    const disk = readYahooDisk(cacheId, resolution);
    if (disk?.length) {
      yahooBarCache.set(yahooCacheKey(cacheId, resolution), { bars: disk, fetchedAt: Date.now() });
      return { bars: disk };
    }
    return {
      bars: [],
      lastError:
        'Yahoo: rate limit — wait 1–2 min, or use a network that is not throttling finance.yahoo.com. Saved chart data may still load if you opened this pair before.',
    };
  }

  const inflightKey = yahooCacheKey(cacheId, resolution);
  const existing = yahooInflight.get(inflightKey);
  if (existing) return existing;

  const promise = (async (): Promise<{ bars: OhlcBar[]; lastError?: string }> => {
    const { interval, range } = yahooIntervalAndRange(resolution);
    const base = yahooChartBaseUrl();
    const symPath = yahooChartPathSymbol(sym);

    const tryBars = (json: unknown | null): OhlcBar[] => (json ? parseYahooChart(json) : []);

    const attempts: string[] = [];
    let lastErr = '';

    const run = async (
      label: string,
      url: string
    ): Promise<{ bars: OhlcBar[]; rateLimited: boolean }> => {
      const { json, status, err } = await fetchYahooChartJson(url);
      attempts.push(`${label}: HTTP ${status}`);
      if (status === 429) {
        lastErr = `${label}: 429 Too Many Requests`;
        return { bars: [], rateLimited: true };
      }
      if (err) lastErr = `${label}: ${status} ${err}`;
      return { bars: tryBars(json), rateLimited: false };
    };

    try {
      const urlRange = `${base}/v8/finance/chart/${symPath}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
      let result = await run('range', urlRange);
      if (result.rateLimited) {
        await sleep(YAHOO_429_RANGE_RETRY_MS);
        result = await run('range-retry', urlRange);
      }
      if (result.rateLimited) return yahooDiskOrCooldown(cacheId, resolution, lastErr);
      if (result.bars.length > 0) {
        setYahooCached(cacheId, resolution, result.bars);
        return { bars: result.bars };
      }

      await sleep(YAHOO_RETRY_GAP_MS);

      const { period1, period2 } = yahooPeriodBounds(resolution);
      const urlPeriod = `${base}/v8/finance/chart/${symPath}?period1=${period1}&period2=${period2}&interval=${encodeURIComponent(interval)}`;
      result = await run('period', urlPeriod);
      if (result.rateLimited) return yahooDiskOrCooldown(cacheId, resolution, lastErr);
      if (result.bars.length > 0) {
        setYahooCached(cacheId, resolution, result.bars);
        return { bars: result.bars };
      }

      if (resolution === '240') {
        await sleep(YAHOO_RETRY_GAP_MS);
        const alt = `${base}/v8/finance/chart/${symPath}?interval=${encodeURIComponent('60m')}&range=${encodeURIComponent('2y')}`;
        result = await run('60m-range', alt);
        if (result.rateLimited) return yahooDiskOrCooldown(cacheId, resolution, lastErr);
        if (result.bars.length > 0) {
          setYahooCached(cacheId, resolution, result.bars);
          return { bars: result.bars };
        }
        await sleep(YAHOO_RETRY_GAP_MS);
        const altP = `${base}/v8/finance/chart/${symPath}?period1=${period1}&period2=${period2}&interval=${encodeURIComponent('60m')}`;
        result = await run('60m-period', altP);
        if (result.rateLimited) return yahooDiskOrCooldown(cacheId, resolution, lastErr);
        if (result.bars.length > 0) {
          setYahooCached(cacheId, resolution, result.bars);
          return { bars: result.bars };
        }
      }

      await sleep(YAHOO_RETRY_GAP_MS);
      const daily = `${base}/v8/finance/chart/${symPath}?interval=1d&range=max`;
      result = await run('daily', daily);
      if (result.rateLimited) return yahooDiskOrCooldown(cacheId, resolution, lastErr);
      if (result.bars.length > 0) {
        setYahooCached(cacheId, resolution, result.bars);
        return { bars: result.bars };
      }

      const emptyMsg = lastErr || attempts.join(' · ') || 'Yahoo returned no usable OHLC rows';
      return yahooDiskOrCooldown(cacheId, resolution, emptyMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch failed';
      return yahooDiskOrCooldown(cacheId, resolution, msg);
    }
  })();

  yahooInflight.set(inflightKey, promise);
  promise.finally(() => {
    yahooInflight.delete(inflightKey);
  });

  return promise;
}

export async function fetchYahooForexCandles(
  pairId: string,
  resolution: FxChartResolutionId
): Promise<{ bars: OhlcBar[]; lastError?: string }> {
  const sym = yahooChartSymbol(pairId);
  if (!sym) return { bars: [] };
  return fetchYahooChartCandlesBySymbol(pairId, sym, resolution);
}

/** Daily candles for Trading Platform commodities (Yahoo symbol from `METAL_QUOTE_ROWS.finnhub`). */
export async function fetchCommodityDailyCandlesFromYahoo(
  commodityId: string,
  yahooSymbol: string
): Promise<{ bars: OhlcBar[]; source: 'yahoo' | 'none'; detail?: string }> {
  const cacheId = `COMM:${commodityId}`;
  const { bars, lastError } = await fetchYahooChartCandlesBySymbol(cacheId, yahooSymbol, 'D');
  if (bars.length > 0) return { bars: normalizeOhlcBars(bars), source: 'yahoo' };
  return { bars: [], source: 'none', detail: lastError };
}

function yahooCryptoSymbol(cryptoId: string): string {
  return `${cryptoId.trim().toUpperCase()}-USD`;
}

/** Crypto candles for Trading Platform crypto panel (Yahoo symbols like BTC-USD). */
export async function fetchCryptoCandlesWithFallback(
  cryptoId: string,
  resolution: FxChartResolutionId
): Promise<{ bars: OhlcBar[]; source: 'yahoo' | 'none'; detail?: string }> {
  const id = cryptoId.trim().toUpperCase();
  const { bars, lastError } = await fetchYahooChartCandlesBySymbol(`CRYPTO:${id}`, yahooCryptoSymbol(id), resolution);
  if (bars.length > 0) return { bars: normalizeOhlcBars(bars), source: 'yahoo' };
  return {
    bars: [],
    source: 'none',
    detail: lastError || `Yahoo returned no crypto candles for ${yahooCryptoSymbol(id)}.`,
  };
}

/** Local CSV (`public/commodity_data`) then Yahoo daily chart for commodities panel. */
export async function fetchCommodityDailyCandlesWithFallback(
  commodityId: string,
  yahooSymbol: string
): Promise<{ bars: OhlcBar[]; source: 'yahoo' | 'local' | 'none'; detail?: string }> {
  const local = await fetchLocalCommodityDailyBars(commodityId);
  if (local.length > 0) return { bars: normalizeOhlcBars(local), source: 'local' };

  const yahoo = await fetchCommodityDailyCandlesFromYahoo(commodityId, yahooSymbol);
  if (yahoo.bars.length > 0) return { bars: yahoo.bars, source: 'yahoo' };

  const parts = [
    'Local: run `npm run download:commodities:5y` so files exist under public/commodity_data/<ID>/daily_ohlcv.csv',
    yahoo.detail ? `Yahoo: ${yahoo.detail}` : '',
  ].filter(Boolean);
  return { bars: [], source: 'none', detail: parts.join(' — ') };
}

export async function fetchForexCandlesWithFallback(
  pairId: string,
  resolution: FxChartResolutionId,
  token?: string
): Promise<{ bars: OhlcBar[]; source: 'finnhub' | 'yahoo' | 'local' | 'none'; detail?: string }> {
  const pack = (bars: OhlcBar[], source: 'finnhub' | 'yahoo' | 'local'): { bars: OhlcBar[]; source: 'finnhub' | 'yahoo' | 'local' } => ({
    bars: normalizeOhlcBars(bars),
    source,
  });

  if (import.meta.env.VITE_FOREX_LOCAL_FIRST === 'true') {
    const localFirst = await fetchLocalForexBars(pairId, resolution);
    if (localFirst.length > 0) return pack(localFirst, 'local');
  }

  /** Yahoo (via same-origin proxy in the browser) works without Finnhub premium; try first. */
  const { bars: yahooBars, lastError: yahooErr } = await fetchYahooForexCandles(pairId, resolution);
  if (yahooBars.length > 0) {
    return pack(yahooBars, 'yahoo');
  }
  const finnhubBars = await fetchFinnhubForexCandles(pairId, resolution, token);
  if (finnhubBars.length > 0) {
    return pack(finnhubBars, 'finnhub');
  }
  const localBars = await fetchLocalForexBars(pairId, resolution);
  if (localBars.length > 0) {
    return pack(localBars, 'local');
  }
  const finnhubKey = (token || getFinnhubToken() || '').trim();
  const parts = [
    yahooErr ? `Yahoo: ${yahooErr}` : '',
    !finnhubKey ? 'Finnhub: add VITE_FINNHUB_KEY to try OHLC backup' : 'Finnhub: no rows (FX candles often need a paid tier)',
    'Local CSV: run npm run download:forex so files exist under public/currency_data/<PAIR>/',
  ].filter(Boolean);
  return { bars: [], source: 'none', detail: parts.join(' — ') };
}
