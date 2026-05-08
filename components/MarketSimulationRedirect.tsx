import React from 'react';

/** Shown when user opens the Market Simulation nav tab — content lives on Portfolio now. */
const MarketSimulationRedirect: React.FC = () => (
  <div className="max-w-lg mx-auto py-16 md:py-24 px-4">
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm p-8 md:p-10 text-center space-y-6">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Paper trading</p>
      <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Simulated portfolio is on Portfolio</h2>
      <p className="text-slate-600 text-sm leading-relaxed">
        Cash balance, simulated positions, market-value and P/L tables — including totals — are now under{' '}
        <span className="font-semibold text-indigo-700">Portfolio</span>. Scroll to <strong>Simulated portfolio</strong>, or jump
        there directly.
      </p>
      <button
        type="button"
        className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-indigo-600 text-white text-sm font-black uppercase tracking-wide shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-colors active:scale-[0.98]"
        onClick={() => {
          window.location.hash = 'simulated-portfolio';
          window.dispatchEvent(new CustomEvent('changeTab', { detail: 'portfolio' }));
        }}
      >
        Open Portfolio · Simulated portfolio
      </button>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Paper-traded equities also roll into <strong>Portfolio Health &amp; 3M What-If Scenarios</strong> above that section.
      </p>
    </div>
  </div>
);

export default MarketSimulationRedirect;
