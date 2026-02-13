
import React, { useState, useEffect } from 'react';
import StockChart from './StockChart';
import { StockData, PortfolioItem } from '../types';
import { auth } from '../services/firebase';
import { addStock, getPortfolio } from '../services/firestoreService';

const MOCK_STOCKS: StockData[] = [
  {
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
  {
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
  {
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
  }
];

const Dashboard: React.FC = () => {
  const [selectedStock, setSelectedStock] = useState<StockData>(MOCK_STOCKS[0]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const user = auth.currentUser;

  // Sync check if selected stock is already in database
  useEffect(() => {
    const checkPortfolio = async () => {
      if (user) {
        try {
          const items = await getPortfolio(user.uid);
          setPortfolioSymbols(items.map(i => i.symbol));
        } catch (e) {
          console.error("Failed to fetch portfolio for check", e);
        }
      }
    };
    checkPortfolio();
  }, [user, selectedStock]);

  const handleSelectStock = (stock: StockData) => {
    setSelectedStock(stock);
    setFeedback(`${stock.symbol} added to your viewing watchlist.`);
    // Clear feedback after 3 seconds
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleSaveToDatabase = async () => {
    if (!user) {
      setFeedback("Please sign in to save stocks to your cloud portfolio.");
      return;
    }

    setIsSaving(true);
    try {
      const item: PortfolioItem = {
        symbol: selectedStock.symbol,
        shares: 1, // Default to 1 share when adding from dashboard
        avgCost: selectedStock.price
      };
      
      await addStock(user.uid, item);
      setPortfolioSymbols(prev => [...prev, selectedStock.symbol]);
      setFeedback(`Success! ${selectedStock.symbol} has been saved to your secure cloud database.`);
    } catch (err: any) {
      setFeedback(`Error: ${err.message || "Failed to save to database."}`);
    } finally {
      setIsSaving(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const isAlreadySaved = portfolioSymbols.includes(selectedStock.symbol);

  return (
    <div className="space-y-6 relative">
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
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-100 min-h-[450px] relative overflow-hidden">
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
                onClick={handleSaveToDatabase}
                disabled={isSaving || isAlreadySaved}
                className={`flex items-center space-x-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 ${
                  isAlreadySaved 
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-100'
                }`}
              >
                {isSaving ? (
                  <span className="flex items-center"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span> Syncing...</span>
                ) : isAlreadySaved ? (
                  <span className="flex items-center">✓ Saved to Cloud</span>
                ) : (
                  <span className="flex items-center"><span className="mr-2">☁️</span> Save to Portfolio</span>
                )}
              </button>
            </div>
          </div>
          
          <div className="h-[300px]">
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
        </div>

        {/* Watchlist Selection */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 h-fit">
          <div className="flex justify-between items-center mb-6 px-2">
            <h3 className="text-lg font-bold text-slate-800">Market Watchlist</h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded">MOCK DATA</span>
          </div>
          <div className="space-y-3">
            {MOCK_STOCKS.map((stock) => (
              <button
                key={stock.symbol}
                onClick={() => handleSelectStock(stock)}
                className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all border group ${
                  selectedStock.symbol === stock.symbol 
                    ? 'border-indigo-600 bg-indigo-50/30 shadow-md shadow-indigo-100/20' 
                    : 'border-slate-50 hover:bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center space-x-3 text-left">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold transition-transform group-hover:scale-110 ${
                    stock.change >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }`}>
                    {stock.symbol}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{stock.symbol}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">{stock.name.split(' ')[0]}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900 text-sm">${stock.price}</p>
                  <p className={`text-[10px] font-bold ${stock.change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {stock.change >= 0 ? '+' : ''}{stock.changePercent}%
                  </p>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-8 pt-6 border-t border-slate-50">
             <button className="w-full flex items-center justify-center space-x-2 py-4 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 text-sm font-bold hover:bg-slate-50 hover:border-indigo-200 hover:text-indigo-600 transition-all group">
              <span className="text-xl group-hover:rotate-90 transition-transform">⊕</span>
              <span>Find More Assets</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
