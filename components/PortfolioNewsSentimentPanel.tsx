import React, { useCallback, useState } from 'react';
import {
  fetchPortfolioNewsSentiment,
  formatAvSentiment,
  newsHealthColor,
  type PortfolioNewsSentimentResult,
} from '../services/portfolioNewsSentiment';

type Props = {
  equitySymbols: string[];
};

const PortfolioNewsSentimentPanel: React.FC<Props> = ({ equitySymbols }) => {
  const [newsSentiment, setNewsSentiment] = useState<PortfolioNewsSentimentResult | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [expandedNewsTicker, setExpandedNewsTicker] = useState<string | null>(null);

  const loadPortfolioNewsSentiment = useCallback(async () => {
    if (equitySymbols.length === 0) {
      setNewsError('Add equity holdings to analyze news sentiment.');
      return;
    }
    setNewsLoading(true);
    setNewsError(null);
    try {
      const data = await fetchPortfolioNewsSentiment(equitySymbols);
      setNewsSentiment(data);
    } catch (e: unknown) {
      setNewsSentiment(null);
      setNewsError(e instanceof Error ? e.message : 'Could not load news sentiment.');
    } finally {
      setNewsLoading(false);
    }
  }, [equitySymbols]);

  return (
    <div className="border border-indigo-100 rounded-xl p-4 mb-4 bg-gradient-to-br from-indigo-50/50 to-white">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-black text-indigo-800 uppercase tracking-widest">
            News sentiment · Alpha Vantage
          </p>
          <p className="text-[9px] text-slate-500 mt-1 leading-snug max-w-xl">
            Per-position average of article sentiment scores (−1 bearish … +1 bullish). Portfolio health = sum of
            position averages ÷ number of positions with data.{' '}
            <a
              href="https://www.alphavantage.co/documentation/#news-sentiment"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline"
            >
              API docs
            </a>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPortfolioNewsSentiment()}
          disabled={newsLoading || equitySymbols.length === 0}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {newsLoading ? 'Fetching news…' : 'Refresh news & sentiment'}
        </button>
      </div>
      {newsError ? <p className="text-xs text-rose-700 mb-2">{newsError}</p> : null}
      {newsLoading ? (
        <p className="text-xs text-indigo-700">
          Loading Alpha Vantage news for {Math.min(equitySymbols.length, 15)} ticker(s) — free tier allows ~5 calls/min;
          this may take a few minutes.
        </p>
      ) : null}
      {newsSentiment && !newsLoading ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="border border-indigo-100 rounded-lg p-3 bg-white">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Portfolio health</p>
              <p className={`text-2xl font-black ${newsHealthColor(newsSentiment.portfolio_health_score)}`}>
                {newsSentiment.portfolio_health_score != null
                  ? newsSentiment.portfolio_health_score.toFixed(1)
                  : '—'}
                <span className="text-sm font-bold text-slate-400"> / 100</span>
              </p>
              <p className="text-[9px] text-slate-500 mt-1">{newsSentiment.portfolio_health_label}</p>
            </div>
            <div className="border border-indigo-100 rounded-lg p-3 bg-white">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Avg sentiment</p>
              <p className="text-2xl font-black text-slate-800">
                {formatAvSentiment(newsSentiment.portfolio_average_sentiment)}
              </p>
              <p className="text-[9px] text-slate-500 mt-1">
                {newsSentiment.positions_with_data} of {newsSentiment.positions_requested} positions
              </p>
            </div>
            <div className="border border-indigo-100 rounded-lg p-3 bg-white">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Coverage</p>
              <p className="text-2xl font-black text-indigo-700">
                {equitySymbols.length
                  ? ((newsSentiment.positions_with_data / equitySymbols.length) * 100).toFixed(0)
                  : 0}
                %
              </p>
              {newsSentiment.skipped_symbols.length > 0 ? (
                <p className="text-[9px] text-slate-500 mt-1 truncate" title={newsSentiment.skipped_symbols.join(', ')}>
                  Skipped non-equity: {newsSentiment.skipped_symbols.join(', ')}
                </p>
              ) : null}
            </div>
          </div>
          <div className="overflow-x-auto border border-indigo-100 rounded-lg">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-indigo-50/80">
                <tr>
                  <th className="px-3 py-2 text-left font-black text-indigo-900 uppercase">Ticker</th>
                  <th className="px-3 py-2 text-right font-black text-indigo-900 uppercase">Avg sentiment</th>
                  <th className="px-3 py-2 text-right font-black text-indigo-900 uppercase">Label</th>
                  <th className="px-3 py-2 text-right font-black text-indigo-900 uppercase">Articles</th>
                  <th className="px-3 py-2 text-right font-black text-indigo-900 uppercase">Headlines</th>
                </tr>
              </thead>
              <tbody>
                {newsSentiment.positions.map((p) => (
                  <React.Fragment key={p.symbol}>
                    <tr className="border-t border-indigo-50">
                      <td className="px-3 py-2 font-black text-slate-800">{p.symbol}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatAvSentiment(p.average_sentiment)}</td>
                      <td
                        className={`px-3 py-2 text-right font-bold ${
                          p.sentiment_label === 'Bullish'
                            ? 'text-emerald-600'
                            : p.sentiment_label === 'Bearish'
                              ? 'text-rose-600'
                              : 'text-amber-600'
                        }`}
                      >
                        {p.error ? 'Error' : p.sentiment_label}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{p.article_count}</td>
                      <td className="px-3 py-2 text-right">
                        {p.articles.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setExpandedNewsTicker((t) => (t === p.symbol ? null : p.symbol))}
                            className="text-[10px] font-bold uppercase text-indigo-600 hover:text-indigo-800"
                          >
                            {expandedNewsTicker === p.symbol ? 'Hide' : 'Show'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    {expandedNewsTicker === p.symbol && p.articles.length > 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-2 bg-slate-50">
                          <ul className="space-y-2">
                            {p.articles.slice(0, 8).map((a, i) => (
                              <li key={`${p.symbol}-${i}`} className="text-[11px] leading-snug">
                                {a.url ? (
                                  <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-semibold text-indigo-800 hover:underline"
                                  >
                                    {a.title || 'Untitled'}
                                  </a>
                                ) : (
                                  <span className="font-semibold text-slate-800">{a.title || 'Untitled'}</span>
                                )}
                                <span className="text-slate-500">
                                  {' '}
                                  · {a.source ?? '—'} · {formatAvSentiment(a.sentiment)} ({a.sentiment_label ?? '—'})
                                </span>
                              </li>
                            ))}
                          </ul>
                          {p.error ? <p className="text-rose-600 text-[10px] mt-1">{p.error}</p> : null}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : !newsLoading && !newsError ? (
        <p className="text-xs text-slate-500">
          Click refresh to load headlines and sentiment for your equity holdings via{' '}
          <span className="font-semibold">ALPHA_VANTAGE_API_KEY</span>.
        </p>
      ) : null}
    </div>
  );
};

export default PortfolioNewsSentimentPanel;
