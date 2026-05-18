import React, { useCallback, useEffect, useState } from 'react';
import { FOREX_TICKERS } from './ForexData';
import { fetchFinnhubCompanyNewsBundle } from '../services/finnhubCompanyNews';
import { fetchForexSentinelContext } from '../services/forexSentinel';
import { getDefaultWatchlistApiBase } from '../utils/watchlistApiFetch';

type ScenarioBlock = {
  label?: string;
  probability?: number;
  confidence_percent?: number;
  path_probability_hit_resistance_before_support?: number;
  path_probability_hit_support_before_resistance?: number;
  range_quality_between_nearest_sr?: number;
};

type DirectionalForecast = {
  scenarios?: {
    up?: ScenarioBlock;
    neutral?: ScenarioBlock;
    down?: ScenarioBlock;
  };
  touch_race?: {
    probability_resistance_hit_before_support?: number;
    probability_support_hit_before_resistance?: number;
    nearest_resistance?: number;
    nearest_support?: number;
  };
  pivot_levels?: { pivot?: number; r1?: number; s1?: number };
};

const SUPPORTED = new Set(FOREX_TICKERS.map((r) => r.symbol));

function pct(x: number | undefined): string {
  if (x == null || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function conf(x: number | undefined): string {
  if (x == null || Number.isNaN(x)) return '—';
  return `${Math.round(x)}%`;
}

const ForexDirectionalForecast: React.FC<{ pairId: string }> = ({ pairId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<DirectionalForecast | null>(null);

  const load = useCallback(async () => {
    if (!SUPPORTED.has(pairId)) {
      setForecast(null);
      setError('Forecast uses Watchlist API OHLC — this synthetic cross is not in the forex registry.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let score = 0;
      let confSent = 0;
      try {
        const bundle = await fetchFinnhubCompanyNewsBundle(pairId.toUpperCase());
        if (bundle.status === 'ok' && bundle.articles?.length) {
          confSent = Math.min(1, bundle.articles.length / 25);
        }
      } catch {
        /* optional */
      }
      const raw = await fetchForexSentinelContext(getDefaultWatchlistApiBase(), pairId, {
        score,
        confidence: confSent,
      });
      const df = raw.directional_forecast as DirectionalForecast | undefined;
      setForecast(df ?? null);
      if (!df) setError('No directional_forecast in API response — update Watchlist API backend.');
    } catch (e: unknown) {
      setForecast(null);
      setError(e instanceof Error ? e.message : 'Could not load forecast.');
    } finally {
      setLoading(false);
    }
  }, [pairId]);

  useEffect(() => {
    void load();
  }, [load]);

  const up = forecast?.scenarios?.up;
  const mid = forecast?.scenarios?.neutral;
  const dn = forecast?.scenarios?.down;
  const race = forecast?.touch_race;

  if (!SUPPORTED.has(pairId)) {
    return (
      <div className="mx-4 mb-3 md:mx-5 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-900">
        Directional probabilities (HMM + news + pivots) apply to registry FX pairs with CSV data under the Watchlist API host.
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 md:mx-5 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          Collective probability · News + HMM + pivots / RSI / MACD
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-rose-700">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-2 py-2">
              <p className="text-[9px] font-black uppercase text-emerald-800">Up / toward R</p>
              <p className="font-black text-emerald-900 tabular-nums">{pct(up?.probability)}</p>
              <p className="text-[10px] text-emerald-800 mt-1">Confidence {conf(up?.confidence_percent)}</p>
              <p className="text-[10px] text-slate-600 mt-1">
                Path P(resist before support){' '}
                <span className="font-mono font-bold">{pct(up?.path_probability_hit_resistance_before_support)}</span>
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
              <p className="text-[9px] font-black uppercase text-slate-600">Sideways</p>
              <p className="font-black text-slate-900 tabular-nums">{pct(mid?.probability)}</p>
              <p className="text-[10px] text-slate-600 mt-1">Confidence {conf(mid?.confidence_percent)}</p>
              <p className="text-[10px] text-slate-600 mt-1">
                Range quality{' '}
                <span className="font-mono font-bold">{mid?.range_quality_between_nearest_sr?.toFixed(2) ?? '—'}</span>
              </p>
            </div>
            <div className="rounded-lg border border-rose-100 bg-rose-50/60 px-2 py-2">
              <p className="text-[9px] font-black uppercase text-rose-800">Down / toward S</p>
              <p className="font-black text-rose-900 tabular-nums">{pct(dn?.probability)}</p>
              <p className="text-[10px] text-rose-800 mt-1">Confidence {conf(dn?.confidence_percent)}</p>
              <p className="text-[10px] text-slate-600 mt-1">
                Path P(support before resist){' '}
                <span className="font-mono font-bold">{pct(dn?.path_probability_hit_support_before_resistance)}</span>
              </p>
            </div>
          </div>
          {race ? (
            <p className="mt-2 text-[10px] text-slate-500 leading-snug">
              Distance race (nearest R vs S): first touch hits resistance ~{' '}
              <strong>{pct(race.probability_resistance_hit_before_support)}</strong>, support ~{' '}
              <strong>{pct(race.probability_support_hit_before_resistance)}</strong>
              {race.nearest_resistance != null && race.nearest_support != null ? (
                <>
                  {' '}
                  · R≈{race.nearest_resistance.toFixed(5)} S≈{race.nearest_support.toFixed(5)}
                </>
              ) : null}
            </p>
          ) : null}
          <p className="mt-2 text-[9px] text-slate-400">
            Run <code className="font-mono bg-slate-100 px-1 rounded">POST /api/forex/refresh</code> if CSVs are missing.
            Not investment advice.
          </p>
        </>
      )}
    </div>
  );
};

export default ForexDirectionalForecast;
