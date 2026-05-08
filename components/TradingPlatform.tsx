
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { getDailyWatchlist, getDailyWatchlistItems } from '../services/supabaseService';
import { watchlistUserVisibleLabel } from '../utils/watchlistDisplay';
import type { DailyWatchlistItem } from '../types';
import {
  clearPersonalWatchlist,
  getPersonalWatchlistFileName,
  getPersonalWatchlistSnapshot,
  getTradingWatchlistSource,
  savePersonalWatchlistSnapshot,
  setTradingWatchlistSource,
  snapshotToDailyWatchlistItems,
  type TradingWatchlistSource,
} from '../utils/personalWatchlistStorage';
import { parsePersonalWatchlistFile } from '../utils/parsePersonalWatchlistFile';
import {
  TRADING_FOREX_DISPLAY,
  fetchForexTradingPrices,
  CRYPTO_QUOTE_ROWS,
  METAL_QUOTE_ROWS,
  fetchFinnhubQuotes,
  getFinnhubToken,
} from '../services/tradingQuotes';
import type { FxChartResolutionId, OhlcBar } from '../services/forexCandles';
import {
  FX_CHART_RESOLUTIONS,
  fetchForexCandlesWithFallback,
  fxChartRefreshIntervalMs,
} from '../services/forexCandles';
import ForexCandleChart from './ForexCandleChart';
import ForexDirectionalForecast from './ForexDirectionalForecast';
import PaperTradeBar from './PaperTradeBar';

type TradingPanel = 'sp500' | 'forex' | 'crypto' | 'commodities';

const PANEL_NAV: { id: TradingPanel; label: string; hint: string; emoji: string }[] = [
  { id: 'sp500', label: 'S&P 500', hint: 'Team or your file', emoji: '📊' },
  { id: 'forex', label: 'Forex', hint: 'Major pairs', emoji: '💱' },
  { id: 'crypto', label: 'Crypto', hint: 'Digital assets', emoji: '₿' },
  { id: 'commodities', label: 'Commodities', hint: 'Metals', emoji: '🪙' },
];

const FX_FLAG: Record<string, string> = {
  EUR: '🇪🇺',
  USD: '🇺🇸',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  CHF: '🇨🇭',
  CAD: '🇨🇦',
};

function parseFxCodes(label: string): [string, string] | null {
  const m = /^([A-Z]{3})\/([A-Z]{3})$/.exec(label.trim());
  if (!m) return null;
  return [m[1], m[2]];
}

const CRYPTO_ICON: Record<string, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  SOL: '◎',
  XRP: '✕',
  BNB: '◆',
  ADA: 'A',
  DOGE: 'Ð',
  AVAX: '▲',
  DOT: '●',
  MATIC: '⬡',
  LINK: '◇',
  ATOM: '⊙',
};

function formatNumber(n: number, digits: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatForexPrice(symbol: string, price: number): string {
  if (symbol.includes('JPY')) return formatNumber(price, 3);
  return formatNumber(price, 4);
}

function formatStockOrMetal(p: number): string {
  return formatNumber(p, 2);
}

function formatCrypto(p: number): string {
  if (p >= 1000) return formatNumber(p, 2);
  if (p >= 1) return formatNumber(p, 4);
  return formatNumber(p, 6);
}

const TradingPlatform: React.FC<{ isPaperTrader?: boolean }> = ({ isPaperTrader }) => {
  const [panel, setPanel] = useState<TradingPanel>('sp500');
  const [simUserId, setSimUserId] = useState<string | null>(null);
  const [paperCryptoId, setPaperCryptoId] = useState<string>(CRYPTO_QUOTE_ROWS[0]?.id ?? 'BTC');
  const [paperMetalId, setPaperMetalId] = useState<string>(METAL_QUOTE_ROWS[0]?.id ?? 'XAU');

  const [watchlistLabel, setWatchlistLabel] = useState<string>('');
  const [watchRows, setWatchRows] = useState<DailyWatchlistItem[]>([]);
  const [watchLoading, setWatchLoading] = useState(true);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [watchlistSource, setWatchlistSourceState] = useState<TradingWatchlistSource>(() => getTradingWatchlistSource());
  const [personalImportError, setPersonalImportError] = useState<string | null>(null);
  const [personalImporting, setPersonalImporting] = useState(false);

  const [liveEquity, setLiveEquity] = useState<Record<string, number>>({});
  const [fxPrices, setFxPrices] = useState<Record<string, number>>({});
  const [cryptoPrices, setCryptoPrices] = useState<Record<string, number>>({});
  const [metalPrices, setMetalPrices] = useState<Record<string, number>>({});

  const [quotesLoading, setQuotesLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const [selectedForexPair, setSelectedForexPair] = useState<string>('EURUSD');
  const [fxChartResolution, setFxChartResolution] = useState<FxChartResolutionId>('15');
  const [fxCandles, setFxCandles] = useState<OhlcBar[]>([]);
  const [fxCandleLoading, setFxCandleLoading] = useState(false);
  const [fxCandleError, setFxCandleError] = useState<string | null>(null);
  const [fxCandleSource, setFxCandleSource] = useState<'finnhub' | 'yahoo' | 'local' | 'none' | null>(null);
  const [fxCandleDetail, setFxCandleDetail] = useState<string | null>(null);

  const finnhubKey = getFinnhubToken();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSimUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSimUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const forexChartPriceFormat = useMemo(() => {
    const jpy = selectedForexPair.includes('JPY');
    return jpy ? { precision: 3 as const, minMove: 0.01 } : { precision: 4 as const, minMove: 0.0001 };
  }, [selectedForexPair]);

  const loadWatchlist = useCallback(async () => {
    setWatchLoading(true);
    setWatchError(null);
    try {
      const source = getTradingWatchlistSource();
      if (source === 'personal') {
        const snap = getPersonalWatchlistSnapshot();
        if (!snap) {
          setWatchlistLabel('Upload a watchlist file below (JSON snapshot or CSV)');
          setWatchRows([]);
          return;
        }
        const fn = getPersonalWatchlistFileName();
        const suffix = fn ? ` · ${fn}` : '';
        setWatchlistLabel(`${snap.label || 'My watchlist'}${suffix}`);
        setWatchRows(snapshotToDailyWatchlistItems(snap));
        return;
      }

      const latest = await getDailyWatchlist();
      if (!latest) {
        setWatchlistLabel('No watchlist snapshot');
        setWatchRows([]);
        return;
      }
      setWatchlistLabel(watchlistUserVisibleLabel(latest));
      const rows = await getDailyWatchlistItems(latest.id, latest.watchlist_date);
      setWatchRows(rows || []);
    } catch {
      setWatchError('Could not load the daily watchlist.');
      setWatchRows([]);
    } finally {
      setWatchLoading(false);
    }
  }, []);

  const applyWatchlistSource = useCallback(
    (next: TradingWatchlistSource) => {
      setTradingWatchlistSource(next);
      setWatchlistSourceState(next);
      setPersonalImportError(null);
      void loadWatchlist();
    },
    [loadWatchlist]
  );

  const handlePersonalWatchlistFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setPersonalImportError(null);
      setPersonalImporting(true);
      try {
        const snap = await parsePersonalWatchlistFile(file);
        savePersonalWatchlistSnapshot(snap, file.name);
        setTradingWatchlistSource('personal');
        setWatchlistSourceState('personal');
        await loadWatchlist();
      } catch (e: unknown) {
        setPersonalImportError(e instanceof Error ? e.message : String(e));
      } finally {
        setPersonalImporting(false);
      }
    },
    [loadWatchlist]
  );

  const handleClearPersonalWatchlist = useCallback(() => {
    clearPersonalWatchlist();
    applyWatchlistSource('team');
  }, [applyWatchlistSource]);

  useEffect(() => {
    void loadWatchlist();
    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange(() => {
      void loadWatchlist();
    });
    const channel = supabase
      .channel('trading-platform-watchlist')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_watchlist' }, () => {
        if (getTradingWatchlistSource() === 'team') void loadWatchlist();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_watchlist_items' }, () => {
        if (getTradingWatchlistSource() === 'team') void loadWatchlist();
      })
      .subscribe();
    const vis = () =>
      document.visibilityState === 'visible' && getTradingWatchlistSource() === 'team' && void loadWatchlist();
    document.addEventListener('visibilitychange', vis);
    const poll = window.setInterval(() => {
      if (getTradingWatchlistSource() === 'team') void loadWatchlist();
    }, 60000);
    return () => {
      authSub.unsubscribe();
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', vis);
      window.clearInterval(poll);
    };
  }, [loadWatchlist]);

  const watchlistTickers = useMemo(
    () =>
      [...new Set(watchRows.map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean))].sort(),
    [watchRows]
  );

  useEffect(() => {
    if (panel !== 'sp500' || watchlistTickers.length === 0 || !finnhubKey) {
      if (panel !== 'sp500') setLiveEquity({});
      return;
    }

    let cancelled = false;
    const tick = async () => {
      const updates = await fetchFinnhubQuotes(watchlistTickers, finnhubKey);
      if (!cancelled) {
        setLiveEquity((prev) => ({ ...prev, ...updates }));
        setLastUpdated(new Date().toLocaleTimeString());
      }
    };
    void tick();
    const id = window.setInterval(tick, 25000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [panel, watchlistTickers, finnhubKey]);

  useEffect(() => {
    if (panel !== 'forex') return;

    let cancelled = false;
    const load = async () => {
      setQuotesLoading(true);
      try {
        const p = await fetchForexTradingPrices();
        if (!cancelled) {
          setFxPrices(p);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    };
    void load();
    const ms = fxChartRefreshIntervalMs(fxChartResolution);
    const id = window.setInterval(load, ms);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [panel, fxChartResolution]);

  useEffect(() => {
    if (panel !== 'forex') return;

    let cancelled = false;

    const loadCandles = async (reset: boolean) => {
      if (reset) {
        setFxCandles([]);
        setFxCandleLoading(true);
        setFxCandleError(null);
        setFxCandleDetail(null);
      }
      try {
        const { bars, source, detail } = await fetchForexCandlesWithFallback(
          selectedForexPair,
          fxChartResolution,
          finnhubKey
        );
        if (!cancelled) {
          setFxCandles(bars);
          setFxCandleSource(source);
          setFxCandleDetail(detail ?? null);
        }
      } catch (e: unknown) {
        if (!cancelled && reset) setFxCandleError(e instanceof Error ? e.message : 'Could not load candles');
      } finally {
        if (!cancelled && reset) setFxCandleLoading(false);
      }
    };

    void loadCandles(true);
    const ms = fxChartRefreshIntervalMs(fxChartResolution);
    const tick = window.setInterval(() => void loadCandles(false), ms);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [panel, selectedForexPair, fxChartResolution, finnhubKey]);

  useEffect(() => {
    if (panel !== 'crypto' || !finnhubKey) return;

    let cancelled = false;
    const symbols = CRYPTO_QUOTE_ROWS.map((r) => r.finnhub);
    const tick = async () => {
      setQuotesLoading(true);
      try {
        const raw = await fetchFinnhubQuotes(symbols, finnhubKey);
        const byId: Record<string, number> = {};
        CRYPTO_QUOTE_ROWS.forEach((row) => {
          const v = raw[row.finnhub];
          if (v != null) byId[row.id] = v;
        });
        if (!cancelled) {
          setCryptoPrices(byId);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    };
    void tick();
    const interval = window.setInterval(tick, 25000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [panel, finnhubKey]);

  useEffect(() => {
    if (panel !== 'commodities' || !finnhubKey) return;

    let cancelled = false;
    const symbols = METAL_QUOTE_ROWS.map((r) => r.finnhub);
    const tick = async () => {
      setQuotesLoading(true);
      try {
        const raw = await fetchFinnhubQuotes(symbols, finnhubKey);
        const byId: Record<string, number> = {};
        METAL_QUOTE_ROWS.forEach((row) => {
          const v = raw[row.finnhub];
          if (v != null) byId[row.id] = v;
        });
        if (!cancelled) {
          setMetalPrices(byId);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    };
    void tick();
    const interval = window.setInterval(tick, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [panel, finnhubKey]);

  const sortedWatchRows = useMemo(() => {
    return [...watchRows].sort((a, b) =>
      String(a.symbol || '').localeCompare(String(b.symbol || ''), undefined, { sensitivity: 'base' })
    );
  }, [watchRows]);

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 max-w-6xl mx-auto animate-in fade-in duration-500 pb-12 px-1">
      {/* Side menu */}
      <aside className="lg:w-56 shrink-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-4">
          <p className="px-3 pt-2 pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Markets</p>
          <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
            {PANEL_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPanel(item.id)}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-150 min-w-[140px] lg:min-w-0 ${
                  panel === item.id
                    ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300/40'
                    : 'text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-100'
                }`}
              >
                <span className="text-xl leading-none w-9 h-9 flex items-center justify-center rounded-lg bg-white/15 lg:bg-slate-100 lg:text-slate-700">
                  {item.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-sm leading-tight">{item.label}</span>
                  <span
                    className={`block text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${
                      panel === item.id ? 'text-indigo-100' : 'text-slate-400'
                    }`}
                  >
                    {item.hint}
                  </span>
                </span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Trading Platform</h2>
            <p className="text-xs text-slate-500 mt-1">
              {panel === 'sp500' && 'Team watchlist from the server, or your own JSON/CSV — stored only in this browser'}
              {panel === 'forex' && 'FX crosses from USD base rates (open.er-api)'}
              {panel === 'crypto' && 'Spot-style USDT pairs via Finnhub'}
              {panel === 'commodities' && 'Metals futures (COMEX-style symbols) via Finnhub'}
            </p>
          </div>
          {lastUpdated ? (
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Updated {lastUpdated}</span>
          ) : null}
        </div>

        {isPaperTrader === false && simUserId ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
            <span className="font-black uppercase tracking-wider text-slate-600">Administrator</span>
            <span className="text-slate-600">
              {' '}
              — paper-trader simulation is reserved for standard accounts; use a non-admin login to exercise simulated fills.
            </span>
          </div>
        ) : isPaperTrader !== false ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-950">
            <span className="font-black uppercase tracking-wider text-emerald-800">Paper trader</span>
            <span className="text-emerald-900">
              {' '}
              — buys and sells update your simulated cash and positions only (no real brokerage). Applies to all members except administrators.
            </span>
          </div>
        ) : null}

        {panel === 'sp500' && (
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4 bg-slate-50/80 space-y-4">
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">Watchlist</h3>
                <p className="text-xs text-slate-500 mt-1">{watchlistLabel}</p>
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Source</p>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
                  <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm w-fit">
                    <button
                      type="button"
                      onClick={() => applyWatchlistSource('team')}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                        watchlistSource === 'team'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Team list
                    </button>
                    <button
                      type="button"
                      onClick={() => applyWatchlistSource('personal')}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                        watchlistSource === 'personal'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      My file
                    </button>
                  </div>
                  {watchlistSource === 'personal' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-100">
                        {personalImporting ? 'Importing…' : 'Upload JSON / CSV'}
                        <input
                          type="file"
                          accept=".json,.csv,application/json,text/csv"
                          className="hidden"
                          disabled={personalImporting}
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            e.target.value = '';
                            void handlePersonalWatchlistFile(f);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleClearPersonalWatchlist}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                      >
                        Clear & use team
                      </button>
                    </div>
                  )}
                </div>
                {personalImportError && (
                  <p className="text-xs text-rose-600 font-medium">{personalImportError}</p>
                )}
                {watchlistSource === 'personal' && (
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-2xl">
                    Use the same <span className="font-semibold text-slate-700">watchlist-snapshot-*.json</span> or{' '}
                    <span className="font-semibold text-slate-700">watchlist-*.csv</span> from the CLI or admin export. Saved only in
                    this browser.
                  </p>
                )}
              </div>
              <p className="text-xs text-indigo-700 font-semibold leading-relaxed">
                Use <span className="font-black">Paper trade</span> on each row to buy or sell into your simulated account. The same list
                is also on <span className="font-black">Portfolio</span> (S&amp;P market simulation).
              </p>
              {!finnhubKey && (
                <p className="text-xs text-amber-700">
                  Set <code className="bg-amber-100 px-1 rounded">VITE_FINNHUB_KEY</code> for live equity prices; otherwise snapshot
                  prices from the watchlist row are shown.
                </p>
              )}
            </div>
            {watchLoading ? (
              <div className="p-10 text-center text-slate-500 text-sm">Loading watchlist…</div>
            ) : watchError ? (
              <div className="p-10 text-center text-rose-600 text-sm">{watchError}</div>
            ) : sortedWatchRows.length === 0 ? (
              <div className="p-10 text-center text-slate-500 text-sm">
                {watchlistSource === 'personal'
                  ? 'No rows — upload a JSON snapshot or CSV using “Upload JSON / CSV”, or switch to Team list.'
                  : 'No watchlist rows yet. An admin can publish today’s list, or choose My file and upload your own.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                      <th className="px-5 py-3 whitespace-nowrap">Symbol</th>
                      <th className="px-3 py-3 hidden sm:table-cell">Company</th>
                      <th className="px-3 py-3 text-right whitespace-nowrap">Price</th>
                      <th className="px-4 py-3 min-w-[200px]">Paper trade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedWatchRows.map((row) => {
                      const sym = String(row.symbol || '').toUpperCase();
                      const snap = row.current_price;
                      const live = liveEquity[sym];
                      const show = live != null ? live : snap;
                      return (
                        <tr key={sym} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-mono font-bold text-slate-900">{sym}</td>
                          <td className="px-3 py-3 hidden sm:table-cell text-slate-600 max-w-[220px] truncate">
                            {row.company || '—'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono tabular-nums align-top">
                            {show != null && typeof show === 'number' ? (
                              <>
                                <span className="text-slate-900 font-semibold">{formatStockOrMetal(show)}</span>
                                {live != null && (
                                  <span className="block text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">
                                    Live
                                  </span>
                                )}
                                {live == null && snap != null && (
                                  <span className="block text-[10px] text-slate-400 uppercase tracking-wide">Snapshot</span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <PaperTradeBar
                              userId={simUserId}
                              kind="equity"
                              symbol={sym}
                              assetLabel={String(row.company || sym)}
                              price={typeof show === 'number' ? show : undefined}
                              defaultQty="10"
                              paperTradingAllowed={isPaperTrader !== false}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {panel === 'forex' && (
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-2 md:px-5 md:pt-5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">Major pairs</h3>
              {quotesLoading ? <span className="text-xs text-slate-400">Refreshing…</span> : null}
            </div>
            {/* Single horizontal strip — compact icons; scroll on narrow viewports */}
            <div className="flex flex-nowrap items-stretch gap-2 overflow-x-auto px-4 pb-3 md:px-5">
              {TRADING_FOREX_DISPLAY.map((row) => {
                const price = fxPrices[row.symbol];
                const codes = parseFxCodes(row.label);
                const selected = selectedForexPair === row.symbol;
                return (
                  <button
                    type="button"
                    key={row.symbol}
                    onClick={() => setSelectedForexPair(row.symbol)}
                    aria-pressed={selected}
                    className={`shrink-0 rounded-lg border bg-gradient-to-br from-white to-slate-50 px-2.5 py-1.5 min-w-[4.75rem] flex flex-col items-center text-center shadow-sm transition-shadow ${
                      selected
                        ? 'border-indigo-500 ring-2 ring-indigo-400/50 ring-offset-1'
                        : 'border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-0.5 text-sm leading-none mb-0.5 h-4" aria-hidden>
                      {codes ? (
                        <>
                          <span className="scale-90 origin-center" title={codes[0]}>
                            {FX_FLAG[codes[0]] ?? '•'}
                          </span>
                          <span className="text-slate-300 text-[9px] font-bold leading-none">/</span>
                          <span className="scale-90 origin-center" title={codes[1]}>
                            {FX_FLAG[codes[1]] ?? '•'}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs leading-none">💱</span>
                      )}
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 leading-tight whitespace-nowrap">
                      {row.label}
                    </span>
                    <span className="mt-0.5 font-mono text-xs font-bold tabular-nums text-indigo-900 leading-none">
                      {price != null ? formatForexPrice(row.symbol, price) : '—'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mx-4 mb-3 md:mx-5 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-white px-3 py-3 shadow-inner">
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700 mb-2">
                Market simulation ·{' '}
                {TRADING_FOREX_DISPLAY.find((x) => x.symbol === selectedForexPair)?.label ?? selectedForexPair}
              </p>
              <PaperTradeBar
                userId={simUserId}
                kind="forex"
                symbol={selectedForexPair}
                assetLabel={
                  TRADING_FOREX_DISPLAY.find((x) => x.symbol === selectedForexPair)?.label ?? selectedForexPair
                }
                price={fxPrices[selectedForexPair]}
                defaultQty="10000"
                paperTradingAllowed={isPaperTrader !== false}
              />
            </div>

            <ForexDirectionalForecast pairId={selectedForexPair} />

            <div
              className={`mx-4 mb-4 md:mx-5 flex flex-col gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-3 ${
                fxChartResolution === '240' ? 'min-h-[520px] md:min-h-[580px]' : 'min-h-[320px] md:min-h-[380px]'
              }`}
            >
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1">Timeframe</span>
                {FX_CHART_RESOLUTIONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setFxChartResolution(r.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${
                      fxChartResolution === r.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div
                className={`flex-1 flex flex-col ${fxChartResolution === '240' ? 'min-h-[480px]' : 'min-h-[300px]'}`}
              >
                <ForexCandleChart
                  bars={fxCandles}
                  loading={fxCandleLoading}
                  error={fxCandleError}
                  dataSource={fxCandleSource}
                  diagnostic={fxCandleDetail}
                  resolutionId={fxChartResolution}
                  forexSymbol={selectedForexPair}
                  pricePrecision={forexChartPriceFormat.precision}
                  priceMinMove={forexChartPriceFormat.minMove}
                  pairLabel={
                    TRADING_FOREX_DISPLAY.find((x) => x.symbol === selectedForexPair)?.label ?? selectedForexPair
                  }
                />
              </div>
            </div>
          </div>
        )}

        {panel === 'crypto' && (
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-white shadow-sm overflow-hidden ring-1 ring-indigo-100/60">
            {!finnhubKey ? (
              <div className="p-5 md:p-6">
                <p className="text-sm text-amber-800">
                  Add <code className="bg-amber-100 px-1 rounded">VITE_FINNHUB_KEY</code> to your{' '}
                  <code className="bg-amber-100 px-1 rounded">.env</code> to load crypto quotes.
                </p>
              </div>
            ) : (
              <>
                <div className="px-4 pt-4 pb-2 md:px-5 md:pt-5 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-black uppercase tracking-widest text-indigo-950">Cryptocurrency</h3>
                  {quotesLoading ? <span className="text-xs text-indigo-400">Refreshing…</span> : null}
                </div>
                <div className="flex flex-nowrap items-stretch gap-2 overflow-x-auto px-4 pb-3 md:px-5">
                  {CRYPTO_QUOTE_ROWS.map((row) => {
                    const price = cryptoPrices[row.id];
                    const glyph = CRYPTO_ICON[row.id] ?? row.hint.slice(0, 1);
                    return (
                      <div
                        key={row.id}
                        className="shrink-0 rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 min-w-[4.75rem] flex flex-col items-center text-center shadow-sm"
                      >
                        <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-black mb-0.5 shadow-inner leading-none">
                          {glyph}
                        </div>
                        <span className="text-[9px] font-bold text-slate-800 leading-tight whitespace-nowrap">
                          {row.label}
                        </span>
                        <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider leading-none">
                          {row.hint}
                        </span>
                        <span className="mt-0.5 font-mono text-xs font-bold tabular-nums text-indigo-900 leading-none">
                          {price != null ? `$${formatCrypto(price)}` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mx-4 mb-4 md:mx-5 rounded-xl border border-indigo-100 bg-white px-3 py-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <label htmlFor="paper-crypto-select" className="text-[10px] font-black uppercase text-indigo-900">
                      Paper trade asset
                    </label>
                    <select
                      id="paper-crypto-select"
                      value={paperCryptoId}
                      onChange={(e) => setPaperCryptoId(e.target.value)}
                      className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-950"
                    >
                      {CRYPTO_QUOTE_ROWS.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <PaperTradeBar
                    userId={simUserId}
                    kind="crypto"
                    symbol={paperCryptoId}
                    assetLabel={CRYPTO_QUOTE_ROWS.find((r) => r.id === paperCryptoId)?.label ?? paperCryptoId}
                    price={cryptoPrices[paperCryptoId]}
                    defaultQty="0.05"
                    paperTradingAllowed={isPaperTrader !== false}
                  />
                </div>

                <div
                  className="mx-4 mb-4 md:mx-5 min-h-[180px] md:min-h-[220px] rounded-xl border border-dashed border-indigo-200/70 bg-indigo-50/20 flex items-center justify-center"
                  aria-label="Reserved for cryptocurrency price charts"
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400/90">Charts</span>
                </div>
              </>
            )}
          </div>
        )}

        {panel === 'commodities' && (
          <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/30 to-white shadow-sm overflow-hidden">
            {!finnhubKey ? (
              <div className="p-5 md:p-6">
                <p className="text-sm text-amber-800">
                  Add <code className="bg-amber-100 px-1 rounded">VITE_FINNHUB_KEY</code> for metals futures quotes.
                </p>
              </div>
            ) : (
              <>
                <div className="px-4 pt-4 pb-2 md:px-5 md:pt-5 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-black uppercase tracking-widest text-amber-950">Commodities & metals</h3>
                  {quotesLoading ? <span className="text-xs text-amber-700/80">Refreshing…</span> : null}
                </div>
                <div className="flex flex-nowrap items-stretch gap-2 overflow-x-auto px-4 pb-3 md:px-5">
                  {METAL_QUOTE_ROWS.map((row) => {
                    const price = metalPrices[row.id];
                    return (
                      <div
                        key={row.id}
                        className="shrink-0 rounded-lg border border-amber-100 bg-white px-2 py-1.5 min-w-[4.85rem] max-w-[6.25rem] flex flex-col items-center text-center shadow-sm"
                      >
                        <span className="text-base leading-none mb-0.5 h-4 flex items-center justify-center shrink-0" aria-hidden>
                          {row.icon}
                        </span>
                        <span className="text-[9px] font-bold text-slate-800 leading-snug text-center px-0.5 line-clamp-2">
                          {row.label}
                        </span>
                        <span className="mt-0.5 font-mono text-xs font-bold tabular-nums text-amber-950 leading-none">
                          {price != null ? formatStockOrMetal(price) : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mx-4 mb-4 md:mx-5 rounded-xl border border-amber-100 bg-white px-3 py-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <label htmlFor="paper-metal-select" className="text-[10px] font-black uppercase text-amber-950">
                      Paper trade metal
                    </label>
                    <select
                      id="paper-metal-select"
                      value={paperMetalId}
                      onChange={(e) => setPaperMetalId(e.target.value)}
                      className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-semibold text-amber-950"
                    >
                      {METAL_QUOTE_ROWS.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <PaperTradeBar
                    userId={simUserId}
                    kind="metal"
                    symbol={paperMetalId}
                    assetLabel={METAL_QUOTE_ROWS.find((r) => r.id === paperMetalId)?.label ?? paperMetalId}
                    price={metalPrices[paperMetalId]}
                    defaultQty="1"
                    paperTradingAllowed={isPaperTrader !== false}
                  />
                </div>

                <div
                  className="mx-4 mb-4 md:mx-5 min-h-[180px] md:min-h-[220px] rounded-xl border border-dashed border-amber-200/80 bg-amber-50/30 flex items-center justify-center"
                  aria-label="Reserved for commodities price charts"
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700/70">Charts</span>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default TradingPlatform;
