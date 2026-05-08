import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMarksByPositionKey,
  fetchMarksForPositions,
  loadMarketSimulationState,
  localStorageKeyForMarketSim,
  MARKET_SIMULATION_UPDATED_EVENT,
  positionCostBasis,
  positionMarketValue,
  positionPnlTodayPct,
  positionPnlTotalPct,
  positionPnlUsd,
  applyFetchedMarksToState,
  markIsLive,
  markIsUsable,
  resolveMarkUsd,
  rollSessionIfNeeded,
  summarizeAccount,
  INITIAL_SIM_CASH_USD,
  type MarketSimulationState,
  type SimAssetKind,
  type SimulatedPosition,
} from '../services/marketSimulation';
import { getFinnhubToken } from '../services/tradingQuotes';

function formatUsd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function kindLabel(kind: SimAssetKind): string {
  switch (kind) {
    case 'forex':
      return 'Forex';
    case 'crypto':
      return 'Crypto';
    case 'metal':
      return 'Metal';
    case 'equity':
      return 'Stock';
    default:
      return kind;
  }
}

/** Display current market price by asset type (aligned with Trading Platform conventions). */
function formatMarketPrice(kind: SimAssetKind, symbol: string, price: number | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—';
  if (kind === 'forex') {
    const digits = symbol.includes('JPY') ? 3 : 4;
    return price.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  if (kind === 'crypto') {
    if (price >= 1000) return formatUsd(price);
    if (price >= 1)
      return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  }
  return formatUsd(price);
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/** Gains = green, losses = red (neutral when zero or unknown). */
function gainLossTextClass(n: number | null, variant: 'default' | 'onDark' = 'default'): string {
  if (n == null || !Number.isFinite(n)) return variant === 'onDark' ? 'text-slate-400' : 'text-slate-500';
  if (n > 0) return variant === 'onDark' ? 'text-green-400' : 'text-green-600';
  if (n < 0) return variant === 'onDark' ? 'text-red-400' : 'text-red-600';
  return variant === 'onDark' ? 'text-slate-300' : 'text-slate-600';
}

type Props = {
  userId?: string | null;
  /** When true, compact header for embedding inside Portfolio (full table unchanged). */
  embedded?: boolean;
};

const MarketSimulation: React.FC<Props> = ({ userId, embedded }) => {
  const finnhubConfigured = Boolean(getFinnhubToken());

  const [state, setState] = useState<MarketSimulationState>(() => loadMarketSimulationState(userId));
  const [marksByKey, setMarksByKey] = useState<Record<string, number | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [lastQuoteAt, setLastQuoteAt] = useState<string | null>(null);

  useEffect(() => {
    setState(loadMarketSimulationState(userId));
  }, [userId]);

  /** Apply localStorage immediately so cash/positions update as soon as a trade saves (quotes fetch after). */
  const syncFromStorage = useCallback(() => {
    const uid = userId || undefined;
    const st = loadMarketSimulationState(uid);
    setState(st);
    const cleared: Record<string, number | undefined> = {};
    st.positions.forEach((p) => {
      cleared[p.key] = undefined;
    });
    setMarksByKey(cleared);
  }, [userId]);

  const refresh = useCallback(async () => {
    const uid = userId || undefined;
    try {
      let st = loadMarketSimulationState(uid);
      const token = getFinnhubToken();
      const maps = await fetchMarksForPositions(st.positions, token);
      let byKey = buildMarksByPositionKey(st.positions, maps);
      applyFetchedMarksToState(uid, st.positions, byKey);
      st = loadMarketSimulationState(uid);
      const rollMarks: Record<string, number | undefined> = {};
      st.positions.forEach((p) => {
        rollMarks[p.key] = resolveMarkUsd(p, byKey[p.key], st.lastGoodMarksByKey);
      });
      rollSessionIfNeeded(uid, st, rollMarks);
      st = loadMarketSimulationState(uid);
      const maps2 = await fetchMarksForPositions(st.positions, token);
      byKey = buildMarksByPositionKey(st.positions, maps2);
      applyFetchedMarksToState(uid, st.positions, byKey);
      st = loadMarketSimulationState(uid);
      setMarksByKey(byKey);
      setState(st);
      setLastQuoteAt(new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }));
    } catch {
      syncFromStorage();
    } finally {
      setLoading(false);
    }
  }, [userId, syncFromStorage]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    const onSimEvent = () => {
      syncFromStorage();
      void refresh();
    };
    window.addEventListener(MARKET_SIMULATION_UPDATED_EVENT, onSimEvent);
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onStorage = (e: StorageEvent) => {
      if (!userId || e.key !== localStorageKeyForMarketSim(userId)) return;
      syncFromStorage();
      void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(MARKET_SIMULATION_UPDATED_EVENT, onSimEvent);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh, syncFromStorage, userId]);

  const summary = useMemo(
    () =>
      summarizeAccount(state, (p) =>
        resolveMarkUsd(p, marksByKey[p.key], state.lastGoodMarksByKey)
      ),
    [state, marksByKey]
  );

  const rows = state.positions;

  /** Previous effective mark per row — after each quote refresh, color price up/down vs prior tick (gain green, loss red). */
  const prevMarksRef = useRef<Record<string, number>>({});
  const [priceVsPrev, setPriceVsPrev] = useState<Record<string, 'up' | 'down'>>({});
  useEffect(() => {
    const next: Record<string, 'up' | 'down'> = {};
    for (const p of rows) {
      const live = marksByKey[p.key];
      const mark = resolveMarkUsd(p, live, state.lastGoodMarksByKey);
      const prev = prevMarksRef.current[p.key];
      if (prev != null && Number.isFinite(prev) && Number.isFinite(mark)) {
        if (mark > prev + 1e-9) next[p.key] = 'up';
        else if (mark < prev - 1e-9) next[p.key] = 'down';
      }
      prevMarksRef.current[p.key] = mark;
    }
    setPriceVsPrev(next);
  }, [rows, marksByKey, state.lastGoodMarksByKey]);

  function markPriceSurfaceClass(priceOk: boolean, key: string): string {
    const move = priceVsPrev[key];
    if (move === 'up')
      return priceOk
        ? 'bg-emerald-100/90 text-emerald-950 ring-1 ring-emerald-400/60'
        : 'bg-green-50 text-green-900 ring-1 ring-green-300/50';
    if (move === 'down')
      return priceOk
        ? 'bg-rose-100/90 text-rose-950 ring-1 ring-rose-400/60'
        : 'bg-red-50 text-red-900 ring-1 ring-red-300/50';
    return priceOk ? 'bg-emerald-50/50 text-emerald-950' : 'bg-amber-50/40 text-amber-900';
  }

  /** Column totals + portfolio-level % (today % only when live quotes exist; MV uses effective marks). */
  const columnTotals = useMemo(() => {
    if (rows.length === 0) return null;

    let sumQty = 0;
    let sumBasis = 0;
    let sumMv = 0;
    let sumPnlUsd = 0;
    /** Session notional for rows where we have a current price (for today’s portfolio %). */
    let sumSessionNotionalQuoted = 0;
    let sumDayMoveUsd = 0;

    for (const p of rows) {
      const live = marksByKey[p.key];
      const markUsd = resolveMarkUsd(p, live, state.lastGoodMarksByKey);
      const mv = positionMarketValue(p, markUsd);
      const basis = positionCostBasis(p);
      const u = positionPnlUsd(p, markUsd);

      sumQty += p.qty;
      sumBasis += basis;
      if (u != null) sumPnlUsd += u;

      if (mv != null) sumMv += mv;

      if (markIsUsable(live, state.lastGoodMarksByKey, p.key) && mv != null) {
        const sessionRow = p.qty * p.refOpenUsd;
        sumSessionNotionalQuoted += sessionRow;
        sumDayMoveUsd += mv - sessionRow;
      }
    }

    const todayPctPort =
      sumSessionNotionalQuoted > 1e-9 ? (sumDayMoveUsd / sumSessionNotionalQuoted) * 100 : null;
    const totalPctPort = sumBasis > 1e-9 ? ((sumMv - sumBasis) / sumBasis) * 100 : null;
    const sumSessionNotionalAll = rows.reduce((s, p) => s + p.qty * p.refOpenUsd, 0);

    return {
      n: rows.length,
      sumQty,
      sumBasis,
      sumMv,
      sumPnlUsd,
      sumSessionNotionalAll,
      sumSessionNotionalQuoted,
      todayPctPort,
      totalPctPort,
    };
  }, [rows, marksByKey, state.lastGoodMarksByKey]);

  const summaryCards = (
    <div className="flex flex-wrap gap-3">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cash</p>
        <p className="text-xl font-black tabular-nums text-slate-900">${formatUsd(summary.cashUsd)}</p>
      </div>
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Total wealth</p>
        <p
          className={`text-xl font-black tabular-nums ${
            summary.equityUsd > INITIAL_SIM_CASH_USD + 1e-6
              ? 'text-green-700'
              : summary.equityUsd < INITIAL_SIM_CASH_USD - 1e-6
                ? 'text-red-700'
                : 'text-indigo-950'
          }`}
        >
          ${formatUsd(summary.equityUsd)}
        </p>
        <p className="text-[9px] font-semibold text-indigo-700/90 mt-0.5">Cash + positions market value</p>
      </div>
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Positions value</p>
        <p className="text-xl font-black tabular-nums text-emerald-950">${formatUsd(summary.positionsMvUsd)}</p>
      </div>
    </div>
  );

  return (
    <div
      className={`max-w-[1400px] mx-auto ${embedded ? 'space-y-4 pb-4' : 'space-y-6 pb-16'}`}
    >
      {embedded ? (
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Paper trading</p>
            <h2 className="text-lg font-black text-slate-900 tracking-tight mt-1">Simulated portfolio</h2>
            <p className="text-xs text-slate-500 mt-1">
              Starts at <span className="font-semibold text-slate-700">${formatUsd(INITIAL_SIM_CASH_USD)} USD</span> cash · stored in this
              browser only.
            </p>
          </div>
          {summaryCards}
        </div>
      ) : (
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Market Simulation</h2>
            <p className="text-sm text-slate-500 mt-1">
              Paper-trading account starts at <span className="font-semibold text-slate-700">${formatUsd(INITIAL_SIM_CASH_USD)} USD</span>{' '}
              cash per user. Positions and balances are stored in this browser only.
            </p>
          </div>
          {summaryCards}
        </header>
      )}

      {!finnhubConfigured && rows.some((p) => p.kind !== 'forex') ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Finnhub API key missing.</span> Forex prices still load from the public FX feed; for{' '}
          <strong>live market prices</strong> on stocks, crypto, and metals in this table, add{' '}
          <code className="rounded bg-amber-100 px-1 text-xs">VITE_FINNHUB_KEY</code> to your{' '}
          <code className="rounded bg-amber-100 px-1 text-xs">.env</code>.
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">Simulated portfolio</h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Rows use <span className="font-semibold text-slate-700">mark price × qty</span> (live when the feed returns a price; otherwise the{' '}
              <span className="font-semibold text-slate-700">last saved quote</span> from this browser so values stay correct when the market is closed).
              {lastQuoteAt ? (
                <>
                  {' '}
                  Last refresh attempt: <span className="font-mono text-slate-600">{lastQuoteAt}</span>
                </>
              ) : null}
            </p>
          </div>
          {loading ? <span className="text-xs font-semibold text-indigo-600">Loading quotes…</span> : null}
        </div>

        {/* Mobile / narrow: card list */}
        <div className="lg:hidden divide-y divide-slate-100">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-slate-500 text-sm">
              No positions yet. Open <span className="font-semibold text-indigo-600">Trading Platform</span> and use paper trade to
              build a portfolio.
            </div>
          ) : (
            rows.map((p: SimulatedPosition) => {
              const live = marksByKey[p.key];
              const markUsd = resolveMarkUsd(p, live, state.lastGoodMarksByKey);
              const mv = positionMarketValue(p, markUsd);
              const basis = positionCostBasis(p);
              const tPct = markIsUsable(live, state.lastGoodMarksByKey, p.key)
                ? positionPnlTodayPct(p, markUsd)
                : null;
              const totPct = positionPnlTotalPct(p, markUsd);
              const totUsd = positionPnlUsd(p, markUsd);
              const liveOk = markIsLive(live);
              const usable = markIsUsable(live, state.lastGoodMarksByKey, p.key);
              return (
                <div key={p.key} className="px-4 py-4 space-y-3 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{p.assetLabel}</p>
                      <p className="text-[11px] font-mono text-slate-500">{p.symbol}</p>
                      <span className="mt-1 inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-600">
                        {kindLabel(p.kind)}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase text-slate-400">Mark price</p>
                      <div
                        className={`inline-block rounded-lg px-2 py-1 mt-0.5 font-mono text-lg font-bold tabular-nums transition-colors duration-300 ${markPriceSurfaceClass(liveOk, p.key)}`}
                      >
                        {formatMarketPrice(p.kind, p.symbol, markUsd)}
                      </div>
                      {liveOk ? (
                        <span className="text-[9px] font-semibold uppercase text-emerald-600">Live quote</span>
                      ) : usable ? (
                        <span className="text-[9px] font-semibold text-slate-600">Last quoted (saved)</span>
                      ) : (
                        <span className="text-[9px] text-amber-800">Avg entry (no quote yet)</span>
                      )}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                    <div>
                      <dt className="text-slate-400 font-semibold uppercase text-[10px]">Qty</dt>
                      <dd className="font-mono font-semibold text-slate-900">{p.qty.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-semibold uppercase text-[10px]">Market value</dt>
                      <dd className="font-mono font-semibold text-slate-900">${formatUsd(mv ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-semibold uppercase text-[10px]">Avg entry</dt>
                      <dd className="font-mono text-slate-700">{formatUsd(p.avgEntryUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-semibold uppercase text-[10px]">Cost basis</dt>
                      <dd className="font-mono text-slate-700">${formatUsd(basis)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-semibold uppercase text-[10px]">Today P/L %</dt>
                      <dd className={`font-mono font-semibold ${gainLossTextClass(tPct)}`}>{formatPct(tPct)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400 font-semibold uppercase text-[10px]">Total P/L</dt>
                      <dd className={`font-mono font-semibold ${gainLossTextClass(totPct)}`}>
                        {formatPct(totPct)}{' '}
                        <span className={`font-normal ${gainLossTextClass(totUsd)}`}>
                          ({totUsd != null ? `${totUsd >= 0 ? '+' : '-'}$${formatUsd(Math.abs(totUsd))}` : '—'})
                        </span>
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })
          )}
          {rows.length > 0 && columnTotals ? (
            <div className="px-4 py-4 bg-indigo-950 text-indigo-50 border-t border-indigo-800">
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-3">Portfolio totals</p>
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <dt className="text-indigo-400 text-[10px] font-bold uppercase">Σ Qty (all lines)</dt>
                  <dd className="font-mono font-black tabular-nums">{columnTotals.sumQty.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-indigo-400 text-[10px] font-bold uppercase">Σ Market value</dt>
                  <dd className="font-mono font-black tabular-nums">${formatUsd(columnTotals.sumMv)}</dd>
                </div>
                <div>
                  <dt className="text-indigo-400 text-[10px] font-bold uppercase">Σ Cost basis</dt>
                  <dd className="font-mono font-black tabular-nums">${formatUsd(columnTotals.sumBasis)}</dd>
                </div>
                <div>
                  <dt className="text-indigo-400 text-[10px] font-bold uppercase">Σ Session notional</dt>
                  <dd className="font-mono font-black tabular-nums">${formatUsd(columnTotals.sumSessionNotionalAll)}</dd>
                </div>
                <div>
                  <dt className="text-indigo-400 text-[10px] font-bold uppercase">Today P/L % (port.)</dt>
                  <dd className={`font-mono font-black ${gainLossTextClass(columnTotals.todayPctPort, 'onDark')}`}>
                    {formatPct(columnTotals.todayPctPort)}
                  </dd>
                </div>
                <div>
                  <dt className="text-indigo-400 text-[10px] font-bold uppercase">Total P/L % (port.)</dt>
                  <dd className={`font-mono font-black ${gainLossTextClass(columnTotals.totalPctPort, 'onDark')}`}>
                    {formatPct(columnTotals.totalPctPort)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-indigo-400 text-[10px] font-bold uppercase">Σ Total P/L ($)</dt>
                  <dd
                    className={`font-mono text-lg font-black tabular-nums ${gainLossTextClass(columnTotals.sumPnlUsd, 'onDark')}`}
                  >
                    {columnTotals.sumPnlUsd >= 0 ? '+' : ''}${formatUsd(Math.abs(columnTotals.sumPnlUsd))}
                  </dd>
                </div>
                <div className="col-span-2 pt-2 border-t border-indigo-700/40">
                  <dt className="text-indigo-300 text-[10px] font-bold uppercase">Total wealth</dt>
                  <dd
                    className={`font-mono text-xl font-black tabular-nums ${gainLossTextClass(summary.equityUsd - INITIAL_SIM_CASH_USD, 'onDark')}`}
                  >
                    ${formatUsd(summary.equityUsd)}
                  </dd>
                  <p className="text-[9px] text-indigo-400 mt-1">
                    Cash ${formatUsd(summary.cashUsd)} + positions ${formatUsd(columnTotals.sumMv)}
                  </p>
                </div>
              </dl>
              <p className="text-[10px] text-indigo-400 mt-3 leading-snug">
                Qty is summed across instruments (mixed units). Mark prices use the live feed when available, else the last stored quote (e.g. last close).
                Today&apos;s portfolio % uses those marks vs session open when a usable price exists for the row.
              </p>
            </div>
          ) : null}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm min-w-[1280px]">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3 whitespace-nowrap">Asset</th>
                <th className="px-3 py-3 whitespace-nowrap">Class</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Curr. market price</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Qty</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Market value</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Avg entr.</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Cost basis</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Session open</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Today&apos;s P/L (%)</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Total P/L (%)</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Total P/L ($)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                    No positions yet. Use <span className="font-semibold text-indigo-600">Trading Platform</span> paper trade controls
                    to buy simulated size; sell to free cash.
                  </td>
                </tr>
              ) : (
                rows.map((p: SimulatedPosition) => {
                  const live = marksByKey[p.key];
                  const markUsd = resolveMarkUsd(p, live, state.lastGoodMarksByKey);
                  const mv = positionMarketValue(p, markUsd);
                  const basis = positionCostBasis(p);
                  const tPct = markIsUsable(live, state.lastGoodMarksByKey, p.key)
                    ? positionPnlTodayPct(p, markUsd)
                    : null;
                  const totPct = positionPnlTotalPct(p, markUsd);
                  const totUsd = positionPnlUsd(p, markUsd);
                  const liveOk = markIsLive(live);
                  const usable = markIsUsable(live, state.lastGoodMarksByKey, p.key);
                  return (
                    <tr key={p.key} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-4 py-3 align-top">
                        <span className="font-semibold text-slate-900">{p.assetLabel}</span>
                        <span className="block text-[10px] font-mono text-slate-400">{p.symbol}</span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          {kindLabel(p.kind)}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono tabular-nums font-semibold transition-colors duration-300 ${markPriceSurfaceClass(liveOk, p.key)}`}
                      >
                        <span className="block">{formatMarketPrice(p.kind, p.symbol, markUsd)}</span>
                        {liveOk ? (
                          <span className="text-[9px] font-bold uppercase text-emerald-700">Live</span>
                        ) : usable ? (
                          <span className="text-[9px] font-semibold text-slate-600">Last quoted</span>
                        ) : (
                          <span className="text-[9px] font-semibold text-amber-800">Avg entry</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-900 font-semibold">
                        {p.qty.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-900" title="Qty × mark price">
                        ${formatUsd(mv ?? 0)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-600">
                        {formatMarketPrice(p.kind, p.symbol, p.avgEntryUsd)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-700">
                        ${formatUsd(basis)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-500 text-[11px]">
                        {formatMarketPrice(p.kind, p.symbol, p.refOpenUsd)}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono tabular-nums font-semibold ${gainLossTextClass(tPct)}`}>
                        {formatPct(tPct)}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono tabular-nums font-semibold ${gainLossTextClass(totPct)}`}>
                        {formatPct(totPct)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${gainLossTextClass(totUsd)}`}>
                        {totUsd != null ? `${totUsd >= 0 ? '+' : ''}$${formatUsd(Math.abs(totUsd))}` : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {rows.length > 0 && columnTotals ? (
              <tfoot>
                <tr className="border-t-2 border-indigo-200 bg-indigo-50/90 text-indigo-950">
                  <td className="px-4 py-3 font-black text-indigo-950">
                    Portfolio totals
                    <span className="block text-[10px] font-bold text-indigo-600 normal-case tracking-normal">
                      {columnTotals.n} position{columnTotals.n === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[11px] font-semibold text-indigo-700">—</td>
                  <td className="px-3 py-3 text-right text-[11px] font-semibold text-indigo-700">—</td>
                  <td className="px-3 py-3 text-right font-mono font-black tabular-nums text-indigo-950">
                    {columnTotals.sumQty.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-black tabular-nums text-indigo-950">
                    ${formatUsd(columnTotals.sumMv)}
                  </td>
                  <td className="px-3 py-3 text-right text-[11px] font-semibold text-indigo-700">—</td>
                  <td className="px-3 py-3 text-right font-mono font-black tabular-nums text-indigo-950">
                    ${formatUsd(columnTotals.sumBasis)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-black tabular-nums text-indigo-900 text-[11px]">
                    ${formatUsd(columnTotals.sumSessionNotionalAll)}
                    <span className="block text-[9px] font-semibold text-indigo-600 normal-case">Σ qty × session open</span>
                  </td>
                  <td className={`px-3 py-3 text-right font-mono font-black tabular-nums ${gainLossTextClass(columnTotals.todayPctPort)}`}>
                    {formatPct(columnTotals.todayPctPort)}
                    <span className="block text-[9px] font-semibold text-slate-600 normal-case">portfolio</span>
                  </td>
                  <td className={`px-3 py-3 text-right font-mono font-black tabular-nums ${gainLossTextClass(columnTotals.totalPctPort)}`}>
                    {formatPct(columnTotals.totalPctPort)}
                    <span className="block text-[9px] font-semibold text-slate-600 normal-case">portfolio</span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-black tabular-nums ${gainLossTextClass(columnTotals.sumPnlUsd)}`}>
                    {columnTotals.sumPnlUsd >= 0 ? '+' : ''}${formatUsd(Math.abs(columnTotals.sumPnlUsd))}
                  </td>
                </tr>
                <tr className="border-t border-indigo-300 bg-white">
                  <td className="px-4 py-3 font-black text-indigo-950" colSpan={7}>
                    Total wealth
                    <span className="block text-[10px] font-semibold text-slate-600 normal-case tracking-normal">
                      Cash + market value of open positions (updates when you sell — proceeds add to cash)
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-black tabular-nums text-lg text-indigo-950" colSpan={4}>
                    <span className={`${gainLossTextClass(summary.equityUsd - INITIAL_SIM_CASH_USD)}`}>${formatUsd(summary.equityUsd)}</span>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        {rows.length > 0 ? (
          <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
            <p>
              <span className="font-semibold text-slate-600">Market value</span> = quantity × mark (live quote when returned; otherwise last saved quote from this browser when the session is idle).
              This page refreshes about every 15 seconds.
            </p>
            <p>
              The <span className="font-semibold text-slate-700">totals row</span> sums market value, cost basis, session notional, and P/L ($).
              Today&apos;s portfolio % uses marks that include both live polls and persisted last quotes.
            </p>
            <p>
              Today&apos;s P/L compares mark price to session open when a usable quote exists (live or last saved); otherwise &ldquo;—&rdquo;.
              Total P/L uses mark vs <span className="font-semibold">average entry</span> only if no quotes were ever saved.
              The price cell flashes <span className="text-green-700 font-semibold">green</span> / <span className="text-red-700 font-semibold">red</span> vs the prior refresh when new live data arrives.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default MarketSimulation;
