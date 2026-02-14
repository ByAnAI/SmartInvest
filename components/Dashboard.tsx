import React, { useState, useEffect } from 'react';
import StockChart from './StockChart';
import { StockData, PortfolioItem } from '../types';
import { auth } from '../services/firebase';
import { addStock, getPortfolio, getWatchlist, addToWatchlist, removeFromWatchlist } from '../services/firestoreService';

// Fallback mock stocks for rendering if watchlist is empty or while loading specific data
const MOCK_STOCKS_MAP: Record<string, StockData> = {
  'AAPL': {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 182.63,
    change: 1.45,
    changePercent: 0.8,
    marketCap: '2.84T',
    peRatio: '28.4',
    history: [
      { time: '09:00', price: 180.20 },
      { time: '10:00', price: 181.50 },
      { time: '11:00', price: 180.80 },
      { time: '12:00', price: 182.10 },
      { time: '13:00', price: 181.90 },
      { time: '14:00', price: 183.20 },
      { time: '15:00', price: 182.63 },
    ]
  },
  'NVDA': {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    price: 726.13,
    change: 14.50,
    changePercent: 2.04,
    marketCap: '1.79T',
    peRatio: '95.2',
    history: [
      { time: '09:00', price: 710.20 },
      { time: '10:00', price: 715.50 },
      { time: '11:00', price: 722.80 },
      { time: '12:00', price: 718.10 },
      { time: '13:00', price: 725.90 },
      { time: '14:00', price: 730.20 },
      { time: '15:00', price: 726.13 },
    ]
  },
  'TSLA': {
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    price: 193.57,
    change: -2.31,
    changePercent: -1.18,
    marketCap: '617.2B',
    peRatio: '42.8',
    history: [
      { time: '09:00', price: 196.20 },
      { time: '10:00', price: 195.50 },
      { time: '11:00', price: 194.80 },
      { time: '12:00', price: 194.10 },
      { time: '13:00', price: 193.90 },
      { time: '14:00', price: 192.20 },
      { time: '15:00', price: 193.57 },
    ]
  },
  'MSFT': {
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    price: 415.50,
    change: 2.10,
    changePercent: 0.51,
    marketCap: '3.08T',
    peRatio: '36.5',
    history: [
      { time: '09:00', price: 412.00 },
      { time: '12:00', price: 414.50 },
      { time: '15:00', price: 415.50 },
    ]
  }
};

const Dashboard: React.FC = () => {
  const [selectedStock, setSelectedStock] = useState<StockData>(MOCK_STOCKS_MAP['AAPL']);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const [newTicker, setNewTicker] = useState('');
  const [isAddingTicker, setIsAddingTicker] = useState(false);
  const user = auth.currentUser;

  // Initial data fetch
  useEffect(() => {
    const fetchData = async () => {
      if (user) {
        try {
          const [portfolioItems, userWatchlist] = await Promise.all([
            getPortfolio(user.uid),
            getWatchlist(user.uid)
          ]);
          setPortfolioSymbols(portfolioItems.map(i => i.symbol));
          setWatchlist(userWatchlist);
          
          // Set first item in watchlist as selected if available
          if (userWatchlist.length > 0) {
            const firstSymbol = userWatchlist[0];
            if (MOCK_STOCKS_MAP[firstSymbol]) {
              setSelectedStock(MOCK_STOCKS_MAP[firstSymbol]);
            } else {
              // Create basic stock data for unknown symbols from mock map
              setSelectedStock({
                symbol: firstSymbol,
                name: `${firstSymbol} Asset`,
                price: 100.00,
                change: 0,
                changePercent: 0,
                marketCap: 'N/A',
                peRatio: 'N/A',
                history: []
              });
            }
          }
        } catch (e) {
          console.error("Dashboard: Error fetching user data", e);
        }
      }
    };
    fetchData();
  }, [user]);

  const handleSelectStock = (symbol: string) => {
    const stock = MOCK_STOCKS_MAP[symbol] || {
      symbol: symbol,
      name: `${symbol} Asset`,
      price: 100.00,
      change: 0,
      changePercent: 0,
      marketCap: 'N/A',
      peRatio: 'N/A',
      history: []
    };
    setSelectedStock(stock);
    setFeedback(`${symbol} selected for analysis.`);
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleSaveToPortfolio = async () => {
    if (!user) {
      setFeedback("Please sign in to manage your portfolio.");
      return;
    }

    setIsSaving(true);
    try {
      const item: PortfolioItem = {
        symbol: selectedStock.symbol,
        shares: 1,
        avgCost: selectedStock.price
      };
      
      await addStock(user.uid, item);
      setPortfolioSymbols(prev => [...prev, selectedStock.symbol]);
      setFeedback(`Success! ${selectedStock.symbol} added to your secure cloud portfolio.`);
    } catch (err: any) {
      setFeedback(`Error: ${err.message || "Failed to save."}`);
    } finally {
      setIsSaving(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const handleAddTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTicker) return;
    const ticker = newTicker.toUpperCase().trim();
    if (watchlist.includes(ticker)) {
      setFeedback("Ticker already in watchlist.");
      return;
    }

    setIsAddingTicker(true);
    try {
      await addToWatchlist(user.uid, ticker);
      setWatchlist(prev => [...prev, ticker]);
      setNewTicker('');
      setFeedback(`${ticker} added to cloud watchlist.`);
    } catch (e) {
      setFeedback("Failed to update watchlist.");
    } finally {
      setIsAddingTicker(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const handleRemoveTicker = async (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await removeFromWatchlist(user.uid, symbol);
      setWatchlist(prev => prev.filter(s => s !== symbol));
      setFeedback(`${symbol} removed.`);
    } catch (e) {
      setFeedback("Failed to remove ticker.");
    }
    setTimeout(() => setFeedback(null), 3000);
  };

  const isAlreadyInPortfolio = portfolioSymbols.includes(selectedStock.symbol);

  return (
    <div className="space-y-6 relative pb-10">
      {/* Dynamic Feedback Toast */}
      {feedback && (
        <div className="fixed top-20 right-8 z-[60] bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl border border-slate-700 flex items-center space-x-3 animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-xs">🔔</div>
          <p className="text-sm font-bold tracking-tight">{feedback}</p>
          <button onClick={() => setFeedback(null)} className="text-slate-500 hover:text-white ml-2">✕</button>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 group hover:border-indigo-100 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <span className="p-3 bg-indigo-50 text-indigo-600 rounded-xl text-xl">📈</span>
            <span className="text-emerald-500 text-xs font-semibold bg-emerald-50 px-2 py-1 rounded-lg">+12.5%</span>
          </div>
          <h3 className="text-slate-500 text-sm font-medium uppercase tracking-widest">S&P 500 Index</h3>
          <p className="text-2xl font-bold mt-1 text-slate-900">5,088.80</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 group hover:border-emerald-100 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <span className="p-3 bg-emerald-50 text-emerald-600 rounded-xl text-xl">⚡</span>
            <span className="text-emerald-500 text-xs font-semibold bg-emerald-50 px-2 py-1 rounded-lg">+0.8%</span>
          </div>
          <h3 className="text-slate-500 text-sm font-medium uppercase tracking-widest">Nasdaq Composite</h3>
          <p className="text-2xl font-bold mt-1 text-slate-900">17,937.61</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 group hover:border-amber-100 transition-colors">
          <div className="flex justify-between items-start mb-4">
            <span className="p-3 bg-amber-50 text-amber-600 rounded-xl text-xl">🏦</span>
            <span className="text-rose-500 text-xs font-semibold bg-rose-50 px-2 py-1 rounded-lg">-0.2%</span>
          </div>
          <h3 className="text-slate-500 text-sm font-medium uppercase tracking-widest">Dow Jones Ind.</h3>
          <p className="text-2xl font-bold mt-1 text-slate-900">39,131.53</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart Area */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-100 min-h-[450px] relative overflow-hidden flex flex-col">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8">
            <div className="flex items-center space-x-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-lg ${
                selectedStock.change >= 0 ? 'bg-emerald-600 text-white shadow-emerald-100' : 'bg-rose-600 text-white shadow-rose-100'
              }`}>
                {selectedStock.symbol[0]}
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">{selectedStock.name}</h3>
                <div className="flex items-center space-x-3 mt-1">
                  <span className="text-3xl font-extrabold text-slate-900">${selectedStock.price}</span>
                  <span className={`text-sm font-bold flex items-center px-2 py-0.5 rounded-lg ${
                    selectedStock.change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                  }`}>
                    {selectedStock.change >= 0 ? '▲' : '▼'} {selectedStock.changePercent}%
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-2 self-end sm:self-start">
              <button 
                onClick={handleSaveToPortfolio}
                disabled={isSaving || isAlreadyInPortfolio}
                className={`flex items-center space-x-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 ${
                  isAlreadyInPortfolio 
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-100'
                }`}
              >
                {isSaving ? (
                  <span className="flex items-center"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span> Syncing...</span>
                ) : isAlreadyInPortfolio ? (
                  <span className="flex items-center">✓ In Portfolio</span>
                ) : (
                  <span className="flex items-center"><span className="mr-2">💼</span> Add to Portfolio</span>
                )}
              </button>
            </div>
          </div>
          
          <div className="relative w-full h-[300px] min-h-[300px] block">
            <StockChart data={selectedStock.history} color={selectedStock.change >= 0 ? "#10b981" : "#ef4444"} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {['1D', '1W', '1M', '1Y', 'ALL'].map((range) => (
              <button 
                key={range} 
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  range === '1D' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          <div className="mt-8 pt-8 border-t border-slate-50">
            <div className="flex items-center justify-between mb-6">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Key Fundamentals</h4>
              <div className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-black">MARKET STATUS: OPEN</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Market Cap</p>
                <p className="text-lg font-extrabold text-slate-800">{selectedStock.marketCap}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">P/E Ratio</p>
                <p className="text-lg font-extrabold text-slate-800">{selectedStock.peRatio}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dividend Yield</p>
                <p className="text-lg font-extrabold text-slate-800">1.42%</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg. Volume</p>
                <p className="text-lg font-extrabold text-slate-800">54.2M</p>
              </div>
            </div>
          </div>
        </div>

        {/* Persistent Watchlist */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 h-fit flex flex-col">
          <div className="flex justify-between items-center mb-6 px-2">
            <h3 className="text-lg font-bold text-slate-800">My Watchlist</h3>
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-1 rounded">Synced</span>
          </div>

          <form onSubmit={handleAddTicker} className="mb-6 flex gap-2 px-2">
            <input 
              type="text" 
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              placeholder="Add Ticker (e.g. GOOGL)"
              className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
            <button 
              disabled={isAddingTicker || !newTicker}
              className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              {isAddingTicker ? '...' : '+'}
            </button>
          </form>

          <div className="space-y-3 flex-1">
            {watchlist.length === 0 ? (
              <div className="text-center py-10 px-4">
                <p className="text-xs text-slate-400 font-medium">Your watchlist is empty. Add ticker symbols to track them here.</p>
              </div>
            ) : (
              watchlist.map((symbol) => {
                const stock = MOCK_STOCKS_MAP[symbol];
                return (
                  <button
                    key={symbol}
                    onClick={() => handleSelectStock(symbol)}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all border group relative ${
                      selectedStock.symbol === symbol 
                        ? 'border-indigo-600 bg-indigo-50/30 shadow-md shadow-indigo-100/20' 
                        : 'border-slate-50 hover:bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3 text-left">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold transition-transform group-hover:scale-105 ${
                        (stock?.change || 0) >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {symbol}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{symbol}</p>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">
                          {stock ? stock.name.split(' ')[0] : 'Asset'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end pr-6">
                      <p className="font-bold text-slate-900 text-sm">${stock?.price || '---'}</p>
                      <p className={`text-[10px] font-bold ${ (stock?.change || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {stock ? `${stock.change >= 0 ? '+' : ''}${stock.changePercent}%` : 'N/A'}
                      </p>
                    </div>
                    <button 
                      onClick={(e) => handleRemoveTicker(e, symbol)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-rose-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </button>
                );
              })
            )}
          </div>
          
          <div className="mt-8 pt-6 border-t border-slate-50 px-2">
            <p className="text-[10px] text-slate-400 font-bold leading-relaxed italic">
              Watchlist symbols are saved to your institutional profile and synced across all your devices.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;