import { useCallback, useEffect, useState } from 'react';
import {
  accountSummaryFromStoredState,
  applyFetchedMarksToState,
  buildMarksByPositionKey,
  fetchMarksForPositions,
  loadMarketSimulationState,
  localStorageKeyForMarketSim,
  MARKET_SIMULATION_UPDATED_EVENT,
  resolveMarkUsd,
  rollSessionIfNeeded,
  summarizeAccount,
  type AccountSummary,
} from '../services/marketSimulation';
import { getFinnhubToken } from '../services/tradingQuotes';

export function useMarketSimulationSummary(userId: string | null | undefined, pollMs = 15_000) {
  const [summary, setSummary] = useState<AccountSummary | null>(null);

  /** Immediate cash/equity from localStorage (no network). Keeps UI in sync after buy/sell. */
  const applyLocalSummary = useCallback(() => {
    setSummary(accountSummaryFromStoredState(userId));
  }, [userId]);

  const refresh = useCallback(async () => {
    const uid = userId || undefined;
    try {
      let state = loadMarketSimulationState(uid);
      const token = getFinnhubToken();
      const maps = await fetchMarksForPositions(state.positions, token);
      let byKey = buildMarksByPositionKey(state.positions, maps);
      applyFetchedMarksToState(uid, state.positions, byKey);
      state = loadMarketSimulationState(uid);
      const rollMarks: Record<string, number | undefined> = {};
      state.positions.forEach((p) => {
        rollMarks[p.key] = resolveMarkUsd(p, byKey[p.key], state.lastGoodMarksByKey);
      });
      rollSessionIfNeeded(uid, state, rollMarks);
      state = loadMarketSimulationState(uid);
      const maps2 = await fetchMarksForPositions(state.positions, token);
      byKey = buildMarksByPositionKey(state.positions, maps2);
      applyFetchedMarksToState(uid, state.positions, byKey);
      state = loadMarketSimulationState(uid);
      const sum = summarizeAccount(state, (p) =>
        resolveMarkUsd(p, byKey[p.key], state.lastGoodMarksByKey)
      );
      setSummary(sum);
    } catch {
      applyLocalSummary();
    }
  }, [userId, applyLocalSummary]);

  useEffect(() => {
    applyLocalSummary();
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    const onSimTrade = () => {
      applyLocalSummary();
      void refresh();
    };
    window.addEventListener(MARKET_SIMULATION_UPDATED_EVENT, onSimTrade);
    const onStorage = (e: StorageEvent) => {
      if (!userId || e.key !== localStorageKeyForMarketSim(userId)) return;
      applyLocalSummary();
      void refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(MARKET_SIMULATION_UPDATED_EVENT, onSimTrade);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh, applyLocalSummary, pollMs, userId]);

  return { summary, refresh };
}
