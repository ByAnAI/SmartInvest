import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchCommodityForecast,
  type CommodityForecastPayload,
  type CommodityHorizonForecast,
} from '../services/commodityForecast';

function pctProb(x: number | undefined): string {
  if (x == null || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function conf(x: number | undefined): string {
  if (x == null || Number.isNaN(x)) return '—';
  return `${Math.round(x)}%`;
}

function fmtPrice(x: number | undefined): string {
  if (x == null || Number.isNaN(x)) return '—';
  if (x >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return x.toFixed(2);
}

const HorizonCard: React.FC<{ row: CommodityHorizonForecast }> = ({ row }) => {
  const po = row.path_outcomes;
  return (
    <div className="rounded-lg border border-amber-100 bg-white px-2.5 py-2 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-1 mb-1.5">
        <p className="text-[9px] font-black uppercase tracking-wide text-amber-900">{row.label}</p>
        <span className="text-[9px] font-bold text-amber-700/80 tabular-nums">
          Conf. {conf(row.confidence_percent)}
        </span>
      </div>
      <p className="text-xs font-mono font-bold text-slate-900 tabular-nums">
        E[price] {fmtPrice(row.expected_price)}
        <span className="text-[10px] font-sans font-semibold text-slate-500 ml-1">
          ({row.expected_return_percent != null && row.expected_return_percent >= 0 ? '+' : ''}
          {row.expected_return_percent?.toFixed(2) ?? '—'}%)
        </span>
      </p>
      <div className="grid grid-cols-3 gap-1 mt-2 text-[10px]">
        <div className="rounded border border-emerald-100 bg-emerald-50/70 px-1 py-1">
          <p className="text-[8px] font-black uppercase text-emerald-800">Resistance</p>
          <p className="font-bold tabular-nums text-emerald-900">{pctProb(po?.hit_resistance?.probability)}</p>
          <p className="text-emerald-800/90">Conf {conf(po?.hit_resistance?.confidence_percent)}</p>
        </div>
        <div className="rounded border border-slate-100 bg-slate-50 px-1 py-1">
          <p className="text-[8px] font-black uppercase text-slate-600">Sideways</p>
          <p className="font-bold tabular-nums text-slate-900">{pctProb(po?.sideways?.probability)}</p>
          <p className="text-slate-600">Conf {conf(po?.sideways?.confidence_percent)}</p>
        </div>
        <div className="rounded border border-rose-100 bg-rose-50/70 px-1 py-1">
          <p className="text-[8px] font-black uppercase text-rose-800">Support</p>
          <p className="font-bold tabular-nums text-rose-900">{pctProb(po?.hit_support?.probability)}</p>
          <p className="text-rose-800/90">Conf {conf(po?.hit_support?.confidence_percent)}</p>
        </div>
      </div>
    </div>
  );
};

const CommodityHMMForecast: React.FC<{ commodityId: string; commodityLabel?: string }> = ({
  commodityId,
  commodityLabel,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CommodityForecastPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchCommodityForecast(commodityId);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Could not load HMM forecast.');
    } finally {
      setLoading(false);
    }
  }, [commodityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const regime = data?.forecast?.hmm_regime as
    | { dominant_state?: string; leading_probability?: number; regime_unstable?: boolean }
    | undefined;
  const horizons = data?.forecast?.horizons ?? [];

  return (
    <div className="mx-4 mb-4 md:mx-5 rounded-xl border border-amber-200/90 bg-gradient-to-br from-white to-amber-50/40 px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-900">
            HMM price outlook · {commodityLabel ?? commodityId}
          </p>
          <p className="text-[10px] text-amber-800/80 mt-0.5">
            3-state daily HMM (RSI+MACD) · support / resistance / sideways per horizon
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-[10px] font-bold uppercase tracking-wide text-amber-800 hover:text-amber-950 disabled:opacity-50"
        >
          {loading ? 'Training…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="text-xs text-rose-700 leading-snug">{error}</p> : null}

      {!error && regime ? (
        <p className="text-[10px] text-slate-600 mb-2">
          Regime: <strong>{regime.dominant_state}</strong>
          {regime.leading_probability != null ? (
            <span className="tabular-nums"> ({(regime.leading_probability * 100).toFixed(0)}%)</span>
          ) : null}
          {regime.regime_unstable ? (
            <span className="text-amber-700 font-semibold"> · unstable</span>
          ) : null}
          {data?.forecast?.bars_used != null ? (
            <span className="text-slate-400"> · {data.forecast.bars_used} daily bars</span>
          ) : null}
        </p>
      ) : null}

      {!error && horizons.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {horizons.map((h) => (
            <HorizonCard key={h.horizon_id} row={h} />
          ))}
        </div>
      ) : null}

      {!error && !loading && horizons.length === 0 ? (
        <p className="text-xs text-slate-500">No horizon data returned.</p>
      ) : null}

      <p className="mt-2 text-[9px] text-slate-400 leading-snug">
        {data?.forecast?.meta?.disclaimer ??
          'Model output from historical daily OHLC — not investment advice.'}
      </p>
    </div>
  );
};

export default CommodityHMMForecast;
