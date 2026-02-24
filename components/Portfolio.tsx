
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getPortfolio, addStock, removeStock, updateStock, clearPortfolio } from '../services/supabaseService';
import { PortfolioItem } from '../types';
import { supabase } from '../services/supabase';
import { SP500_TICKERS } from './SP500Data';
import { NASDAQ_TICKERS } from './NasdaqData';
import { CRYPTO_TICKERS } from './CryptoData';
import { FOREX_TICKERS } from './ForexData';

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
}

const Portfolio: React.FC<PortfolioProps> = ({ userId }) => {
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
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Live market prices: Finnhub when key is set, otherwise simulated tick
  useEffect(() => {
    const symbols = [...new Set([...items.map(i => i.symbol), addFromListStock?.symbol].filter(Boolean) as string[])];
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
        items.forEach(item => {
          const currentPrice = next[item.symbol] || item.avgCost;
          const fluctuation = currentPrice * (Math.random() * 0.002 - 0.001);
          nextLast[item.symbol] = currentPrice;
          next[item.symbol] = Number((currentPrice + fluctuation).toFixed(2));
        });
        setLastPrices(nextLast);
        return next;
      });
      setLastSync(new Date().toLocaleTimeString());
    }, 3000);
    return () => clearInterval(interval);
  }, [items.length, addFromListStock?.symbol, finnhubKey]);

  // Ensure S&P assets have variety in prices
  useMemo(() => {
    SP500_TICKERS.forEach(t => {
      if (t.price === 150) {
        t.price = Number((Math.random() * 750 + 50).toFixed(2));
      }
    });
  }, []);

  const loadPortfolio = async () => {
    if (!currentUid) return;
    try {
      const data = await getPortfolio(currentUid);
      setItems(data);
      setError(null);
      // Initialize market prices with current directory data or avg cost
      const initialPrices: Record<string, number> = {};
      data.forEach(item => {
        const directoryStock = TICKER_DIRECTORY.find(s => s.symbol === item.symbol);
        initialPrices[item.symbol] = directoryStock ? directoryStock.price : item.avgCost;
      });
      setMarketPrices(initialPrices);
      setLastSync(new Date().toLocaleTimeString());
    } catch (e: any) {
      setError("Sync interrupted: " + (e?.message || 'Could not load portfolio'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPortfolio(); }, [currentUid]);

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

  const totalValuation = items.reduce((acc, i) => acc + (i.shares * (marketPrices[i.symbol] || i.avgCost)), 0);
  const totalCost = items.reduce((acc, i) => acc + (i.shares * i.avgCost), 0);

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
        </div>
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Principal Capital</h3>
          <p className="text-4xl font-black text-slate-900 tracking-tighter">${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Net Performance</h3>
          <p className={`text-4xl font-black tracking-tighter transition-all duration-1000 ${totalValuation >= totalCost ? 'text-emerald-500' : 'text-rose-500'}`}>
            {totalValuation >= totalCost ? '+' : '-'}${Math.abs(totalValuation - totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

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
        <div className="px-8 py-6 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Holding Ledger</h3>
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          </div>
          {lastSync && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Live Pulse: {lastSync}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                <th className="px-8 py-5">Asset Identifier</th>
                <th className="px-8 py-5 text-center">Volume</th>
                <th className="px-8 py-5">Avg. Buy-In (Mark)</th>
                <th className="px-8 py-5">Live Price (Mark)</th>
                <th className="px-8 py-5">Market Value (Mark)</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center text-slate-300 font-bold uppercase tracking-[0.2em] text-[10px] italic">
                    Vault empty. Use explorer to acquire assets.
                  </td>
                </tr>
              ) : (
                items.map(item => {
                  const currentPrice = marketPrices[item.symbol] || item.avgCost;
                  const prevPrice = lastPrices[item.symbol];
                  const priceUp = prevPrice != null && currentPrice > prevPrice;
                  const priceDown = prevPrice != null && currentPrice < prevPrice;
                  const isUp = currentPrice >= item.avgCost;
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
                      <td className="px-8 py-5 font-bold text-slate-500 text-xs">${item.avgCost.toFixed(2)}</td>
                      <td className="px-8 py-5 font-black text-sm">
                        <span className={`transition-all duration-300 rounded px-2 py-1 inline-block ${priceUp ? 'text-emerald-600 bg-emerald-50' : priceDown ? 'text-rose-600 bg-rose-50' : 'text-slate-700'}`}>
                          ${currentPrice.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-8 py-5 font-black text-sm">
                        <span className={isUp ? 'text-emerald-600' : 'text-rose-600'}>
                          ${(item.shares * currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => handleInitiateRemove(item.symbol)}
                          disabled={isDeleting === item.symbol}
                          className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all"
                        >
                          {isDeleting === item.symbol ? "..." : "🗑️"}
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
      <p className="text-[8px] font-black text-slate-400 text-center uppercase tracking-widest opacity-30 mt-10 italic">
        Real-time pricing is simulated for institutional demonstration. All market valuations are processed via the Secure Handshake protocol.
      </p>
    </div>
  );
};

export default Portfolio;
