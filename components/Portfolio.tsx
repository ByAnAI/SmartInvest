
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getPortfolio, addStock, removeStock, clearPortfolio } from '../services/firestoreService';
import { PortfolioItem } from '../types';
import { auth } from '../services/firebase';

const TICKER_DIRECTORY = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 182.63 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', price: 415.50 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 145.32 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 174.42 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 726.13 },
  { symbol: 'META', name: 'Meta Platforms Inc.', price: 484.03 },
  { symbol: 'TSLA', name: 'Tesla, Inc.', price: 193.57 },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway', price: 408.20 },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', price: 742.10 },
  { symbol: 'AVGO', name: 'Broadcom Inc.', price: 1245.50 },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', price: 183.07 },
  { symbol: 'V', name: 'Visa Inc.', price: 278.43 },
  { symbol: 'UNH', name: 'UnitedHealth Group', price: 524.12 },
  { symbol: 'MA', name: 'Mastercard Inc.', price: 462.10 },
  { symbol: 'COST', name: 'Costco Wholesale', price: 725.30 },
  { symbol: 'HD', name: 'Home Depot Inc.', price: 362.40 },
  { symbol: 'PG', name: 'Procter & Gamble', price: 158.20 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', price: 176.50 },
  { symbol: 'NFLX', name: 'Netflix, Inc.', price: 583.50 },
  { symbol: 'BAC', name: 'Bank of America', price: 34.20 },
  { symbol: 'DIS', name: 'Walt Disney Co.', price: 108.30 },
  { symbol: 'INTC', name: 'Intel Corp.', price: 43.10 },
  { symbol: 'CSCO', name: 'Cisco Systems', price: 49.20 },
  { symbol: 'WMT', name: 'Walmart Inc.', price: 175.40 },
  { symbol: 'KO', name: 'Coca-Cola Co.', price: 59.80 },
  { symbol: 'PEP', name: 'PepsiCo Inc.', price: 168.40 },
  { symbol: 'MCD', name: 'McDonald\'s Corp.', price: 295.10 },
  { symbol: 'CRM', name: 'Salesforce Inc.', price: 288.40 },
  { symbol: 'ADBE', name: 'Adobe Inc.', price: 542.10 },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', price: 154.30 }
];

const Portfolio: React.FC = () => {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const user = auth.currentUser;

  // Simulation: Market Feed for live valuation
  useEffect(() => {
    const interval = setInterval(() => {
      setMarketPrices(prev => {
        const next = { ...prev };
        items.forEach(item => {
          const currentPrice = next[item.symbol] || item.avgCost;
          const fluctuation = currentPrice * (Math.random() * 0.002 * 2 - 0.002);
          next[item.symbol] = Number((currentPrice + fluctuation).toFixed(2));
        });
        return next;
      });
      setLastSync(new Date().toLocaleTimeString());
    }, 15000);

    return () => clearInterval(interval);
  }, [items]);

  const loadPortfolio = async () => {
    if (!user) return;
    try {
      const data = await getPortfolio(user.uid);
      setItems(data);
      // Initialize market prices with current directory data or avg cost
      const initialPrices: Record<string, number> = {};
      data.forEach(item => {
        const directoryStock = TICKER_DIRECTORY.find(s => s.symbol === item.symbol);
        initialPrices[item.symbol] = directoryStock ? directoryStock.price : item.avgCost;
      });
      setMarketPrices(initialPrices);
      setLastSync(new Date().toLocaleTimeString());
    } catch (e: any) {
      setError("Sync Interrupted: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPortfolio(); }, [user]);

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
    if (!searchQuery) return [];
    const heldSymbols = new Set(items.map(i => i.symbol.toUpperCase()));
    return TICKER_DIRECTORY.filter(stock => 
      (stock.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || 
       stock.name.toLowerCase().includes(searchQuery.toLowerCase())) &&
      !heldSymbols.has(stock.symbol.toUpperCase())
    ).slice(0, 5);
  }, [searchQuery, items]);

  const handleAddTicker = async (stock: typeof TICKER_DIRECTORY[0]) => {
    if (!user) return;
    setIsAdding(stock.symbol);
    try {
      const newItem: PortfolioItem = { symbol: stock.symbol, shares: 1, avgCost: stock.price };
      await addStock(user.uid, newItem);
      await loadPortfolio();
      setSearchQuery('');
      setShowDropdown(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsAdding(null);
    }
  };

  const handleRemove = async (sym: string) => {
    if (!user || !window.confirm(`Are you sure you want to remove ${sym}?`)) return;
    setIsDeleting(sym);
    try {
      await removeStock(user.uid, sym);
      await loadPortfolio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsDeleting(null);
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
    <div className="space-y-6 max-w-6xl mx-auto">
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
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center">
            <span className="w-2 h-2 rounded-full bg-indigo-600 mr-3 animate-ping"></span>
            Market Explorer
          </h3>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Live Pricing Engaged</span>
          </div>
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

          {showDropdown && searchQuery && (
            <div className="absolute top-full left-0 right-0 mt-3 bg-white border border-slate-100 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
              {filteredResults.length > 0 ? (
                <div className="divide-y divide-slate-50">
                  {filteredResults.map(stock => (
                    <div 
                      key={stock.symbol}
                      onClick={() => handleAddTicker(stock)}
                      className="flex items-center justify-between p-5 hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-xs shadow-lg group-hover:scale-105 transition-transform">
                          {stock.symbol[0]}
                        </div>
                        <div>
                          <p className="font-black text-slate-900 text-sm">{stock.symbol}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">{stock.name}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-6">
                        <p className="text-sm font-black text-slate-900">${stock.price.toFixed(2)}</p>
                        <button className="bg-indigo-600 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">Add to Vault</button>
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
                <th className="px-8 py-5">Avg Buy-In</th>
                <th className="px-8 py-5">Live Price</th>
                <th className="px-8 py-5">Market Value</th>
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
                  const isUp = currentPrice >= item.avgCost;
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
                      <td className="px-8 py-5 font-black text-slate-700 text-sm text-center">{item.shares}</td>
                      <td className="px-8 py-5 font-bold text-slate-500 text-xs">${item.avgCost.toFixed(2)}</td>
                      <td className="px-8 py-5 font-black text-slate-900 text-sm transition-all duration-500">
                        <span className={isUp ? 'text-emerald-600' : 'text-rose-600'}>
                          ${currentPrice.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-8 py-5 font-black text-slate-900 text-sm">
                        <span className={isUp ? 'text-emerald-600' : 'text-rose-600'}>
                          ${(item.shares * currentPrice).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button 
                          onClick={() => handleRemove(item.symbol)}
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
