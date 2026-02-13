
import React, { useEffect, useState } from 'react';
import { getMarketNews } from '../services/geminiService';

const NewsSection: React.FC = () => {
  const [news, setNews] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const data = await getMarketNews();
        setNews(data);
      } catch (e) {
        console.error("News fetch error", e);
      } finally {
        setLoading(false);
      }
    };
    fetchNews();
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold">Real-time Market Pulse</h2>
        <div className="text-sm text-slate-500 flex items-center">
          <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2 animate-pulse"></span>
          Live data feed
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white p-6 rounded-2xl animate-pulse border border-slate-100 h-40">
              <div className="h-4 bg-slate-200 rounded w-1/4 mb-4"></div>
              <div className="h-4 bg-slate-200 rounded w-full mb-2"></div>
              <div className="h-4 bg-slate-200 rounded w-5/6"></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="prose prose-slate max-w-none">
            {/* Split by potential newlines or bullet points for a nicer look if needed, 
                but for simplicity we'll render the markdown text */}
            <div className="whitespace-pre-line text-slate-700 leading-loose">
              {news}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-emerald-600 p-6 rounded-2xl text-white shadow-lg">
          <h4 className="font-bold mb-2">Earnings Season</h4>
          <p className="text-emerald-100 text-sm">Large-cap tech companies are reporting better-than-expected margins this quarter.</p>
        </div>
        <div className="bg-indigo-600 p-6 rounded-2xl text-white shadow-lg">
          <h4 className="font-bold mb-2">Interest Rates</h4>
          <p className="text-indigo-100 text-sm">Fed indicates potential rate cuts later this year as inflation cools toward 2% goal.</p>
        </div>
        <div className="bg-amber-500 p-6 rounded-2xl text-white shadow-lg">
          <h4 className="font-bold mb-2">Geopolitics</h4>
          <p className="text-amber-50 text-sm">Energy prices fluctuate as supply chain routes face renewed logistical hurdles.</p>
        </div>
      </div>
    </div>
  );
};

export default NewsSection;
