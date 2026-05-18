/**
 * Paper-trading account: default $100k USD cash, positions in localStorage per user.
 */

import {
  CRYPTO_QUOTE_ROWS,
  METAL_QUOTE_ROWS,
  fetchFinnhubQuotes,
  fetchForexTradingPrices,
} from './tradingQuotes';

export const INITIAL_SIM_CASH_USD = 100_000;

export const MARKET_SIMULATION_UPDATED_EVENT = 'marketSimulationUpdated';

export type SimAssetKind = 'forex' | 'crypto' | 'metal' | 'equity';

export type SimulatedPosition = {
  /** Stable id for React keys */
  key: string;
  kind: SimAssetKind;
  symbol: string;
  assetLabel: string;
  qty: number;
  avgEntryUsd: number;
  /** Snapshot price at session open for today's P/L (local calendar day). */
  refOpenUsd: number;
};

export type MarketSimulationState = {
  cashUsd: number;
  positions: SimulatedPosition[];
  sessionDate: string;
  /**
   * Last successful USD mark per position key (from Finnhub / FX API when a quote returned).
   * Used when the market is closed or a poll fails so portfolio value stays on the last known price.
   */
  lastGoodMarksByKey?: Record<string, number>;
  /** ISO time when `lastGoodMarksByKey` was last updated from a live fetch (or initial buy fill). */
  lastGoodMarksAtIso?: string;
};

function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function posKey(kind: SimAssetKind, symbol: string): string {
  return `${kind}:${symbol}`;
}

function emptyState(): MarketSimulationState {
  return { cashUsd: INITIAL_SIM_CASH_USD, positions: [], sessionDate: localDateStr() };
}

function storageKey(userId: string): string {
  return `smartinvest_market_sim_v2_${userId}`;
}

export function loadMarketSimulationState(userId: string | undefined | null): MarketSimulationState {
  if (!userId) return emptyState();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return emptyState();
    const p = JSON.parse(raw) as Partial<MarketSimulationState>;
    const cashUsd = typeof p.cashUsd === 'number' && Number.isFinite(p.cashUsd) ? p.cashUsd : INITIAL_SIM_CASH_USD;
    const positions = Array.isArray(p.positions)
      ? p.positions
          .filter(
            (x): x is SimulatedPosition =>
              x != null &&
              typeof x === 'object' &&
              typeof x.key === 'string' &&
              typeof x.qty === 'number' &&
              x.qty > 0 &&
              typeof x.avgEntryUsd === 'number' &&
              typeof x.refOpenUsd === 'number'
          )
          .map((x) => ({
            ...x,
            qty: x.qty,
            avgEntryUsd: x.avgEntryUsd,
            refOpenUsd: x.refOpenUsd,
          }))
      : [];
    const sessionDate = typeof p.sessionDate === 'string' ? p.sessionDate : localDateStr();
    let lastGoodMarksByKey: Record<string, number> | undefined;
    if (p.lastGoodMarksByKey && typeof p.lastGoodMarksByKey === 'object') {
      const raw = p.lastGoodMarksByKey as Record<string, unknown>;
      lastGoodMarksByKey = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) lastGoodMarksByKey[k] = n;
      }
      if (Object.keys(lastGoodMarksByKey).length === 0) lastGoodMarksByKey = undefined;
    }
    const lastGoodMarksAtIso =
      typeof p.lastGoodMarksAtIso === 'string' && p.lastGoodMarksAtIso.trim() ? p.lastGoodMarksAtIso.trim() : undefined;
    return { cashUsd, positions, sessionDate, lastGoodMarksByKey, lastGoodMarksAtIso };
  } catch {
    return emptyState();
  }
}

export function saveMarketSimulationState(userId: string | undefined | null, state: MarketSimulationState): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MARKET_SIMULATION_UPDATED_EVENT));
    }
  } catch {
    /* ignore quota */
  }
}

/** Total market value of all positions at given mark prices (sum of qty * price). */
function sumPositionValue(positions: SimulatedPosition[], mark: (p: SimulatedPosition) => number | undefined): number {
  let s = 0;
  for (const p of positions) {
    const px = mark(p);
    if (px == null || !Number.isFinite(px)) continue;
    s += p.qty * px;
  }
  return s;
}

export type AccountSummary = {
  cashUsd: number;
  positionsMvUsd: number;
  equityUsd: number;
};

export function summarizeAccount(state: MarketSimulationState, mark: (p: SimulatedPosition) => number | undefined): AccountSummary {
  const positionsMvUsd = sumPositionValue(state.positions, mark);
  const equityUsd = state.cashUsd + positionsMvUsd;
  return { cashUsd: state.cashUsd, positionsMvUsd, equityUsd };
}

/**
 * Finnhub/network often misses a quote (no API key, rate limit, symbol format). Using `undefined`
 * as mark made market value $0 while cost basis stayed positive — showing a fake total loss.
 * Falls back to average entry so MV ≈ cost and P/L stays ~0 until a live price returns.
 */
export function effectiveMarkUsd(p: SimulatedPosition, live: number | undefined): number {
  if (live != null && Number.isFinite(live) && live > 0) return live;
  const a = p.avgEntryUsd;
  return Number.isFinite(a) && a > 0 ? a : 1e-8;
}

/**
 * Mark used for valuation: live quote when present, else last persisted good price (last close / last poll),
 * else average entry (legacy fallback).
 */
export function resolveMarkUsd(
  p: SimulatedPosition,
  live: number | undefined,
  lastGoodByKey: Record<string, number> | undefined
): number {
  if (live != null && Number.isFinite(live) && live > 0) return live;
  const cached = lastGoodByKey?.[p.key];
  if (cached != null && Number.isFinite(cached) && cached > 0) return cached;
  return effectiveMarkUsd(p, undefined);
}

/** True if we have a live poll price this round. */
export function markIsLive(live: number | undefined): boolean {
  return live != null && Number.isFinite(live) && live > 0;
}

/** True if live quote or a persisted last-good mark exists (market closed / stale poll still shows last value). */
export function markIsUsable(live: number | undefined, lastGoodByKey: Record<string, number> | undefined, key: string): boolean {
  if (markIsLive(live)) return true;
  const c = lastGoodByKey?.[key];
  return c != null && Number.isFinite(c) && c > 0;
}

/**
 * Merge successful live marks into persisted state so closed-market views keep the last closing/current values.
 */
export function applyFetchedMarksToState(
  userId: string | undefined | null,
  positions: SimulatedPosition[],
  liveByKey: Record<string, number | undefined>
): void {
  if (!userId) return;
  const state = loadMarketSimulationState(userId);
  const prev = state.lastGoodMarksByKey ?? {};
  const next: Record<string, number> = { ...prev };
  let updated = false;
  const holdKeys = new Set(positions.map((x) => x.key));
  for (const k of Object.keys(next)) {
    if (!holdKeys.has(k)) {
      delete next[k];
      updated = true;
    }
  }
  for (const p of positions) {
    const live = liveByKey[p.key];
    if (markIsLive(live)) {
      next[p.key] = live!;
      updated = true;
    }
  }
  const nextState: MarketSimulationState = {
    ...state,
    lastGoodMarksByKey: Object.keys(next).length ? next : undefined,
    lastGoodMarksAtIso: updated ? new Date().toISOString() : state.lastGoodMarksAtIso,
  };
  saveMarketSimulationState(userId, nextState);
}

/** Sidebar / instant UI: read localStorage and value positions using last good marks when no live poll. */
export function accountSummaryFromStoredState(userId: string | undefined | null): AccountSummary {
  const state = loadMarketSimulationState(userId);
  return summarizeAccount(state, (p) => resolveMarkUsd(p, undefined, state.lastGoodMarksByKey));
}

export function localStorageKeyForMarketSim(userId: string): string {
  return storageKey(userId);
}

export function hasLiveQuote(live: number | undefined): boolean {
  return live != null && Number.isFinite(live) && live > 0;
}

export function positionPnlTodayPct(p: SimulatedPosition, price: number | undefined): number | null {
  if (price == null || !Number.isFinite(price) || !Number.isFinite(p.refOpenUsd) || p.refOpenUsd <= 0) return null;
  return ((price - p.refOpenUsd) / p.refOpenUsd) * 100;
}

export function positionPnlTotalPct(p: SimulatedPosition, price: number | undefined): number | null {
  if (price == null || !Number.isFinite(price) || !Number.isFinite(p.avgEntryUsd) || p.avgEntryUsd <= 0) return null;
  return ((price - p.avgEntryUsd) / p.avgEntryUsd) * 100;
}

export function positionCostBasis(p: SimulatedPosition): number {
  return p.qty * p.avgEntryUsd;
}

export function positionMarketValue(p: SimulatedPosition, price: number | undefined): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  return p.qty * price;
}

export function positionPnlUsd(p: SimulatedPosition, price: number | undefined): number | null {
  const mv = positionMarketValue(p, price);
  if (mv == null) return null;
  return mv - positionCostBasis(p);
}

function roundCash(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Add USD to paper-trading cash (e.g. proceeds from vault sells). */
export function creditSimCashUsd(userId: string | undefined | null, usd: number): void {
  if (!userId || !(Number.isFinite(usd) && usd > 0)) return;
  const state = loadMarketSimulationState(userId);
  saveMarketSimulationState(userId, {
    ...state,
    cashUsd: roundCash(state.cashUsd + usd),
  });
}

export type BuyInput = {
  kind: SimAssetKind;
  symbol: string;
  assetLabel: string;
  qty: number;
  priceUsd: number;
};

export function simulateBuy(userId: string | undefined | null, input: BuyInput): { ok: true } | { ok: false; reason: string } {
  if (!userId) return { ok: false, reason: 'Not signed in.' };
  const qty = input.qty;
  const px = input.priceUsd;
  if (!(qty > 0) || !(px > 0)) return { ok: false, reason: 'Quantity and price must be positive.' };
  const gross = qty * px;
  const state = loadMarketSimulationState(userId);
  if (state.cashUsd + 1e-9 < gross) return { ok: false, reason: 'Insufficient cash.' };

  const key = posKey(input.kind, input.symbol);
  const idx = state.positions.findIndex((x) => x.key === key);
  let positions = [...state.positions];

  const lastGood = { ...(state.lastGoodMarksByKey ?? {}) };
  lastGood[key] = px;

  if (idx >= 0) {
    const cur = positions[idx];
    const newQty = cur.qty + qty;
    const newAvg = (cur.qty * cur.avgEntryUsd + qty * px) / newQty;
    positions[idx] = {
      ...cur,
      qty: newQty,
      avgEntryUsd: newAvg,
      assetLabel: input.assetLabel || cur.assetLabel,
    };
  } else {
    positions.push({
      key,
      kind: input.kind,
      symbol: input.symbol,
      assetLabel: input.assetLabel,
      qty,
      avgEntryUsd: px,
      refOpenUsd: px,
    });
  }

  saveMarketSimulationState(userId, {
    ...state,
    cashUsd: roundCash(state.cashUsd - gross),
    positions,
    sessionDate: state.sessionDate,
    lastGoodMarksByKey: lastGood,
    lastGoodMarksAtIso: new Date().toISOString(),
  });
  return { ok: true };
}

export type SellInput = {
  kind: SimAssetKind;
  symbol: string;
  qty: number;
  priceUsd: number;
};

export function simulateSell(
  userId: string | undefined | null,
  input: SellInput
): { ok: true; soldQty: number; proceedsUsd: number } | { ok: false; reason: string } {
  if (!userId) return { ok: false, reason: 'Not signed in.' };
  const qty = input.qty;
  const px = input.priceUsd;
  if (!(qty > 0) || !(px > 0)) return { ok: false, reason: 'Quantity and price must be positive.' };

  const state = loadMarketSimulationState(userId);
  const key = posKey(input.kind, input.symbol);
  const idx = state.positions.findIndex((x) => x.key === key);
  if (idx < 0) return { ok: false, reason: 'No position for this asset.' };
  const cur = state.positions[idx];
  const sellQty = Math.min(qty, cur.qty);
  const proceeds = sellQty * px;
  let positions = [...state.positions];

  if (sellQty >= cur.qty - 1e-12) {
    positions.splice(idx, 1);
  } else {
    positions[idx] = { ...cur, qty: cur.qty - sellQty };
  }

  const lastGood = { ...(state.lastGoodMarksByKey ?? {}) };
  if (sellQty >= cur.qty - 1e-12) {
    delete lastGood[key];
  }

  saveMarketSimulationState(userId, {
    ...state,
    cashUsd: roundCash(state.cashUsd + proceeds),
    positions,
    lastGoodMarksByKey: Object.keys(lastGood).length ? lastGood : undefined,
  });
  return { ok: true, soldQty: sellQty, proceedsUsd: roundCash(proceeds) };
}

/**
 * Advance session when the calendar day changes: set refOpenUsd to current marks so "today" P/L resets at local midnight.
 */
export function rollSessionIfNeeded(
  userId: string | undefined | null,
  state: MarketSimulationState,
  marks: Record<string, number | undefined>
): MarketSimulationState {
  const today = localDateStr();
  if (state.sessionDate === today) return state;

  if (state.positions.length === 0) {
    const next = { ...state, sessionDate: today };
    if (userId) saveMarketSimulationState(userId, next);
    return next;
  }

  const nextPositions = state.positions.map((p) => {
    const px = marks[p.key];
    return {
      ...p,
      refOpenUsd: px != null && Number.isFinite(px) ? px : p.refOpenUsd,
    };
  });

  const next = { ...state, sessionDate: today, positions: nextPositions };
  if (userId) saveMarketSimulationState(userId, next);
  return next;
}

/** Build mark map keyed by position.key for roll + display. */
export function buildMarksByPositionKey(
  positions: SimulatedPosition[],
  maps: {
    fx: Record<string, number>;
    crypto: Record<string, number>;
    metal: Record<string, number>;
    equityByTicker: Record<string, number>;
  }
): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const p of positions) {
    let px: number | undefined;
    switch (p.kind) {
      case 'forex':
        px = maps.fx[p.symbol];
        break;
      case 'crypto':
        px = maps.crypto[p.symbol];
        break;
      case 'metal':
        px = maps.metal[p.symbol];
        break;
      case 'equity':
        px = maps.equityByTicker[p.symbol.toUpperCase()];
        break;
      default:
        px = undefined;
    }
    out[p.key] = px;
  }
  return out;
}

/** Fetch quotes needed for the given positions (batch Finnhub where possible). */
export async function fetchMarksForPositions(
  positions: SimulatedPosition[],
  finnhubToken: string | undefined
): Promise<{
  fx: Record<string, number>;
  crypto: Record<string, number>;
  metal: Record<string, number>;
  equityByTicker: Record<string, number>;
}> {
  const fx = await fetchForexTradingPrices();

  const cryptoSyms = [...new Set(positions.filter((p) => p.kind === 'crypto').map((p) => p.symbol))];
  const metalSyms = [...new Set(positions.filter((p) => p.kind === 'metal').map((p) => p.symbol))];
  const tickers = [...new Set(positions.filter((p) => p.kind === 'equity').map((p) => p.symbol.toUpperCase()))];

  const cryptoFinnhub = cryptoSyms
    .map((id) => CRYPTO_QUOTE_ROWS.find((r) => r.id === id)?.finnhub)
    .filter((x): x is string => !!x);
  const metalFinnhub = metalSyms
    .map((id) => METAL_QUOTE_ROWS.find((r) => r.id === id)?.finnhub)
    .filter((x): x is string => !!x);

  const equityFinnhub = tickers.map((t) => t);

  let raw: Record<string, number> = {};
  if (finnhubToken) {
    const symbols = [...new Set([...cryptoFinnhub, ...metalFinnhub, ...equityFinnhub])];
    raw = await fetchFinnhubQuotes(symbols, finnhubToken);
  }

  const crypto: Record<string, number> = {};
  CRYPTO_QUOTE_ROWS.forEach((row) => {
    const v = raw[row.finnhub];
    if (v != null) crypto[row.id] = v;
  });

  const metal: Record<string, number> = {};
  METAL_QUOTE_ROWS.forEach((row) => {
    const v = raw[row.finnhub];
    if (v != null) metal[row.id] = v;
  });

  const equityByTicker: Record<string, number> = {};
  tickers.forEach((t) => {
    const v = raw[t];
    if (v != null) equityByTicker[t] = v;
  });

  return { fx, crypto, metal, equityByTicker };
}
