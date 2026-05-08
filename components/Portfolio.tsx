
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getPortfolio, addStock, removeStock, updateStock, clearPortfolio, getDailyWatchlist, getDailyWatchlistItems } from '../services/supabaseService';
import { DailyWatchlistItem, PortfolioItem } from '../types';
import { supabase } from '../services/supabase';
import { SP500_TICKERS } from './SP500Data';
import { NASDAQ_TICKERS } from './NasdaqData';
import { CRYPTO_TICKERS } from './CryptoData';
import { FOREX_TICKERS } from './ForexData';
import Sp500PaperSimulation from './Sp500PaperSimulation';
import MarketSimulation from './MarketSimulation';
import {
  buildMarksByPositionKey,
  creditSimCashUsd,
  applyFetchedMarksToState,
  fetchMarksForPositions,
  resolveMarkUsd,
  loadMarketSimulationState,
  localStorageKeyForMarketSim,
  MARKET_SIMULATION_UPDATED_EVENT,
  type MarketSimulationState,
  type SimulatedPosition,
} from '../services/marketSimulation';
import { getFinnhubToken } from '../services/tradingQuotes';
import { watchlistUserVisibleLabel } from '../utils/watchlistDisplay';

const PORTFOLIO_REFRESH_MS = 300_000; // 5 minutes

const TICKER_DIRECTORY = [
  // EQUITIES
  { symbol: 'AAPL', name: 'Apple Inc.', price: 182.63, category: 'EQUITIES' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', price: 415.50, category: 'EQUITIES' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 145.32, category: 'EQUITIES' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 174.42, category: 'EQUITIES' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 726.13, category: 'EQUITIES' },
  { symbol: 'META', name: 'Meta Platforms Inc.', price: 484.03, category: 'EQUITIES' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', price: 193.57, category: 'EQUITIES' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', price: 742.10, category: 'EQUITIES' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', price: 183.07, category: 'EQUITIES' },
  { symbol: 'V', name: 'Visa Inc.', price: 278.43, category: 'EQUITIES' },

  // NASDAQ
  { symbol: 'AVGO', name: 'Broadcom Inc.', price: 1245.50, category: 'NASDAQ' },
  { symbol: 'COST', name: 'Costco Wholesale', price: 725.30, category: 'NASDAQ' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', price: 176.50, category: 'NASDAQ' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', price: 583.50, category: 'NASDAQ' },
  { symbol: 'ADBE', name: 'Adobe Inc.', price: 542.10, category: 'NASDAQ' },
  { symbol: 'CRM', name: 'Salesforce Inc.', price: 288.40, category: 'NASDAQ' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', price: 154.30, category: 'NASDAQ' },
  { symbol: 'INTT', name: 'Intel Corp.', price: 43.10, category: 'NASDAQ' },
  { symbol: 'CSCO', name: 'Cisco Systems', price: 49.20, category: 'NASDAQ' },
  { symbol: 'PEP', name: 'PepsiCo Inc.', price: 168.40, category: 'NASDAQ' },

  // COMMODITIES
  { symbol: 'GOLD', name: 'Gold Bullion', price: 2034.50, category: 'COMMODITIES' },
  { symbol: 'SILVER', name: 'Silver Bullion', price: 22.85, category: 'COMMODITIES' },
  { symbol: 'PLAT', name: 'Platinum', price: 895.20, category: 'COMMODITIES' },
  { symbol: 'PALL', name: 'Palladium', price: 955.40, category: 'COMMODITIES' },
  { symbol: 'COPPER', name: 'Copper Futures', price: 3.82, category: 'COMMODITIES' },
  { symbol: 'CRUDE', name: 'WTI Crude Oil', price: 78.15, category: 'COMMODITIES' },
  { symbol: 'NATGAS', name: 'Natural Gas', price: 1.85, category: 'COMMODITIES' },
  { symbol: 'ALUM', name: 'Aluminum', price: 2240.00, category: 'COMMODITIES' },
  { symbol: 'NICK', name: 'Nickel', price: 16450.00, category: 'COMMODITIES' },
  { symbol: 'ZINC', name: 'Zinc', price: 2350.00, category: 'COMMODITIES' },
];

interface PortfolioProps {
  userId?: string;
  /** false for administrators — paper buy/sell is for standard members only. */
  paperTradingAllowed?: boolean;
}

type LatestWatchlistMetric = {
  symbol: string;
  company?: string;
  current_price?: number | null;
  iv_ensemble?: number | null;
  iv_upside_pct?: number | null;
  risk_summary_score?: number | null;
  torchlight_score?: number | null;
  torchlight_sentiment?: number | null;
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** `opened_at` is stored as ISO UTC; show in UTC for a clear “bought at” reading. */
function formatBoughtOnUtc(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    d.toLocaleString('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }) + ' UTC'
  );
}

/** Merge vault holdings with paper equity positions for health / what-if rows (by ticker). */
function mergeVaultAndSimEquities(items: PortfolioItem[], simPositions: SimulatedPosition[]) {
  const equities = simPositions.filter((p) => p.kind === 'equity');
  const map = new Map<
    string,
    {
      shares: number;
      avgCost: number;
      hasVault: boolean;
      hasSim: boolean;
      openedAt?: string;
      firstBuyPrice?: number;
    }
  >();

  for (const i of items) {
    const t = i.symbol.toUpperCase();
    map.set(t, {
      shares: i.shares,
      avgCost: i.avgCost,
      hasVault: true,
      hasSim: false,
      openedAt: i.openedAt,
      firstBuyPrice: i.firstBuyPrice ?? i.avgCost,
    });
  }
  for (const p of equities) {
    const t = p.symbol.toUpperCase();
    const cur = map.get(t);
    if (cur) {
      const sh = cur.shares + p.qty;
      const vw = sh > 0 ? (cur.shares * cur.avgCost + p.qty * p.avgEntryUsd) / sh : cur.avgCost;
      map.set(t, {
        shares: sh,
        avgCost: vw,
        hasVault: cur.hasVault,
        hasSim: true,
        openedAt: cur.openedAt,
        firstBuyPrice: cur.firstBuyPrice,
      });
    } else {
      map.set(t, {
        shares: p.qty,
        avgCost: p.avgEntryUsd,
        hasVault: false,
        hasSim: true,
        openedAt: undefined,
        firstBuyPrice: p.avgEntryUsd,
      });
    }
  }

  return [...map.entries()].map(([symbol, v]) => ({
    symbol,
    shares: v.shares,
    avgCost: v.avgCost,
    openedAt: v.openedAt,
    firstBuyPrice: v.firstBuyPrice,
    companyNote:
      v.hasVault && v.hasSim ? ' · vault + paper' : v.hasSim && !v.hasVault ? ' · paper sim' : '',
  }));
}

const Portfolio: React.FC<PortfolioProps> = ({ userId, paperTradingAllowed = true }) => {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const [lastPrices, setLastPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<'EQUITIES' | 'COMMODITIES' | 'NASDAQ' | 'S&P' | 'CRYPTO' | 'FOREX' | 'ALL'>('EQUITIES');
  const [liveFxRates, setLiveFxRates] = useState<Record<string, number>>({});
  const [latestWatchlistLabel, setLatestWatchlistLabel] = useState<string>('No watchlist snapshot available');
  const [latestMetricsBySymbol, setLatestMetricsBySymbol] = useState<Record<string, LatestWatchlistMetric>>({});
  const [healthLoading, setHealthLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [simState, setSimState] = useState<MarketSimulationState>(() =>
    loadMarketSimulationState(undefined)
  );
  /** Live marks for non-equity sim positions (crypto/forex/metal) — refreshed with vault totals. */
  const [simMarksForKey, setSimMarksForKey] = useState<Record<string, number | undefined>>({});
  const [vaultSellTarget, setVaultSellTarget] = useState<PortfolioItem | null>(null);
  const [vaultSellQty, setVaultSellQty] = useState('1');
  const [vaultSelling, setVaultSelling] = useState(false);

  // Manual Entry State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualSymbol, setManualSymbol] = useState('');
  const [manualShares, setManualShares] = useState('1');
  const [manualPrice, setManualPrice] = useState('');

  // Add-from-list modal: ticker chosen from list, volume default 1 (user can adjust), price is live
  type ListStock = { symbol: string; name: string; price: number; category: string };
  const [showAddFromListModal, setShowAddFromListModal] = useState(false);
  const [addFromListStock, setAddFromListStock] = useState<ListStock | null>(null);
  const [addFromListVolume, setAddFromListVolume] = useState('1');

  // Editable volume in table
  const [editingVolumeSymbol, setEditingVolumeSymbol] = useState<string | null>(null);
  const [editingVolumeValue, setEditingVolumeValue] = useState('');

  // Use the passed userId (from App when logged in) or fallback to current session
  const [currentUid, setCurrentUid] = useState<string | undefined>(userId);

  useEffect(() => {
    if (userId) {
      setCurrentUid(userId);
    } else if (!currentUid) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          setCurrentUid(session.user.id);
        }
      });
    }
  }, [userId]);

  useEffect(() => {
    const uid = currentUid ?? userId;
    const sync = () => setSimState(loadMarketSimulationState(uid));
    sync();
    window.addEventListener(MARKET_SIMULATION_UPDATED_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (!uid || e.key !== localStorageKeyForMarketSim(uid)) return;
      sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MARKET_SIMULATION_UPDATED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, [currentUid, userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#simulated-portfolio') return;
    if (loading) return;
    const id = requestAnimationFrame(() =>
      document.getElementById('simulated-portfolio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
    return () => cancelAnimationFrame(id);
  }, [loading]);

  // Fetch live forex rates on mount
  useEffect(() => {
    const fetchForexRates = async () => {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();
        if (data?.rates) {
          const computed: Record<string, number> = {};
          FOREX_TICKERS.forEach(pair => {
            const { base, quote, symbol } = pair;
            const baseInUsd = base === 'USD' ? 1 : 1 / (data.rates[base] || 1);
            const quotePerUsd = data.rates[quote] || 1;
            computed[symbol] = Number((baseInUsd * quotePerUsd).toFixed(5));
          });
          setLiveFxRates(computed);
        }
      } catch (e) {
        console.warn('Forex rate fetch failed', e);
      }
    };
    fetchForexRates();
    // Refresh every 60 seconds
    const interval = setInterval(fetchForexRates, 60000);
    return () => clearInterval(interval);
  }, []);

  const finnhubKey = (import.meta.env.VITE_FINNHUB_KEY as string | undefined)?.trim() || undefined;

  const mergedPriceSymbols = useMemo(() => {
    const fromSim = simState.positions.filter((p) => p.kind === 'equity').map((p) => p.symbol);
    return [
      ...new Set(
        [...items.map((i) => i.symbol), ...fromSim, addFromListStock?.symbol].filter(Boolean) as string[]
      ),
    ];
  }, [items, simState.positions, addFromListStock?.symbol]);

  // Live market prices: Finnhub when key is set, otherwise simulated tick
  useEffect(() => {
    const symbols = mergedPriceSymbols;
    if (symbols.length === 0) return;

    if (finnhubKey) {
      const fetchLive = async () => {
        const updates: Record<string, number> = {};
        await Promise.all(
          symbols.map(async (symbol) => {
            try {
              const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`);
              const data = await res.json();
              if (data?.c != null && typeof data.c === 'number') {
                updates[symbol] = Number(data.c.toFixed(2));
              }
            } catch {
              // keep previous
            }
          })
        );
        setMarketPrices(prev => {
          setLastPrices(prev);
          return { ...prev, ...updates };
        });
        setLastSync(new Date().toLocaleTimeString());
      };
      fetchLive();
      const interval = setInterval(fetchLive, 25000);
      return () => clearInterval(interval);
    }

    // No API key: simulated live tick (price changes with market feel)
    const interval = setInterval(() => {
      setMarketPrices(prev => {
        const next = { ...prev };
        const nextLast = { ...prev };
        symbols.forEach((sym) => {
          const upper = sym.toUpperCase();
          const item = items.find((i) => i.symbol.toUpperCase() === upper);
          const simEq = simState.positions.find(
            (p) => p.kind === 'equity' && p.symbol.toUpperCase() === upper
          );
          const seed = item?.avgCost ?? simEq?.avgEntryUsd ?? 100;
          const currentPrice = next[sym] ?? seed;
          const fluctuation = currentPrice * (Math.random() * 0.002 - 0.001);
          nextLast[sym] = currentPrice;
          next[sym] = Number((currentPrice + fluctuation).toFixed(2));
        });
        setLastPrices(nextLast);
        return next;
      });
      setLastSync(new Date().toLocaleTimeString());
    }, 3000);
    return () => clearInterval(interval);
  }, [mergedPriceSymbols, items, simState.positions, finnhubKey]);

  // Ensure S&P assets have variety in prices
  useMemo(() => {
    SP500_TICKERS.forEach(t => {
      if (t.price === 150) {
        t.price = Number((Math.random() * 750 + 50).toFixed(2));
      }
    });
  }, []);

  const loadPortfolio = useCallback(
    async (attempt = 0) => {
      if (!currentUid) return;
      try {
        const data = await getPortfolio(currentUid);
        setItems(data);
        setError(null);
        const initialPrices: Record<string, number> = {};
        data.forEach((item) => {
          const directoryStock = TICKER_DIRECTORY.find((s) => s.symbol === item.symbol);
          initialPrices[item.symbol] = directoryStock ? directoryStock.price : item.avgCost;
        });
        setMarketPrices((prev) => ({ ...initialPrices, ...prev }));
        setLastSync(new Date().toLocaleTimeString());
      } catch (e: any) {
        const msg = String(e?.message ?? '');
        const authLockAbort =
          e?.name === 'AbortError' || /Lock broken|steal option/i.test(msg);
        if (authLockAbort && attempt < 2) {
          await new Promise((r) => setTimeout(r, 400 + attempt * 400));
          return loadPortfolio(attempt + 1);
        }
        setError('Sync interrupted: ' + (msg || 'Could not load portfolio'));
      } finally {
        setLoading(false);
      }
    },
    [currentUid]
  );

  useEffect(() => {
    void loadPortfolio();
    const id = window.setInterval(() => void loadPortfolio(), PORTFOLIO_REFRESH_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadPortfolio();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loadPortfolio]);

  const loadLatestWatchlistHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const latest = await getDailyWatchlist();
      if (!latest) {
        setLatestWatchlistLabel('No watchlist snapshot available');
        setLatestMetricsBySymbol({});
        return;
      }
      setLatestWatchlistLabel(watchlistUserVisibleLabel(latest));
      const rows = await getDailyWatchlistItems(latest.id, latest.watchlist_date);
      const mapped: Record<string, LatestWatchlistMetric> = {};
      (rows || []).forEach((r: DailyWatchlistItem) => {
        const t = String(r.symbol || '').toUpperCase();
        if (!t) return;
        mapped[t] = {
          symbol: t,
          company: r.company || '',
          current_price: r.current_price ?? null,
          iv_ensemble: r.iv_ensemble ?? null,
          iv_upside_pct: r.iv_upside_pct ?? null,
          risk_summary_score: r.risk_summary_score ?? null,
          torchlight_score: r.torchlight_score ?? null,
          torchlight_sentiment: r.torchlight_sentiment ?? null,
        };
      });
      setLatestMetricsBySymbol(mapped);
    } catch {
      setLatestWatchlistLabel('Could not load latest watchlist snapshot');
      setLatestMetricsBySymbol({});
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLatestWatchlistHealth();
    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange(() => {
      void loadLatestWatchlistHealth();
    });
    const channel = supabase
      .channel('portfolio-daily-watchlist')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_watchlist' },
        () => {
          void loadLatestWatchlistHealth();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_watchlist_items' },
        () => {
          void loadLatestWatchlistHealth();
        }
      )
      .subscribe();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadLatestWatchlistHealth();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const poll = window.setInterval(() => void loadLatestWatchlistHealth(), PORTFOLIO_REFRESH_MS);
    return () => {
      authSub.unsubscribe();
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(poll);
    };
  }, [loadLatestWatchlistHealth]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredResults = useMemo(() => {
    const heldSymbols = new Set(items.map(i => i.symbol.toUpperCase()));

    // Combine base directory with S&P and NASDAQ tickers
    // Merge live forex rates into FOREX_TICKERS
    const forexWithLiveRates = FOREX_TICKERS.map(f => ({
      ...f,
      price: liveFxRates[f.symbol] ?? f.price,
    }));
    const MASTER_DIRECTORY = [...TICKER_DIRECTORY, ...SP500_TICKERS, ...NASDAQ_TICKERS, ...CRYPTO_TICKERS, ...forexWithLiveRates];

    const baseList = selectedCategory === 'ALL'
      ? MASTER_DIRECTORY
      : MASTER_DIRECTORY.filter(s => s.category === (selectedCategory as any));

    if (!searchQuery) {
      // Show more for S&P/NASDAQ to allow scrolling as requested
      const limit = (selectedCategory === 'S&P' || selectedCategory === 'NASDAQ' || selectedCategory === 'CRYPTO' || selectedCategory === 'FOREX') ? 50 : 10;
      return baseList.filter(s => !heldSymbols.has(s.symbol.toUpperCase())).slice(0, limit);
    }

    return baseList.filter(stock =>
      (stock.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        stock.name.toLowerCase().includes(searchQuery.toLowerCase())) &&
      !heldSymbols.has(stock.symbol.toUpperCase())
    ).slice(0, 50);
  }, [searchQuery, items, selectedCategory, liveFxRates]);

  const openAddFromListModal = (stock: ListStock) => {
    setAddFromListStock(stock);
    setAddFromListVolume('1');
    setShowAddFromListModal(true);
  };

  const handleAddFromListSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUid || !addFromListStock) return;
    const vol = parseFloat(addFromListVolume);
    if (!Number.isFinite(vol) || vol <= 0) return;
    const livePrice = marketPrices[addFromListStock.symbol] ?? addFromListStock.price;
    setIsAdding(addFromListStock.symbol);
    try {
      const newItem: PortfolioItem = { symbol: addFromListStock.symbol, shares: vol, avgCost: livePrice };
      await addStock(currentUid, newItem);
      await loadPortfolio();
      setSearchQuery('');
      setShowDropdown(false);
      setShowAddFromListModal(false);
      setAddFromListStock(null);
      setAddFromListVolume('1');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsAdding(null);
    }
  };

  const startEditVolume = (item: PortfolioItem) => {
    setEditingVolumeSymbol(item.symbol);
    setEditingVolumeValue(String(item.shares));
  };

  const saveVolume = async () => {
    if (!currentUid || !editingVolumeSymbol) return;
    const val = parseFloat(editingVolumeValue);
    if (!Number.isFinite(val) || val <= 0) {
      setEditingVolumeSymbol(null);
      return;
    }
    try {
      await updateStock(currentUid, editingVolumeSymbol, { shares: val });
      await loadPortfolio();
    } catch (e: any) {
      setError(e.message);
    }
    setEditingVolumeSymbol(null);
  };

  const handleInitiateRemove = (sym: string) => {
    setItemToDelete(sym);
  };

  const handleConfirmRemove = async () => {
    if (!currentUid || !itemToDelete) return;
    setIsDeleting(itemToDelete);
    try {
      await removeStock(currentUid, itemToDelete);
      await loadPortfolio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsDeleting(null);
      setItemToDelete(null);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUid || !manualSymbol || !manualShares || !manualPrice) return;

    setIsAdding(manualSymbol.toUpperCase());
    try {
      const newItem: PortfolioItem = {
        symbol: manualSymbol.toUpperCase(),
        shares: parseFloat(manualShares),
        avgCost: parseFloat(manualPrice)
      };
      await addStock(currentUid, newItem);
      await loadPortfolio();
      setShowManualModal(false);
      setManualSymbol('');
      setManualShares('1');
      setManualPrice('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsAdding(null);
    }
  };

  const refreshSimMarks = useCallback(async () => {
    const uid = currentUid ?? userId;
    if (!uid) {
      setSimMarksForKey({});
      return;
    }
    const st = loadMarketSimulationState(uid);
    if (st.positions.length === 0) {
      setSimMarksForKey({});
      return;
    }
    try {
      const maps = await fetchMarksForPositions(st.positions, getFinnhubToken());
      const byKey = buildMarksByPositionKey(st.positions, maps);
      applyFetchedMarksToState(uid, st.positions, byKey);
      setSimMarksForKey(byKey);
    } catch {
      const cleared: Record<string, number | undefined> = {};
      st.positions.forEach((p) => {
        cleared[p.key] = undefined;
      });
      setSimMarksForKey(cleared);
    }
  }, [currentUid, userId]);

  useEffect(() => {
    void refreshSimMarks();
    const id = window.setInterval(() => void refreshSimMarks(), PORTFOLIO_REFRESH_MS);
    const ev = () => void refreshSimMarks();
    window.addEventListener(MARKET_SIMULATION_UPDATED_EVENT, ev);
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshSimMarks();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(MARKET_SIMULATION_UPDATED_EVENT, ev);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshSimMarks]);

  const mergedEquityHoldings = useMemo(
    () => mergeVaultAndSimEquities(items, simState.positions),
    [items, simState.positions]
  );

  const nonEqSimPositions = useMemo(
    () => simState.positions.filter((p) => p.kind !== 'equity'),
    [simState.positions]
  );

  const totalValuation = useMemo(() => {
    let v = simState.cashUsd;
    for (const h of mergedEquityHoldings) {
      const px = marketPrices[h.symbol] ?? h.avgCost;
      v += h.shares * px;
    }
    for (const p of nonEqSimPositions) {
      const live = simMarksForKey[p.key];
      v += p.qty * resolveMarkUsd(p, live, simState.lastGoodMarksByKey);
    }
    return v;
  }, [mergedEquityHoldings, nonEqSimPositions, marketPrices, simState.cashUsd, simState.lastGoodMarksByKey, simMarksForKey]);

  const principalCapital = useMemo(() => {
    let c = 0;
    mergedEquityHoldings.forEach((h) => {
      c += h.shares * h.avgCost;
    });
    nonEqSimPositions.forEach((p) => {
      c += p.qty * p.avgEntryUsd;
    });
    return c;
  }, [mergedEquityHoldings, nonEqSimPositions]);

  /** Unrealized P/L on deployed positions (idle simulated cash excluded). */
  const netPerformance = totalValuation - simState.cashUsd - principalCapital;

  const handleVaultSellConfirm = async () => {
    if (!currentUid || !vaultSellTarget) return;
    const max = vaultSellTarget.shares;
    const qty = parseFloat(String(vaultSellQty).replace(/,/g, ''));
    if (!Number.isFinite(qty) || qty <= 0) return;
    const sellQty = Math.min(qty, max);
    const px = marketPrices[vaultSellTarget.symbol] ?? vaultSellTarget.avgCost;
    const proceeds = sellQty * px;
    setVaultSelling(true);
    try {
      if (sellQty >= max - 1e-9) {
        await removeStock(currentUid, vaultSellTarget.symbol);
      } else {
        await updateStock(currentUid, vaultSellTarget.symbol, { shares: max - sellQty });
      }
      creditSimCashUsd(currentUid, proceeds);
      await loadPortfolio();
      setVaultSellTarget(null);
      setVaultSellQty('1');
    } catch (e: any) {
      setError(e?.message || 'Sell failed');
    } finally {
      setVaultSelling(false);
    }
  };

  const portfolioHealth = useMemo(() => {
    const mergedHoldings = mergeVaultAndSimEquities(items, simState.positions);

    const VALUE_EPS = 1e-6;
    const PL_EPS = 0.005;

    const rows = mergedHoldings.map((hold) => {
      const ticker = hold.symbol.toUpperCase();
      const livePrice = marketPrices[hold.symbol] || hold.avgCost;
      const value = hold.shares * livePrice;
      const costBasis = hold.shares * hold.avgCost;
      const unrealizedPl = value - costBasis;
      const snapshot = latestMetricsBySymbol[ticker];
      const ivEnsemble = snapshot?.iv_ensemble ?? null;
      const ivUpsidePct = snapshot?.iv_upside_pct ?? null;
      const sentimentScore = snapshot?.torchlight_sentiment ?? null;
      const riskSummary = snapshot?.risk_summary_score ?? null;
      const sentimentAdjPct = sentimentScore != null ? (sentimentScore - 50) * 0.12 : 0; // +/-6% max
      const riskDamp = riskSummary != null && riskSummary < 50 ? 0.7 : 1;
      // Base 3M what-if return combines valuation gap + current sentiment impact.
      const base3mPct = clamp((((ivUpsidePct ?? 0) * 0.25) + sentimentAdjPct) * riskDamp, -30, 30);
      const downPct = clamp(base3mPct - 6, -40, 40);
      const samePct = clamp(base3mPct, -40, 40);
      const upPct = clamp(base3mPct + 6, -40, 40);
      const priceDown = livePrice * (1 + downPct / 100);
      const priceSame = livePrice * (1 + samePct / 100);
      const priceUp = livePrice * (1 + upPct / 100);
      const direction = samePct > 2 ? 'Go Up' : samePct < -2 ? 'Go Down' : 'Stay Same';
      const sentimentImpact = sentimentScore == null
        ? 'Unknown'
        : sentimentScore >= 60
          ? 'Positive'
          : sentimentScore <= 40
            ? 'Negative'
            : 'Neutral';
      const baseName = snapshot?.company || '';
      const company = baseName ? `${baseName}${hold.companyNote}` : `${ticker}${hold.companyNote}`;

      const unrealizedPlPct = costBasis > VALUE_EPS ? (unrealizedPl / costBasis) * 100 : 0;
      const avgBuyShare = hold.avgCost;
      const firstPurchaseShare =
        hold.firstBuyPrice != null && Number.isFinite(hold.firstBuyPrice) ? hold.firstBuyPrice : hold.avgCost;

      return {
        ticker,
        company,
        livePrice,
        value,
        costBasis,
        avgBuyShare,
        firstPurchaseShare,
        unrealizedPl,
        unrealizedPlPct,
        acquiredLabel: formatBoughtOnUtc(hold.openedAt),
        ivEnsemble,
        ivUpsidePct,
        priceDown,
        priceSame,
        priceUp,
        direction,
        sentimentScore,
        sentimentImpact,
        riskSummary,
        torchlight: snapshot?.torchlight_score ?? null,
      };
    });

    const covered = rows.filter((r) => r.ivEnsemble != null || r.riskSummary != null || r.torchlight != null);
    const hasNonZeroValue = (r: (typeof rows)[number]) => Math.abs(r.value) > VALUE_EPS;
    const totalDeployed = rows.filter(hasNonZeroValue).reduce((a, r) => a + r.value, 0);

    const hasNonZeroSentiment = (r: (typeof rows)[number]) =>
      r.sentimentScore != null && Number.isFinite(r.sentimentScore) && Math.abs(r.sentimentScore) > 1e-9;
    const hasNonZeroPL = (r: (typeof rows)[number]) =>
      Number.isFinite(r.unrealizedPl) && Math.abs(r.unrealizedPl) > PL_EPS;
    const qualifiesForMetricAvg = (r: (typeof rows)[number]) => hasNonZeroSentiment(r) || hasNonZeroPL(r);
    const signalPool = rows.filter(qualifiesForMetricAvg);

    const weightedByDeployedValue = (getter: (r: (typeof rows)[number]) => number | null) =>
      rows.reduce((acc, r) => {
        if (!hasNonZeroValue(r)) return acc;
        const w = totalDeployed > 0 ? r.value / totalDeployed : 0;
        const v = getter(r);
        return acc + (v != null && Number.isFinite(v) ? w * v : 0);
      }, 0);

    const equalMeanAmongPool = (getter: (r: (typeof rows)[number]) => number | null | undefined) => {
      const vals = signalPool.map(getter).filter((v): v is number => v != null && Number.isFinite(v));
      if (!vals.length) return 0;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const useSignalPool = signalPool.length > 0;
    const weightedRisk = useSignalPool
      ? equalMeanAmongPool((r) => r.riskSummary)
      : weightedByDeployedValue((r) => r.riskSummary);
    const weightedTorch = useSignalPool
      ? equalMeanAmongPool((r) => r.torchlight)
      : weightedByDeployedValue((r) => r.torchlight);
    const weightedIvUpside = useSignalPool
      ? equalMeanAmongPool((r) => r.ivUpsidePct)
      : weightedByDeployedValue((r) => r.ivUpsidePct);

    const coveragePct = rows.length ? (covered.length / rows.length) * 100 : 0;
    return {
      rows,
      weightedRisk,
      weightedTorch,
      weightedIvUpside,
      coveragePct,
      /** Tickers with sentiment ≠ 0 or |unrealized P/L| &gt; ~$0 — used as equal-weight average denominator when non-empty. */
      signalPoolCount: signalPool.length,
      usedSignalPoolForAvg: useSignalPool,
    };
  }, [items, simState.positions, marketPrices, latestMetricsBySymbol]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 animate-pulse">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Accessing Secure Ledger...</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto relative">
      {/* Error banner when sync fails */}
      {error && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800">
          <p className="text-sm font-bold flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="px-3 py-1.5 rounded-xl text-xs font-black uppercase bg-rose-200 hover:bg-rose-300 text-rose-900 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {vaultSellTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-black text-slate-900 mb-2">Sell from vault</h3>
            <p className="text-slate-500 text-sm font-medium mb-4 leading-relaxed">
              Sell at the live mark. Proceeds are credited to your <span className="font-semibold text-indigo-700">simulated cash</span>{' '}
              (paper-trading wealth).
            </p>
            <p className="text-xs font-bold text-slate-700 mb-2">
              {vaultSellTarget.symbol} · max {vaultSellTarget.shares.toLocaleString()} shares
            </p>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Shares to sell</label>
            <input
              type="text"
              inputMode="decimal"
              value={vaultSellQty}
              onChange={(e) => setVaultSellQty(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-mono font-bold mb-4"
            />
            <p className="text-xs text-slate-600 mb-6">
              Est. proceeds:{' '}
              <span className="font-black text-emerald-700">
                $
                {(
                  Math.min(
                    parseFloat(String(vaultSellQty).replace(/,/g, '')) || 0,
                    vaultSellTarget.shares
                  ) * (marketPrices[vaultSellTarget.symbol] ?? vaultSellTarget.avgCost)
                ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => {
                  setVaultSellTarget(null);
                  setVaultSellQty('1');
                }}
                className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={vaultSelling}
                onClick={() => void handleVaultSellConfirm()}
                className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg disabled:opacity-50"
              >
                {vaultSelling ? '…' : 'Sell & credit cash'}
              </button>
            </div>
          </div>
        </div>
      )}

      {itemToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-black text-slate-900 mb-2">Confirm Asset Liquidation</h3>
            <p className="text-slate-500 text-sm font-medium mb-8 leading-relaxed">
              Are you sure you want to remove <span className="font-bold text-slate-900 bg-slate-100 px-1 rounded">{itemToDelete}</span> from your portfolio? This will delete the record from the database.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setItemToDelete(null)}
                className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRemove}
                className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
              >
                Liquidate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add from list: ticker from list, volume default 1 (editable), price is live */}
      {showAddFromListModal && addFromListStock && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 max-w-md w-full border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-1">Add to portfolio</h3>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-6">{addFromListStock.name} · {addFromListStock.symbol}</p>
            <form onSubmit={handleAddFromListSubmit} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Volume (shares)</label>
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  required
                  value={addFromListVolume}
                  onChange={e => setAddFromListVolume(e.target.value)}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Live price (market)</label>
                <p className="px-5 py-4 bg-slate-100 border border-slate-200 rounded-2xl font-black text-slate-900 text-lg">
                  ${(marketPrices[addFromListStock.symbol] ?? addFromListStock.price).toFixed(2)}
                </p>
              </div>
              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddFromListModal(false); setAddFromListStock(null); }}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdding !== null}
                  className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg active:scale-95 disabled:opacity-50"
                >
                  {isAdding ? 'Adding...' : 'Add to Vault'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl group-hover:scale-110 transition-transform">🏦</div>
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Live Portfolio Value</h3>
          <p className="text-4xl font-black tracking-tighter transition-all duration-1000">
            ${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[9px] font-semibold text-slate-500 mt-2 leading-snug">
            Total wealth at <strong className="text-slate-400">current market marks</strong> (vault + simulated cash &amp; positions).{' '}
            Unrealized vs cost (open positions):{' '}
            <strong className={netPerformance >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {netPerformance >= 0 ? '+' : '-'}$
              {Math.abs(netPerformance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
            · Refreshes ~every {PORTFOLIO_REFRESH_MS / 60_000} min
          </p>
        </div>
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Principal Capital</h3>
          <p className="text-4xl font-black text-slate-900 tracking-tighter">
            ${principalCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[9px] font-semibold text-slate-400 mt-2">Cost basis in open positions (vault + paper)</p>
        </div>
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Net Performance</h3>
          <p
            className={`text-4xl font-black tracking-tighter transition-all duration-1000 ${
              netPerformance >= 0 ? 'text-emerald-500' : 'text-rose-500'
            }`}
          >
            {netPerformance >= 0 ? '+' : '-'}$
            {Math.abs(netPerformance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[9px] font-semibold text-slate-400 mt-2">Unrealized P/L on holdings (excludes idle cash)</p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Portfolio Health & 3M What-If Scenarios</h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">
              Vault + paper-traded equities (Market Simulation){' '}
              <span className="text-slate-400 font-semibold normal-case">·</span> Source: {latestWatchlistLabel}
            </p>
          </div>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            Coverage {portfolioHealth.coveragePct.toFixed(0)}%
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="border border-slate-100 rounded-xl p-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Risk Summary (portfolio avg)</p>
            <p className="text-2xl font-black text-slate-800">{portfolioHealth.weightedRisk.toFixed(1)}</p>
            <p className="text-[9px] text-slate-400 mt-1 leading-snug">
              {portfolioHealth.usedSignalPoolForAvg
                ? `Equal-weight among ${portfolioHealth.signalPoolCount} ticker(s) with sentiment ≠ 0 or unrealized gain/loss. Each metric ÷ count of that group with data.`
                : 'Value-weighted over positions with non-zero market value (no sentiment/P/L signal pool).'}
            </p>
          </div>
          <div className="border border-slate-100 rounded-xl p-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Torchlight (portfolio avg)</p>
            <p className="text-2xl font-black text-indigo-700">{portfolioHealth.weightedTorch.toFixed(1)}</p>
            <p className="text-[9px] text-slate-400 mt-1 leading-snug">
              {portfolioHealth.usedSignalPoolForAvg
                ? `Same pool (${portfolioHealth.signalPoolCount} ticker(s)).`
                : 'Value-weighted on non-zero market value only.'}
            </p>
          </div>
          <div className="border border-slate-100 rounded-xl p-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">IV Upside (portfolio avg)</p>
            <p className={`text-2xl font-black ${portfolioHealth.weightedIvUpside >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {portfolioHealth.weightedIvUpside.toFixed(2)}%
            </p>
            <p className="text-[9px] text-slate-400 mt-1 leading-snug">
              {portfolioHealth.usedSignalPoolForAvg
                ? `Same pool (${portfolioHealth.signalPoolCount} ticker(s)).`
                : 'Value-weighted on non-zero market value only.'}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-xs min-w-[1280px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-black text-slate-500 uppercase">Ticker</th>
                <th className="px-3 py-2 text-left font-black text-slate-500 uppercase">Company</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 whitespace-nowrap uppercase">
                  Last buy (UTC)
                </th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">1st purchase $/sh</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">Blended avg $/sh</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">Live Price</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">Cost basis</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">Value</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">P/L $</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">P/L %</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">IV (Latest)</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">IV Upside</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">3M What-If (Down)</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">3M What-If (Same)</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">3M What-If (Up)</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">Likely Path</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">Sentiment Impact</th>
                <th className="px-3 py-2 text-right font-black text-slate-500 uppercase">Risk Summary</th>
              </tr>
            </thead>
            <tbody>
              {portfolioHealth.rows.map((r) => (
                <tr key={r.ticker} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-black text-slate-800">{r.ticker}</td>
                  <td className="px-3 py-2 text-slate-600">{r.company || '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">{r.acquiredLabel}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-800 font-semibold">${r.firstPurchaseShare.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">${r.avgBuyShare.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">${r.livePrice.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">
                    ${r.costBasis.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    ${r.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-bold ${
                      r.unrealizedPl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {r.unrealizedPl >= 0 ? '+' : '-'}$
                    {Math.abs(r.unrealizedPl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-bold ${
                      r.unrealizedPlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {Number.isFinite(r.unrealizedPlPct) ? `${r.unrealizedPlPct >= 0 ? '+' : ''}${r.unrealizedPlPct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{r.ivEnsemble != null ? `$${r.ivEnsemble.toFixed(2)}` : '—'}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${(r.ivUpsidePct ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {r.ivUpsidePct != null ? `${r.ivUpsidePct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{Number.isFinite(r.priceDown) ? `$${r.priceDown.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number.isFinite(r.priceSame) ? `$${r.priceSame.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number.isFinite(r.priceUp) ? `$${r.priceUp.toFixed(2)}` : '—'}</td>
                  <td className={`px-3 py-2 text-right font-black ${r.direction === 'Go Up' ? 'text-emerald-600' : r.direction === 'Go Down' ? 'text-rose-600' : 'text-amber-600'}`}>
                    {r.direction}
                  </td>
                  <td className={`px-3 py-2 text-right font-black ${r.sentimentImpact === 'Positive' ? 'text-emerald-600' : r.sentimentImpact === 'Negative' ? 'text-rose-600' : 'text-amber-600'}`}>
                    {r.sentimentImpact}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{r.riskSummary != null ? r.riskSummary.toFixed(1) : '—'}</td>
                </tr>
              ))}
              {!healthLoading && portfolioHealth.rows.length === 0 && (
                <tr>
                  <td colSpan={18} className="px-3 py-6 text-center text-slate-400 font-medium">
                    No holdings — add assets from the explorer or paper-trade from the S&amp;P simulation block below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section id="simulated-portfolio" className="scroll-mt-24">
        <MarketSimulation userId={currentUid ?? userId ?? null} embedded />
      </section>

      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm relative z-50" ref={dropdownRef}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center">
            <span className="w-2 h-2 rounded-full bg-indigo-600 mr-3 animate-ping"></span>
            Market Explorer
          </h3>
          <div className="flex items-center bg-slate-100 p-1 rounded-xl overflow-x-auto no-scrollbar">
            {(['EQUITIES', 'COMMODITIES', 'NASDAQ', 'S&P', 'CRYPTO', 'FOREX', 'ALL'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${selectedCategory === cat
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowManualModal(true)}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95 whitespace-nowrap"
          >
            + Manual Entry
          </button>
        </div>

        <div className="relative">
          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400">🔍</div>
          <input
            type="text"
            value={searchQuery}
            onFocus={() => setShowDropdown(true)}
            onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
            placeholder="Search symbols or company names (e.g. NVIDIA)..."
            className="w-full pl-14 pr-6 py-5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-300"
          />

          {showDropdown && (searchQuery || selectedCategory) && (
            <div className="absolute top-full left-0 right-0 z-50 mt-3 bg-white border border-slate-100 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300 max-h-[400px] overflow-y-auto">
              {filteredResults.length > 0 ? (
                <div className="divide-y divide-slate-50">
                  {filteredResults.map(stock => (
                    <div
                      key={stock.symbol}
                      onClick={() => openAddFromListModal(stock)}
                      className="flex items-center justify-between p-5 hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-xs shadow-lg group-hover:scale-105 transition-transform">
                          {stock.symbol[0]}
                        </div>
                        <div>
                          <p className="font-black text-slate-900 text-sm">{stock.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{stock.category} · {stock.symbol}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-6">
                        <p className="text-sm font-black text-slate-900">${(marketPrices[stock.symbol] ?? stock.price).toFixed(2)}</p>
                        <button type="button" className="bg-indigo-600 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">Add to Vault</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-xs font-bold text-slate-400 uppercase tracking-widest italic">
                  No institutional matching results found.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Manual Entry Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 max-w-md w-full border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-2xl font-black text-slate-900 mb-2">Acquire Custom Asset</h3>
            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-8">Manual Ledger Override</p>

            <form onSubmit={handleManualAdd} className="space-y-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Asset Symbol</label>
                <input
                  autoFocus
                  required
                  type="text"
                  placeholder="e.g. TSLA, BTC, XAU"
                  value={manualSymbol}
                  onChange={e => setManualSymbol(e.target.value)}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Volume (Shares)</label>
                  <input
                    required
                    type="number"
                    step="any"
                    value={manualShares}
                    onChange={e => setManualShares(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buy Price ($)</label>
                  <input
                    required
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={manualPrice}
                    onChange={e => setManualPrice(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="flex-1 px-4 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdding !== null}
                  className="flex-1 px-4 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isAdding ? 'Syncing...' : 'Add to Vault'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-50 bg-slate-50/50 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center space-x-4">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Holding Ledger</h3>
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          </div>
          <p className="text-[10px] text-slate-500 font-medium max-w-xl leading-snug">
            <strong className="text-slate-600">Last buy (UTC)</strong> is set to the current UTC date and time on every purchase.{' '}
            <strong className="text-slate-600">First purchase $/sh</strong> stays fixed from your first fill; blended average updates when you add shares (P/L uses blended cost basis).
          </p>
          {lastSync && (
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter shrink-0">
              Live Pulse: {lastSync}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                <th className="px-8 py-5">Asset Identifier</th>
                <th className="px-8 py-5 text-center">Volume</th>
                <th className="px-8 py-5 whitespace-nowrap">Last buy (UTC)</th>
                <th className="px-8 py-5">First purchase $/sh</th>
                <th className="px-8 py-5">Blended avg $/sh</th>
                <th className="px-8 py-5">Live Price</th>
                <th className="px-8 py-5">Cost basis</th>
                <th className="px-8 py-5">Market value</th>
                <th className="px-8 py-5">Unrealized P/L</th>
                <th className="px-8 py-5">P/L %</th>
                <th className="px-8 py-5 text-right">Sell / Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-8 py-20 text-center text-slate-300 font-bold uppercase tracking-[0.2em] text-[10px] italic">
                    Vault empty. Use explorer to acquire assets.
                  </td>
                </tr>
              ) : (
                items.map(item => {
                  const currentPrice = marketPrices[item.symbol] || item.avgCost;
                  const prevPrice = lastPrices[item.symbol];
                  const priceUp = prevPrice != null && currentPrice > prevPrice;
                  const priceDown = prevPrice != null && currentPrice < prevPrice;
                  const costBasis = item.shares * item.avgCost;
                  const marketValue = item.shares * currentPrice;
                  const unrealizedPl = marketValue - costBasis;
                  const unrealizedPct = costBasis > 1e-9 ? (unrealizedPl / costBasis) * 100 : 0;
                  const firstPurchase =
                    item.firstBuyPrice != null && Number.isFinite(item.firstBuyPrice)
                      ? item.firstBuyPrice
                      : item.avgCost;
                  const isEditing = editingVolumeSymbol === item.symbol;
                  return (
                    <tr key={item.symbol} className="hover:bg-slate-50/50 transition-all group">
                      <td className="px-8 py-5">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs border border-indigo-100 shadow-sm">
                            {item.symbol[0]}
                          </div>
                          <span className="font-black text-slate-900 tracking-tight text-sm">{item.symbol}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={editingVolumeValue}
                            onChange={e => setEditingVolumeValue(e.target.value)}
                            onBlur={saveVolume}
                            onKeyDown={e => { if (e.key === 'Enter') saveVolume(); }}
                            className="w-20 px-2 py-1.5 text-sm font-black text-center rounded-lg border border-indigo-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditVolume(item)}
                            className="font-black text-slate-700 text-sm hover:text-indigo-600 hover:underline"
                          >
                            {item.shares}
                          </button>
                        )}
                      </td>
                      <td className="px-8 py-5 text-xs font-semibold text-slate-700 whitespace-nowrap">
                        {formatBoughtOnUtc(item.openedAt)}
                      </td>
                      <td className="px-8 py-5 font-black text-slate-900 text-sm tabular-nums">
                        ${firstPurchase.toFixed(2)}
                      </td>
                      <td className="px-8 py-5 font-bold text-slate-600 text-xs tabular-nums">${item.avgCost.toFixed(2)}</td>
                      <td className="px-8 py-5 font-black text-sm">
                        <span className={`transition-all duration-300 rounded px-2 py-1 inline-block ${priceUp ? 'text-emerald-600 bg-emerald-50' : priceDown ? 'text-rose-600 bg-rose-50' : 'text-slate-700'}`}>
                          ${currentPrice.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-8 py-5 font-bold text-slate-600 text-xs">
                        ${costBasis.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-8 py-5 font-black text-sm text-slate-900">
                        ${marketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className={`px-8 py-5 font-black text-sm ${unrealizedPl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {unrealizedPl >= 0 ? '+' : '-'}$
                        {Math.abs(unrealizedPl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className={`px-8 py-5 font-black text-sm ${unrealizedPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {Number.isFinite(unrealizedPct) ? `${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-8 py-5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setVaultSellTarget(item);
                            setVaultSellQty(String(item.shares));
                          }}
                          className="mr-2 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-all"
                        >
                          Sell
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateRemove(item.symbol)}
                          disabled={isDeleting === item.symbol}
                          className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all align-middle"
                          title="Remove without crediting simulated cash"
                        >
                          {isDeleting === item.symbol ? '…' : '🗑️'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sp500PaperSimulation userId={currentUid ?? userId ?? null} paperTradingAllowed={paperTradingAllowed} />

      <p className="text-[8px] font-black text-slate-400 text-center uppercase tracking-widest opacity-30 mt-10 italic">
        Real-time pricing is simulated for institutional demonstration. All market valuations are processed via the Secure Handshake protocol.
      </p>
    </div>
  );
};

export default Portfolio;
