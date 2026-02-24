
import React, { useState } from 'react';

const Dashboard: React.FC = () => {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const mainIndices = [
    { name: 'S&P 500', change: '+0.56%', price: '$6,881.31', color: 'text-emerald-500' },
    { name: 'Nasdaq 100', change: '+0.80%', price: '$24,898.87', color: 'text-emerald-500' },
    { name: 'Russell 2000', change: '-0.12%', price: '$2,142.45', color: 'text-rose-500' },
  ];

  type AssetRow = {
    name: string;
    trend1M: 'up' | 'down' | 'neutral' | 'widening';
    trend3M: 'up' | 'down' | 'neutral';
    regime: string;
    note?: string;
  };

  const sections: { title: string; subtitle: string; assets: AssetRow[]; insight?: string }[] = [
    {
      title: 'EQUITIES (Risk Appetite)',
      subtitle: 'Institutional Risk Benchmarks',
      assets: [
        { name: 'S&P 500 (Broad US)', trend1M: 'up', trend3M: 'up', regime: 'Risk-On' },
        { name: 'NASDAQ-100 (Growth/Liq)', trend1M: 'up', trend3M: 'up', regime: 'Easing Liquidity' },
        { name: 'Russell 2000 (Domestic/Credit)', trend1M: 'neutral', trend3M: 'down', regime: 'Credit Sensitivity' },
      ],
      insight: 'If Russell underperforms S&P → tightening liquidity. If Nasdaq leads → easing liquidity / duration bid.'
    },
    {
      title: 'DERIVATIVES (Equity & Vol)',
      subtitle: 'Leveraged Exposure & Hedging',
      assets: [
        { name: 'S&P 500 Futures (ES)', trend1M: 'up', trend3M: 'up', regime: 'Institutional Beta' },
        { name: 'Nasdaq Futures (NQ)', trend1M: 'up', trend3M: 'up', regime: 'Growth Momentum' },
        { name: 'Russell Futures (RTY)', trend1M: 'neutral', trend3M: 'down', regime: 'Reflation Bet' },
        { name: 'Equity Options', trend1M: 'up', trend3M: 'neutral', regime: 'Tail Hedging' },
        { name: 'VIX Futures & Options', trend1M: 'down', trend3M: 'up', regime: 'Sentiment Buffer' },
      ],
      insight: 'High OTM Put volume in ES/NQ indicates growing demand for tail protection.'
    },
    {
      title: 'FX DERIVATIVES',
      subtitle: 'Macro Flows & Dollar Funding',
      assets: [
        { name: 'EUR/USD Futures', trend1M: 'down', trend3M: 'down', regime: 'Dollar Strength' },
        { name: 'USD/JPY Futures', trend1M: 'up', trend3M: 'up', regime: 'Carry Trade' },
        { name: 'FX Options', trend1M: 'up', trend3M: 'neutral', regime: 'FX Uncertainty' },
        { name: 'Currency Swaps', trend1M: 'down', trend3M: 'down', regime: 'Funding Stress' },
      ],
      insight: 'JPY futures weakness often correlates with risk-on carry trade expansion.'
    },
    {
      title: 'COMMODITIES COMPLEX',
      subtitle: 'Precious, Industrial & Global Demand',
      assets: [
        { name: 'Gold', trend1M: 'up', trend3M: 'up', regime: 'Monetary Hedge' },
        { name: 'Silver', trend1M: 'up', trend3M: 'neutral', regime: 'Growth Reflation' },
        { name: 'Platinum', trend1M: 'neutral', trend3M: 'down', regime: 'Industrial Value' },
        { name: 'Palladium', trend1M: 'down', trend3M: 'down', regime: 'Auto Catalyst' },
        { name: 'Copper ("Dr. Copper")', trend1M: 'neutral', trend3M: 'down', regime: 'Growth Signal' },
        { name: 'Aluminum', trend1M: 'up', trend3M: 'neutral', regime: 'Supply Stress' },
        { name: 'Nickel', trend1M: 'down', trend3M: 'down', regime: 'EV Slowdown' },
        { name: 'Zinc', trend1M: 'neutral', trend3M: 'down', regime: 'Steel Cycle' },
      ],
      insight: 'Silver outperforming Gold → growth reflation. Copper rising + yields rising = growth acceleration.'
    },
    {
      title: 'CREDIT & LIQUIDITY',
      subtitle: 'The Leading Indicator Layer',
      assets: [
        { name: 'Investment Grade Spread', trend1M: 'down', trend3M: 'down', regime: 'Funding Stress' },
        { name: 'High Yield Spread', trend1M: 'widening', trend3M: 'down', regime: 'Recession Warning' },
        { name: 'TED Spread', trend1M: 'neutral', trend3M: 'up', regime: 'Banking Stress' },
        { name: 'M2 Money Supply', trend1M: 'up', trend3M: 'up', regime: 'Asset Inflation' },
        { name: 'Fed Balance Sheet Size', trend1M: 'down', trend3M: 'down', regime: 'Quant. Tightening' },
      ],
      insight: 'Institutional reality: Credit moves first. Equities move second.'
    }
  ];

  const TrendIcon = ({ trend }: { trend: AssetRow['trend1M'] }) => {
    if (trend === 'up') return <span className="text-emerald-500 font-bold">🟢</span>;
    if (trend === 'down') return <span className="text-rose-500 font-bold">🔴</span>;
    if (trend === 'widening') return <span className="text-rose-600 font-bold flex items-center justify-center space-x-1">🔴<span className="text-[8px] uppercase font-black">widening</span></span>;
    return <span className="text-amber-500 font-bold">🟡</span>;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* Branded Header Section */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 flex flex-col items-center text-center space-y-2">
        <div className="flex items-center space-x-1">
          <span className="text-3xl font-black tracking-tighter text-amber-500">Smart</span>
          <span className="text-3xl font-black tracking-tighter text-blue-600 italic">Invest</span>
          <span className="text-3xl font-light tracking-tighter text-blue-800 ml-1">AI</span>
        </div>
        <div className="flex items-center space-x-3 text-slate-500 text-[10px] font-medium uppercase tracking-widest">
          <span>{dateStr}</span>
          <span className="text-slate-300">|</span>
          <a href="#" className="text-blue-600 hover:underline">View Online</a>
          <span className="text-slate-300">|</span>
          <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('changeTab', { detail: 'portfolio' })); }} className="text-blue-600 hover:underline">Portfolio</a>
          <span className="text-slate-300">|</span>
          <a href="#" className="text-blue-600 hover:underline">Start Free Trial</a>
        </div>
      </div>

      {/* Main Market Indices */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {mainIndices.map((index) => (
          <div key={index.name} className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col items-center text-center hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer group">
            <h3 className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{index.name}</h3>
            <p className={`text-2xl font-black ${index.color} mb-1`}>{index.change}</p>
            <p className="text-slate-900 font-bold text-sm tracking-tight">{index.price}</p>
          </div>
        ))}
      </div>

      {/* Comprehensive Market Data Sections */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-slate-900">
        {sections.map((section) => (
          <div
            key={section.title}
            className={`bg-white border border-slate-100 rounded-[1.5rem] shadow-sm overflow-hidden flex flex-col ${section.title === 'COMMODITIES COMPLEX' ? 'xl:col-span-2' : ''
              }`}
          >
            <div className="p-4 border-b border-slate-50">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-sm font-black text-slate-900 tracking-tight uppercase tracking-wider">{section.title}</h2>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mt-0.5">{section.subtitle}</p>
                </div>
                <div className="bg-slate-50 px-2 py-0.5 rounded-full text-[8px] font-bold text-slate-400 uppercase tracking-tighter border border-slate-100">
                  Live
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-8 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest w-1/3 text-slate-600">Asset</th>
                    <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center text-slate-600">1M</th>
                    <th className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center text-slate-600">3M</th>
                    <th className="px-8 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right text-slate-600">Regime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {section.title === 'COMMODITIES COMPLEX' ? (
                    // Specialized Grid-based non-table layout for dual columns
                    <tr className="w-full">
                      <td colSpan={4} className="p-0">
                        <div className="grid grid-cols-1 md:grid-cols-2">
                          {section.assets.map((asset, assetIdx) => (
                            <div
                              key={asset.name}
                              className={`flex items-center justify-between p-2.5 px-6 hover:bg-slate-50 transition-colors group ${assetIdx % 2 === 0 ? 'md:border-r md:border-slate-50' : ''
                                } ${assetIdx < section.assets.length - 2 ? 'border-b border-slate-50' : ''}`}
                            >
                              <div className="flex-1 min-w-0 mr-4">
                                <span className="font-bold text-slate-700 text-[12px] group-hover:text-blue-600 transition-colors truncate block">{asset.name}</span>
                              </div>
                              <div className="flex items-center space-x-6 sm:space-x-8">
                                <div className="flex items-center space-x-6 sm:space-x-8">
                                  <div className="w-6 flex justify-center"><TrendIcon trend={asset.trend1M} /></div>
                                  <div className="w-6 flex justify-center"><TrendIcon trend={asset.trend3M} /></div>
                                </div>
                                <div className="w-24 text-right">
                                  <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter inline-block whitespace-nowrap ${asset.regime.includes('Stress') || asset.regime.includes('Warning') || asset.regime.includes('Slowdown')
                                    ? 'bg-rose-50 text-rose-600 border border-rose-100'
                                    : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                    }`}>
                                    {asset.regime}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    section.assets.map((asset) => (
                      <tr key={asset.name} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-8 py-5">
                          <span className="font-bold text-slate-700 text-sm group-hover:text-blue-600 transition-colors">{asset.name}</span>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <TrendIcon trend={asset.trend1M} />
                        </td>
                        <td className="px-4 py-5 text-center">
                          <TrendIcon trend={asset.trend3M} />
                        </td>
                        <td className="px-8 py-5 text-right">
                          <span className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tighter inline-block whitespace-nowrap ${asset.regime.includes('Stress') || asset.regime.includes('Warning') || asset.regime.includes('Tightening') || asset.regime.includes('Fear')
                            ? 'bg-rose-50 text-rose-600 border border-rose-100'
                            : asset.regime.includes('Risk-On') || asset.regime.includes('Inflation') || asset.regime.includes('Expanding') || asset.regime.includes('Momentum')
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                              : 'bg-blue-50 text-blue-600 border border-blue-100'
                            }`}>
                            {asset.regime}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {section.insight && (
              <div className="p-3 bg-slate-50 border-t border-slate-100">
                <div className="flex space-x-2 items-start">
                  <span className="text-blue-600 mt-0.5 font-bold text-[10px]">💡</span>
                  <div>
                    <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest leading-none mb-1">Institutional Insight</p>
                    <p className="text-[10px] text-slate-500 font-medium leading-tight italic">{section.insight}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Institutional Interpretation Summary */}
      <div className="bg-slate-900 rounded-[1.5rem] p-6 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-10">
          <span className="text-6xl font-black uppercase tracking-tighter">Regime</span>
        </div>

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-black tracking-tighter mb-4 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent uppercase">
              Regime Interpretation
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"></span>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400">Risk-On</p>
                </div>
                <ul className="space-y-1.5">
                  {['Spreads Tightening', 'Copper Rising', 'Russell Outperforming'].map(item => (
                    <li key={item} className="flex items-center text-[11px] font-bold text-slate-300">
                      <span className="text-emerald-500 mr-2 text-[10px]">✦</span> {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]"></span>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-rose-400">Risk-Off</p>
                </div>
                <ul className="space-y-1.5">
                  {['HY Widening', 'TED Spread Rising', 'Capital Flight'].map(item => (
                    <li key={item} className="flex items-center text-[11px] font-bold text-slate-300">
                      <span className="text-rose-500 mr-2 text-[10px]">✦</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-center text-center space-y-4 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-indigo-400 text-[9px] font-black uppercase tracking-[0.2em]">Inflation Basis</span>
              <span className="text-white text-[11px] font-black">Energy + Agri Rising</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-indigo-400 text-[9px] font-black uppercase tracking-[0.2em]">Growth Bias</span>
              <span className="text-white text-[11px] font-black">Silver &gt; Gold</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
