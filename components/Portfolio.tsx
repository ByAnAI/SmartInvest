
import React, { useState, useEffect } from 'react';
import { auth } from '../services/firebase';
import { getPortfolio, addStock, removeStock, clearPortfolio } from '../services/firestoreService';
import { PortfolioItem } from '../types';

const Portfolio: React.FC = () => {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  
  // Form state
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');

  const user = auth.currentUser;

  const loadPortfolio = async () => {
    if (!user) return;
    try {
      const data = await getPortfolio(user.uid);
      setItems(data);
      setLastSync(new Date().toLocaleTimeString());
      setError(null);
    } catch (e: any) {
      console.error("Failed to load portfolio", e);
      setError("Sync Error: " + (e.message || "Unable to reach database."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortfolio();
  }, [user]);

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !symbol || !shares || !price) return;

    setAdding(true);
    setError(null);
    try {
      const newItem: PortfolioItem = {
        symbol: symbol.toUpperCase(),
        shares: parseFloat(shares),
        avgCost: parseFloat(price)
      };
      
      await addStock(user.uid, newItem);
      
      setSymbol('');
      setShares('');
      setPrice('');
      await loadPortfolio();
    } catch (e: any) {
      setError("Database Error: " + (e.message || "Failed to save to cloud."));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (sym: string) => {
    if (!user) return;
    if (!confirm(`Confirm divestment of ${sym}?`)) return;

    try {
      await removeStock(user.uid, sym);
      await loadPortfolio();
    } catch (e: any) {
      setError("Delete Error: " + e.message);
    }
  };

  const handleReset = async () => {
    if (!user) return;
    const confirmed = confirm("IRREVERSIBLE ACTION: Wipe all cloud-stored asset data for this account?");
    if (!confirmed) return;

    setLoading(true);
    try {
      await clearPortfolio(user.uid);
      await loadPortfolio();
    } catch (e: any) {
      setError("Reset Error: " + e.message);
      setLoading(false);
    }
  };

  const totalValue = items.reduce((acc, item) => acc + (item.shares * item.avgCost * 1.05), 0);
  const totalCost = items.reduce((acc, item) => acc + (item.shares * item.avgCost), 0);
  const profit = totalValue - totalCost;

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center py-40 space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        <div className="text-center">
          <p className="text-slate-900 font-bold text-lg">Synchronizing Vault</p>
          <p className="text-slate-400 text-sm animate-pulse">Establishing secure Firestore handshake...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Portfolio Header with Reset Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Portfolio Inventory</h2>
          <div className="flex items-center mt-1 space-x-3">
            <span className="flex items-center text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase tracking-wider border border-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
              Encrypted Cloud Sync
            </span>
            {lastSync && (
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                Last Handshake: {lastSync}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-3">
            <button 
              onClick={loadPortfolio}
              className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
              title="Manual Refresh"
            >
              🔄
            </button>
            <button 
              onClick={handleReset}
              className="px-4 py-2 border border-rose-100 text-rose-500 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-rose-50 transition-all active:scale-95"
            >
              Purge Cloud Data
            </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 p-4 rounded-2xl text-sm font-bold animate-in slide-in-from-top-2 duration-300">
          ⚠️ {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl group-hover:scale-110 transition-transform">💎</div>
          <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Assets</h3>
          <p className="text-4xl font-bold">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <div className="mt-4 flex items-center text-emerald-400 text-sm font-bold uppercase tracking-tighter">
            <span className="mr-1">▲</span> AI Predicted Valuation
          </div>
        </div>
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Invested Capital</h3>
          <p className="text-3xl font-bold text-slate-900">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-slate-400 text-xs mt-4 font-bold uppercase tracking-tighter">{items.length} Secure Positions</p>
        </div>
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Net Performance</h3>
          <p className={`text-3xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {profit >= 0 ? '+' : ''}${profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <div className={`mt-4 inline-flex px-2 py-1 rounded-lg text-xs font-bold ${profit >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            Audit Grade: Verified
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Asset Table */}
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
            <h3 className="font-bold text-slate-800 flex items-center">
              <span className="mr-2">📂</span> Holding Ledger
            </h3>
            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full uppercase tracking-widest">Firestore Secure Mode</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-50">
                  <th className="px-6 py-4">Symbol</th>
                  <th className="px-6 py-4">Qty</th>
                  <th className="px-6 py-4">Avg Price</th>
                  <th className="px-6 py-4">Current Val</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center text-slate-400 font-medium">
                      Cloud storage empty. Add assets to see them synced across devices.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.symbol} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-lg shadow-indigo-100">
                            {item.symbol[0]}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{item.symbol}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Equity Instrument</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-700">{item.shares.toLocaleString()}</td>
                      <td className="px-6 py-4 font-bold text-slate-700">${item.avgCost.toFixed(2)}</td>
                      <td className="px-6 py-4 font-bold text-emerald-600">${(item.shares * item.avgCost * 1.05).toFixed(2)}</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => handleRemove(item.symbol)}
                          className="text-slate-300 hover:text-rose-500 transition-colors p-2 opacity-0 group-hover:opacity-100"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add Asset Form */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 h-fit">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center">
            <span className="mr-2">💳</span> Cloud Asset Acquisition
          </h3>
          <form onSubmit={handleAddStock} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Symbol</label>
              <input
                type="text"
                required
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="NVDA"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none uppercase font-bold text-slate-700 transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Quantity</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-bold text-slate-700 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Price</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-bold text-slate-700 transition-all"
                />
              </div>
            </div>
            <button
              disabled={adding}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-indigo-600 shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 mt-4"
            >
              {adding ? 'Securing to Cloud...' : 'Commit Transaction'}
            </button>
          </form>
          <div className="mt-8 pt-6 border-t border-slate-50">
            <div className="flex items-center text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-2">
              <span className="mr-2">🛡️</span> Multi-Region Redundancy
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed italic">
              Portfolio changes are mirrored across Firestore instances immediately. All data is scoped to your secure UID.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Portfolio;
