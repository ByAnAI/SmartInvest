import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  analyzeTickerNewsSentiment,
  equityHoldingsFromSimulation,
  portfolioAggregateSentiment,
} from '../services/sentimentAnalysis';
import { MARKET_SIMULATION_UPDATED_EVENT } from '../services/marketSimulation';
import { getFinnhubToken } from '../services/tradingQuotes';
import type { TickerNewsSentimentAnalysis } from '../types';

type RowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: TickerNewsSentimentAnalysis }
  | { status: 'no_news'; data: TickerNewsSentimentAnalysis }
  | { status: 'error'; message: string };

const SENTIMENT_ROWS_STORAGE_V1 = 'smartinvest_sentiment_rows_v1';

function sentimentStorageKey(userId: string | null | undefined): string {
  return `${SENTIMENT_ROWS_STORAGE_V1}_${userId ?? '__guest__'}`;
}

function reviveRowState(raw: unknown): RowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const status = o.status;
  if (status === 'idle') return { status: 'idle' };
  if (status === 'loading') return { status: 'idle' };
  if (status === 'error' && typeof o.message === 'string') return { status: 'error', message: o.message };
  if (status !== 'ok' && status !== 'no_news') return null;
  const data = o.data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<TickerNewsSentimentAnalysis>;
  if (typeof d.ticker !== 'string' || !Array.isArray(d.article_analysis)) return null;
  return { status: status as 'ok' | 'no_news', data: data as TickerNewsSentimentAnalysis };
}

function loadPersistedRows(userId: string | null | undefined): Record<string, RowState> {
  try {
    const raw = localStorage.getItem(sentimentStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, RowState> = {};
    for (const [ticker, val] of Object.entries(parsed)) {
      const row = reviveRowState(val);
      if (row) out[ticker] = row;
    }
    return out;
  } catch {
    return {};
  }
}

function persistRows(userId: string | null | undefined, rows: Record<string, RowState>): void {
  try {
    localStorage.setItem(sentimentStorageKey(userId), JSON.stringify(rows));
  } catch {
    /* quota / private mode */
  }
}

function clearPersistedRows(userId: string | null | undefined): void {
  try {
    localStorage.removeItem(sentimentStorageKey(userId));
  } catch {
    /* ignore */
  }
}

function labelBadgeClass(label: string): string {
  const u = label.toUpperCase();
  if (u === 'BULLISH') return 'bg-emerald-100 text-emerald-900 border-emerald-300';
  if (u === 'BEARISH') return 'bg-rose-100 text-rose-900 border-rose-300';
  return 'bg-amber-100 text-amber-950 border-amber-300';
}

function directionClass(d: string): string {
  const u = d.toUpperCase().replace(/\s+/g, ' ');
  if (u === 'UP') return 'text-emerald-700';
  if (u === 'DOWN') return 'text-rose-700';
  return 'text-amber-700';
}

function polarityCellClass(sentiment: string): string {
  const u = sentiment.toUpperCase();
  if (u === 'POSITIVE') return 'text-emerald-700 font-bold';
  if (u === 'NEGATIVE') return 'text-rose-700 font-bold';
  return 'text-amber-700 font-bold';
}

function polarityRowTint(sentiment: string): string {
  const u = sentiment.toUpperCase();
  if (u === 'POSITIVE') return 'bg-emerald-50/70';
  if (u === 'NEGATIVE') return 'bg-rose-50/70';
  return 'bg-amber-50/70';
}

type Props = { userId?: string | null };

const SentimentAnalysis: React.FC<Props> = ({ userId }) => {
  const finnhubOk = Boolean(getFinnhubToken());

  /** Re-read paper equity holdings when simulated portfolio changes (otherwise useMemo[userId] alone misses new buys). */
  const [simRevision, setSimRevision] = useState(0);
  useEffect(() => {
    const bump = () => setSimRevision((n) => n + 1);
    window.addEventListener(MARKET_SIMULATION_UPDATED_EVENT, bump);
    return () => window.removeEventListener(MARKET_SIMULATION_UPDATED_EVENT, bump);
  }, []);

  const holdings = useMemo(() => equityHoldingsFromSimulation(userId), [userId, simRevision]);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  /** Load cached sentiment/news per user when switching account; keep results across navigation until Clear. */
  useEffect(() => {
    setCacheLoaded(false);
    setRows(loadPersistedRows(userId));
    setCacheLoaded(true);
  }, [userId]);

  /** New equity tickers start as idle; existing tickers keep cached ok/no_news/error. */
  useEffect(() => {
    if (!cacheLoaded) return;
    setRows((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const h of holdings) {
        if (!(h.ticker in next)) {
          next[h.ticker] = { status: 'idle' };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [holdings, cacheLoaded]);

  /** Persist after analysis completes or Clear; survives tab changes and refresh. */
  useEffect(() => {
    if (!cacheLoaded) return;
    persistRows(userId, rows);
  }, [userId, rows, cacheLoaded]);

  const clearResults = useCallback(() => {
    clearPersistedRows(userId);
    setRows({});
  }, [userId]);

  /** Every completed ticker contributes: full runs (`ok`) and empty-news stubs (`no_news` = neutral baseline). Errors skipped. */
  const portfolioSentimentInputs = useMemo(() => {
    const list: TickerNewsSentimentAnalysis[] = [];
    holdings.forEach((h) => {
      const r = rows[h.ticker];
      if (r?.status === 'ok') list.push(r.data);
      else if (r?.status === 'no_news') list.push(r.data);
    });
    return list;
  }, [holdings, rows]);

  const aggregate = useMemo(() => portfolioAggregateSentiment(portfolioSentimentInputs), [portfolioSentimentInputs]);

  const analyzedCount = portfolioSentimentInputs.length;
  const totalHoldings = holdings.length;

  const runAnalysis = async () => {
    if (!holdings.length || running) return;
    setRunning(true);
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    for (let i = 0; i < holdings.length; i++) {
      const { ticker, companyName } = holdings[i];
      setRows((prev) => ({ ...prev, [ticker]: { status: 'loading' } }));
      try {
        const data = await analyzeTickerNewsSentiment(ticker, companyName);
        const isEmpty = data.article_analysis.length === 0;
        setRows((prev) => ({
          ...prev,
          [ticker]: isEmpty ? { status: 'no_news', data } : { status: 'ok', data },
        }));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setRows((prev) => ({ ...prev, [ticker]: { status: 'error', message } }));
      }
      if (i < holdings.length - 1) await delay(450);
    }
    setRunning(false);
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6 pb-16 animate-in fade-in duration-500">
      <header className="space-y-2">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Sentiment analysis</h2>
        <p className="text-sm text-slate-600 max-w-3xl">
          News-driven sentiment for every <span className="font-semibold text-slate-800">stock</span> in your simulated portfolio.
          Uses Finnhub company headlines and summaries, then scores them with your configured AI model (same token as AI Analysis).
        </p>
      </header>

      {!finnhubOk ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Finnhub key missing.</span> Add{' '}
          <code className="rounded bg-amber-100 px-1 text-xs">VITE_FINNHUB_KEY</code> to load company news.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={running || !holdings.length || !finnhubOk}
          className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-black uppercase tracking-wide shadow-lg shadow-indigo-500/25 hover:bg-indigo-700 disabled:opacity-45 disabled:pointer-events-none transition-colors"
        >
          {running ? 'Analyzing…' : 'Analyze portfolio'}
        </button>
        <button
          type="button"
          onClick={() => clearResults()}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Clear collected news
        </button>
        <span className="text-xs text-slate-500">
          {holdings.length} equity symbol{holdings.length === 1 ? '' : 's'} in paper portfolio · Saved in this browser until you clear
        </span>
      </div>

      {holdings.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          <p className="font-semibold text-slate-800 mb-2">No stock positions yet</p>
          <p className="text-sm mb-4">Use paper trade on Trading Platform to buy equities; only <span className="font-semibold">stock</span> holdings are analyzed here.</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('changeTab', { detail: 'trading-platform' }))}
            className="text-indigo-600 font-bold text-sm hover:underline"
          >
            Open Trading Platform →
          </button>
        </div>
      ) : null}

      {holdings.length > 0 && analyzedCount > 0 ? (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Portfolio sentiment (signal-weighted mean)</p>
            <span className="text-[11px] font-bold text-indigo-800 bg-white/80 px-2 py-1 rounded-lg border border-indigo-100 tabular-nums">
              {running
                ? `${analyzedCount} / ${totalHoldings} tickers so far`
                : `${aggregate.count} of ${aggregate.totalAnalyzed} in avg${aggregate.usedFallback ? ' (fallback: all)' : ''}`}
            </span>
          </div>
          <div className="flex flex-wrap gap-6 items-end">
            <div>
              <p className="text-xs text-indigo-700 font-semibold">Total portfolio score</p>
              <p
                className={`text-3xl font-black tabular-nums ${
                  aggregate.label === 'BULLISH'
                    ? 'text-emerald-800'
                    : aggregate.label === 'BEARISH'
                      ? 'text-rose-800'
                      : 'text-amber-800'
                }`}
              >
                {aggregate.avgScore != null ? aggregate.avgScore.toFixed(3) : '—'}
              </p>
              <p className="text-[10px] text-indigo-600 mt-1">
                Mean of overall sentiment (−1 … +1) over tickers with non-zero or non-neutral news signal only; divide by that count. If none qualify, uses all analyzed tickers.
              </p>
            </div>
            <div>
              <p className="text-xs text-indigo-700 font-semibold">Portfolio label</p>
              <span
                className={`inline-flex mt-1 px-3 py-1 rounded-lg text-sm font-black border ${labelBadgeClass(aggregate.label)}`}
              >
                {aggregate.label}
              </span>
            </div>
            <p className="text-xs text-indigo-600 max-w-md">
              Updates after each ticker finishes. Portfolio average excludes neutral-only stubs from the denominator when at least one ticker has a clear POSITIVE/NEGATIVE or non-zero score; otherwise all completed tickers are used. Forex/crypto/metals are excluded from this list.
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {holdings.map(({ ticker, companyName }) => {
          const st = rows[ticker] ?? { status: 'idle' as const };
          return (
            <div key={ticker} className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80">
                <div>
                  <p className="text-lg font-black text-slate-900">{ticker}</p>
                  <p className="text-xs text-slate-500">{companyName}</p>
                </div>
                {st.status === 'loading' ? (
                  <span className="text-xs font-bold text-indigo-600">Working…</span>
                ) : null}
                {st.status === 'idle' ? (
                  <span className="text-xs text-slate-400">Not analyzed</span>
                ) : null}
                {st.status === 'error' ? (
                  <span className="text-xs font-semibold text-rose-600 max-w-md text-right">{st.message}</span>
                ) : null}
                {st.status === 'no_news' ? (
                  <div className="flex flex-col items-end gap-1 text-right">
                    <span className="text-xs font-semibold text-amber-800">No articles in range — neutral baseline</span>
                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-md border ${labelBadgeClass(st.data.overall_sentiment.label)}`}>
                      Final: {st.data.overall_sentiment.label} ({st.data.overall_sentiment.score.toFixed(2)})
                    </span>
                  </div>
                ) : null}
                {st.status === 'ok' ? (
                  <span className={`text-xs font-black px-2 py-1 rounded-lg border ${labelBadgeClass(st.data.overall_sentiment.label)}`}>
                    Final: {st.data.overall_sentiment.label} · {st.data.overall_sentiment.score.toFixed(3)}
                  </span>
                ) : null}
              </div>

              {(st.status === 'ok' || st.status === 'no_news') && (
                <div className="p-5 space-y-5">
                  <div
                    className={`rounded-xl border-2 px-4 py-4 flex flex-wrap items-center justify-between gap-4 ${labelBadgeClass(st.data.overall_sentiment.label)}`}
                  >
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Final sentiment (this ticker)</p>
                      <p className="text-xl font-black mt-1 tracking-tight">{st.data.overall_sentiment.label}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Score</p>
                      <p className="text-2xl font-black font-mono tabular-nums mt-0.5">
                        {st.data.overall_sentiment.score.toFixed(3)}
                      </p>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-100 p-4">
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Short-term (1–3 d)</p>
                      <p className={`text-lg font-black ${directionClass(st.data.short_term_impact.direction)}`}>
                        {st.data.short_term_impact.direction}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Confidence <span className="font-mono">{st.data.short_term_impact.confidence.toFixed(2)}</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-100 p-4">
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Detected themes</p>
                      {st.data.detected_events.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {st.data.detected_events.map((ev) => (
                            <span
                              key={ev}
                              className="text-[11px] font-semibold bg-violet-50 text-violet-900 px-2 py-0.5 rounded-md border border-violet-100"
                            >
                              {ev}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">None tagged</p>
                      )}
                    </div>
                  </div>

                  {st.data.article_analysis.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Per-article</p>
                      <div className="overflow-x-auto rounded-xl border border-slate-100">
                        <table className="w-full text-sm min-w-[920px]">
                          <thead>
                            <tr className="text-left text-[10px] font-black uppercase text-slate-400 bg-slate-50">
                              <th className="px-3 py-2">Headline</th>
                              <th className="px-3 py-2 whitespace-nowrap">Source</th>
                              <th className="px-3 py-2 whitespace-nowrap">Article</th>
                              <th className="px-3 py-2 whitespace-nowrap">Sentiment</th>
                              <th className="px-3 py-2 text-right">Score</th>
                              <th className="px-3 py-2 min-w-[200px]">Why</th>
                            </tr>
                          </thead>
                          <tbody>
                            {st.data.article_analysis.map((a, idx) => (
                              <tr
                                key={`${a.title}-${idx}`}
                                className={`border-t border-slate-100 align-top ${polarityRowTint(a.sentiment)}`}
                              >
                                <td className="px-3 py-2 text-slate-900 font-medium max-w-[280px]">{a.title}</td>
                                <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                                  {a.source && a.source !== 'Unknown' ? (
                                    <span className="font-semibold">{a.source}</span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {a.url ? (
                                    <a
                                      href={a.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-indigo-600 font-bold text-xs hover:text-indigo-800 hover:underline"
                                    >
                                      View article ↗
                                    </a>
                                  ) : (
                                    <span className="text-xs text-slate-400">No link</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className={`text-[11px] uppercase tracking-wide ${polarityCellClass(a.sentiment)}`}>
                                    {a.sentiment}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">{a.score.toFixed(2)}</td>
                                <td className="px-3 py-2 text-slate-700 text-xs leading-relaxed">{a.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 max-w-2xl">
        Scores are model estimates from headlines only — not investment advice. Requires{' '}
        <code className="text-slate-700">VITE_HF_API_TOKEN</code> for the JSON model and{' '}
        <code className="text-slate-700">VITE_FINNHUB_KEY</code> for articles.
      </p>
    </div>
  );
};

export default SentimentAnalysis;
