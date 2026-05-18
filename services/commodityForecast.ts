/**
 * Commodity HMM multi-horizon forecasts (Watchlist API).
 */

import { fetchWatchlistApi, getDefaultWatchlistApiBase, readWatchlistJson } from '../utils/watchlistApiFetch';

export type CommodityPathOutcome = {
  label?: string;
  probability?: number;
  confidence_percent?: number;
};

export type CommodityHorizonForecast = {
  horizon_id: string;
  label: string;
  trading_days: number;
  expected_price?: number;
  current_price?: number;
  expected_return_percent?: number;
  confidence_percent?: number;
  hmm_regime_probabilities?: { bear?: number; neutral?: number; bull?: number };
  path_outcomes?: {
    hit_resistance?: CommodityPathOutcome;
    hit_support?: CommodityPathOutcome;
    sideways?: CommodityPathOutcome;
  };
};

export type CommodityForecastPayload = {
  commodity_id: string;
  label?: string;
  analysis_mode?: string;
  sentiment?: { score?: number; confidence?: number; source?: string };
  forecast?: {
    current_price?: number;
    bars_used?: number;
    hmm_regime?: Record<string, unknown>;
    horizons?: CommodityHorizonForecast[];
    meta?: { disclaimer?: string };
  };
};

export async function fetchCommodityForecast(
  commodityId: string,
  opts?: {
    apiBase?: string;
    sentimentScore?: number;
    sentimentConfidence?: number;
    useCsvSentiment?: boolean;
  }
): Promise<CommodityForecastPayload> {
  const apiBase = opts?.apiBase ?? getDefaultWatchlistApiBase();
  const body: Record<string, unknown> = {
    commodity_id: commodityId.trim().toUpperCase(),
    use_csv_sentiment: opts?.useCsvSentiment ?? true,
  };
  if (opts?.sentimentScore != null) body.sentiment_score = opts.sentimentScore;
  if (opts?.sentimentConfidence != null) body.sentiment_confidence = opts.sentimentConfidence;

  const res = await fetchWatchlistApi(apiBase, '/api/commodities/forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { detail?: unknown };
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `Commodity forecast failed (${res.status})`);
  }
  return (await res.json()) as CommodityForecastPayload;
}
