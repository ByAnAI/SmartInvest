import React, { useState, useEffect } from 'react';
import { getStockInsight } from '../services/geminiService';
import { getDailyWatchlist } from '../services/supabaseService';
import { InsightResponse } from '../types';

const AIAnalysis: React.FC = () => {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [error, setError] = useState('');
  const [todayWatchlist, setTodayWatchlist] = useState<string[]>([]);

  useEffect(() => {
    getDailyWatchlist().then((w) => {
      if (w && w.symbols.length) setTodayWatchlist(w.symbols);
    });
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol) return;

    setLoading(true);
    setError('');
    try {
      const data = await getStockInsight(symbol.toUpperCase());
      setInsight(data);
    } catch (err) {
      setError('Could not fetch analysis. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-gradient-to-br from-indigo-900 to-indigo-700 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
        {/* Abstract background blobs */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full blur-3xl opacity-20 -mr-32 -mt-32"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500 rounded-full blur-3xl opacity-10 -ml-24 -mb-24"></div>
        
        <div className="relative z-10 text-center space-y-4">
          <h2 className="text-3xl font-bold">Smart AI Market Intelligence</h2>
          <p className="text-indigo-100 max-w-lg mx-auto">
            Enter a ticker symbol and let our AI analyze fundamentals, sentiment, and recent news to give you a smart recommendation.
          </p>
          <form onSubmit={handleAnalyze} className="max-w-md mx-auto flex items-center bg-white/10 backdrop-blur-md p-2 rounded-2xl border border-white/20">
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. MSFT, GOOGL, TSLA"
              className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-indigo-200 px-4 py-3 font-medium uppercase"
            />
            <button
              disabled={loading}
              className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-xl font-bold transition-all disabled:opacity-50"
            >
              {loading ? 'Analyzing...' : 'Generate Insight'}
            </button>
          </form>
        </div>
      </div>

      {/* Today's watchlist — read-only; only admin can create it (in Admin panel) */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <h3 className="text-slate-900 font-bold uppercase tracking-widest text-sm mb-2">Watchlist of the day</h3>
        <p className="text-slate-500 text-xs font-medium mb-4">Set by your manager. View only.</p>
        {todayWatchlist.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {todayWatchlist.map((s) => (
              <span key={s} className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold border border-indigo-100">
                {s}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-slate-400 text-sm font-medium">No watchlist set for today.</p>
        )}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-xl text-center font-medium">
          ⚠️ {error}
        </div>
      )}

      {insight && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {/* Main Recommendation */}
          <div className="md:col-span-2 space-y-6">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wider">AI RECOMMENDATION</h3>
                  <p className="text-3xl font-bold mt-1">{insight.sentiment}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-sm font-semibold">CONFIDENCE</p>
                  <div className="flex items-center mt-1 space-x-2">
                    <div className="w-32 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 rounded-full" 
                        style={{ width: `${insight.confidence}%` }}
                      ></div>
                    </div>
                    <span className="text-lg font-bold text-emerald-600">{insight.confidence}%</span>
                  </div>
                </div>
              </div>
              <p className="text-slate-700 leading-relaxed text-lg">
                {insight.recommendation}
              </p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold mb-4">Market Summary</h3>
              <p className="text-slate-600 leading-relaxed">
                {insight.summary}
              </p>
            </div>
          </div>

          {/* Pros and Cons */}
          <div className="space-y-6">
            <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
              <h4 className="text-emerald-700 font-bold mb-4 flex items-center">
                <span className="mr-2">🚀</span> Growth Drivers
              </h4>
              <ul className="space-y-3">
                {insight.pros.map((pro, i) => (
                  <li key={i} className="flex items-start text-sm text-emerald-800">
                    <span className="text-emerald-500 mr-2 mt-0.5">✓</span>
                    {pro}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-rose-50 p-6 rounded-2xl border border-rose-100">
              <h4 className="text-rose-700 font-bold mb-4 flex items-center">
                <span className="mr-2">⚠️</span> Risk Factors
              </h4>
              <ul className="space-y-3">
                {insight.cons.map((con, i) => (
                  <li key={i} className="flex items-start text-sm text-rose-800">
                    <span className="text-rose-400 mr-2 mt-0.5">✕</span>
                    {con}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {!insight && !loading && (
        <div className="text-center py-20 bg-slate-100/50 rounded-3xl border border-dashed border-slate-300">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-slate-500 font-medium">Analysis will appear here</h3>
        </div>
      )}
    </div>
  );
};

export default AIAnalysis;
