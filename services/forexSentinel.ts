/**
 * Forex OHLC refresh (backend) + HMM/Sentinel context for “Forex Sentinel Alpha”.
 */

import { fetchWatchlistApi, readWatchlistJson } from '../utils/watchlistApiFetch';

/** Same keys as ``currency_data/EURUSD/`` on disk — strips slashes/dashes (EUR/USD → EURUSD). */
export function normalizeForexPairSymbol(raw: string): string {
  return raw.replace(/\W/g, '').toUpperCase();
}

export async function postForexRefresh(
  apiBase: string,
  opts: { pair?: string; currency?: string }
): Promise<{ refreshed: string[]; errors: string[]; count: number }> {
  const res = await fetchWatchlistApi(apiBase, '/api/forex/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pair: opts.pair ? normalizeForexPairSymbol(opts.pair) : undefined,
      currency: opts.currency?.trim().toUpperCase() || undefined,
    }),
  });
  const data = (await readWatchlistJson<{ refreshed?: string[]; errors?: string[]; count?: number }>(res)) || {};
  return {
    refreshed: data.refreshed ?? [],
    errors: data.errors ?? [],
    count: typeof data.count === 'number' ? data.count : (data.refreshed?.length ?? 0),
  };
}

export async function fetchForexSentinelContext(
  apiBase: string,
  pair: string,
  sentiment?: { score: number; confidence: number },
  opts?: { hmmAndFxDataOnly?: boolean }
): Promise<Record<string, unknown>> {
  const res = await fetchWatchlistApi(apiBase, '/api/forex/sentinel-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pair: normalizeForexPairSymbol(pair),
      sentiment_score: sentiment?.score ?? 0,
      sentiment_confidence: sentiment?.confidence ?? 0,
      hmm_and_fx_data_only: opts?.hmmAndFxDataOnly ?? false,
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { detail?: unknown };
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `Forex sentinel context failed (${res.status})`);
  }
  return (await res.json()) as Record<string, unknown>;
}
