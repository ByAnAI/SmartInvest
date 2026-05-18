import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { getDailyWatchlist, getDailyWatchlistItems } from '../services/supabaseService';
import type { DailyWatchlistItem } from '../types';
import { fetchFinnhubQuotes, getFinnhubToken } from '../services/tradingQuotes';
import PaperTradeBar from './PaperTradeBar';

function formatStockOrMetal(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Props = {
  userId?: string | null;
  paperTradingAllowed?: boolean;
};

/**
 * Team daily watchlist + paper equity trades for Market Simulation (USD).
 * Lives at the bottom of the Portfolio page.
 */
const Sp500PaperSimulation: React.FC<Props> = ({ userId, paperTradingAllowed = true }) => {
  const [simUserId, setSimUserId] = useState<string | null>(userId ?? null);
  const [watchlistLabel, setWatchlistLabel] = useState<string>('');
  const [watchRows, setWatchRows] = useState<DailyWatchlistItem[]>([]);
  const [watchLoading, setWatchLoading] = useState(true);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [liveEquity, setLiveEquity] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const finnhubKey = getFinnhubToken();

  useEffect(() => {
    setSimUserId(userId ?? null);
  }, [userId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSimUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSimUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadWatchlist = useCallback(async () => {
    setWatchLoading(true);
    setWatchError(null);
    try {
      const latest = await getDailyWatchlist();
      if (!latest) {
        setWatchlistLabel('No watchlist snapshot');
        setWatchRows([]);
        return;
      }
      setWatchlistLabel(latest.label || `WatchList-of-${latest.watchlist_date}`);
      const rows = await getDailyWatchlistItems(latest.id, latest.watchlist_date);
      setWatchRows(rows || []);
    } catch {
      setWatchError('Could not load the daily watchlist.');
      setWatchRows([]);
    } finally {
      setWatchLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWatchlist();
    const channel = supabase
      .channel('portfolio-sp500-paper-watchlist')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_watchlist' }, () => void loadWatchlist())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_watchlist_items' }, () => void loadWatchlist())
      .subscribe();
    const vis = () => document.visibilityState === 'visible' && void loadWatchlist();
    document.addEventListener('visibilitychange', vis);
    const poll = window.setInterval(() => void loadWatchlist(), 60000);
    return () => {
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
    if (watchlistTickers.length === 0 || !finnhubKey) {
      setLiveEquity({});
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
  }, [watchlistTickers, finnhubKey]);

  const sortedWatchRows = useMemo(() => {
    return [...watchRows].sort((a, b) =>
      String(a.symbol || '').localeCompare(String(b.symbol || ''), undefined, { sensitivity: 'base' })
    );
  }, [watchRows]);

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-5 md:px-8 md:py-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <h3 className="text-sm font-black uppercase tracking-widest text-white">S&amp;P market simulation</h3>
        <p className="text-xs text-slate-300 mt-2 max-w-2xl leading-relaxed">
          Paper-trade the team&apos;s daily equity watchlist into your simulated account (same as{' '}
          <span className="font-semibold text-indigo-200">Market Simulation</span>). Uses live Finnhub quotes when configured.
        </p>
        <p className="text-[11px] text-slate-400 mt-2 font-medium">{watchlistLabel}</p>
        {lastUpdated ? (
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">Quotes updated {lastUpdated}</p>
        ) : null}
        {!finnhubKey && (
          <p className="text-xs text-amber-200 mt-3 bg-white/10 rounded-lg px-3 py-2 inline-block">
            Set <code className="bg-black/20 px-1 rounded">VITE_FINNHUB_KEY</code> for live equity prices; otherwise snapshot prices
            from the watchlist are used.
          </p>
        )}
      </div>

      {watchLoading ? (
        <div className="p-10 text-center text-slate-500 text-sm">Loading watchlist…</div>
      ) : watchError ? (
        <div className="p-10 text-center text-rose-600 text-sm">{watchError}</div>
      ) : sortedWatchRows.length === 0 ? (
        <div className="p-10 text-center text-slate-500 text-sm">No watchlist rows yet. An admin can publish today&apos;s list.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="px-5 md:px-8 py-3">Symbol</th>
                <th className="px-3 py-3 hidden sm:table-cell">Company</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 md:px-8 py-3 min-w-[200px]">Paper trade</th>
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
                    <td className="px-5 md:px-8 py-3 font-mono font-bold text-slate-900">{sym}</td>
                    <td className="px-3 py-3 hidden sm:table-cell text-slate-600 max-w-[220px] truncate">
                      {row.company || '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {show != null && typeof show === 'number' ? (
                        <>
                          <span className="text-slate-900 font-semibold">{formatStockOrMetal(show)}</span>
                          {live != null && (
                            <span className="block text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Live</span>
                          )}
                          {live == null && snap != null && (
                            <span className="block text-[10px] text-slate-400 uppercase tracking-wide">Snapshot</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 md:px-8 py-3 align-top">
                      <PaperTradeBar
                        userId={simUserId}
                        kind="equity"
                        symbol={sym}
                        assetLabel={String(row.company || sym)}
                        price={typeof show === 'number' ? show : undefined}
                        defaultQty="10"
                        paperTradingAllowed={paperTradingAllowed}
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
  );
};

export default Sp500PaperSimulation;
