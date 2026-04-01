import React, { useState, useEffect, useMemo } from 'react';
import { getStockInsight } from '../services/geminiService';
import { getAllDailyWatchlists, getCompanyFundamentalsByTickers, getDailyWatchlistItems, getPortfolio } from '../services/supabaseService';
import { supabase } from '../services/supabase';
import { DailyWatchlist, InsightResponse, PortfolioItem } from '../types';

type WatchlistRow = {
  ticker: string;
  company?: string;
  sector?: string;
  industry?: string;
  location?: string;
  current_price?: number | null;
  total_assets?: number | null;
  total_liabilities?: number | null;
  total_revenue?: number | null;
  net_income?: number | null;
  operating_cash_flow?: number | null;
  free_cash_flow?: number | null;
  iv_dcf?: number | null;
  iv_ri?: number | null;
  iv_multiples?: number | null;
  iv_quality_score?: number | null;
  iv_ensemble?: number | null;
  iv_upside_pct?: number | null;
  torchlight_score?: number | null;
  torchlight_rank_factors?: string;
  torchlight_momentum?: number | null;
  torchlight_valuation_edge?: number | null;
  torchlight_quality?: number | null;
  torchlight_growth?: number | null;
  torchlight_sentiment?: number | null;
  torchlight_macro_fit?: number | null;
  torchlight_execution_feasibility?: number | null;
  torchlight_risk_adjusted_alpha?: number | null;
  ctr_total_return?: number | null;
  ctr_annualized?: number | null;
  torchlight_ctr_score?: number | null;
  risk_volatility_annual?: number | null;
  risk_daily_return_mean?: number | null;
  risk_volatility_daily?: number | null;
  risk_sharpe?: number | null;
  risk_sortino?: number | null;
  risk_max_drawdown?: number | null;
  risk_var_95_hist?: number | null;
  risk_var_99_hist?: number | null;
  risk_var_95_param?: number | null;
  risk_var_99_param?: number | null;
  risk_cvar_95?: number | null;
  risk_beta?: number | null;
  risk_summary_score?: number | null;
};

function formatStatementNum(val: number | null | undefined): string {
  if (val == null || Number.isNaN(val)) return '—';
  const abs = Math.abs(val);
  if (abs >= 1e12) return `${(val / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(2)}K`;
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
}

type ReturnPoint = { date: string; ret: number };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const scaleTo100 = (x: number | null | undefined, lo: number, hi: number, neutral = 50) => {
  if (x == null || Number.isNaN(x) || hi <= lo) return neutral;
  return clamp(((x - lo) / (hi - lo)) * 100, 0, 100);
};

const quantile = (arr: number[], q: number): number | null => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (s.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  const w = idx - lo;
  return s[lo] * (1 - w) + s[hi] * w;
};

function tickerFlags(r: WatchlistRow): string[] {
  const flags: string[] = [];
  if ((r.iv_upside_pct ?? 0) < -20) flags.push('Overvalued');
  if ((r.risk_max_drawdown ?? 0) < -0.30) flags.push('High drawdown risk');
  if ((r.risk_sharpe ?? 0) < 0) flags.push('Negative risk-adjusted return');
  if (r.risk_cvar_95 != null && r.risk_volatility_daily != null && Math.abs(r.risk_cvar_95) > 3 * Math.abs(r.risk_volatility_daily)) flags.push('High tail risk');
  if (r.total_assets != null && r.total_liabilities != null && r.total_assets > 0 && r.total_liabilities > 0.8 * r.total_assets) flags.push('Balance sheet stress');
  if ((r.risk_beta ?? 0) > 1.5) flags.push('Excessive beta');
  if ((r.free_cash_flow ?? 0) < 0) flags.push('Negative free cash flow');
  return flags;
}

function tickerHealthScore(r: WatchlistRow): number {
  const valuation = scaleTo100(r.iv_upside_pct, -40, 60);
  const profitability = (
    (r.total_revenue != null && r.total_revenue > 0 ? 25 : 0) +
    (r.net_income != null && r.net_income > 0 ? 25 : 0) +
    (r.operating_cash_flow != null && r.operating_cash_flow > 0 ? 25 : 0) +
    (r.free_cash_flow != null && r.free_cash_flow > 0 ? 25 : 0)
  );
  const balRatio = r.total_assets != null && r.total_liabilities != null && r.total_liabilities > 0
    ? r.total_assets / r.total_liabilities
    : null;
  const balance = scaleTo100(balRatio, 0.7, 2.0);
  const performance = scaleTo100(r.ctr_annualized, -0.2, 0.4);
  const riskProfile = r.risk_summary_score ?? (
    0.35 * (100 - scaleTo100(r.risk_volatility_annual, 0.10, 0.80)) +
    0.35 * (100 - scaleTo100(Math.abs(r.risk_max_drawdown ?? 0), 0.05, 0.60)) +
    0.30 * (100 - scaleTo100(Math.abs(r.risk_cvar_95 ?? 0), 0.007, 0.12))
  );
  const riskAdjusted = 0.6 * scaleTo100(r.risk_sharpe, -1, 3) + 0.4 * scaleTo100(r.risk_sortino, -1, 4);
  return Number((0.2 * valuation + 0.15 * profitability + 0.15 * balance + 0.15 * performance + 0.2 * riskProfile + 0.15 * riskAdjusted).toFixed(1));
}

function buySellScore(row: WatchlistRow): { buy: number; sell: number } {
  const iv = scaleTo100(row.iv_upside_pct, -40, 80);
  const quality = scaleTo100(row.torchlight_score, 20, 90);
  const risk = scaleTo100(row.risk_summary_score, 20, 90);
  const sharpe = scaleTo100(row.risk_sharpe, -1, 3);
  const sortino = scaleTo100(row.risk_sortino, -1, 4);
  const ctr = scaleTo100(row.ctr_annualized, -0.25, 0.5);
  const ddPenalty = 100 - scaleTo100(Math.abs(row.risk_max_drawdown ?? 0), 0.05, 0.60);
  const buy = 0.28 * iv + 0.2 * quality + 0.15 * risk + 0.12 * sharpe + 0.1 * sortino + 0.1 * ctr + 0.05 * ddPenalty;
  const sell = 100 - buy;
  return { buy: Number(buy.toFixed(1)), sell: Number(sell.toFixed(1)) };
}

function pct(val: number | null | undefined, factor = 1): string {
  if (val == null || Number.isNaN(val)) return 'N/A';
  return `${(val * factor).toFixed(2)}%`;
}

function num(val: number | null | undefined, digits = 2): string {
  if (val == null || Number.isNaN(val)) return 'N/A';
  return val.toFixed(digits);
}

function buildContextualInsightPrompt(symbol: string, row: WatchlistRow | null): string {
  if (!row) {
    return `Analyze the stock ticker ${symbol}. Fetch the latest market news, then provide market sentiment, a summary of recent performance, key pros and cons for investors, and a final recommendation with a confidence level. Return only a valid JSON object.`;
  }

  const company = row.company || symbol;
  const sector = row.sector || 'Unknown sector';
  return [
    `System: ${company} (${symbol}) has an Intrinsic Value upside of ${pct(row.iv_upside_pct, 1)} based on our Ensemble model, and a quality score of ${num(row.iv_quality_score, 1)}.`,
    `Quant snapshot: Torchlight ${num(row.torchlight_score, 1)}, Risk Summary ${num(row.risk_summary_score, 1)}, Sharpe ${num(row.risk_sharpe, 2)}, Sortino ${num(row.risk_sortino, 2)}, Max Drawdown ${pct(row.risk_max_drawdown, 100)}, Beta ${num(row.risk_beta, 2)}, CTR Annualized ${pct(row.ctr_annualized, 100)}.`,
    `Financial snapshot: Price ${row.current_price != null ? `$${row.current_price.toFixed(2)}` : 'N/A'}, Assets ${formatStatementNum(row.total_assets)}, Liabilities ${formatStatementNum(row.total_liabilities)}, Revenue ${formatStatementNum(row.total_revenue)}, Net Income ${formatStatementNum(row.net_income)}, Free Cash Flow ${formatStatementNum(row.free_cash_flow)}.`,
    `Task: Fetch the latest market news and explain why the market is currently pricing ${company} at this discount/premium versus intrinsic value. Reconcile valuation with risk, quality, macro drivers, sector (${sector}), and any company-specific catalysts.`,
    'Output format: return only valid JSON with keys sentiment, summary, pros (array), cons (array), recommendation, confidence (0-100).',
  ].join('\n');
}

function buildSectorInsightPrompt(sector: string, rows: WatchlistRow[]): string {
  const valid = rows.filter((r) => (r.sector || '').trim() === sector);
  const top = [...valid]
    .sort((a, b) => (b.torchlight_score ?? -1) - (a.torchlight_score ?? -1))
    .slice(0, 8);

  const avg = (getter: (r: WatchlistRow) => number | null | undefined, factor = 1) => {
    const vals = valid.map(getter).filter((v): v is number => v != null && Number.isFinite(v));
    if (!vals.length) return 'N/A';
    return `${((vals.reduce((a, b) => a + b, 0) / vals.length) * factor).toFixed(2)}`;
  };

  const topTickers = top.map((r) => `${r.ticker}${r.company ? `(${r.company})` : ''}`).join(', ') || 'N/A';
  return [
    `System: Generate a sector-level investment insight for ${sector}.`,
    `Sector quant summary from current watchlist rows (${valid.length} companies): avg IV Upside ${avg((r) => r.iv_upside_pct, 1)}%, avg Torchlight ${avg((r) => r.torchlight_score)}, avg Risk Summary ${avg((r) => r.risk_summary_score)}, avg Sharpe ${avg((r) => r.risk_sharpe)}, avg Beta ${avg((r) => r.risk_beta)}, avg CTR Annualized ${avg((r) => r.ctr_annualized, 100)}%.`,
    `Top representatives by Torchlight: ${topTickers}.`,
    `Task: Explain the sector outlook, key macro/news drivers, and valuation-versus-risk context. For sectors, do NOT provide buy/sell instructions.`,
    `Sector policy: sentiment must be one of Bullish, Neutral, or Bearish. Recommendation must describe a sector stance (e.g., "Bullish sector stance", "Neutral sector stance", "Bearish sector stance") and not "Buy", "Sell", or "Hold".`,
    `Output format: return only valid JSON with keys sentiment, summary, pros (array), cons (array), recommendation, confidence (0-100).`,
  ].join('\n');
}

function normalizeLookupValue(v: string): string {
  return v.trim().toLowerCase().replace(/[\s\-_]+/g, ' ');
}

const AIAnalysis: React.FC = () => {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [error, setError] = useState('');
  const [watchlists, setWatchlists] = useState<DailyWatchlist[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>('');
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);
  const [watchlistRowsLoading, setWatchlistRowsLoading] = useState(false);
  const [selectedRowTicker, setSelectedRowTicker] = useState<string>('');
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedCompanyTicker, setSelectedCompanyTicker] = useState<string>('all');
  const [minRiskSummary, setMinRiskSummary] = useState<string>('all');
  const [rankBy, setRankBy] = useState<'torchlight' | 'risk_summary'>('torchlight');
  const [reportMode, setReportMode] = useState<'single' | 'portfolio'>('single');
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [returnsByTicker, setReturnsByTicker] = useState<Record<string, ReturnPoint[]>>({});
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [insightScope, setInsightScope] = useState<'Ticker' | 'Sector'>('Ticker');
  const watchlistApiUrl = (import.meta.env.VITE_WATCHLIST_API_URL || 'http://localhost:8000').replace(/\/$/, '');

  useEffect(() => {
    const loadPortfolioItems = async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      try {
        const rows = await getPortfolio(uid);
        setPortfolioItems(rows);
      } catch {
        setPortfolioItems([]);
      }
    };
    loadPortfolioItems();
  }, []);

  useEffect(() => {
    getAllDailyWatchlists().then((list) => {
      setWatchlists(list);
      if (list.length > 0) {
        setSelectedWatchlistId(list[0].id);
      }
    }).catch(() => {
      setError('Could not load watchlists.');
    });
  }, []);

  useEffect(() => {
    setSelectedSector('all');
    setSelectedCompanyTicker('all');
    setMinRiskSummary('all');
    setSelectedRowTicker('');
    const selected = watchlists.find((w) => w.id === selectedWatchlistId);
    if (!selected) {
      setWatchlistRows([]);
      return;
    }

    const loadRows = async () => {
      const symbols = (selected.symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean);
      if (symbols.length === 0) {
        setWatchlistRows([]);
        return;
      }
      setWatchlistRowsLoading(true);
      try {
        const savedItems = await getDailyWatchlistItems(selected.id, selected.watchlist_date);
        if (savedItems.length > 0) {
          const rows: WatchlistRow[] = savedItems.map((r) => ({
            ticker: r.symbol,
            company: r.company || '',
            sector: r.sector || '',
            industry: r.industry || '',
            location: r.location || '',
            current_price: r.current_price ?? null,
            total_assets: r.total_assets ?? null,
            total_liabilities: r.total_liabilities ?? null,
            total_revenue: r.total_revenue ?? null,
            net_income: r.net_income ?? null,
            operating_cash_flow: r.operating_cash_flow ?? null,
            free_cash_flow: r.free_cash_flow ?? null,
            iv_dcf: r.iv_dcf ?? null,
            iv_ri: r.iv_ri ?? null,
            iv_multiples: r.iv_multiples ?? null,
            iv_quality_score: r.iv_quality_score ?? null,
            iv_ensemble: r.iv_ensemble ?? null,
            iv_upside_pct: r.iv_upside_pct ?? null,
            torchlight_score: r.torchlight_score ?? null,
            torchlight_rank_factors: r.torchlight_rank_factors ?? 'W1..W8 equal',
            torchlight_momentum: r.torchlight_momentum ?? null,
            torchlight_valuation_edge: r.torchlight_valuation_edge ?? null,
            torchlight_quality: r.torchlight_quality ?? null,
            torchlight_growth: r.torchlight_growth ?? null,
            torchlight_sentiment: r.torchlight_sentiment ?? null,
            torchlight_macro_fit: r.torchlight_macro_fit ?? null,
            torchlight_execution_feasibility: r.torchlight_execution_feasibility ?? null,
            torchlight_risk_adjusted_alpha: r.torchlight_risk_adjusted_alpha ?? null,
            ctr_total_return: r.ctr_total_return ?? null,
            ctr_annualized: r.ctr_annualized ?? null,
            torchlight_ctr_score: r.torchlight_ctr_score ?? null,
            risk_volatility_annual: r.risk_volatility_annual ?? null,
            risk_daily_return_mean: r.risk_daily_return_mean ?? null,
            risk_volatility_daily: r.risk_volatility_daily ?? null,
            risk_sharpe: r.risk_sharpe ?? null,
            risk_sortino: r.risk_sortino ?? null,
            risk_max_drawdown: r.risk_max_drawdown ?? null,
            risk_var_95_hist: r.risk_var_95_hist ?? null,
            risk_var_99_hist: r.risk_var_99_hist ?? null,
            risk_var_95_param: r.risk_var_95_param ?? null,
            risk_var_99_param: r.risk_var_99_param ?? null,
            risk_cvar_95: r.risk_cvar_95 ?? null,
            risk_beta: r.risk_beta ?? null,
            risk_summary_score: r.risk_summary_score ?? null,
          }));
          const hasTorchlightOrCtr = rows.some(
            (row) => row.torchlight_score != null || row.ctr_total_return != null || row.ctr_annualized != null
          );
          if (hasTorchlightOrCtr) {
            setWatchlistRows(rows);
            return;
          }
        }

        const basicsByTicker = await getCompanyFundamentalsByTickers(symbols);
        const res = await fetch(`${watchlistApiUrl}/api/financials/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: symbols }),
        });
        const yahooData: any[] = res.ok ? await res.json() : [];
        const byTicker: Record<string, any> = {};
        yahooData.forEach((r: any) => {
          const t = String(r?.ticker || '').toUpperCase();
          if (t) byTicker[t] = r;
        });

        const rows: WatchlistRow[] = symbols.map((t) => {
          const b = basicsByTicker[t];
          const y = byTicker[t] || {};
          return {
            ticker: t,
            company: b?.company || y.short_name || '',
            sector: y.sector || b?.sector || '',
            industry: b?.industry || y.industry || '',
            location: b?.location || '',
            current_price: typeof y.current_price === 'number' ? y.current_price : null,
            total_assets: y.total_assets != null ? Number(y.total_assets) : null,
            total_liabilities: y.total_liabilities != null ? Number(y.total_liabilities) : null,
            total_revenue: y.total_revenue != null ? Number(y.total_revenue) : null,
            net_income: y.net_income != null ? Number(y.net_income) : null,
            operating_cash_flow: y.operating_cash_flow != null ? Number(y.operating_cash_flow) : null,
            free_cash_flow: y.free_cash_flow != null ? Number(y.free_cash_flow) : null,
            iv_dcf: y.iv_dcf != null ? Number(y.iv_dcf) : null,
            iv_ri: y.iv_ri != null ? Number(y.iv_ri) : null,
            iv_multiples: y.iv_multiples != null ? Number(y.iv_multiples) : null,
            iv_quality_score: y.iv_quality_score != null ? Number(y.iv_quality_score) : null,
            iv_ensemble: y.iv_ensemble != null ? Number(y.iv_ensemble) : null,
            iv_upside_pct: y.iv_upside_pct != null ? Number(y.iv_upside_pct) : null,
            torchlight_score: y.torchlight_score != null ? Number(y.torchlight_score) : null,
            torchlight_rank_factors: typeof y.torchlight_rank_factors === 'string' ? y.torchlight_rank_factors : 'W1..W8 equal',
            torchlight_momentum: y.torchlight_momentum != null ? Number(y.torchlight_momentum) : null,
            torchlight_valuation_edge: y.torchlight_valuation_edge != null ? Number(y.torchlight_valuation_edge) : null,
            torchlight_quality: y.torchlight_quality != null ? Number(y.torchlight_quality) : null,
            torchlight_growth: y.torchlight_growth != null ? Number(y.torchlight_growth) : null,
            torchlight_sentiment: y.torchlight_sentiment != null ? Number(y.torchlight_sentiment) : null,
            torchlight_macro_fit: y.torchlight_macro_fit != null ? Number(y.torchlight_macro_fit) : null,
            torchlight_execution_feasibility: y.torchlight_execution_feasibility != null ? Number(y.torchlight_execution_feasibility) : null,
            torchlight_risk_adjusted_alpha: y.torchlight_risk_adjusted_alpha != null ? Number(y.torchlight_risk_adjusted_alpha) : null,
            ctr_total_return: y.ctr_total_return != null ? Number(y.ctr_total_return) : null,
            ctr_annualized: y.ctr_annualized != null ? Number(y.ctr_annualized) : null,
            torchlight_ctr_score: y.torchlight_ctr_score != null ? Number(y.torchlight_ctr_score) : null,
            risk_volatility_annual: y.risk_volatility_annual != null ? Number(y.risk_volatility_annual) : null,
            risk_daily_return_mean: y.risk_daily_return_mean != null ? Number(y.risk_daily_return_mean) : null,
            risk_volatility_daily: y.risk_volatility_daily != null ? Number(y.risk_volatility_daily) : null,
            risk_sharpe: y.risk_sharpe != null ? Number(y.risk_sharpe) : null,
            risk_sortino: y.risk_sortino != null ? Number(y.risk_sortino) : null,
            risk_max_drawdown: y.risk_max_drawdown != null ? Number(y.risk_max_drawdown) : null,
            risk_var_95_hist: y.risk_var_95_hist != null ? Number(y.risk_var_95_hist) : null,
            risk_var_99_hist: y.risk_var_99_hist != null ? Number(y.risk_var_99_hist) : null,
            risk_var_95_param: y.risk_var_95_param != null ? Number(y.risk_var_95_param) : null,
            risk_var_99_param: y.risk_var_99_param != null ? Number(y.risk_var_99_param) : null,
            risk_cvar_95: y.risk_cvar_95 != null ? Number(y.risk_cvar_95) : null,
            risk_beta: y.risk_beta != null ? Number(y.risk_beta) : null,
            risk_summary_score: y.risk_summary_score != null ? Number(y.risk_summary_score) : null,
          };
        });
        setWatchlistRows(rows);
      } catch {
        setWatchlistRows([]);
      } finally {
        setWatchlistRowsLoading(false);
      }
    };

    loadRows();
  }, [selectedWatchlistId, watchlists, watchlistApiUrl]);

  const sectorOptions = Array.from(
    new Set(watchlistRows.map((r) => (r.sector || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const companyOptions = watchlistRows
    .map((r) => ({ ticker: r.ticker, label: `${r.ticker} — ${r.company || 'Unknown'}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const filteredRows = watchlistRows.filter((r) => {
    const matchesSector = selectedSector === 'all' || (r.sector || '').trim() === selectedSector;
    const matchesCompany = selectedCompanyTicker === 'all' || r.ticker === selectedCompanyTicker;
    const minRisk = minRiskSummary === 'all' ? null : Number(minRiskSummary);
    const matchesRisk = minRisk == null || (r.risk_summary_score != null && r.risk_summary_score >= minRisk);
    return matchesSector && matchesCompany && matchesRisk;
  });
  const rankedRows = [...filteredRows].sort((a, b) => {
    const ak = rankBy === 'risk_summary' ? (a.risk_summary_score ?? -1) : (a.torchlight_score ?? -1);
    const bk = rankBy === 'risk_summary' ? (b.risk_summary_score ?? -1) : (b.torchlight_score ?? -1);
    return bk - ak;
  });
  const selectedRow = rankedRows.find((r) => r.ticker === selectedRowTicker) || rankedRows[0] || null;

  useEffect(() => {
    const loadReturns = async () => {
      if (reportMode !== 'portfolio' || rankedRows.length < 2) return;
      setReturnsLoading(true);
      try {
        const tickers = rankedRows.map((r) => r.ticker);
        const res = await fetch(`${watchlistApiUrl}/api/financials/returns-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers }),
        });
        const data: any[] = res.ok ? await res.json() : [];
        const mapped: Record<string, ReturnPoint[]> = {};
        (data || []).forEach((row: any) => {
          const t = String(row?.ticker || '').toUpperCase();
          if (!t) return;
          mapped[t] = Array.isArray(row?.series)
            ? row.series
              .map((p: any) => ({ date: String(p?.date || ''), ret: Number(p?.ret) }))
              .filter((p: ReturnPoint) => p.date && Number.isFinite(p.ret))
            : [];
        });
        setReturnsByTicker(mapped);
      } catch {
        setReturnsByTicker({});
      } finally {
        setReturnsLoading(false);
      }
    };
    loadReturns();
  }, [reportMode, rankedRows, watchlistApiUrl]);

  const singleTickerReport = useMemo(() => {
    if (!selectedRow) return null;
    const flags = tickerFlags(selectedRow);
    const score = tickerHealthScore(selectedRow);
    const verdict = score >= 70 && flags.length <= 1 ? 'Healthy' : score >= 50 ? 'Moderate Risk' : 'High Risk';
    const action = verdict === 'Healthy' ? 'Hold' : verdict === 'Moderate Risk' ? 'Watch' : 'Reduce';
    return { row: selectedRow, flags, score, verdict, action };
  }, [selectedRow]);

  const marketInsights = useMemo(() => {
    if (!rankedRows.length) return { buy: [] as Array<{ row: WatchlistRow; score: number }>, sell: [] as Array<{ row: WatchlistRow; score: number }> };
    const scored = rankedRows.map((row) => {
      const s = buySellScore(row);
      return { row, buyScore: s.buy, sellScore: s.sell };
    });
    const buy = [...scored]
      .sort((a, b) => b.buyScore - a.buyScore)
      .slice(0, 10)
      .map((x) => ({ row: x.row, score: x.buyScore }));
    const sell = [...scored]
      .sort((a, b) => b.sellScore - a.sellScore)
      .slice(0, 10)
      .map((x) => ({ row: x.row, score: x.sellScore }));
    return { buy, sell };
  }, [rankedRows]);

  const portfolioReport = useMemo(() => {
    if (rankedRows.length === 0) return null;
    const rowByTicker: Record<string, WatchlistRow> = {};
    rankedRows.forEach((r) => { rowByTicker[r.ticker] = r; });

    const holdingValues: Record<string, number> = {};
    portfolioItems.forEach((p) => {
      const t = String(p.symbol || '').toUpperCase();
      if (!rowByTicker[t]) return;
      const px = rowByTicker[t].current_price ?? p.avgCost ?? 0;
      const v = (p.shares ?? 0) * (px ?? 0);
      if (v > 0) holdingValues[t] = (holdingValues[t] || 0) + v;
    });
    const hasPortfolioWeights = Object.keys(holdingValues).length > 0;
    const baseWeight = 1 / Math.max(1, rankedRows.length);
    const totalValue = Object.values(holdingValues).reduce((a, b) => a + b, 0);
    const weights: Record<string, number> = {};
    rankedRows.forEach((r) => {
      weights[r.ticker] = hasPortfolioWeights && totalValue > 0 ? (holdingValues[r.ticker] || 0) / totalValue : baseWeight;
    });

    const weighted = (getter: (r: WatchlistRow) => number | null | undefined) =>
      rankedRows.reduce((acc, r) => acc + (weights[r.ticker] || 0) * (getter(r) ?? 0), 0);

    const top3 = [...rankedRows]
      .map((r) => ({ ticker: r.ticker, w: weights[r.ticker] || 0 }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 3);
    const top3Weight = top3.reduce((a, b) => a + b.w, 0);

    const sectorWeights: Record<string, number> = {};
    const geoWeights: Record<string, number> = {};
    rankedRows.forEach((r) => {
      const s = (r.sector || 'Unknown').trim() || 'Unknown';
      const g = (r.location || 'Unknown').trim() || 'Unknown';
      sectorWeights[s] = (sectorWeights[s] || 0) + (weights[r.ticker] || 0);
      geoWeights[g] = (geoWeights[g] || 0) + (weights[r.ticker] || 0);
    });
    const topSector = Object.entries(sectorWeights).sort((a, b) => b[1] - a[1])[0];
    const topGeo = Object.entries(geoWeights).sort((a, b) => b[1] - a[1])[0];

    // Correlation/covariance + true portfolio risk on common return dates.
    const tickers = rankedRows.map((r) => r.ticker).filter((t) => (returnsByTicker[t] || []).length > 30);
    const dateSets = tickers.map((t) => new Set((returnsByTicker[t] || []).map((p) => p.date)));
    let commonDates: string[] = [];
    if (dateSets.length >= 2) {
      commonDates = [...dateSets[0]].filter((d) => dateSets.every((s) => s.has(d))).sort();
    }
    const retByTickerDate: Record<string, Record<string, number>> = {};
    tickers.forEach((t) => {
      retByTickerDate[t] = {};
      (returnsByTicker[t] || []).forEach((p) => { retByTickerDate[t][p.date] = p.ret; });
    });

    const vectors: Record<string, number[]> = {};
    tickers.forEach((t) => {
      vectors[t] = commonDates.map((d) => retByTickerDate[t][d]).filter((v) => Number.isFinite(v));
    });

    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const cov = (a: number[], b: number[]) => {
      const n = Math.min(a.length, b.length);
      if (n < 2) return 0;
      const ma = mean(a.slice(0, n));
      const mb = mean(b.slice(0, n));
      let s = 0;
      for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
      return s / (n - 1);
    };
    const std = (a: number[]) => Math.sqrt(Math.max(0, cov(a, a)));

    const covMatrix: number[][] = tickers.map((ti) => tickers.map((tj) => cov(vectors[ti] || [], vectors[tj] || [])));
    const corrMatrix: number[][] = tickers.map((ti, i) => tickers.map((tj, j) => {
      const s1 = Math.sqrt(Math.max(0, covMatrix[i][i]));
      const s2 = Math.sqrt(Math.max(0, covMatrix[j][j]));
      return s1 > 0 && s2 > 0 ? covMatrix[i][j] / (s1 * s2) : 0;
    }));

    const wVec = tickers.map((t) => weights[t] || 0);
    const sigmaW = tickers.map((_, i) => covMatrix[i].reduce((acc, cij, j) => acc + cij * wVec[j], 0));
    const varP = wVec.reduce((acc, wi, i) => acc + wi * sigmaW[i], 0);
    const sigmaP = Math.sqrt(Math.max(0, varP));
    const sigmaPAnn = sigmaP * Math.sqrt(252);
    const avgWeightedSigma = tickers.reduce((acc, t) => acc + (weights[t] || 0) * std(vectors[t] || []), 0);
    const diversificationRatio = sigmaP > 0 ? avgWeightedSigma / sigmaP : null;
    const mrc = tickers.map((t, i) => ({
      ticker: t,
      contribution: sigmaP > 0 ? (wVec[i] * sigmaW[i]) / sigmaP : 0,
    })).sort((a, b) => b.contribution - a.contribution);

    const portfolioDaily = commonDates.map((d) => tickers.reduce((acc, t) => acc + (weights[t] || 0) * (retByTickerDate[t][d] ?? 0), 0));
    const pVar95 = quantile(portfolioDaily, 0.05);
    const pVar99 = quantile(portfolioDaily, 0.01);
    const pCvar95 = pVar95 == null ? null : (() => {
      const tail = portfolioDaily.filter((x) => x <= pVar95);
      return tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : null;
    })();
    let pMaxDD: number | null = null;
    if (portfolioDaily.length) {
      let eq = 1;
      let peak = 1;
      pMaxDD = 0;
      portfolioDaily.forEach((r) => {
        eq *= 1 + r;
        peak = Math.max(peak, eq);
        pMaxDD = Math.min(pMaxDD as number, (eq - peak) / peak);
      });
    }

    const perStock = rankedRows.map((r) => {
      const flags = tickerFlags(r);
      const score = tickerHealthScore(r);
      return { ticker: r.ticker, company: r.company || '', weight: weights[r.ticker] || 0, score, flags, riskSummary: r.risk_summary_score ?? null };
    }).sort((a, b) => b.weight - a.weight);

    return {
      hasPortfolioWeights,
      weightedSharpe: weighted((r) => r.risk_sharpe ?? null),
      weightedSortino: weighted((r) => r.risk_sortino ?? null),
      weightedBeta: weighted((r) => r.risk_beta ?? null),
      weightedVolAnn: weighted((r) => r.risk_volatility_annual ?? null),
      weightedIvUpside: weighted((r) => r.iv_upside_pct ?? null),
      top3Weight,
      topSector,
      topGeo,
      correlationTickers: tickers.slice(0, 8),
      correlationMatrix: corrMatrix.slice(0, 8).map((row) => row.slice(0, 8)),
      covarianceMatrix: covMatrix.slice(0, 8).map((row) => row.slice(0, 8)),
      sigmaPortfolioAnnual: sigmaPAnn,
      diversificationRatio,
      portfolioVaR95: pVar95,
      portfolioVaR99: pVar99,
      portfolioCVaR95: pCvar95,
      portfolioMaxDD: pMaxDD,
      marginalRiskTop: mrc.slice(0, 5),
      perStock,
    };
  }, [rankedRows, portfolioItems, returnsByTicker]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = symbol.trim();
    const selectedByClick = selectedRowTicker
      ? rankedRows.find((r) => r.ticker === selectedRowTicker) || null
      : null;
    const singleFilteredRow = rankedRows.length === 1 ? rankedRows[0] : null;
    const rowFromInput = rawInput
      ? rankedRows.find((r) => r.ticker === rawInput.toUpperCase()) || null
      : null;
    const preferredTickerRow = selectedByClick || singleFilteredRow || rowFromInput;

    if (!rawInput && !preferredTickerRow) return;

    setLoading(true);
    setError('');
    try {
      if (preferredTickerRow) {
        const ticker = preferredTickerRow.ticker.toUpperCase();
        const contextualPrompt = buildContextualInsightPrompt(ticker, preferredTickerRow);
        const data = await getStockInsight(ticker, contextualPrompt);
        setInsight(data);
        setInsightScope('Ticker');
        setSymbol(ticker);
      } else {
        const symbolUpper = rawInput.toUpperCase();
        const inputNorm = normalizeLookupValue(rawInput);
        const sectorMatch = sectorOptions.find((s) => normalizeLookupValue(s) === inputNorm);
        if (sectorMatch) {
          const sectorRows = watchlistRows.filter((r) => (r.sector || '').trim() === sectorMatch);
          if (sectorRows.length === 0) {
            throw new Error(`No rows found for sector "${sectorMatch}" in the selected watchlist.`);
          }
          const prompt = buildSectorInsightPrompt(sectorMatch, watchlistRows);
          const data = await getStockInsight(sectorMatch.toUpperCase(), prompt);
          setInsight(data);
          setInsightScope('Sector');
        } else {
          // Fallback: allow ad-hoc ticker analysis even if not in selected watchlist.
          const contextualPrompt = buildContextualInsightPrompt(symbolUpper, null);
          const data = await getStockInsight(symbolUpper, contextualPrompt);
          setInsight(data);
          setInsightScope('Ticker');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not fetch analysis. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSectorAnalyze = async () => {
    if (selectedSector === 'all') {
      setError('Select a specific sector first, then click Generate Sector Insight.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const prompt = buildSectorInsightPrompt(selectedSector, filteredRows);
      const data = await getStockInsight(selectedSector.toUpperCase(), prompt);
      setInsight(data);
      setInsightScope('Sector');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not fetch sector analysis. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-gradient-to-br from-indigo-900 to-indigo-700 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
        {/* Abstract background blobs */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full blur-3xl opacity-20 -mr-32 -mt-32"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500 rounded-full blur-3xl opacity-10 -ml-24 -mb-24"></div>
        
        <div className="relative z-10 text-center space-y-4">
          <h2 className="text-3xl font-bold">Smart AI Market Intelligence</h2>
          <p className="text-indigo-100 max-w-lg mx-auto">
            Enter a ticker symbol and let our AI analyze fundamentals, sentiment, and recent news to give you a smart recommendation.
          </p>
          <form onSubmit={handleAnalyze} className="max-w-md mx-auto flex items-center bg-white/10 backdrop-blur-md p-2 rounded-2xl border border-white/20">
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. MSFT or Healthcare"
              className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-indigo-200 px-4 py-3 font-medium uppercase"
            />
            <button
              disabled={loading}
              className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-xl font-bold transition-all disabled:opacity-50"
            >
              {loading ? 'Analyzing...' : 'Generate Insight'}
            </button>
          </form>
        </div>
      </div>

      {/* All watchlists — users can select any list and browse rows */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <h3 className="text-slate-900 font-bold uppercase tracking-widest text-sm mb-2">All watchlists</h3>
        <p className="text-slate-500 text-xs font-medium mb-4">Select a watchlist, then scroll rows and pick the company you want to analyze.</p>

        {watchlists.length > 0 ? (
          <div className="space-y-4">
            <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Label</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Date</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlists.map((w) => (
                    <tr
                      key={w.id}
                      className={`border-t border-slate-100 cursor-pointer ${selectedWatchlistId === w.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                      onClick={() => setSelectedWatchlistId(w.id)}
                    >
                      <td className="px-3 py-2 font-bold text-indigo-700">{w.label || `WatchList-of-${w.watchlist_date}`}</td>
                      <td className="px-3 py-2 text-slate-600">{w.watchlist_date}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{(w.symbols || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="max-h-80 overflow-auto border border-slate-100 rounded-xl">
              <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row gap-3 md:items-end">
                <div className="min-w-[220px]">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Filter by sector</label>
                  <select
                    value={selectedSector}
                    onChange={(e) => setSelectedSector(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white"
                  >
                    <option value="all">All sectors</option>
                    {sectorOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[260px]">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Filter by company</label>
                  <select
                    value={selectedCompanyTicker}
                    onChange={(e) => setSelectedCompanyTicker(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white"
                  >
                    <option value="all">All companies</option>
                    {companyOptions.map((c) => (
                      <option key={c.ticker} value={c.ticker}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[180px]">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Min risk summary</label>
                  <select
                    value={minRiskSummary}
                    onChange={(e) => setMinRiskSummary(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white"
                  >
                    <option value="all">All scores</option>
                    <option value="40">{'>= 40'}</option>
                    <option value="50">{'>= 50'}</option>
                    <option value="60">{'>= 60'}</option>
                    <option value="70">{'>= 70'}</option>
                    <option value="80">{'>= 80'}</option>
                  </select>
                </div>
                <div className="min-w-[180px]">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Rank by</label>
                  <select
                    value={rankBy}
                    onChange={(e) => setRankBy(e.target.value as 'torchlight' | 'risk_summary')}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white"
                  >
                    <option value="torchlight">Torchlight</option>
                    <option value="risk_summary">Risk Summary</option>
                  </select>
                </div>
                <p className="text-[11px] text-slate-500 font-medium md:ml-auto">
                  Showing {filteredRows.length} of {watchlistRows.length} rows (ranked by {rankBy === 'risk_summary' ? 'Risk Summary' : 'Torchlight'})
                </p>
                <button
                  type="button"
                  onClick={handleSectorAnalyze}
                  disabled={loading || selectedSector === 'all'}
                  className="px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Analyzing...' : 'Generate Sector Insight'}
                </button>
              </div>
              <table className="w-full text-xs min-w-[1320px]">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Rank</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Ticker</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Company</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Sector</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Industry</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Location</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Price</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Assets</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Liabilities</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Revenue</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Net Income</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Op. Cash Flow</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Free Cash Flow</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">IV (DCF)</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">IV (RI)</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">IV (Mult.)</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">IV Ensemble</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">IV Upside %</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">CTR Total %</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">CTR Ann. %</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Mean Daily %</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Vol Daily %</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Vol Ann. %</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Sharpe</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Sortino</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Max DD %</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">VaR 95% (Hist)</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">VaR 99% (Hist)</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">VaR 95% (Param)</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">VaR 99% (Param)</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">CVaR 95%</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Beta</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Risk Summary</th>
                    <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Torchlight</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.map((r, idx) => (
                    <tr
                      key={r.ticker}
                      className={`border-t border-slate-100 cursor-pointer ${selectedRowTicker === r.ticker ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                      onClick={() => {
                        setSelectedRowTicker(r.ticker);
                        setSymbol(r.ticker);
                      }}
                    >
                      <td className="px-3 py-2 text-right font-black text-indigo-700">{idx + 1}</td>
                      <td className="px-3 py-2 font-black text-slate-800">{r.ticker}</td>
                      <td className="px-3 py-2 text-slate-700">{r.company || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{r.sector || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{r.industry || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{r.location || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.current_price != null ? `$${r.current_price.toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.total_assets)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.total_liabilities)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.total_revenue)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.net_income)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.operating_cash_flow)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.free_cash_flow)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.iv_dcf)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.iv_ri)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatStatementNum(r.iv_multiples)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{formatStatementNum(r.iv_ensemble)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${r.iv_upside_pct != null && r.iv_upside_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {r.iv_upside_pct != null ? `${r.iv_upside_pct.toFixed(2)}%` : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${(r.ctr_total_return ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {r.ctr_total_return != null ? `${(r.ctr_total_return * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${(r.ctr_annualized ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {r.ctr_annualized != null ? `${(r.ctr_annualized * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_daily_return_mean != null ? `${(r.risk_daily_return_mean * 100).toFixed(3)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_volatility_daily != null ? `${(r.risk_volatility_daily * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_volatility_annual != null ? `${(r.risk_volatility_annual * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_sharpe != null ? r.risk_sharpe.toFixed(2) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_sortino != null ? r.risk_sortino.toFixed(2) : '—'}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${(r.risk_max_drawdown ?? 0) <= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {r.risk_max_drawdown != null ? `${(r.risk_max_drawdown * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_var_95_hist != null ? `${(r.risk_var_95_hist * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_var_99_hist != null ? `${(r.risk_var_99_hist * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_var_95_param != null ? `${(r.risk_var_95_param * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_var_99_param != null ? `${(r.risk_var_99_param * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_cvar_95 != null ? `${(r.risk_cvar_95 * 100).toFixed(2)}%` : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.risk_beta != null ? r.risk_beta.toFixed(2) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-slate-700">{r.risk_summary_score != null ? r.risk_summary_score.toFixed(1) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono font-black text-indigo-700">
                        {r.torchlight_score != null ? r.torchlight_score.toFixed(1) : '—'}
                      </td>
                    </tr>
                  ))}
                  {!watchlistRowsLoading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={33} className="px-3 py-6 text-center text-slate-400 font-medium">No rows match the selected filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {watchlistRowsLoading && (
              <p className="text-xs text-slate-500 font-medium">Loading selected watchlist data...</p>
            )}
          </div>
        ) : (
          <p className="text-slate-400 text-sm font-medium">No watchlists available.</p>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <h3 className="text-slate-900 font-bold uppercase tracking-widest text-sm">Portfolio Health Report</h3>
          <div className="md:ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReportMode('single')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${reportMode === 'single' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Single Ticker
            </button>
            <button
              type="button"
              onClick={() => setReportMode('portfolio')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${reportMode === 'portfolio' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Full Portfolio
            </button>
          </div>
        </div>

        {reportMode === 'single' && singleTickerReport && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Selected: <span className="font-bold text-slate-800">{singleTickerReport.row.ticker}</span> — {singleTickerReport.row.company || 'Unknown'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black">Ticker Health Score</p>
                <p className="text-2xl font-black text-indigo-700">{singleTickerReport.score.toFixed(1)}</p>
              </div>
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black">Verdict</p>
                <p className="text-xl font-black text-slate-800">{singleTickerReport.verdict}</p>
              </div>
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black">Suggested Action</p>
                <p className="text-xl font-black text-slate-800">{singleTickerReport.action}</p>
              </div>
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black">Flags</p>
                <p className="text-xl font-black text-rose-600">{singleTickerReport.flags.length}</p>
              </div>
            </div>
            <div className="border border-slate-100 rounded-xl p-3">
              <p className="text-[10px] uppercase text-slate-400 font-black mb-2">Auto Diagnostics</p>
              {singleTickerReport.flags.length ? (
                <div className="flex flex-wrap gap-2">
                  {singleTickerReport.flags.map((f) => (
                    <span key={f} className="px-2 py-1 rounded-md bg-rose-50 border border-rose-100 text-rose-700 text-[11px] font-bold">{f}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-emerald-600 font-bold">No critical red flags detected.</p>
              )}
            </div>
          </div>
        )}

        {reportMode === 'portfolio' && portfolioReport && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              {portfolioReport.hasPortfolioWeights ? 'Using your portfolio holdings weights.' : 'No holdings overlap found; using equal weights across selected rows.'}
              {returnsLoading ? ' Computing correlation/covariance...' : ''}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black">Top 3 Concentration</p>
                <p className="text-xl font-black text-slate-800">{(portfolioReport.top3Weight * 100).toFixed(1)}%</p>
              </div>
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black">Weighted Sharpe / Beta</p>
                <p className="text-xl font-black text-slate-800">{portfolioReport.weightedSharpe.toFixed(2)} / {portfolioReport.weightedBeta.toFixed(2)}</p>
              </div>
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black">True Port. Vol Ann.</p>
                <p className="text-xl font-black text-slate-800">{(portfolioReport.sigmaPortfolioAnnual * 100).toFixed(2)}%</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black mb-2">Portfolio Risk Dashboard</p>
                <p className="text-xs text-slate-600">Diversification Ratio: <span className="font-bold">{portfolioReport.diversificationRatio != null ? portfolioReport.diversificationRatio.toFixed(2) : '—'}</span></p>
                <p className="text-xs text-slate-600">Portfolio VaR 95/99: <span className="font-bold">{portfolioReport.portfolioVaR95 != null ? `${(portfolioReport.portfolioVaR95 * 100).toFixed(2)}%` : '—'} / {portfolioReport.portfolioVaR99 != null ? `${(portfolioReport.portfolioVaR99 * 100).toFixed(2)}%` : '—'}</span></p>
                <p className="text-xs text-slate-600">Portfolio CVaR 95: <span className="font-bold">{portfolioReport.portfolioCVaR95 != null ? `${(portfolioReport.portfolioCVaR95 * 100).toFixed(2)}%` : '—'}</span></p>
                <p className="text-xs text-slate-600">Portfolio Max Drawdown: <span className="font-bold">{portfolioReport.portfolioMaxDD != null ? `${(portfolioReport.portfolioMaxDD * 100).toFixed(2)}%` : '—'}</span></p>
                <p className="text-xs text-slate-600">Top Sector: <span className="font-bold">{portfolioReport.topSector ? `${portfolioReport.topSector[0]} (${(portfolioReport.topSector[1] * 100).toFixed(1)}%)` : '—'}</span></p>
                <p className="text-xs text-slate-600">Top Geography: <span className="font-bold">{portfolioReport.topGeo ? `${portfolioReport.topGeo[0]} (${(portfolioReport.topGeo[1] * 100).toFixed(1)}%)` : '—'}</span></p>
              </div>
              <div className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] uppercase text-slate-400 font-black mb-2">Top Marginal Risk Contributors</p>
                <div className="space-y-1">
                  {portfolioReport.marginalRiskTop.map((m) => (
                    <p key={m.ticker} className="text-xs text-slate-600">{m.ticker}: <span className="font-bold">{m.contribution.toFixed(4)}</span></p>
                  ))}
                  {portfolioReport.marginalRiskTop.length === 0 && <p className="text-xs text-slate-400">Need return series for 2+ tickers.</p>}
                </div>
              </div>
            </div>

            <div className="border border-slate-100 rounded-xl p-3 overflow-auto">
              <p className="text-[10px] uppercase text-slate-400 font-black mb-2">Correlation Matrix (Portfolio Mode Only)</p>
              {portfolioReport.correlationTickers.length >= 2 ? (
                <div className="space-y-3">
                  <table className="text-xs min-w-[520px] w-full">
                    <thead>
                      <tr>
                        <th className="p-1 text-left">Ticker</th>
                        {portfolioReport.correlationTickers.map((t) => <th key={t} className="p-1 text-right">{t}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioReport.correlationTickers.map((ti, i) => (
                        <tr key={ti} className="border-t border-slate-100">
                          <td className="p-1 font-bold">{ti}</td>
                          {portfolioReport.correlationTickers.map((_, j) => (
                            <td key={`${ti}-${j}`} className="p-1 text-right">{portfolioReport.correlationMatrix[i]?.[j]?.toFixed(2) ?? '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] uppercase text-slate-400 font-black">Covariance Matrix</p>
                  <table className="text-xs min-w-[520px] w-full">
                    <thead>
                      <tr>
                        <th className="p-1 text-left">Ticker</th>
                        {portfolioReport.correlationTickers.map((t) => <th key={t} className="p-1 text-right">{t}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioReport.correlationTickers.map((ti, i) => (
                        <tr key={`${ti}-cov`} className="border-t border-slate-100">
                          <td className="p-1 font-bold">{ti}</td>
                          {portfolioReport.correlationTickers.map((_, j) => (
                            <td key={`${ti}-cov-${j}`} className="p-1 text-right">{portfolioReport.covarianceMatrix[i]?.[j]?.toFixed(5) ?? '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Not enough overlapping return history to compute correlation.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 space-y-4">
        <h3 className="text-slate-900 font-bold uppercase tracking-widest text-sm">Market Insights</h3>
        <p className="text-xs text-slate-500">Top 10 best buy and top 10 best sell candidates based on calculated valuation, risk, quality, and performance variables.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-emerald-100 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100 text-emerald-800 text-xs font-black uppercase tracking-widest">Top 10 Best Buy</div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">Ticker</th>
                  <th className="px-2 py-1 text-left">Company</th>
                  <th className="px-2 py-1 text-right">Score</th>
                  <th className="px-2 py-1 text-right">IV Upside</th>
                </tr>
              </thead>
              <tbody>
                {marketInsights.buy.map((x) => (
                  <tr key={`buy-${x.row.ticker}`} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-bold">{x.row.ticker}</td>
                    <td className="px-2 py-1 text-slate-600">{x.row.company || '—'}</td>
                    <td className="px-2 py-1 text-right font-black text-emerald-700">{x.score.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{x.row.iv_upside_pct != null ? `${x.row.iv_upside_pct.toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border border-rose-100 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-rose-50 border-b border-rose-100 text-rose-800 text-xs font-black uppercase tracking-widest">Top 10 Best Sell</div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">Ticker</th>
                  <th className="px-2 py-1 text-left">Company</th>
                  <th className="px-2 py-1 text-right">Score</th>
                  <th className="px-2 py-1 text-right">IV Upside</th>
                </tr>
              </thead>
              <tbody>
                {marketInsights.sell.map((x) => (
                  <tr key={`sell-${x.row.ticker}`} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-bold">{x.row.ticker}</td>
                    <td className="px-2 py-1 text-slate-600">{x.row.company || '—'}</td>
                    <td className="px-2 py-1 text-right font-black text-rose-700">{x.score.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{x.row.iv_upside_pct != null ? `${x.row.iv_upside_pct.toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-xl text-center font-medium">
          ⚠️ {error}
        </div>
      )}

      {insight && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {/* Main Recommendation */}
          <div className="md:col-span-2 space-y-6">
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-bold uppercase tracking-widest text-slate-600">
              Insight scope: {insightScope}
            </div>
            {insightScope === 'Ticker' && symbol.trim() && (
              <p className="text-lg font-black text-blue-700">
                {symbol.trim().toUpperCase()}
              </p>
            )}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wider">AI RECOMMENDATION</h3>
                  <p className="text-3xl font-bold mt-1">{insight.sentiment}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-sm font-semibold">CONFIDENCE</p>
                  <div className="flex items-center mt-1 space-x-2">
                    <div className="w-32 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          insight.sentiment === 'Bearish'
                            ? 'bg-rose-500'
                            : insight.sentiment === 'Neutral'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        }`}
                        style={{ width: `${insight.confidence}%` }}
                      ></div>
                    </div>
                    <span className={`text-lg font-bold ${
                      insight.sentiment === 'Bearish'
                        ? 'text-rose-600'
                        : insight.sentiment === 'Neutral'
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                    }`}>{insight.confidence}%</span>
                  </div>
                </div>
              </div>
              <p className="text-slate-700 leading-relaxed text-lg">
                {insight.recommendation}
              </p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold mb-4">Market Summary</h3>
              <p className="text-slate-600 leading-relaxed">
                {insight.summary}
              </p>
            </div>
          </div>

          {/* Pros and Cons */}
          <div className="space-y-6">
            <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
              <h4 className="text-emerald-700 font-bold mb-4 flex items-center">
                <span className="mr-2">🚀</span> Growth Drivers
              </h4>
              <ul className="space-y-3">
                {insight.pros.map((pro, i) => (
                  <li key={i} className="flex items-start text-sm text-emerald-800">
                    <span className="text-emerald-500 mr-2 mt-0.5">✓</span>
                    {pro}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-rose-50 p-6 rounded-2xl border border-rose-100">
              <h4 className="text-rose-700 font-bold mb-4 flex items-center">
                <span className="mr-2">⚠️</span> Risk Factors
              </h4>
              <ul className="space-y-3">
                {insight.cons.map((con, i) => (
                  <li key={i} className="flex items-start text-sm text-rose-800">
                    <span className="text-rose-400 mr-2 mt-0.5">✕</span>
                    {con}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {!insight && !loading && (
        <div className="text-center py-20 bg-slate-100/50 rounded-3xl border border-dashed border-slate-300">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-slate-500 font-medium">Analysis will appear here</h3>
        </div>
      )}
    </div>
  );
};

export default AIAnalysis;
