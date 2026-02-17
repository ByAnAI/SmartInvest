
import React, { useState, useEffect } from 'react';
import StockChart from './StockChart';
import { StockData, PortfolioItem } from '../types';
import { addStock, getPortfolio, getWatchlist, addToWatchlist, removeFromWatchlist } from '../services/firestoreService';
import { auth } from '../services/firebase';

const INITIAL_MOCK_STOCKS: Record<string, StockData> = {
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
  const [marketStocks, setMarketStocks] = useState<Record<string, StockData>>(INITIAL_MOCK_STOCKS);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AAPL');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const [newTicker, setNewTicker] = useState('');
  const [isAddingTicker, setIsAddingTicker] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>(new Date().toLocaleTimeString());
  const [tickerToRemove, setTickerToRemove] = useState<string | null>(null);
  
  const user = auth.currentUser;

  // Real-time Simulation: Updated to handle dynamic tickers in market refresh
  useEffect(() => {
    const interval = setInterval(() => {
      setMarketStocks(prev => {
        const next = { ...prev };
        
        // Ensure all watchlisted symbols exist in marketStocks
        watchlist.forEach(sym => {
          if (!next[sym]) {
            next[sym] = {
              symbol: sym,
              name: `${sym} Asset`,
              price: 100 + Math.random() * 50,
              change: 0,
              changePercent: 0,
              marketCap: 'N/A',
              peRatio: 'N/A',
              history: []
            };
          }
        });

        Object.keys(next).forEach(symbol => {
          const current = next[symbol];
          const volatility = 0.002;
          const change = current.price * (Math.random() * volatility * 2 - volatility);
          const newPrice = Number((current.price + change).toFixed(2));
          
          next[symbol] = {
            ...current,
            price: newPrice,
            change: Number((current.change + change).toFixed(2)),
            changePercent: Number(((current.change + change) / (newPrice - (current.change + change)) * 100).toFixed(2))
          };
        });
        return next;
      });
      setLastUpdate(new Date().toLocaleTimeString());
    }, 15000);

    return () => clearInterval(interval);
  }, [watchlist]);

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
          
          if (userWatchlist.length > 0) {
            setSelectedSymbol(userWatchlist[0]);
          }
        } catch (e) {
          console.error("Dashboard: Error fetching user data", e);
        }
      }
    };
    fetchData();
  }, [user]);

  const selectedStock = marketStocks[selectedSymbol] || {
    symbol: selectedSymbol,
    name: `${selectedSymbol} Asset`,
    price: 0.00,
    change: 0,
    changePercent: 0,
    marketCap: 'N/A',
    peRatio: 'N/A',
    history: []
  };

  const handleSelectStock = (symbol: string) => {
    setSelectedSymbol(symbol);
  };

  const handleSaveToPortfolio = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const item: PortfolioItem = {
        symbol: selectedStock.symbol,
        shares: 1,
        avgCost: selectedStock.price
      };
      await addStock(user.uid, item);
      setPortfolioSymbols(prev => [...prev, selectedStock.symbol]);
      setFeedback(`${selectedStock.symbol} added to portfolio.`);
    } catch (err: any) {
      setFeedback(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
      setTimeout(() => setFeedback(null), 3000);
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
      setFeedback(`${ticker} added to watchlist.`);
      setSelectedSymbol(ticker);
    } catch (e) {
      setFeedback("Failed to update watchlist.");
    } finally {
      setIsAddingTicker(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const handleInitiateRemove = (e: React.MouseEvent, symbol: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTickerToRemove(symbol);
  };

  const handleConfirmRemove = async () => {
    if (!user || !tickerToRemove) return;
    const symbol = tickerToRemove;
    
    try {
      await removeFromWatchlist(user.uid, symbol);
      
      const updatedList = watchlist.filter(s => s.toUpperCase() !== symbol.toUpperCase());
      setWatchlist(updatedList);
      setFeedback(`${symbol} purged successfully.`);

      // Logic for fallback selection if viewing deleted item
      if (selectedSymbol.toUpperCase() === symbol.toUpperCase()) {
        if (updatedList.length > 0) {
          setSelectedSymbol(updatedList[0]);
        } else {
          // Fallback to first available initial mock stock if watchlist is wiped
          setSelectedSymbol(Object.keys(INITIAL_MOCK_STOCKS)[0]);
        }
      }
    } catch (err: any) {
      setFeedback("Directive failed: Connection lost.");
    } finally {
      setTickerToRemove(null);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const isAlreadyInPortfolio = portfolioSymbols.includes(selectedStock.symbol);

  return (
    <div className="space-y-6 relative pb-10">
      {/* Custom Confirmation Modal */}
      {tickerToRemove && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-black text-slate-900 mb-2">Confirm Removal</h3>
            <p className="text-slate-500 text-sm font-medium mb-8 leading-relaxed">
              Are you sure you want to remove <span className="font-bold text-slate-900 bg-slate-100 px-1 rounded">{tickerToRemove}</span> from your watchlist?
            </p>
            <div className="flex space-x-3">
              <button 
                onClick={() => setTickerToRemove(null)} 
                className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                No
              </button>
              <button 
                onClick={handleConfirmRemove} 
                className="flex-1 px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <div className="fixed top-24 right-8 z-[100] bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl border border-slate-700 flex items-center space-x-3 animate-in fade-in slide-in-from-right-4">
          <p className="text-xs font-black uppercase tracking-widest">{feedback}</p>
        </div>
      )}

      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Market Pulse Active: {lastUpdate}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-xs font-black uppercase tracking-widest">S&P 500</h3>
          <p className="text-2xl font-black mt-1 text-slate-900">5,088.80</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-xs font-black uppercase tracking-widest">Nasdaq</h3>
          <p className="text-2xl font-black mt-1 text-slate-900">17,937.61</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-xs font-black uppercase tracking-widest">Dow Jones</h3>
          <p className="text-2xl font-black mt-1 text-slate-900">39,131.53</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col min-h-[500px]">
          <div className="flex justify-between items-start mb-8">
            <div className="flex items-center space-x-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-xl transition-all duration-500 ${selectedStock.change >= 0 ? 'bg-emerald-600 shadow-emerald-500/20' : 'bg-rose-600 shadow-rose-500/20'}`}>
                {selectedStock.symbol[0]}
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">{selectedStock.name}</h3>
                <p className="text-3xl font-black text-slate-900">${selectedStock.price.toFixed(2)}</p>
              </div>
            </div>
            <button 
              onClick={handleSaveToPortfolio}
              disabled={isSaving || isAlreadyInPortfolio}
              className={`px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all shadow-lg ${isAlreadyInPortfolio ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'}`}
            >
              {isSaving ? 'Syncing...' : isAlreadyInPortfolio ? 'In Portfolio' : 'Add to Vault'}
            </button>
          </div>
          
          <div className="flex-1 min-h-[300px]">
            <StockChart data={selectedStock.history} color={selectedStock.change >= 0 ? "#10b981" : "#ef4444"} />
          </div>

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6 pt-8 border-t border-slate-50">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Market Cap</p>
              <p className="text-sm font-black text-slate-800">{selectedStock.marketCap}</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">P/E Ratio</p>
              <p className="text-sm font-black text-slate-800">{selectedStock.peRatio}</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Div Yield</p>
              <p className="text-sm font-black text-slate-800">1.42%</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Avg Volume</p>
              <p className="text-sm font-black text-slate-800">54.2M</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 h-fit">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 px-2">Institutional Watchlist</h3>
          
          <form onSubmit={handleAddTicker} className="mb-6 flex gap-2 px-2">
            <input 
              type="text" 
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value)}
              placeholder="Enter Ticker (e.g. AMZN)"
              className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-black tracking-widest focus:ring-2 focus:ring-indigo-500 outline-none uppercase text-slate-700"
            />
            <button disabled={isAddingTicker} className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-xs font-bold hover:bg-indigo-600 transition-all active:scale-95">+</button>
          </form>

          <div className="space-y-3">
            {watchlist.length === 0 ? (
              <div className="py-10 text-center space-y-2 opacity-50">
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">Registry Cleared</p>
                <p className="text-[8px] text-slate-400 font-bold italic uppercase">Add assets to monitor market velocity</p>
              </div>
            ) : (
              watchlist.map((symbol) => {
                const stock = marketStocks[symbol];
                const isActive = selectedSymbol.toUpperCase() === symbol.toUpperCase();
                return (
                  <div
                    key={symbol}
                    onClick={() => handleSelectStock(symbol)}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all border cursor-pointer group relative overflow-visible ${
                      isActive ? 'border-indigo-600 bg-indigo-50/50 shadow-md ring-1 ring-indigo-600' : 'border-slate-50 hover:bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3 z-10">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-sm ${ (stock?.change || 0) >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700' }`}>
                        {symbol[0]}
                      </div>
                      <div>
                        <p className="font-black text-slate-900 text-sm tracking-tight">{symbol}</p>
                        <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest truncate max-w-[80px]">{stock?.name || 'Loading...'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end pr-10 z-10">
                      <p className="font-black text-slate-900 text-sm tracking-tighter">${stock?.price.toFixed(2) || '---'}</p>
                      <p className={`text-[9px] font-black ${ (stock?.change || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {stock ? `${stock.change >= 0 ? '+' : ''}${stock.changePercent.toFixed(2)}%` : '---'}
                      </p>
                    </div>
                    
                    {/* Hardened Removal Button with Tooltip */}
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 z-30 group/del flex items-center">
                      <div className="absolute right-full mr-3 px-3 py-2 bg-slate-900 text-white text-[8px] font-black uppercase tracking-widest rounded-xl opacity-0 group-hover/del:opacity-100 transition-all duration-300 pointer-events-none whitespace-nowrap shadow-2xl border border-slate-700 translate-x-2 group-hover/del:translate-x-0">
                        Remove from Watchlist
                      </div>
                      <button 
                        onClick={(e) => handleInitiateRemove(e, symbol)}
                        className="text-slate-300 hover:text-rose-600 p-2 transition-all hover:scale-125 opacity-0 group-hover:opacity-100 bg-white/10 rounded-lg hover:bg-rose-50"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
