import React from 'react';
import { signOutSafely } from '../services/supabase';
import { useMarketSimulationSummary } from '../hooks/useMarketSimulationSummary';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isAdmin?: boolean;
  /** All signed-in users except admins use paper-only trading simulation. */
  isPaperTrader?: boolean;
  user?: { email?: string | null; user_metadata?: { full_name?: string }; id?: string } | null;
  userMetadata?: { displayName?: string } | null;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab, isAdmin, isPaperTrader, user, userMetadata }) => {
  const { summary } = useMarketSimulationSummary(user?.id ?? null);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'analysis', label: 'AI Analysis', icon: '🧠' },
    { id: 'portfolio', label: 'Portfolio', icon: '💼' },
    { id: 'trading-platform', label: 'Trading Platform', icon: '💹' },
    { id: 'market-simulation', label: 'Market Simulation', icon: '📈' },
    { id: 'news-board', label: 'News Board', icon: '📌' },
    { id: 'sentiment-analysis', label: 'Sentiment', icon: '📰' },
    // New Sections
    { id: 'files', label: 'My Files', icon: '📁' },
    { id: 'notes', label: 'My Notes', icon: '📝' },
    { id: 'team', label: 'Team Members', icon: '👥' },
  ];

  // Add admin tab if user has privileges
  if (isAdmin) {
    tabs.push({ id: 'admin', label: 'Admin Panel', icon: '🛡️' });
  }

  const handleLogout = async () => {
    try {
      await signOutSafely();
      // App.tsx onAuthStateChange will handle redirection
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col hidden md:flex shadow-2xl">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-indigo-400 bg-clip-text text-transparent">
            SmartInvest AI
          </h1>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-semibold">Wealth OS</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 mt-4 overflow-y-auto custom-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                activeTab === tab.id 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className="font-medium">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          {summary ? (
            <div className="rounded-xl border border-slate-700/80 bg-slate-800/80 px-3 py-2.5 mb-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Sim. account</p>
              <p className="text-[11px] font-semibold text-slate-200 tabular-nums">
                Cash{' '}
                <span className="text-white">
                  ${summary.cashUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </p>
              <p className="text-[11px] font-semibold text-indigo-300 tabular-nums mt-0.5">
                Equity{' '}
                <span>
                  ${summary.equityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </p>
            </div>
          ) : null}

          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="flex items-center space-x-3">
              <div className={`w-8 h-8 rounded-full ${isAdmin ? 'bg-indigo-500' : 'bg-indigo-500/20'} flex items-center justify-center text-white border border-indigo-500/20 font-bold overflow-hidden shadow-sm`}>
                {(user?.user_metadata as any)?.avatar_url ? (
                    <img src={(user?.user_metadata as any).avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                    (userMetadata?.displayName?.[0] || user?.user_metadata?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()
                )}
              </div>
              <div className="overflow-hidden">
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  <p className="text-xs font-bold text-white truncate">{userMetadata?.displayName || user?.user_metadata?.full_name || 'Investor'}</p>
                  {isAdmin && (
                    <span className="text-[7px] font-black bg-indigo-500 text-white px-1 py-0.5 rounded tracking-tighter uppercase shrink-0">Admin</span>
                  )}
                  {isPaperTrader && (
                    <span className="text-[7px] font-black bg-emerald-600/90 text-white px-1 py-0.5 rounded tracking-tighter uppercase shrink-0">
                      Paper trader
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
              </div>
            </div>
          </div>
          
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-xl text-white bg-slate-800 hover:bg-slate-700 shadow-lg border border-slate-700 transition-all text-sm font-bold active:scale-[0.98]"
          >
            <span>Sign Out</span>
            <span className="text-lg">↪️</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 z-10 shadow-sm">
          <div className="flex items-center space-x-4">
            <div className="md:hidden">
               <h1 className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-emerald-600 bg-clip-text text-transparent">S.A.I</h1>
            </div>
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest hidden sm:block">
              {tabs.find((t) => t.id === activeTab)?.label ??
                (activeTab === 'admin' ? 'Admin Panel' : activeTab.replace(/-/g, ' '))}
            </h2>
          </div>
          
          <div className="flex items-center space-x-2 md:space-x-4">
            {isAdmin && (
              <div className="hidden sm:flex items-center text-[9px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 uppercase tracking-widest">
                Administrative Mode
              </div>
            )}
            
            {summary ? (
              <div
                className="hidden xl:flex flex-col items-end text-right text-[10px] font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 tabular-nums leading-tight"
                title="Paper-trading simulation (stored in this browser)"
              >
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Sim. account</span>
                <span>
                  Cash <span className="text-slate-900">${summary.cashUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-slate-300 mx-1">·</span>
                  Equity{' '}
                  <span className="text-indigo-700">
                    ${summary.equityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </span>
              </div>
            ) : null}

            <div className="hidden lg:flex items-center space-x-2 text-[10px] text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 font-bold uppercase tracking-tighter">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Secure Cloud Sync</span>
            </div>

            <div className="h-8 w-[1px] bg-slate-200 mx-2"></div>

            <div className="flex items-center space-x-2">
              <button 
                onClick={handleLogout}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-all border border-slate-200 hover:border-indigo-100 group"
              >
                <span className="text-xs font-bold uppercase tracking-wider hidden sm:inline">Log Out</span>
                <span className="text-lg group-hover:translate-x-1 transition-transform duration-300">➜</span>
              </button>
            </div>
          </div>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </div>
      </main>

      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-3 z-50 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.1)] overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-col items-center space-y-1 p-2 rounded-xl transition-all min-w-[60px] ${
              activeTab === tab.id ? 'text-indigo-600 bg-indigo-50 shadow-inner' : 'text-slate-400'
            }`}
          >
            <span className="text-xl">{tab.icon}</span>
            <span className="text-[10px] font-bold tracking-tight whitespace-nowrap">{tab.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Layout;
