
import React from 'react';

interface LandingPageProps {
  onStart: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center relative overflow-hidden px-4">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/10 rounded-full blur-[120px]"></div>
      
      {/* Content */}
      <div className="relative z-10 max-w-4xl text-center space-y-8">
        <div className="inline-flex items-center space-x-2 bg-white/5 border border-white/10 px-4 py-2 rounded-full mb-4 backdrop-blur-sm">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-indigo-200 text-xs font-semibold uppercase tracking-widest">Powered by Gemini 3.5 AI</span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tight leading-tight">
          Master the Market with <br />
          <span className="bg-gradient-to-r from-indigo-400 via-emerald-400 to-indigo-400 bg-clip-text text-transparent bg-[length:200%_auto] animate-[gradient_8s_linear_infinite]">
            Intelligent Wealth
          </span>
        </h1>
        
        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
          SmartInvest AI combines deep neural analysis with real-time market grounding to provide you with institutional-grade insights for your personal portfolio.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
          <button 
            onClick={onStart}
            className="group relative px-10 py-5 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-2xl shadow-indigo-500/40 hover:bg-indigo-500 transition-all duration-300 transform hover:-translate-y-1 active:scale-95 overflow-hidden"
          >
            <span className="relative z-10 flex items-center">
              Get Started Now
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
          </button>
          
          <button className="px-10 py-5 bg-transparent text-slate-300 border border-slate-700 rounded-2xl font-bold text-lg hover:bg-white/5 transition-all">
            View Live Demo
          </button>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-20 border-t border-white/5 mt-12">
          <div className="text-left space-y-2">
            <div className="text-indigo-400 text-2xl">🧠</div>
            <h3 className="text-white font-bold">Neural Analysis</h3>
            <p className="text-slate-500 text-sm">Deep learning models analyze thousands of data points in seconds.</p>
          </div>
          <div className="text-left space-y-2">
            <div className="text-emerald-400 text-2xl">🌍</div>
            <h3 className="text-white font-bold">Market Grounding</h3>
            <p className="text-slate-500 text-sm">Real-time news integration using advanced Google Search tools.</p>
          </div>
          <div className="text-left space-y-2">
            <div className="text-amber-400 text-2xl">🛡️</div>
            <h3 className="text-white font-bold">Risk Management</h3>
            <p className="text-slate-500 text-sm">Automated risk assessment for your specific portfolio goals.</p>
          </div>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes gradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  );
};

export default LandingPage;
