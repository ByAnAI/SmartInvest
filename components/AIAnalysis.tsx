import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { SP500_TICKERS } from './SP500Data';
import { NASDAQ_TICKERS } from './NasdaqData';
import { isSp500OnlyMode } from '../utils/sp500OnlyMode';
import { FOREX_TICKERS } from './ForexData';
import {
  getForexSentinelInsight,
  getGrowthRiskDashboard,
  getIndustryLifecycleAnalysis,
  getLeadershipLifecycleAnalysis,
  getStockInsight,
  getTickerWatchlistConditionBrief,
} from '../services/geminiService';
import { fetchForexSentinelContext } from '../services/forexSentinel';
import { fetchFinnhubCompanyNewsBundle, promptBlockFromBundle } from '../services/finnhubCompanyNews';
import { fetchMacroReportForDate, localReportDateKey, stripMacroReportFileHeader } from '../services/macroReportCache';
import { fetchPortfolioNewsSentiment, formatAvSentiment } from '../services/portfolioNewsSentiment';
import { buildWatchlistLabel, getAllDailyWatchlists, getCompanyFundamentalsByTickers, getDailyWatchlistItems, getPortfolio } from '../services/supabaseService';
import { formatWatchlistCreatedAt, watchlistSelectOptionText } from '../utils/watchlistDisplay';
import { snapshotToDailyWatchlistItems } from '../utils/personalWatchlistStorage';
import { parsePersonalWatchlistFile } from '../utils/parsePersonalWatchlistFile';
import {
  addWatchlistToLibrary,
  getWatchlistFileLibrary,
  getWatchlistLibraryEntry,
  LOCAL_LIB_PREFIX,
  removeWatchlistFromLibrary,
} from '../utils/watchlistFileLibrary';
import { supabase } from '../services/supabase';
import { fetchFinancialsBatchChunked, fetchWatchlistApi, getDefaultWatchlistApiBase, readWatchlistJson } from '../utils/watchlistApiFetch';
import {
  DailyWatchlist,
  DailyWatchlistItem,
  InsightResponse,
  PortfolioItem,
  type GrowthRiskDashboardItem,
  type GrowthRiskDashboardReport,
  type GrowthRiskImpactLevel,
  type IndustryLifecycleReport,
  type TickerWatchlistConditionBrief,
} from '../types';
import { deriveWatchlistSignalAnalysis, type WatchlistSignalBundle } from '../utils/watchlistSignalAnalysis';

type WatchlistRow = {
  ticker: string;
  company?: string;
  sector?: string;
  industry?: string;
  location?: string;
  current_price?: number | null;
  revenue_growth?: number | null;
  earnings_growth?: number | null;
  gross_margins?: number | null;
  profit_margins?: number | null;
  operating_margins?: number | null;
  ebitda_margins?: number | null;
  market_cap?: number | null;
  enterprise_value?: number | null;
  shares_outstanding?: number | null;
  average_volume?: number | null;
  recommendation_mean?: number | null;
  target_mean_price?: number | null;
  leader_name?: string | null;
  leader_title?: string | null;
  leader_total_pay?: number | null;
  leader_year_born?: number | null;
  officer_count?: number | null;
  held_percent_insiders?: number | null;
  held_percent_institutions?: number | null;
  audit_risk?: number | null;
  board_risk?: number | null;
  compensation_risk?: number | null;
  shareholder_rights_risk?: number | null;
  overall_risk?: number | null;
  yahoo_recent_news?: Array<{ title?: string; publisher?: string; published?: unknown; link?: string }> | null;
  yahoo_management_news?: Array<{ title?: string; publisher?: string; published?: unknown; link?: string }> | null;
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
  ctr_price_return?: number | null;
  ctr_cash_return?: number | null;
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

type GrowthRiskReportJob = {
  status: 'pending' | 'done' | 'error';
  promise: Promise<GrowthRiskDashboardReport>;
  report?: GrowthRiskDashboardReport;
  error?: string;
  startedAt: number;
};

const growthRiskReportJobs = new Map<string, GrowthRiskReportJob>();
const growthRiskReportListeners = new Set<() => void>();

const aiAnalysisUiMemory: {
  symbol?: string;
  selectedWatchlistId?: string;
  watchlistSnapshotSource?: 'team' | 'library';
  marketUniverse?: AiMarketUniverse;
  insightTarget?: InsightTarget;
  selectedRowTicker?: string;
  selectedSector?: string;
  selectedSubsector?: string;
  selectedCompanyTicker?: string;
  minRiskSummary?: string;
  rankBy?: 'torchlight' | 'risk_summary';
  insight?: InsightResponse | null;
  insightReportMeta?: MarketInsightReportMeta | null;
  insightScope?: 'Ticker' | 'Sector';
  growthRiskDashboard?: GrowthRiskDashboardReport | null;
  growthRiskDashboardError?: string;
  businessLifecycleReport?: IndustryLifecycleReport | null;
  industryLifecycleReport?: IndustryLifecycleReport | null;
  industryLifecycleReportKind?: 'industry' | 'business' | 'leadership';
  industryLifecycleError?: string;
} = {};

function notifyGrowthRiskReportListeners(): void {
  growthRiskReportListeners.forEach((listener) => listener());
}

function subscribeGrowthRiskReportJobs(listener: () => void): () => void {
  growthRiskReportListeners.add(listener);
  return () => {
    growthRiskReportListeners.delete(listener);
  };
}

function startGrowthRiskReportJob(
  key: string,
  run: () => Promise<GrowthRiskDashboardReport>
): GrowthRiskReportJob {
  const existing = growthRiskReportJobs.get(key);
  if (existing) return existing;

  const job: GrowthRiskReportJob = {
    status: 'pending',
    promise: run(),
    startedAt: Date.now(),
  };
  growthRiskReportJobs.set(key, job);
  job.promise
    .then((report) => {
      job.status = 'done';
      job.report = report;
      notifyGrowthRiskReportListeners();
    })
    .catch((err: unknown) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : 'Could not generate growth & risk report.';
      notifyGrowthRiskReportListeners();
    });
  notifyGrowthRiskReportListeners();
  return job;
}

function insightConditionDisplayLabel(sentiment: InsightResponse['sentiment']): string {
  return sentiment === 'Neutral' ? 'Hold' : sentiment;
}

function insightConditionTextClass(sentiment: InsightResponse['sentiment']): string {
  if (sentiment === 'Bullish') return 'text-emerald-600';
  if (sentiment === 'Bearish') return 'text-rose-600';
  return 'text-amber-600';
}

/** True when the model JSON was parsed poorly and geminiService filled generic one-line pros/cons. */
function insightProsConsAreLlmPlaceholder(insight: InsightResponse): boolean {
  const badFragments = [
    'not clearly structured',
    'details were incomplete',
    'Model response format was incomplete',
    'Potential upside exists, but details',
    'risk assessment may be limited',
  ];
  const looksBad = (items: string[]) =>
    items.length > 0 &&
    items.length <= 3 &&
    items.every(
      (s) =>
        s.length < 160 && badFragments.some((f) => s.includes(f)),
    );
  return looksBad(insight.pros) && looksBad(insight.cons);
}

/** Risk heatmap cell background by impact. */
function growthRiskHeatmapCellClass(level: GrowthRiskImpactLevel): string {
  if (level === 'High') return 'bg-rose-600 text-white border-rose-700';
  if (level === 'Medium') return 'bg-amber-400 text-amber-950 border-amber-500';
  return 'bg-slate-200 text-slate-800 border-slate-300';
}

const LIFECYCLE_STAGES: Array<IndustryLifecycleReport['stage']> = ['Introduction', 'Growth', 'Maturity', 'Decline'];

function lifecycleStageClass(stage: IndustryLifecycleReport['stage']): string {
  if (stage === 'Growth') return 'bg-emerald-600 text-white border-emerald-700';
  if (stage === 'Maturity') return 'bg-blue-600 text-white border-blue-700';
  if (stage === 'Decline') return 'bg-rose-600 text-white border-rose-700';
  return 'bg-amber-400 text-amber-950 border-amber-500';
}

function lifecycleStageMutedClass(stage: IndustryLifecycleReport['stage']): string {
  if (stage === 'Growth') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (stage === 'Maturity') return 'bg-blue-50 text-blue-800 border-blue-200';
  if (stage === 'Decline') return 'bg-rose-50 text-rose-800 border-rose-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

function lifecycleStagePosition(stage: IndustryLifecycleReport['stage']): number {
  const idx = Math.max(0, LIFECYCLE_STAGES.indexOf(stage));
  return Math.round((idx / Math.max(1, LIFECYCLE_STAGES.length - 1)) * 100);
}

function lifecycleSignalBiasCounts(report: IndustryLifecycleReport): Array<{
  stage: IndustryLifecycleReport['stage'];
  count: number;
}> {
  return LIFECYCLE_STAGES.map((stage) => ({
    stage,
    count: report.signals.filter((signal) => signal.stageBias === stage).length,
  }));
}

function leadershipSentimentClass(sentiment: IndustryLifecycleReport['leadershipSentiment']): string {
  if (sentiment === 'Positive') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (sentiment === 'Negative') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (sentiment === 'Mixed') return 'bg-amber-100 text-amber-900 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function groupGrowthRiskByCategory(items: GrowthRiskDashboardItem[]): [string, GrowthRiskDashboardItem[]][] {
  const m = new Map<string, GrowthRiskDashboardItem[]>();
  for (const it of items) {
    const k = (it.category || 'General').trim() || 'General';
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return [...m.entries()]
    .map(([k, arr]) => [k, [...arr].sort((a, b) => b.score - a.score)] as [string, GrowthRiskDashboardItem[]])
    .sort(([a], [b]) => a.localeCompare(b));
}

function tickerIn(ticker: string, values: string[]): boolean {
  return values.includes(ticker.toUpperCase());
}

function inferredSubsector(row: WatchlistRow): string {
  const explicit = (row.industry || '').trim();
  if (explicit) return explicit;
  const sector = (row.sector || '').trim();
  const sectorKey = sector.toLowerCase();
  if (!sectorKey) return '';
  const ticker = row.ticker.toUpperCase();
  const text = `${row.company || ''} ${ticker}`.toLowerCase();

  if (sectorKey.includes('technology')) {
    if (tickerIn(ticker, ['NVDA', 'AMD', 'INTC', 'AVGO', 'QCOM', 'TXN', 'ADI', 'MU', 'MCHP', 'MPWR', 'ON', 'NXPI', 'KLAC', 'LRCX', 'AMAT', 'TER', 'SWKS', 'QRVO']) || /semiconductor|microchip|broadcom|nvidia|amd|intel|analog devices|texas instruments|qualcomm/.test(text)) {
      return 'Semiconductors & Equipment';
    }
    if (tickerIn(ticker, ['MSFT', 'ORCL', 'ADBE', 'CRM', 'INTU', 'NOW', 'PANW', 'SNPS', 'CDNS', 'ADSK', 'ANSS', 'FICO', 'PLTR', 'FTNT', 'TYL', 'PTC']) || /software|cloud|salesforce|adobe|autodesk|synopsys|cadence|serviceNow|palantir|fortinet/i.test(text)) {
      return 'Software & Cloud';
    }
    if (tickerIn(ticker, ['ACN', 'IBM', 'FI', 'FIS', 'GPN', 'ADP', 'PAYX', 'CTSH', 'EPAM', 'IT', 'LDOS', 'CDW']) || /consulting|services|payments|payroll|data processing|fiserv|global payments|cognizant|accenture|gartner/.test(text)) {
      return 'IT Services & Payments';
    }
    if (tickerIn(ticker, ['AAPL', 'HPQ', 'DELL', 'STX', 'WDC', 'NTAP', 'CSCO', 'ANET', 'MSI', 'GLW', 'TEL', 'KEYS', 'HPE', 'JNPR']) || /apple|hardware|storage|network|communications|electronics|motorola|cisco|arista/.test(text)) {
      return 'Hardware, Devices & Networking';
    }
    return 'Technology - Other';
  }

  if (sectorKey.includes('health')) {
    if (/pharma|therapeutics|medicine|drug|bristol|pfizer|merck|eli lilly|abbvie|biogen|regeneron|moderna|gilead|vertex/.test(text)) return 'Pharma & Biotechnology';
    if (/device|surgical|medtronic|stryker|boston scientific|intuitive|becton|edwards|zimmer|resmed/.test(text)) return 'Medical Devices';
    if (/health|managed care|insurance|cigna|humana|unitedhealth|centene|mckesson|cardinal|cvs|elevance/.test(text)) return 'Healthcare Services & Managed Care';
    if (/laborator|diagnostic|thermo|danaher|idexx|illumina|quest|agilent/.test(text)) return 'Life Sciences & Diagnostics';
    return 'Healthcare - Other';
  }

  if (sectorKey.includes('financial')) {
    if (/bank|bancorp|financial|trust|jpmorgan|citigroup|wells fargo|goldman|morgan stanley/.test(text)) return 'Banks & Capital Markets';
    if (/insurance|assurant|aig|allstate|chubb|progressive|metlife|aflac|travelers|hartford/.test(text)) return 'Insurance';
    if (/visa|mastercard|paypal|payment|fiserv|american express|discover/.test(text)) return 'Payments & Credit Services';
    if (/exchange|marketaxess|cboe|nasdaq|factset|msci|s&p global|moody/.test(text)) return 'Exchanges, Data & Ratings';
    return 'Financial Services - Other';
  }

  if (sectorKey.includes('communication')) {
    if (/alphabet|meta|netflix|interactive|match|take-two|electronic arts/.test(text)) return 'Interactive Media & Entertainment';
    if (/telecom|communications|verizon|at&t|t-mobile/.test(text)) return 'Telecom Services';
    if (/media|warner|disney|comcast|charter|fox|paramount/.test(text)) return 'Media & Cable';
    return 'Communication Services - Other';
  }

  if (sectorKey.includes('consumer cyclical')) {
    if (/auto|tesla|ford|general motors|carmax|oreilly|autozone/.test(text)) return 'Autos & Auto Retail';
    if (/restaurant|mcdonald|starbucks|chipotle|yum|domino/.test(text)) return 'Restaurants';
    if (/apparel|nike|lululemon|tapestry|ralph lauren|retail|amazon|target|best buy|etsy|ebay/.test(text)) return 'Retail & Apparel';
    if (/hotel|booking|travel|carnival|royal caribbean|airbnb|expedia|marriott|hilton/.test(text)) return 'Travel & Leisure';
    return 'Consumer Cyclical - Other';
  }

  if (sectorKey.includes('consumer defensive')) {
    if (/food|beverage|coca|pepsi|mondelez|hershey|kraft|general mills|conagra|tyson/.test(text)) return 'Food & Beverage';
    if (/costco|walmart|kroger|dollar|retail/.test(text)) return 'Defensive Retail';
    if (/household|procter|colgate|clorox|kimberly|estee/.test(text)) return 'Household & Personal Products';
    if (/tobacco|altria|philip morris/.test(text)) return 'Tobacco';
    return 'Consumer Defensive - Other';
  }

  if (sectorKey.includes('industrial')) {
    if (/aerospace|defense|boeing|lockheed|northrop|raytheon|general dynamics|transdigm/.test(text)) return 'Aerospace & Defense';
    if (/rail|airline|transport|logistics|fedex|ups|union pacific|csx|norfolk/.test(text)) return 'Transportation & Logistics';
    if (/machinery|caterpillar|deere|cummins|paccar|ingersoll|emerson|rockwell/.test(text)) return 'Machinery & Automation';
    if (/waste|rental|services|verisk|equifax|jacobs|cintas|robert half/.test(text)) return 'Industrial Services';
    return 'Industrials - Other';
  }

  if (sectorKey.includes('energy')) {
    if (/exploration|resources|eog|diamondback|conoco|devon|marathon|hess/.test(text)) return 'Oil & Gas E&P';
    if (/exxon|chevron|integrated/.test(text)) return 'Integrated Oil & Gas';
    if (/pipeline|midstream|williams|oneok|targa|kindermorgan/.test(text)) return 'Midstream & Infrastructure';
    if (/service|slb|halliburton|baker hughes/.test(text)) return 'Oilfield Services';
    return 'Energy - Other';
  }

  if (sectorKey.includes('real estate')) {
    if (/data center|equinix|digital realty/.test(text)) return 'Data Center REITs';
    if (/industrial|prologis/.test(text)) return 'Industrial REITs';
    if (/residential|apartment|equity residential|avalonbay|invitation/.test(text)) return 'Residential REITs';
    if (/retail|realty income|simon|kimco|regency/.test(text)) return 'Retail REITs';
    return 'Real Estate - Other';
  }

  if (sectorKey.includes('utilit')) {
    if (/water|american water/.test(text)) return 'Water Utilities';
    if (/gas|nisource|atmos/.test(text)) return 'Gas Utilities';
    if (/renewable|nextera|aes/.test(text)) return 'Power & Renewables';
    return 'Electric & Multi-Utilities';
  }

  if (sectorKey.includes('material') || sectorKey.includes('basic')) {
    if (/chemical|dow|dupont|lyondell|celanese|corteva|mosaic|cf industries/.test(text)) return 'Chemicals & Agriculture Inputs';
    if (/packaging|container|ball|avery|westrock|international paper/.test(text)) return 'Packaging & Paper';
    if (/steel|alcoa|copper|mining|minerals|newmont|freeport/.test(text)) return 'Metals & Mining';
    return 'Materials - Other';
  }

  return `${sector} - Other`;
}

function mapDailyItemsToWatchlistRows(savedItems: DailyWatchlistItem[]): WatchlistRow[] {
  return savedItems.map((r) => ({
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
    ctr_price_return: r.ctr_price_return ?? null,
    ctr_cash_return: r.ctr_cash_return ?? null,
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
}

const WATCHLIST_METRIC_KEYS: Array<keyof WatchlistRow> = [
  'current_price',
  'total_assets',
  'total_liabilities',
  'total_revenue',
  'net_income',
  'operating_cash_flow',
  'free_cash_flow',
  'iv_dcf',
  'iv_ri',
  'iv_multiples',
  'iv_quality_score',
  'iv_ensemble',
  'iv_upside_pct',
  'torchlight_score',
  'torchlight_momentum',
  'torchlight_valuation_edge',
  'torchlight_quality',
  'torchlight_growth',
  'torchlight_sentiment',
  'torchlight_macro_fit',
  'torchlight_execution_feasibility',
  'torchlight_risk_adjusted_alpha',
  'ctr_total_return',
  'ctr_price_return',
  'ctr_cash_return',
  'ctr_annualized',
  'torchlight_ctr_score',
  'risk_volatility_annual',
  'risk_daily_return_mean',
  'risk_volatility_daily',
  'risk_sharpe',
  'risk_sortino',
  'risk_max_drawdown',
  'risk_var_95_hist',
  'risk_var_99_hist',
  'risk_var_95_param',
  'risk_var_99_param',
  'risk_cvar_95',
  'risk_beta',
  'risk_summary_score',
];

function watchlistMetricCount(row: WatchlistRow): number {
  return WATCHLIST_METRIC_KEYS.reduce((count, key) => {
    const value = row[key];
    return value != null && value !== '' && !(typeof value === 'number' && Number.isNaN(value)) ? count + 1 : count;
  }, 0);
}

function mergeMissingWatchlistMetrics(row: WatchlistRow, fallback: WatchlistRow | undefined): WatchlistRow {
  if (!fallback || watchlistMetricCount(fallback) <= watchlistMetricCount(row)) return row;
  const merged: WatchlistRow = { ...row };
  for (const key of WATCHLIST_METRIC_KEYS) {
    if (merged[key] == null || merged[key] === '') {
      (merged as Record<string, unknown>)[key] = fallback[key];
    }
  }
  if (!merged.company && fallback.company) merged.company = fallback.company;
  if (!merged.sector && fallback.sector) merged.sector = fallback.sector;
  if (!merged.industry && fallback.industry) merged.industry = fallback.industry;
  if (!merged.location && fallback.location) merged.location = fallback.location;
  if (!merged.torchlight_rank_factors && fallback.torchlight_rank_factors) {
    merged.torchlight_rank_factors = fallback.torchlight_rank_factors;
  }
  return merged;
}

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

/** Single 0–100 score: high IV vs price, high upside, Torchlight, and favorable risk (summary, Sharpe, lower vol). */
function opportunityCompositeScore(r: WatchlistRow): number {
  const ivGap =
    r.iv_ensemble != null && r.current_price != null && r.current_price > 0
      ? (r.iv_ensemble - r.current_price) / r.current_price
      : null;
  const ivPart =
    ivGap != null ? scaleTo100(ivGap, -0.35, 0.45) : scaleTo100(r.iv_upside_pct, -40, 80);
  const upside = scaleTo100(r.iv_upside_pct, -40, 80);
  const torch = scaleTo100(r.torchlight_score, 20, 95);
  const riskLow = scaleTo100(r.risk_summary_score, 20, 95);
  const sharpe = scaleTo100(r.risk_sharpe, -1, 3);
  const sortino = scaleTo100(r.risk_sortino, -1, 4);
  const volLow = 100 - scaleTo100(Math.abs(r.risk_volatility_annual ?? 0.28), 0.10, 0.70);
  const score =
    0.22 * ivPart +
    0.18 * upside +
    0.22 * torch +
    0.18 * riskLow +
    0.08 * sharpe +
    0.07 * sortino +
    0.05 * volLow;
  return Number(score.toFixed(2));
}

function escapeCsvCell(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadMarketInsightsCsv(
  ranked: Array<{ row: WatchlistRow; score: number }>,
  scopeLabel: string
): void {
  const cols = [
    'scope',
    'rank',
    'composite_score',
    'ticker',
    'company',
    'sector',
    'subsector',
    'iv_ensemble',
    'current_price',
    'iv_upside_pct',
    'torchlight_score',
    'risk_summary_score',
    'risk_sharpe',
    'risk_sortino',
    'risk_volatility_annual',
    'risk_max_drawdown',
    'risk_beta',
    'ctr_total_return',
    'ctr_price_return',
    'ctr_cash_return',
    'ctr_annualized',
  ] as const;
  const header = cols.map((c) => escapeCsvCell(c)).join(',');
  const line = (rank: number, x: { row: WatchlistRow; score: number }) => {
    const r = x.row;
    const vals: Record<string, unknown> = {
      scope: scopeLabel,
      rank,
      composite_score: x.score,
      ticker: r.ticker,
      company: r.company ?? '',
      sector: r.sector ?? '',
      subsector: inferredSubsector(r),
      iv_ensemble: r.iv_ensemble ?? '',
      current_price: r.current_price ?? '',
      iv_upside_pct: r.iv_upside_pct ?? '',
      torchlight_score: r.torchlight_score ?? '',
      risk_summary_score: r.risk_summary_score ?? '',
      risk_sharpe: r.risk_sharpe ?? '',
      risk_sortino: r.risk_sortino ?? '',
      risk_volatility_annual: r.risk_volatility_annual ?? '',
      risk_max_drawdown: r.risk_max_drawdown ?? '',
      risk_beta: r.risk_beta ?? '',
      ctr_total_return: r.ctr_total_return ?? '',
      ctr_price_return: r.ctr_price_return ?? '',
      ctr_cash_return: r.ctr_cash_return ?? '',
      ctr_annualized: r.ctr_annualized ?? '',
    };
    return cols.map((c) => escapeCsvCell(vals[c])).join(',');
  };
  const lines: string[] = [header];
  ranked.forEach((x, i) => lines.push(line(i + 1, x)));
  if (lines.length <= 1) return;
  const csv = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `watchlist-insights-ranked-${new Date().toISOString().slice(0, 10)}.csv`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function pct(val: number | null | undefined, factor = 1): string {
  if (val == null || Number.isNaN(val)) return 'N/A';
  return `${(val * factor).toFixed(2)}%`;
}

function num(val: number | null | undefined, digits = 2): string {
  if (val == null || Number.isNaN(val)) return 'N/A';
  return val.toFixed(digits);
}

/** Single place: all watchlist / API numbers the LLM must ground the report in. */
function buildWatchlistQuantitativeDataBlock(r: WatchlistRow): string {
  const p = (v: number | null | undefined) => (v != null && !Number.isNaN(v) ? `${(v * 100).toFixed(2)}%` : 'N/A');
  const ppu = (v: number | null | undefined) => (v != null && !Number.isNaN(v) ? `${v.toFixed(2)}%` : 'N/A');
  const $n = (v: number | null | undefined) => (v != null && !Number.isNaN(v) ? `$${v.toFixed(2)}` : 'N/A');
  const lines: string[] = [];
  const L = (k: string, v: string) => lines.push(`${k}: ${v}`);

  L('Identifier', `${r.ticker} / ${r.company || 'N/A'}`);
  L('Sector', r.sector || 'N/A');
  L('Industry/Subsector', inferredSubsector(r) || 'N/A');
  L('Location', r.location || 'N/A');
  L('Current price (mark)', $n(r.current_price));

  lines.push('--- Intrinsic value (IV) ---');
  L('IV DCF', formatStatementNum(r.iv_dcf));
  L('IV Residual income (RI)', formatStatementNum(r.iv_ri));
  L('IV Multiples', formatStatementNum(r.iv_multiples));
  L('IV Ensemble (primary IV vs price anchor)', formatStatementNum(r.iv_ensemble));
  L('IV Quality score', num(r.iv_quality_score, 2));
  L('IV Upside % (vs mark, model definition in watchlist)', ppu(r.iv_upside_pct));

  lines.push('--- Shareholder return (CTR) ---');
  L('CTR Total return (fraction → % in UI)', p(r.ctr_total_return));
  L('CTR Price return (fraction → % in UI)', p(r.ctr_price_return));
  L('CTR Cash return (fraction → % in UI)', p(r.ctr_cash_return));
  L('CTR Annualized', p(r.ctr_annualized));
  L('Torchlight CTR composite score', num(r.torchlight_ctr_score, 2));

  lines.push('--- Torchlight composite & factors ---');
  L('Torchlight headline score', num(r.torchlight_score, 2));
  L('Torchlight rank factors (weights description)', r.torchlight_rank_factors || 'N/A');
  L('Torchlight momentum', num(r.torchlight_momentum, 2));
  L('Torchlight valuation edge', num(r.torchlight_valuation_edge, 2));
  L('Torchlight quality', num(r.torchlight_quality, 2));
  L('Torchlight growth', num(r.torchlight_growth, 2));
  L('Torchlight sentiment', num(r.torchlight_sentiment, 2));
  L('Torchlight macro fit', num(r.torchlight_macro_fit, 2));
  L('Torchlight execution feasibility', num(r.torchlight_execution_feasibility, 2));
  L('Torchlight risk-adjusted alpha', num(r.torchlight_risk_adjusted_alpha, 2));

  lines.push('--- Risk & drawdown ---');
  L('Risk summary score', num(r.risk_summary_score, 2));
  L('Beta', num(r.risk_beta, 3));
  L('Mean daily return', p(r.risk_daily_return_mean));
  L('Volatility daily', p(r.risk_volatility_daily));
  L('Volatility annualized', p(r.risk_volatility_annual));
  L('Sharpe', num(r.risk_sharpe, 3));
  L('Sortino', num(r.risk_sortino, 3));
  L('Max drawdown', p(r.risk_max_drawdown));
  L('VaR 95% historical', p(r.risk_var_95_hist));
  L('VaR 99% historical', p(r.risk_var_99_hist));
  L('VaR 95% parametric', p(r.risk_var_95_param));
  L('VaR 99% parametric', p(r.risk_var_99_param));
  L('CVaR 95%', p(r.risk_cvar_95));

  lines.push('--- Financial statements (scaled / reported units as in feed) ---');
  L('Total assets', formatStatementNum(r.total_assets));
  L('Total liabilities', formatStatementNum(r.total_liabilities));
  L('Total revenue', formatStatementNum(r.total_revenue));
  L('Net income', formatStatementNum(r.net_income));
  L('Operating cash flow', formatStatementNum(r.operating_cash_flow));
  L('Free cash flow', formatStatementNum(r.free_cash_flow));

  return lines.join('\n');
}

function truncateContextBlock(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

async function buildTickerGrowthRiskContextBlock(row: WatchlistRow, apiBase: string): Promise<string> {
  const blocks: string[] = [
    '=== PRIMARY WATCHLIST VALUES (highest priority; cite these numbers first) ===',
    buildWatchlistQuantitativeDataBlock(row),
    '=== END PRIMARY WATCHLIST VALUES ===',
  ];
  const ticker = row.ticker.toUpperCase();

  try {
    const sentiment = await fetchPortfolioNewsSentiment([ticker], apiBase);
    const position = sentiment.positions.find((p) => p.symbol.toUpperCase() === ticker);
    blocks.push(
      [
        '=== NEWS SENTIMENT CONTEXT (secondary; do not override watchlist values) ===',
        `Source: ${sentiment.source || 'news sentiment API'}`,
        position
          ? `Ticker sentiment: ${position.sentiment_label} (${formatAvSentiment(position.average_sentiment)}), articles: ${position.article_count}`
          : 'Ticker sentiment: no ticker-specific sentiment row returned.',
        ...(position?.articles ?? []).slice(0, 5).map((a, i) => {
          const title = a.title || 'Untitled';
          const source = a.source ? `, ${a.source}` : '';
          const label = a.sentiment_label ? `, sentiment ${a.sentiment_label}` : '';
          const score = a.sentiment != null ? ` (${formatAvSentiment(a.sentiment)})` : '';
          return `${i + 1}. ${title}${source}${label}${score}`;
        }),
        '=== END NEWS SENTIMENT CONTEXT ===',
      ].join('\n')
    );
  } catch (e: unknown) {
    blocks.push(
      [
        '=== NEWS SENTIMENT CONTEXT (secondary) ===',
        `Unavailable: ${e instanceof Error ? e.message : String(e)}`,
        '=== END NEWS SENTIMENT CONTEXT ===',
      ].join('\n')
    );
  }

  try {
    const todayNewsBundle = await fetchFinnhubCompanyNewsBundle(ticker, {
      daysBack: 0,
      maxArticles: 3,
    });
    blocks.push(
      [
        '=== TODAY TICKER NEWS (secondary; Finnhub today only) ===',
        promptBlockFromBundle(todayNewsBundle),
        '=== END TODAY TICKER NEWS ===',
      ].join('\n')
    );
  } catch (e: unknown) {
    blocks.push(
      [
        '=== TODAY TICKER NEWS (secondary) ===',
        `Unavailable: ${e instanceof Error ? e.message : String(e)}`,
        '=== END TODAY TICKER NEWS ===',
      ].join('\n')
    );
  }

  try {
    const day = localReportDateKey();
    const macro = await fetchMacroReportForDate(day, apiBase);
    blocks.push(
      [
        '=== FRED MACRO REPORT CONTEXT (secondary; use for macro category only) ===',
        macro.found && macro.content
          ? `Report date: ${macro.report_date}\n${truncateContextBlock(stripMacroReportFileHeader(macro.content), 5000)}`
          : `No saved FRED macro report found for ${day}.`,
        '=== END FRED MACRO REPORT CONTEXT ===',
      ].join('\n')
    );
  } catch (e: unknown) {
    blocks.push(
      [
        '=== FRED MACRO REPORT CONTEXT (secondary) ===',
        `Unavailable: ${e instanceof Error ? e.message : String(e)}`,
        '=== END FRED MACRO REPORT CONTEXT ===',
      ].join('\n')
    );
  }

  return blocks.join('\n\n');
}

/** Mean of a numeric column; only rows with finite values count. */
function sectorColumnMean(
  rows: WatchlistRow[],
  get: (r: WatchlistRow) => number | null | undefined
): { mean: number; n: number } | null {
  const vals = rows.map(get).filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  return { mean: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length };
}

function pushSectorAvgLine(
  lines: string[],
  rows: WatchlistRow[],
  nSector: number,
  label: string,
  get: (r: WatchlistRow) => number | null | undefined,
  fmt: (mean: number) => string
): void {
  const res = sectorColumnMean(rows, get);
  if (!res) {
    lines.push(`${label}: no numeric data`);
    return;
  }
  lines.push(`${label}: ${fmt(res.mean)} (mean over ${res.n}/${nSector} companies)`);
}

/**
 * Sum-equivalent sector view: for each numeric column, average = sum(values) ÷ count(non-null).
 * Matches units/formatting used in buildWatchlistQuantitativeDataBlock.
 */
function buildSectorAggregateMetricsBlock(sector: string, rows: WatchlistRow[]): string {
  const nSector = rows.length;
  const lines: string[] = [
    `=== SECTOR COLUMN AVERAGES (${sector}) ===`,
    `Companies in sector: ${nSector}`,
    'Each line is the arithmetic mean for that metric across companies with data (Σ values ÷ number of companies with that metric).',
    '',
  ];

  const pAvg = (m: number) => `${(m * 100).toFixed(2)}%`;
  const ppuAvg = (m: number) => `${m.toFixed(2)}%`;

  pushSectorAvgLine(lines, rows, nSector, 'Avg current price (mark)', (r) => r.current_price, (m) => `$${m.toFixed(2)}`);

  lines.push('--- Intrinsic value (IV) — sector averages ---');
  pushSectorAvgLine(lines, rows, nSector, 'Avg IV DCF', (r) => r.iv_dcf, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg IV Residual income (RI)', (r) => r.iv_ri, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg IV Multiples', (r) => r.iv_multiples, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg IV Ensemble', (r) => r.iv_ensemble, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg IV Quality score', (r) => r.iv_quality_score, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg IV Upside % (model units)', (r) => r.iv_upside_pct, ppuAvg);

  lines.push('--- Shareholder return (CTR) — sector averages ---');
  pushSectorAvgLine(lines, rows, nSector, 'Avg CTR Total return (fraction)', (r) => r.ctr_total_return, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg CTR Price return (fraction)', (r) => r.ctr_price_return, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg CTR Cash return (fraction)', (r) => r.ctr_cash_return, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg CTR Annualized', (r) => r.ctr_annualized, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight CTR composite', (r) => r.torchlight_ctr_score, (m) => m.toFixed(2));

  lines.push('--- Torchlight — sector averages ---');
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight headline score', (r) => r.torchlight_score, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight momentum', (r) => r.torchlight_momentum, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight valuation edge', (r) => r.torchlight_valuation_edge, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight quality', (r) => r.torchlight_quality, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight growth', (r) => r.torchlight_growth, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight sentiment', (r) => r.torchlight_sentiment, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight macro fit', (r) => r.torchlight_macro_fit, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight execution feasibility', (r) => r.torchlight_execution_feasibility, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Torchlight risk-adjusted alpha', (r) => r.torchlight_risk_adjusted_alpha, (m) => m.toFixed(2));

  lines.push('--- Risk & drawdown — sector averages ---');
  pushSectorAvgLine(lines, rows, nSector, 'Avg Risk summary score', (r) => r.risk_summary_score, (m) => m.toFixed(2));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Beta', (r) => r.risk_beta, (m) => m.toFixed(3));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Mean daily return', (r) => r.risk_daily_return_mean, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg Volatility daily', (r) => r.risk_volatility_daily, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg Volatility annualized', (r) => r.risk_volatility_annual, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg Sharpe', (r) => r.risk_sharpe, (m) => m.toFixed(3));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Sortino', (r) => r.risk_sortino, (m) => m.toFixed(3));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Max drawdown', (r) => r.risk_max_drawdown, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg VaR 95% historical', (r) => r.risk_var_95_hist, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg VaR 99% historical', (r) => r.risk_var_99_hist, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg VaR 95% parametric', (r) => r.risk_var_95_param, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg VaR 99% parametric', (r) => r.risk_var_99_param, pAvg);
  pushSectorAvgLine(lines, rows, nSector, 'Avg CVaR 95%', (r) => r.risk_cvar_95, pAvg);

  lines.push('--- Financial statements — sector averages (same units as feed) ---');
  pushSectorAvgLine(lines, rows, nSector, 'Avg Total assets', (r) => r.total_assets, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Total liabilities', (r) => r.total_liabilities, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Total revenue', (r) => r.total_revenue, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Net income', (r) => r.net_income, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Operating cash flow', (r) => r.operating_cash_flow, (m) => formatStatementNum(m));
  pushSectorAvgLine(lines, rows, nSector, 'Avg Free cash flow', (r) => r.free_cash_flow, (m) => formatStatementNum(m));

  const compVals = rows.map((r) => opportunityCompositeScore(r)).filter((x) => Number.isFinite(x));
  if (compVals.length) {
    const cm = compVals.reduce((a, b) => a + b, 0) / compVals.length;
    lines.push('');
    lines.push(
      `Derived internal benchmark — avg opportunity composite (0–100, same formula as stock ranking): ${cm.toFixed(2)} (${compVals.length} firms)`
    );
  }

  lines.push('');
  lines.push('(Torchlight rank_factors text is per company — not averaged; use top-by-Torchlight list elsewhere in the prompt.)');
  lines.push('=== END SECTOR COLUMN AVERAGES ===');
  return lines.join('\n');
}

function finiteLifecycleNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function avgLifecycleField(rows: Array<Record<string, unknown>>, key: string): { mean: number; n: number } | null {
  const vals = rows.map((r) => finiteLifecycleNum(r[key])).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return { mean: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length };
}

function pctLifecycle(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : 'N/A';
}

function numLifecycle(v: number | null | undefined, digits = 2): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : 'N/A';
}

function formatYahooNewsForPrompt(raw: unknown, label: string): string[] {
  const rows = Array.isArray(raw) ? raw : [];
  if (!rows.length) return [`${label}: none returned by Yahoo Finance.`];
  return [
    `${label}:`,
    ...rows.slice(0, 10).map((item, i) => {
      if (!item || typeof item !== 'object') return `${i + 1}. N/A`;
      const r = item as Record<string, unknown>;
      const title = String(r.title || '').trim() || 'Untitled';
      const publisher = String(r.publisher || '').trim();
      const published = r.published != null ? String(r.published) : '';
      return `${i + 1}. ${title}${publisher ? ` — ${publisher}` : ''}${published ? ` (${published})` : ''}`;
    }),
  ];
}

function classifyLifecycleStageFromSignals(signals: {
  revenueGrowth: number | null;
  competition: 'rising' | 'few_players' | 'consolidating' | 'unknown';
  marginTrend: 'improving' | 'stable' | 'falling' | 'unknown';
}): 'Introduction' | 'Growth' | 'Maturity' | 'Decline' {
  if (signals.revenueGrowth != null && signals.revenueGrowth > 0.2 && signals.competition === 'rising') return 'Growth';
  if (signals.marginTrend === 'stable') return 'Maturity';
  if (signals.revenueGrowth != null && signals.revenueGrowth < 0) return 'Decline';
  return 'Introduction';
}

function buildIndustryLifecycleDataBlock(
  segmentLabel: string,
  rows: WatchlistRow[],
  yahooRows: unknown[],
  yahooError?: string
): string {
  const yahooByTicker = new Map<string, Record<string, unknown>>();
  for (const raw of yahooRows) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const ticker = String(obj.ticker || '').toUpperCase();
    if (ticker) yahooByTicker.set(ticker, obj);
  }
  const merged = rows.map((row) => ({ ...row, ...(yahooByTicker.get(row.ticker.toUpperCase()) || {}) }));
  const revenueGrowth = avgLifecycleField(merged, 'revenue_growth');
  const earningsGrowth = avgLifecycleField(merged, 'earnings_growth');
  const grossMargins = avgLifecycleField(merged, 'gross_margins');
  const profitMargins = avgLifecycleField(merged, 'profit_margins');
  const operatingMargins = avgLifecycleField(merged, 'operating_margins');
  const ebitdaMargins = avgLifecycleField(merged, 'ebitda_margins');
  const marketCap = avgLifecycleField(merged, 'market_cap');
  const enterpriseValue = avgLifecycleField(merged, 'enterprise_value');
  const recommendationMean = avgLifecycleField(merged, 'recommendation_mean');
  const targetMeanPrice = avgLifecycleField(merged, 'target_mean_price');
  const growthBreadth =
    revenueGrowth && merged.length > 0
      ? merged.filter((r) => {
          const g = finiteLifecycleNum(r.revenue_growth);
          return g != null && g > 0.2;
        }).length / Math.max(1, revenueGrowth.n)
      : null;
  const competition =
    rows.length <= 4 ? 'few_players' : growthBreadth != null && growthBreadth >= 0.35 ? 'rising' : 'unknown';
  const marginTrend =
    operatingMargins && profitMargins && revenueGrowth && Math.abs(revenueGrowth.mean) <= 0.12
      ? 'stable'
      : 'unknown';
  const deterministicStage = classifyLifecycleStageFromSignals({
    revenueGrowth: revenueGrowth?.mean ?? null,
    competition,
    marginTrend,
  });
  const topRows = [...merged]
    .sort((a, b) => (finiteLifecycleNum(b.revenue_growth) ?? -999) - (finiteLifecycleNum(a.revenue_growth) ?? -999))
    .slice(0, 12);

  return [
    buildSectorAggregateMetricsBlock(segmentLabel, rows),
    '',
    `=== YAHOO FINANCE LIFECYCLE FIELDS (${segmentLabel}) ===`,
    `Yahoo fetch status: ${yahooRows.length > 0 ? `loaded ${yahooRows.length}/${rows.length} rows` : yahooError ? `unavailable: ${yahooError}` : 'no lifecycle rows returned'}`,
    `Avg revenue growth: ${revenueGrowth ? `${pctLifecycle(revenueGrowth.mean)} (mean over ${revenueGrowth.n}/${rows.length})` : 'N/A'}`,
    `Avg earnings growth: ${earningsGrowth ? `${pctLifecycle(earningsGrowth.mean)} (mean over ${earningsGrowth.n}/${rows.length})` : 'N/A'}`,
    `Avg gross margins: ${grossMargins ? `${pctLifecycle(grossMargins.mean)} (mean over ${grossMargins.n}/${rows.length})` : 'N/A'}`,
    `Avg profit margins: ${profitMargins ? `${pctLifecycle(profitMargins.mean)} (mean over ${profitMargins.n}/${rows.length})` : 'N/A'}`,
    `Avg operating margins: ${operatingMargins ? `${pctLifecycle(operatingMargins.mean)} (mean over ${operatingMargins.n}/${rows.length})` : 'N/A'}`,
    `Avg EBITDA margins: ${ebitdaMargins ? `${pctLifecycle(ebitdaMargins.mean)} (mean over ${ebitdaMargins.n}/${rows.length})` : 'N/A'}`,
    `Avg market cap: ${marketCap ? formatStatementNum(marketCap.mean) : 'N/A'}`,
    `Avg enterprise value: ${enterpriseValue ? formatStatementNum(enterpriseValue.mean) : 'N/A'}`,
    `Avg recommendation mean: ${recommendationMean ? numLifecycle(recommendationMean.mean, 2) : 'N/A'}`,
    `Avg target mean price: ${targetMeanPrice ? `$${targetMeanPrice.mean.toFixed(2)}` : 'N/A'}`,
    `Competition proxy: ${competition} (constituents: ${rows.length}; high-growth breadth: ${growthBreadth != null ? `${(growthBreadth * 100).toFixed(1)}%` : 'N/A'})`,
    `Margin trend proxy: ${marginTrend} (direct multi-year margin trend is not available in this payload)`,
    `Deterministic classification from requested logic: ${deterministicStage}`,
    'Missing direct signals: user growth, TAM/market-size growth, direct new-entrant count, consolidation/M&A count, and multi-year margin trend.',
    '',
    'Top rows by Yahoo revenue growth proxy:',
    ...topRows.map((r, i) => {
      const ticker = String(r.ticker || '').toUpperCase();
      const company = String(r.company || r.short_name || '').trim();
      return `${i + 1}. ${ticker}${company ? ` (${company})` : ''}: revenue_growth=${pctLifecycle(finiteLifecycleNum(r.revenue_growth))}, earnings_growth=${pctLifecycle(finiteLifecycleNum(r.earnings_growth))}, profit_margins=${pctLifecycle(finiteLifecycleNum(r.profit_margins))}, operating_margins=${pctLifecycle(finiteLifecycleNum(r.operating_margins))}, market_cap=${formatStatementNum(finiteLifecycleNum(r.market_cap))}`;
    }),
    '=== END YAHOO FINANCE LIFECYCLE FIELDS ===',
  ].join('\n');
}

function buildBusinessLifecycleDataBlock(row: WatchlistRow, yahooRows: unknown[], yahooError?: string): string {
  const yahoo = (yahooRows.find((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return String((raw as Record<string, unknown>).ticker || '').toUpperCase() === row.ticker.toUpperCase();
  }) || {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...row, ...yahoo };
  const revenueGrowth = finiteLifecycleNum(merged.revenue_growth);
  const earningsGrowth = finiteLifecycleNum(merged.earnings_growth);
  const grossMargins = finiteLifecycleNum(merged.gross_margins);
  const profitMargins = finiteLifecycleNum(merged.profit_margins);
  const operatingMargins = finiteLifecycleNum(merged.operating_margins);
  const ebitdaMargins = finiteLifecycleNum(merged.ebitda_margins);
  const marketCap = finiteLifecycleNum(merged.market_cap);
  const enterpriseValue = finiteLifecycleNum(merged.enterprise_value);
  const recommendationMean = finiteLifecycleNum(merged.recommendation_mean);
  const targetMeanPrice = finiteLifecycleNum(merged.target_mean_price);
  const fcfMargin =
    row.free_cash_flow != null && row.total_revenue != null && row.total_revenue !== 0
      ? row.free_cash_flow / row.total_revenue
      : null;
  const netMargin =
    row.net_income != null && row.total_revenue != null && row.total_revenue !== 0
      ? row.net_income / row.total_revenue
      : null;
  const competition =
    revenueGrowth != null && revenueGrowth > 0.2 ? 'rising' : row.sector ? 'unknown' : 'few_players';
  const marginTrend =
    operatingMargins != null && profitMargins != null && Math.abs((operatingMargins || 0) - (profitMargins || 0)) <= 0.12
      ? 'stable'
      : 'unknown';
  const deterministicStage = classifyLifecycleStageFromSignals({ revenueGrowth, competition, marginTrend });
  return [
    `=== BUSINESS / INSTRUMENT LIFECYCLE DATA (${row.ticker}) ===`,
    `Company: ${row.company || 'N/A'}`,
    `Ticker: ${row.ticker}`,
    `Sector: ${row.sector || 'N/A'}`,
    `Industry/Subsector: ${inferredSubsector(row) || 'N/A'}`,
    `Yahoo fetch status: ${yahooRows.length > 0 ? 'loaded lifecycle row' : yahooError ? `unavailable: ${yahooError}` : 'no lifecycle row returned'}`,
    '',
    '--- Watchlist quantitative anchor ---',
    buildWatchlistQuantitativeDataBlock(row),
    '',
    '--- Yahoo Finance business lifecycle fields ---',
    `Revenue growth: ${pctLifecycle(revenueGrowth)}`,
    `Earnings growth: ${pctLifecycle(earningsGrowth)}`,
    `Gross margins: ${pctLifecycle(grossMargins)}`,
    `Profit margins: ${pctLifecycle(profitMargins)}`,
    `Operating margins: ${pctLifecycle(operatingMargins)}`,
    `EBITDA margins: ${pctLifecycle(ebitdaMargins)}`,
    `Net margin from statements: ${pctLifecycle(netMargin)}`,
    `FCF margin from statements: ${pctLifecycle(fcfMargin)}`,
    `Market cap: ${formatStatementNum(marketCap)}`,
    `Enterprise value: ${formatStatementNum(enterpriseValue)}`,
    `Recommendation mean: ${numLifecycle(recommendationMean, 2)}`,
    `Target mean price: ${targetMeanPrice != null ? `$${targetMeanPrice.toFixed(2)}` : 'N/A'}`,
    `Competition proxy: ${competition}`,
    `Margin trend proxy: ${marginTrend} (direct multi-year margin trend is not available in this payload)`,
    `Deterministic classification from requested logic: ${deterministicStage}`,
    'Missing direct signals: user/customer growth, TAM/market-size growth, direct competitor/new-entrant count, consolidation/M&A count, and multi-year revenue/margin history.',
    '=== END BUSINESS / INSTRUMENT LIFECYCLE DATA ===',
  ].join('\n');
}

function buildLeadershipLifecycleDataBlock(row: WatchlistRow, yahooRows: unknown[], yahooError?: string): string {
  const yahoo = (yahooRows.find((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return String((raw as Record<string, unknown>).ticker || '').toUpperCase() === row.ticker.toUpperCase();
  }) || {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...row, ...yahoo };
  const leaderName = String(merged.leader_name || '').trim() || 'N/A';
  const leaderTitle = String(merged.leader_title || '').trim() || 'N/A';
  const leaderTotalPay = finiteLifecycleNum(merged.leader_total_pay);
  const leaderYearBorn = finiteLifecycleNum(merged.leader_year_born);
  const officerCount = finiteLifecycleNum(merged.officer_count);
  const heldPercentInsiders = finiteLifecycleNum(merged.held_percent_insiders);
  const heldPercentInstitutions = finiteLifecycleNum(merged.held_percent_institutions);
  const auditRisk = finiteLifecycleNum(merged.audit_risk);
  const boardRisk = finiteLifecycleNum(merged.board_risk);
  const compensationRisk = finiteLifecycleNum(merged.compensation_risk);
  const shareholderRightsRisk = finiteLifecycleNum(merged.shareholder_rights_risk);
  const overallRisk = finiteLifecycleNum(merged.overall_risk);
  const revenueGrowth = finiteLifecycleNum(merged.revenue_growth);
  const earningsGrowth = finiteLifecycleNum(merged.earnings_growth);
  const profitMargins = finiteLifecycleNum(merged.profit_margins);
  const operatingMargins = finiteLifecycleNum(merged.operating_margins);
  const recommendationMean = finiteLifecycleNum(merged.recommendation_mean);
  const targetMeanPrice = finiteLifecycleNum(merged.target_mean_price);
  const managementNewsLines = formatYahooNewsForPrompt(merged.yahoo_management_news, 'Yahoo management / governance news');
  const recentNewsLines = formatYahooNewsForPrompt(merged.yahoo_recent_news, 'Yahoo recent company news');
  return [
    `=== LEADERSHIP LIFECYCLE DATA (${row.ticker}) ===`,
    `Company: ${row.company || 'N/A'}`,
    `Ticker: ${row.ticker}`,
    `Leader name: ${leaderName}`,
    `Leader title: ${leaderTitle}`,
    `Leader total pay: ${formatStatementNum(leaderTotalPay)}`,
    `Leader year born: ${leaderYearBorn != null ? String(Math.round(leaderYearBorn)) : 'N/A'}`,
    `Officer count: ${officerCount != null ? String(Math.round(officerCount)) : 'N/A'}`,
    `Sector: ${row.sector || 'N/A'}`,
    `Industry/Subsector: ${inferredSubsector(row) || 'N/A'}`,
    `Yahoo fetch status: ${yahooRows.length > 0 ? 'loaded leadership/lifecycle row' : yahooError ? `unavailable: ${yahooError}` : 'no leadership row returned'}`,
    '',
    '--- Leadership execution proxies from company fundamentals ---',
    `Revenue growth: ${pctLifecycle(revenueGrowth)}`,
    `Earnings growth: ${pctLifecycle(earningsGrowth)}`,
    `Profit margins: ${pctLifecycle(profitMargins)}`,
    `Operating margins: ${pctLifecycle(operatingMargins)}`,
    `Total revenue: ${formatStatementNum(row.total_revenue)}`,
    `Net income: ${formatStatementNum(row.net_income)}`,
    `Operating cash flow: ${formatStatementNum(row.operating_cash_flow)}`,
    `Free cash flow: ${formatStatementNum(row.free_cash_flow)}`,
    `Total assets: ${formatStatementNum(row.total_assets)}`,
    `Total liabilities: ${formatStatementNum(row.total_liabilities)}`,
    `Recommendation mean: ${numLifecycle(recommendationMean, 2)}`,
    `Target mean price: ${targetMeanPrice != null ? `$${targetMeanPrice.toFixed(2)}` : 'N/A'}`,
    `Insider ownership: ${pctLifecycle(heldPercentInsiders)}`,
    `Institutional ownership: ${pctLifecycle(heldPercentInstitutions)}`,
    `Audit risk (Yahoo 1 low to 10 high): ${numLifecycle(auditRisk, 0)}`,
    `Board risk (Yahoo 1 low to 10 high): ${numLifecycle(boardRisk, 0)}`,
    `Compensation risk (Yahoo 1 low to 10 high): ${numLifecycle(compensationRisk, 0)}`,
    `Shareholder rights risk (Yahoo 1 low to 10 high): ${numLifecycle(shareholderRightsRisk, 0)}`,
    `Overall governance risk (Yahoo 1 low to 10 high): ${numLifecycle(overallRisk, 0)}`,
    '',
    '--- Yahoo Finance news context ---',
    ...managementNewsLines,
    ...recentNewsLines,
    '',
    '--- Market / risk / execution proxies ---',
    `Torchlight growth: ${numLifecycle(row.torchlight_growth, 2)}`,
    `Torchlight quality: ${numLifecycle(row.torchlight_quality, 2)}`,
    `Torchlight execution feasibility: ${numLifecycle(row.torchlight_execution_feasibility, 2)}`,
    `Torchlight sentiment: ${numLifecycle(row.torchlight_sentiment, 2)}`,
    `Risk summary score: ${numLifecycle(row.risk_summary_score, 2)}`,
    `Sharpe: ${numLifecycle(row.risk_sharpe, 3)}`,
    `Sortino: ${numLifecycle(row.risk_sortino, 3)}`,
    `Max drawdown: ${pctLifecycle(row.risk_max_drawdown)}`,
    '',
    'Missing direct leadership signals when absent above: tenure, compensation alignment, insider ownership, management changes, succession risk, employee approval, governance quality, and direct strategic milestone history.',
    '=== END LEADERSHIP LIFECYCLE DATA ===',
  ].join('\n');
}

function buildContextualInsightPrompt(
  symbol: string,
  row: WatchlistRow | null,
  finnhubNewsBlock: string
): string {
  const extendedReportSpec = row
    ? 'extended_report — string, REQUIRED: 10–14 paragraphs separated by two newline characters (\\n\\n), ~750–1100 words total, plain prose only (no markdown tables). First paragraph must name the ticker symbol and company and restate the same stance as your JSON sentiment/recommendation in one cohesive lead. Then write distinct, detailed paragraphs for: (1) investment thesis and setup (2) valuation vs current price with cited IV DCF, IV RI, IV multiples, IV ensemble, IV quality, and IV upside (3) how reliable/conflicted the valuation anchors are (4) Torchlight headline and rank_factors (5) CTR total return, price return, cash return, annualized return, and Torchlight CTR composite (6) revenue, earnings, operating cash flow, free cash flow, margin/cash-conversion implications when possible (7) balance sheet using assets/liabilities when available (8) risk stack: volatility, beta, Sharpe, Sortino, drawdown, VaR and CVaR (9) what would invalidate the bullish/neutral/bearish view (10) today’s Finnhub headline catalyst or explicitly none (11) time horizon, position-sizing posture, and monitoring checklist. If any metric is N/A, say so. Numbers must match the data block or TODAY news block only.'
    : 'extended_report — string, REQUIRED: 5–7 paragraphs separated by \\n\\n (~250–400 words). Name the ticker; watchlist fundamentals were not loaded — state that clearly, do not invent numbers, and anchor the rest only on the Finnhub TODAY block plus cautious general framing.';

  const densityRule = row
    ? 'Be dense and factual; no filler. Numbers must match the data block.'
    : 'Be factual; do not invent fundamentals beyond the Finnhub block.';

  const jsonFooter =
    [
      'Return ONLY valid JSON with these keys (no markdown, no extra keys):',
      'sentiment — exactly one of: Bullish, Bearish, Neutral',
      'confidence — integer 0–100',
      'The app UI already renders a deterministic IV (green) and risk (red) signal strip from the same data — synthesize and add nuance; do not duplicate those bullets verbatim.',
      'executive_summary — ~80–120 words: tie IV vs price, Torchlight headline, CTR, fundamentals, and risk posture using ONLY numbers from the data block.',
      'valuation_view — ~110–160 words: IV DCF, IV RI, IV Multiples, IV Ensemble, IV Quality, IV Upside % vs Current price; discount/premium vs mark with cited figures; explain whether anchors agree or conflict.',
      'torchlight_view — ~110–160 words: Torchlight headline, rank_factors line, key sub-scores and **all CTR legs** (total, price, cash, annualized) + Torchlight CTR composite with cited figures.',
      'risk_view — ~120–170 words: risk summary score, Beta, Sharpe, Sortino, vols, max drawdown, VaR / CVaR — cite figures and interpret position risk.',
      'market_catalysts — ~60–100 words: ONLY the TODAY Finnhub block below; if empty or no articles, write exactly: No ticker-specific headlines in the provided TODAY block.',
      'pros — array of exactly 5 strings; each must name a metric and its value from the data block.',
      'cons — array of exactly 5 strings; same rule.',
      'recommendation — ~120–180 words: reconcile IV vs price, Torchlight, CTR, fundamentals, balance sheet, risk, catalysts, horizon, and monitoring triggers.',
      extendedReportSpec,
      densityRule,
    ].join('\n');

  const newsSection = [
    '',
    '=== TODAY NEWS (Finnhub company-news API; today only, latest 1 article) ===',
    finnhubNewsBlock,
    '=== END TODAY NEWS ===',
    '',
  ].join('\n');

  if (!row) {
    return [
      `Analyze ticker ${symbol} using watchlist quantitative context and today's Finnhub ticker-news items only.`,
      'Do not use any external/web/news beyond the provided Finnhub block.',
      'If you lack the numeric data block below, still return valid JSON; use neutral stance and explain missing data in executive_summary.',
      newsSection,
      jsonFooter,
    ].join('\n');
  }

  const company = row.company || symbol;
  const sector = row.sector || 'Unknown sector';
  const dataBlock = buildWatchlistQuantitativeDataBlock(row);

  return [
    `You are generating an equity RESEARCH BRIEF for ${company} (${symbol}), sector: ${sector}.`,
    '',
    '=== AUTHORITATIVE WATCHLIST NUMBERS (anchor every figure here; no external data) ===',
    dataBlock,
    '=== END DATA ===',
    newsSection,
    'RULES:',
    '- Every numeric claim must appear verbatim (or same rounding) in the data block.',
    '- Do not repeat the entire data table in prose; interpret and compare (e.g. IV ensemble vs price, upside %).',
    '- If a metric is N/A, say so briefly instead of guessing.',
    '',
    jsonFooter,
  ].join('\n');
}

function buildSectorInsightPrompt(segmentLabel: string, rows: WatchlistRow[]): string {
  const valid = rows;
  const top = [...valid]
    .sort((a, b) => (b.torchlight_score ?? -1) - (a.torchlight_score ?? -1))
    .slice(0, 8);

  const aggregateBlock = buildSectorAggregateMetricsBlock(segmentLabel, valid);

  const topTickers = top.map((r) => `${r.ticker}${r.company ? `(${r.company})` : ''}`).join(', ') || 'N/A';
  return [
    `System: Generate a sector/subsector-level investment BRIEF for ${segmentLabel}.`,
    '',
    aggregateBlock,
    '',
    `Constituents: ${valid.length} companies in this selected segment in the current universe.`,
    `Top representatives by Torchlight (for narrative color — still center on sector averages): ${topTickers}.`,
    '',
    'RULES:',
    '1) Anchor on the sector averages block; cite "mean over k/N" where shown.',
    '2) Return ONLY valid JSON (no markdown) with keys:',
    '   sentiment (Bullish | Bearish | Neutral), confidence (0-100),',
    '   executive_summary (~70 words): sector valuation vs upside, typical risk, typical Torchlight posture.',
    '   valuation_view (~90 words): sector IV averages vs typical mark.',
    '   torchlight_view (~100 words): sector Torchlight averages and what they imply.',
    '   risk_view (~90 words): sector risk/return averages (Sharpe, drawdown, VaR, beta, vol).',
    '   market_catalysts — must be exactly this sentence: Sector aggregates only; no headline news in this prompt.',
    '   pros (3 strings) and cons (3 strings) — each cites specific averaged metrics from the block.',
    '   recommendation (~85 words): sector stance (not buy/sell on individual names).',
    '3) No external web/news. No invented figures.',
    '',
    'Output format: return only valid JSON with the keys listed above.',
  ].join('\n');
}

function normalizeLookupValue(v: string): string {
  return v.trim().toLowerCase().replace(/[\s\-_]+/g, ' ');
}

type AIAnalysisProps = {
  /** Signed-in user — watchlists load only when this is set (same as rest of app after login). */
  userId?: string | null;
};

/** Built-in directories for AI analysis. `none` = user has not chosen a universe yet. */
type AiMarketUniverse = 'none' | 'watchlist' | 'sp500' | 'nasdaq' | 'forex' | 'commodity';

const COMMODITY_TICKERS: { symbol: string; name: string }[] = [
  { symbol: 'GOLD', name: 'Gold Bullion' },
  { symbol: 'SILVER', name: 'Silver Bullion' },
  { symbol: 'PLAT', name: 'Platinum' },
  { symbol: 'PALL', name: 'Palladium' },
  { symbol: 'COPPER', name: 'Copper Futures' },
  { symbol: 'CRUDE', name: 'WTI Crude Oil' },
  { symbol: 'NATGAS', name: 'Natural Gas' },
  { symbol: 'ALUM', name: 'Aluminum' },
  { symbol: 'NICK', name: 'Nickel' },
  { symbol: 'ZINC', name: 'Zinc' },
];

const NASDAQ_AI_SLICED = NASDAQ_TICKERS.slice(0, 400);

const SP500_SYMBOL_SET = new Set(SP500_TICKERS.map((s) => s.symbol.toUpperCase()));

function stubWatchlistRow(ticker: string, company: string, sector: string): WatchlistRow {
  return {
    ticker: ticker.toUpperCase(),
    company,
    sector,
  };
}

const AI_UNIVERSE_LABELS: Record<AiMarketUniverse, string> = {
  none: 'Choose universe',
  watchlist: 'Team watchlist',
  sp500: 'S&P 500',
  nasdaq: 'NASDAQ',
  forex: 'FOREX',
  commodity: 'Commodity',
};

/** Fixed basket for AI Analysis → FOREX: HMM + OHLC-only Sentinel run (matches user-requested majors). */
const AI_FOREX_HMM_PAIRS = [
  'EURUSD',
  'EURCHF',
  'USDCAD',
  'GBPUSD',
  'USDJPY',
  'GBPJPY',
] as const;

function forexHmmPairLabel(symbol: string): string {
  return FOREX_TICKERS.find((r) => r.symbol === symbol)?.name ?? symbol;
}

type ForexHmmBatchRow = {
  symbol: string;
  label: string;
  insight: InsightResponse | null;
  error?: string;
};

type InsightTarget = 'ticker' | 'sector';
type MarketInsightReportMeta = {
  scope: 'Ticker' | 'Sector';
  display: string;
  subject: string;
};

const AIAnalysis: React.FC<AIAnalysisProps> = ({ userId }) => {
  const [symbol, setSymbol] = useState(aiAnalysisUiMemory.symbol ?? '');
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<InsightResponse | null>(aiAnalysisUiMemory.insight ?? null);
  const [insightReportMeta, setInsightReportMeta] = useState<MarketInsightReportMeta | null>(
    aiAnalysisUiMemory.insightReportMeta ?? null
  );
  /** Deterministic IV / risk / Torchlight signals from the active watchlist row (instant, no LLM). */
  const [signalAnalysis, setSignalAnalysis] = useState<WatchlistSignalBundle | null>(null);
  const [error, setError] = useState('');
  const [watchlists, setWatchlists] = useState<DailyWatchlist[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>(aiAnalysisUiMemory.selectedWatchlistId ?? '');
  /** Team = Supabase daily_watchlist rows; library = saved uploads in this browser (see watchlistFileLibrary). */
  const [watchlistSnapshotSource, setWatchlistSnapshotSource] = useState<'team' | 'library'>(
    aiAnalysisUiMemory.watchlistSnapshotSource ?? 'team'
  );
  const [libraryRev, setLibraryRev] = useState(0);
  const [libraryUploadBusy, setLibraryUploadBusy] = useState(false);
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);
  const [watchlistRowsLoading, setWatchlistRowsLoading] = useState(false);
  const [marketUniverse, setMarketUniverse] = useState<AiMarketUniverse>(() =>
    aiAnalysisUiMemory.marketUniverse ?? (isSp500OnlyMode() ? 'sp500' : 'none'),
  );
  const [insightTarget, setInsightTarget] = useState<InsightTarget>(aiAnalysisUiMemory.insightTarget ?? 'ticker');
  const [selectedRowTicker, setSelectedRowTicker] = useState<string>(aiAnalysisUiMemory.selectedRowTicker ?? '');
  const [selectedSector, setSelectedSector] = useState<string>(aiAnalysisUiMemory.selectedSector ?? 'all');
  const [selectedSubsector, setSelectedSubsector] = useState<string>(aiAnalysisUiMemory.selectedSubsector ?? 'all');
  const [selectedCompanyTicker, setSelectedCompanyTicker] = useState<string>(
    aiAnalysisUiMemory.selectedCompanyTicker ?? 'all'
  );
  const [minRiskSummary, setMinRiskSummary] = useState<string>(aiAnalysisUiMemory.minRiskSummary ?? 'all');
  const [rankBy, setRankBy] = useState<'torchlight' | 'risk_summary'>(
    aiAnalysisUiMemory.rankBy ?? 'torchlight'
  );
  const [reportMode, setReportMode] = useState<'single' | 'portfolio'>('single');
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [returnsByTicker, setReturnsByTicker] = useState<Record<string, ReturnPoint[]>>({});
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [insightScope, setInsightScope] = useState<'Ticker' | 'Sector'>(aiAnalysisUiMemory.insightScope ?? 'Ticker');
  const [forexHmmLoading, setForexHmmLoading] = useState(false);
  const [forexHmmResults, setForexHmmResults] = useState<ForexHmmBatchRow[]>([]);
  const [watchlistConditionBrief, setWatchlistConditionBrief] = useState<TickerWatchlistConditionBrief | null>(null);
  const [watchlistConditionBriefLoading, setWatchlistConditionBriefLoading] = useState(false);
  const [watchlistConditionBriefError, setWatchlistConditionBriefError] = useState('');
  const [growthRiskDashboard, setGrowthRiskDashboard] = useState<GrowthRiskDashboardReport | null>(
    aiAnalysisUiMemory.growthRiskDashboard ?? null
  );
  const [growthRiskDashboardLoading, setGrowthRiskDashboardLoading] = useState(false);
  const [growthRiskDashboardError, setGrowthRiskDashboardError] = useState(
    aiAnalysisUiMemory.growthRiskDashboardError ?? ''
  );
  const [businessLifecycleReport, setBusinessLifecycleReport] = useState<IndustryLifecycleReport | null>(
    aiAnalysisUiMemory.businessLifecycleReport ?? null
  );
  const [industryLifecycleReport, setIndustryLifecycleReport] = useState<IndustryLifecycleReport | null>(
    aiAnalysisUiMemory.industryLifecycleReport ?? null
  );
  const [industryLifecycleReportKind, setIndustryLifecycleReportKind] = useState<'industry' | 'business' | 'leadership'>(
    aiAnalysisUiMemory.industryLifecycleReportKind ?? 'industry'
  );
  const [industryLifecycleLoading, setIndustryLifecycleLoading] = useState(false);
  const [industryLifecycleError, setIndustryLifecycleError] = useState(
    aiAnalysisUiMemory.industryLifecycleError ?? ''
  );
  const watchlistApiUrl = getDefaultWatchlistApiBase();

  const libraryEntries = useMemo(() => getWatchlistFileLibrary(), [libraryRev]);

  const bestLibraryMetricsByTicker = useMemo(() => {
    const best = new Map<string, WatchlistRow>();
    for (const entry of libraryEntries) {
      const rows = mapDailyItemsToWatchlistRows(snapshotToDailyWatchlistItems(entry.snapshot));
      for (const row of rows) {
        const ticker = row.ticker.toUpperCase();
        const current = best.get(ticker);
        if (!current || watchlistMetricCount(row) > watchlistMetricCount(current)) {
          best.set(ticker, row);
        }
      }
    }
    return best;
  }, [libraryEntries]);

  const aiUniverseSelectKeys = useMemo((): Exclude<AiMarketUniverse, 'none'>[] => {
    if (isSp500OnlyMode()) return ['watchlist', 'sp500'];
    return (Object.keys(AI_UNIVERSE_LABELS) as AiMarketUniverse[]).filter((k) => k !== 'none') as Exclude<
      AiMarketUniverse,
      'none'
    >[];
  }, []);

  useEffect(() => {
    aiAnalysisUiMemory.symbol = symbol;
    aiAnalysisUiMemory.selectedWatchlistId = selectedWatchlistId;
    aiAnalysisUiMemory.watchlistSnapshotSource = watchlistSnapshotSource;
    aiAnalysisUiMemory.marketUniverse = marketUniverse;
    aiAnalysisUiMemory.insightTarget = insightTarget;
    aiAnalysisUiMemory.selectedRowTicker = selectedRowTicker;
    aiAnalysisUiMemory.selectedSector = selectedSector;
    aiAnalysisUiMemory.selectedSubsector = selectedSubsector;
    aiAnalysisUiMemory.selectedCompanyTicker = selectedCompanyTicker;
    aiAnalysisUiMemory.minRiskSummary = minRiskSummary;
    aiAnalysisUiMemory.rankBy = rankBy;
    aiAnalysisUiMemory.insight = insight;
    aiAnalysisUiMemory.insightReportMeta = insightReportMeta;
    aiAnalysisUiMemory.insightScope = insightScope;
    aiAnalysisUiMemory.growthRiskDashboard = growthRiskDashboard;
    aiAnalysisUiMemory.growthRiskDashboardError = growthRiskDashboardError;
    aiAnalysisUiMemory.businessLifecycleReport = businessLifecycleReport;
    aiAnalysisUiMemory.industryLifecycleReport = industryLifecycleReport;
    aiAnalysisUiMemory.industryLifecycleReportKind = industryLifecycleReportKind;
    aiAnalysisUiMemory.industryLifecycleError = industryLifecycleError;
  }, [
    symbol,
    selectedWatchlistId,
    watchlistSnapshotSource,
    marketUniverse,
    insightTarget,
    selectedRowTicker,
    selectedSector,
    selectedSubsector,
    selectedCompanyTicker,
    minRiskSummary,
    rankBy,
    insight,
    insightReportMeta,
    insightScope,
    growthRiskDashboard,
    growthRiskDashboardError,
    businessLifecycleReport,
    industryLifecycleReport,
    industryLifecycleReportKind,
    industryLifecycleError,
  ]);

  useEffect(() => {
    if (watchlistSnapshotSource === 'team') {
      setSelectedWatchlistId((prev) => {
        if (watchlists.some((w) => w.id === prev)) return prev;
        return watchlists[0]?.id ?? '';
      });
      return;
    }
    setSelectedWatchlistId((prev) => {
      if (prev.startsWith(LOCAL_LIB_PREFIX)) {
        const id = prev.slice(LOCAL_LIB_PREFIX.length);
        if (libraryEntries.some((e) => e.id === id)) return prev;
      }
      const first = libraryEntries[0];
      return first ? `${LOCAL_LIB_PREFIX}${first.id}` : '';
    });
  }, [watchlistSnapshotSource, watchlists, libraryEntries]);

  const handleWatchlistLibraryUpload = async (file: File | null) => {
    if (!file) return;
    setLibraryUploadBusy(true);
    setError('');
    try {
      const snap = await parsePersonalWatchlistFile(file);
      const id = addWatchlistToLibrary(snap, file.name);
      setLibraryRev((n) => n + 1);
      setWatchlistSnapshotSource('library');
      setSelectedWatchlistId(`${LOCAL_LIB_PREFIX}${id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLibraryUploadBusy(false);
    }
  };

  const removeSelectedLibraryEntry = () => {
    if (!selectedWatchlistId.startsWith(LOCAL_LIB_PREFIX)) return;
    const id = selectedWatchlistId.slice(LOCAL_LIB_PREFIX.length);
    removeWatchlistFromLibrary(id);
    setLibraryRev((n) => n + 1);
    const rest = getWatchlistFileLibrary();
    setSelectedWatchlistId(rest[0] ? `${LOCAL_LIB_PREFIX}${rest[0].id}` : '');
  };

  useEffect(() => {
    if (marketUniverse === 'forex') {
      setError('');
      setSymbol('');
      setSelectedRowTicker('');
    } else {
      setForexHmmResults([]);
    }
  }, [marketUniverse]);

  useEffect(() => {
    if (!isSp500OnlyMode()) return;
    if (
      marketUniverse === 'none' ||
      marketUniverse === 'nasdaq' ||
      marketUniverse === 'forex' ||
      marketUniverse === 'commodity'
    ) {
      setMarketUniverse('sp500');
    }
  }, [marketUniverse]);

  useEffect(() => {
    const loadPortfolioItems = async () => {
      if (!userId) {
        setPortfolioItems([]);
        return;
      }
      try {
        const rows = await getPortfolio(userId);
        setPortfolioItems(rows);
      } catch {
        setPortfolioItems([]);
      }
    };
    void loadPortfolioItems();
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const loadLists = async () => {
      if (!userId) {
        if (!cancelled) {
          setWatchlists([]);
          setSelectedWatchlistId('');
        }
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        if (!cancelled) {
          setWatchlists([]);
          setSelectedWatchlistId('');
        }
        return;
      }
      try {
        const list = await getAllDailyWatchlists();
        if (cancelled) return;
        setWatchlists(list);
        setError(null);
        setSelectedWatchlistId((prev) => {
          if (list.length === 0) return '';
          if (prev && list.some((w) => w.id === prev)) return prev;
          return list[0].id;
        });
      } catch {
        if (!cancelled) setError('Could not load watchlists.');
      }
    };

    void loadLists();
    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange(() => {
      void loadLists();
    });

    const channel = supabase
      .channel('ai-analysis-daily-watchlist')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_watchlist' },
        () => {
          void loadLists();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_watchlist_items' },
        () => {
          void loadLists();
        }
      )
      .subscribe();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadLists();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const poll = window.setInterval(() => void loadLists(), 60000);
    return () => {
      cancelled = true;
      authSub.unsubscribe();
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(poll);
    };
  }, [userId]);

  /** When the user switches watchlist only — not when the list refreshes from Supabase realtime/poll. */
  useEffect(() => {
    setSelectedSector('all');
    setSelectedCompanyTicker('all');
    setMinRiskSummary('all');
    setSelectedRowTicker('');
    setSymbol('');
  }, [selectedWatchlistId]);

  useEffect(() => {
    setSelectedSector('all');
    setSelectedSubsector('all');
    setSelectedCompanyTicker('all');
    setMinRiskSummary('all');
    setSelectedRowTicker('');
    setSymbol('');
  }, [marketUniverse]);

  useEffect(() => {
    if (selectedWatchlistId.startsWith(LOCAL_LIB_PREFIX)) {
      const libId = selectedWatchlistId.slice(LOCAL_LIB_PREFIX.length);
      const entry = getWatchlistLibraryEntry(libId);
      if (!entry) {
        setWatchlistRows([]);
        return;
      }
      const loadFromLibrary = async () => {
        const symbols = (entry.snapshot.symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean);
        if (symbols.length === 0) {
          setWatchlistRows([]);
          return;
        }
        setWatchlistRowsLoading(true);
        try {
          const items = snapshotToDailyWatchlistItems(entry.snapshot);
          if (items.length > 0) {
            const rows: WatchlistRow[] = mapDailyItemsToWatchlistRows(items);
            const hasTorchlightOrCtr = rows.some(
              (row) => row.torchlight_score != null || row.ctr_total_return != null || row.ctr_annualized != null
            );
            if (hasTorchlightOrCtr) {
              setWatchlistRows(rows);
              return;
            }
          }
          const basicsByTicker = await getCompanyFundamentalsByTickers(symbols);
          let yahooData: any[] = [];
          try {
            yahooData = ((await fetchFinancialsBatchChunked(watchlistApiUrl, symbols)) as any[]) || [];
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (m.includes('Watchlist API')) setError(m);
            yahooData = [];
          }
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
              leader_name: typeof y.leader_name === 'string' ? y.leader_name : null,
              leader_title: typeof y.leader_title === 'string' ? y.leader_title : null,
              leader_total_pay: y.leader_total_pay != null ? Number(y.leader_total_pay) : null,
              leader_year_born: y.leader_year_born != null ? Number(y.leader_year_born) : null,
              officer_count: y.officer_count != null ? Number(y.officer_count) : null,
              held_percent_insiders: y.held_percent_insiders != null ? Number(y.held_percent_insiders) : null,
              held_percent_institutions: y.held_percent_institutions != null ? Number(y.held_percent_institutions) : null,
              audit_risk: y.audit_risk != null ? Number(y.audit_risk) : null,
              board_risk: y.board_risk != null ? Number(y.board_risk) : null,
              compensation_risk: y.compensation_risk != null ? Number(y.compensation_risk) : null,
              shareholder_rights_risk: y.shareholder_rights_risk != null ? Number(y.shareholder_rights_risk) : null,
              overall_risk: y.overall_risk != null ? Number(y.overall_risk) : null,
              current_price: typeof y.current_price === 'number' ? y.current_price : null,
              revenue_growth: y.revenue_growth != null ? Number(y.revenue_growth) : null,
              earnings_growth: y.earnings_growth != null ? Number(y.earnings_growth) : null,
              gross_margins: y.gross_margins != null ? Number(y.gross_margins) : null,
              profit_margins: y.profit_margins != null ? Number(y.profit_margins) : null,
              operating_margins: y.operating_margins != null ? Number(y.operating_margins) : null,
              ebitda_margins: y.ebitda_margins != null ? Number(y.ebitda_margins) : null,
              market_cap: y.market_cap != null ? Number(y.market_cap) : null,
              enterprise_value: y.enterprise_value != null ? Number(y.enterprise_value) : null,
              shares_outstanding: y.shares_outstanding != null ? Number(y.shares_outstanding) : null,
              average_volume: y.average_volume != null ? Number(y.average_volume) : null,
              recommendation_mean: y.recommendation_mean != null ? Number(y.recommendation_mean) : null,
              target_mean_price: y.target_mean_price != null ? Number(y.target_mean_price) : null,
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
              ctr_price_return: y.ctr_price_return != null ? Number(y.ctr_price_return) : null,
              ctr_cash_return: y.ctr_cash_return != null ? Number(y.ctr_cash_return) : null,
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
      void loadFromLibrary();
      return;
    }

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
          const rows: WatchlistRow[] = mapDailyItemsToWatchlistRows(savedItems);
          const hasTorchlightOrCtr = rows.some(
            (row) => row.torchlight_score != null || row.ctr_total_return != null || row.ctr_annualized != null
          );
          if (hasTorchlightOrCtr) {
            let enrichedRows = rows;
            try {
              const basicsByTicker = await getCompanyFundamentalsByTickers(symbols);
              let yahooByTicker: Record<string, any> = {};
              if (rows.some((row) => !(row.industry || basicsByTicker[row.ticker.toUpperCase()]?.industry))) {
                try {
                  const yahooData = ((await fetchFinancialsBatchChunked(watchlistApiUrl, symbols)) as any[]) || [];
                  yahooData.forEach((r: any) => {
                    const t = String(r?.ticker || '').toUpperCase();
                    if (t) yahooByTicker[t] = r;
                  });
                } catch (e) {
                  const m = e instanceof Error ? e.message : String(e);
                  if (m.includes('Watchlist API')) setError(m);
                }
              }
              enrichedRows = rows.map((row) => {
                const ticker = row.ticker.toUpperCase();
                const b = basicsByTicker[ticker];
                const y = yahooByTicker[ticker] || {};
                return {
                  ...row,
                  company: row.company || b?.company || y.short_name || '',
                  sector: row.sector || y.sector || b?.sector || '',
                  industry: row.industry || b?.industry || y.industry || '',
                  location: row.location || b?.location || '',
                };
              });
            } catch {
              enrichedRows = rows;
            }
            setWatchlistRows(enrichedRows);
            return;
          }
        }

        const basicsByTicker = await getCompanyFundamentalsByTickers(symbols);
        let yahooData: any[] = [];
        try {
          yahooData = ((await fetchFinancialsBatchChunked(watchlistApiUrl, symbols)) as any[]) || [];
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          if (m.includes('Watchlist API')) setError(m);
          yahooData = [];
        }
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
            leader_name: typeof y.leader_name === 'string' ? y.leader_name : null,
            leader_title: typeof y.leader_title === 'string' ? y.leader_title : null,
            leader_total_pay: y.leader_total_pay != null ? Number(y.leader_total_pay) : null,
            leader_year_born: y.leader_year_born != null ? Number(y.leader_year_born) : null,
            officer_count: y.officer_count != null ? Number(y.officer_count) : null,
            held_percent_insiders: y.held_percent_insiders != null ? Number(y.held_percent_insiders) : null,
            held_percent_institutions: y.held_percent_institutions != null ? Number(y.held_percent_institutions) : null,
            audit_risk: y.audit_risk != null ? Number(y.audit_risk) : null,
            board_risk: y.board_risk != null ? Number(y.board_risk) : null,
            compensation_risk: y.compensation_risk != null ? Number(y.compensation_risk) : null,
            shareholder_rights_risk: y.shareholder_rights_risk != null ? Number(y.shareholder_rights_risk) : null,
            overall_risk: y.overall_risk != null ? Number(y.overall_risk) : null,
            current_price: typeof y.current_price === 'number' ? y.current_price : null,
            revenue_growth: y.revenue_growth != null ? Number(y.revenue_growth) : null,
            earnings_growth: y.earnings_growth != null ? Number(y.earnings_growth) : null,
            gross_margins: y.gross_margins != null ? Number(y.gross_margins) : null,
            profit_margins: y.profit_margins != null ? Number(y.profit_margins) : null,
            operating_margins: y.operating_margins != null ? Number(y.operating_margins) : null,
            ebitda_margins: y.ebitda_margins != null ? Number(y.ebitda_margins) : null,
            market_cap: y.market_cap != null ? Number(y.market_cap) : null,
            enterprise_value: y.enterprise_value != null ? Number(y.enterprise_value) : null,
            shares_outstanding: y.shares_outstanding != null ? Number(y.shares_outstanding) : null,
            average_volume: y.average_volume != null ? Number(y.average_volume) : null,
            recommendation_mean: y.recommendation_mean != null ? Number(y.recommendation_mean) : null,
            target_mean_price: y.target_mean_price != null ? Number(y.target_mean_price) : null,
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
            ctr_price_return: y.ctr_price_return != null ? Number(y.ctr_price_return) : null,
            ctr_cash_return: y.ctr_cash_return != null ? Number(y.ctr_cash_return) : null,
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
  }, [selectedWatchlistId, watchlists, watchlistApiUrl, libraryRev]);

  const directoryStocks = useMemo(() => {
    switch (marketUniverse) {
      case 'nasdaq':
        return NASDAQ_AI_SLICED.map((s) => ({ symbol: s.symbol, name: s.name, sector: 'NASDAQ' }));
      case 'forex':
        return FOREX_TICKERS.map((s) => ({ symbol: s.symbol, name: s.name, sector: 'FOREX' }));
      case 'commodity':
        return COMMODITY_TICKERS.map((s) => ({ symbol: s.symbol, name: s.name, sector: 'Commodity' }));
      default:
        return [];
    }
  }, [marketUniverse]);

  const syntheticUniverseRows = useMemo(
    () => directoryStocks.map((s) => stubWatchlistRow(s.symbol, s.name, s.sector)),
    [directoryStocks],
  );

  const usesWatchlistData =
    marketUniverse === 'watchlist' || marketUniverse === 'sp500';

  /** For NASDAQ / Commodity, overlay metrics from the selected team watchlist snapshot when tickers match. */
  const enrichedWatchlistRows = useMemo(
    () => watchlistRows.map((row) => mergeMissingWatchlistMetrics(row, bestLibraryMetricsByTicker.get(row.ticker.toUpperCase()))),
    [watchlistRows, bestLibraryMetricsByTicker]
  );

  const enrichedDirectoryRows = useMemo(() => {
    if (marketUniverse !== 'nasdaq' && marketUniverse !== 'commodity') return syntheticUniverseRows;
    const by = new Map(enrichedWatchlistRows.map((r) => [r.ticker.toUpperCase(), r]));
    return syntheticUniverseRows.map((s) => {
      const w = by.get(s.ticker.toUpperCase());
      const fallback = bestLibraryMetricsByTicker.get(s.ticker.toUpperCase());
      return w ? (Object.assign({}, s, w) as WatchlistRow) : mergeMissingWatchlistMetrics(s, fallback);
    });
  }, [marketUniverse, syntheticUniverseRows, enrichedWatchlistRows, bestLibraryMetricsByTicker]);

  const activeRows = useMemo(() => {
    if (marketUniverse === 'none') return [];
    if (marketUniverse === 'watchlist') return enrichedWatchlistRows;
    if (marketUniverse === 'sp500') {
      return enrichedWatchlistRows.filter((r) => SP500_SYMBOL_SET.has(r.ticker.toUpperCase()));
    }
    return enrichedDirectoryRows;
  }, [marketUniverse, enrichedWatchlistRows, enrichedDirectoryRows]);

  const activeRowsLoading =
    usesWatchlistData || marketUniverse === 'nasdaq' || marketUniverse === 'commodity'
      ? watchlistRowsLoading
      : false;

  const universeReady = marketUniverse !== 'none';

  /** Snapshot / metrics source for equities — team Supabase or locally saved files (browser only). */
  const showWatchlistSnapshotPicker = universeReady && marketUniverse !== 'forex';

  /** Block ticker / table when watchlist or S&P mode has no snapshot data for the active source. */
  const watchlistUniverseDataMissing =
    usesWatchlistData &&
    ((watchlistSnapshotSource === 'team' && (!userId || watchlists.length === 0)) ||
      (watchlistSnapshotSource === 'library' && libraryEntries.length === 0));

  const sectorTrimmed: string[] = activeRows
    .map((r) => (r.sector || '').trim())
    .filter((s): s is string => s.length > 0);
  const sectorOptions: string[] = Array.from(new Set<string>(sectorTrimmed)).sort((a, b) => a.localeCompare(b));
  const subsectorOptions = useMemo(() => {
    if (selectedSector === 'all') return [] as string[];
    const industries = activeRows
      .filter((r) => (r.sector || '').trim() === selectedSector)
      .map((r) => inferredSubsector(r))
      .filter((s): s is string => s.length > 0);
    return Array.from(new Set<string>(industries)).sort((a, b) => a.localeCompare(b));
  }, [activeRows, selectedSector]);

  const subsectorsBySector = useMemo(() => {
    const groups = new Map<string, Map<string, number>>();
    for (const row of activeRows) {
      const sector = (row.sector || '').trim();
      const industry = inferredSubsector(row);
      if (!sector || !industry) continue;
      if (!groups.has(sector)) groups.set(sector, new Map<string, number>());
      const sectorIndustries = groups.get(sector)!;
      sectorIndustries.set(industry, (sectorIndustries.get(industry) || 0) + 1);
    }
    return Array.from(groups.entries())
      .map(([sector, industries]) => ({
        sector,
        industries: Array.from(industries.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.industries.length > 0)
      .sort((a, b) => a.sector.localeCompare(b.sector));
  }, [activeRows]);

  const sectorSubsectorSelectValue =
    selectedSector === 'all' || selectedSubsector === 'all'
      ? ''
      : `${selectedSector}|||${selectedSubsector}`;
  const selectedSectorSubsectorChoices =
    selectedSector === 'all'
      ? []
      : subsectorsBySector.find((group) => group.sector === selectedSector)?.industries ?? [];

  useEffect(() => {
    if (selectedSubsector === 'all') return;
    if (!subsectorOptions.includes(selectedSubsector)) {
      setSelectedSubsector('all');
    }
  }, [selectedSubsector, subsectorOptions]);

  const sectorSegmentRows = useMemo(() => {
    if (selectedSector === 'all') return [] as WatchlistRow[];
    return activeRows.filter((r) => {
      const matchesSector = (r.sector || '').trim() === selectedSector;
      const matchesSubsector = selectedSubsector === 'all' || inferredSubsector(r) === selectedSubsector;
      return matchesSector && matchesSubsector;
    });
  }, [activeRows, selectedSector, selectedSubsector]);

  const sectorSegmentLabel =
    selectedSector === 'all'
      ? 'Sector aggregate'
      : selectedSubsector === 'all'
        ? selectedSector
        : `${selectedSector} / ${selectedSubsector}`;

  const companyOptionRows = selectedSector === 'all' ? activeRows : sectorSegmentRows;
  const companyOptions = companyOptionRows
    .map((r) => ({ ticker: r.ticker, label: `${r.ticker} — ${r.company || 'Unknown'}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  /** Ticker dropdown value when it matches the active watchlist (else blank). */
  const marketTickerSelectValue = useMemo(() => {
    const u = symbol.trim().toUpperCase();
    if (!u || !activeRows.some((r) => r.ticker === u)) return '';
    return u;
  }, [symbol, activeRows]);

  const filteredRows = activeRows.filter((r) => {
    const matchesSector = selectedSector === 'all' || (r.sector || '').trim() === selectedSector;
    const matchesSubsector = selectedSubsector === 'all' || inferredSubsector(r) === selectedSubsector;
    const matchesCompany = selectedCompanyTicker === 'all' || r.ticker === selectedCompanyTicker;
    const minRisk = minRiskSummary === 'all' ? null : Number(minRiskSummary);
    const matchesRisk = minRisk == null || (r.risk_summary_score != null && r.risk_summary_score >= minRisk);
    return matchesSector && matchesSubsector && matchesCompany && matchesRisk;
  });
  const rankedRows = [...filteredRows].sort((a, b) => {
    const ak = rankBy === 'risk_summary' ? (a.risk_summary_score ?? -1) : (a.torchlight_score ?? -1);
    const bk = rankBy === 'risk_summary' ? (b.risk_summary_score ?? -1) : (b.torchlight_score ?? -1);
    return bk - ak;
  });
  const selectedRow = rankedRows.find((r) => r.ticker === selectedRowTicker) || rankedRows[0] || null;
  const growthRiskDashboardJobKey = useMemo(() => {
    if (insightTarget === 'ticker') {
      if (!selectedRow) return '';
      return [
        'ticker',
        watchlistSnapshotSource,
        selectedWatchlistId,
        selectedRow.ticker.toUpperCase(),
        selectedRow.current_price ?? 'na',
        selectedRow.iv_ensemble ?? 'na',
        selectedRow.iv_upside_pct ?? 'na',
        selectedRow.risk_summary_score ?? 'na',
        selectedRow.torchlight_score ?? 'na',
      ].join('|');
    }
    if (selectedSector === 'all') return '';
    return ['sector', watchlistSnapshotSource, selectedWatchlistId, sectorSegmentLabel, sectorSegmentRows.length].join('|');
  }, [
    insightTarget,
    selectedRow,
    selectedSector,
    sectorSegmentLabel,
    sectorSegmentRows.length,
    watchlistSnapshotSource,
    selectedWatchlistId,
  ]);

  useEffect(() => {
    if (marketUniverse === 'forex' || insightTarget !== 'ticker' || !selectedRow || watchlistUniverseDataMissing) {
      setSignalAnalysis(null);
      return;
    }
    setSignalAnalysis(deriveWatchlistSignalAnalysis(selectedRow));
  }, [marketUniverse, insightTarget, selectedRow, watchlistUniverseDataMissing]);

  const insightReportBuild = useMemo(() => {
    if (insight && insightReportMeta) {
      return {
        label: insightReportMeta.scope,
        subject: insightReportMeta.subject,
        display: insightReportMeta.display,
      };
    }
    if (insightScope === 'Ticker') {
      const t = symbol.trim().toUpperCase();
      return { label: 'Ticker', subject: t, display: t || '—' };
    }
    if (insightScope === 'Sector') {
      const name = selectedSector !== 'all' ? sectorSegmentLabel : symbol.trim() || 'Sector aggregate';
      return { label: 'Sector', subject: name.toUpperCase(), display: name.toUpperCase() };
    }
    return { label: '', subject: '', display: '' };
  }, [insight, insightReportMeta, insightScope, symbol, selectedSector, sectorSegmentLabel]);

  useEffect(() => {
    const loadReturns = async () => {
      if (reportMode !== 'portfolio' || rankedRows.length < 2) return;
      setReturnsLoading(true);
      try {
        const tickers = rankedRows.map((r) => r.ticker);
        const res = await fetchWatchlistApi(watchlistApiUrl, '/api/financials/returns-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers }),
        });
        let data: any[] = [];
        try {
          data = res.ok ? ((await readWatchlistJson<any[]>(res)) || []) : [];
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          if (m.includes('Watchlist API')) setError(m);
          data = [];
        }
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

  const marketInsightRows = useMemo(() => {
    if (selectedSector !== 'all') return sectorSegmentRows;
    return [] as WatchlistRow[];
  }, [selectedSector, sectorSegmentRows]);

  const marketInsightScopeLabel =
    selectedSector === 'all' ? 'select a sector or subsector' : sectorSegmentLabel;

  const marketInsights = useMemo(() => {
    if (!marketInsightRows.length) {
      return {
        ranked: [] as Array<{ row: WatchlistRow; score: number }>,
      };
    }
    const scored = marketInsightRows.map((row) => ({
      row,
      score: opportunityCompositeScore(row),
    }));
    const ranked = [...scored]
      .sort((a, b) => b.score - a.score)
      .map((x) => ({ row: x.row, score: x.score }));
    return { ranked };
  }, [marketInsightRows]);

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
    const dateSets = tickers.map((t) =>
      new Set<string>((returnsByTicker[t] || []).map((p) => p.date)),
    );
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

  const handleRunForexHmmBatch = async () => {
    setForexHmmLoading(true);
    setError('');
    setSignalAnalysis(null);
    setForexHmmResults([]);
    try {
      const rows = await Promise.all(
        AI_FOREX_HMM_PAIRS.map(async (sym) => {
          const label = forexHmmPairLabel(sym);
          try {
            const payload = await fetchForexSentinelContext(
              watchlistApiUrl,
              sym,
              { score: 0, confidence: 0 },
              { hmmAndFxDataOnly: true }
            );
            const data = await getForexSentinelInsight(payload, { ohlcHmmOnly: true });
            return { symbol: sym, label, insight: data } satisfies ForexHmmBatchRow;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { symbol: sym, label, insight: null, error: msg };
          }
        })
      );
      setForexHmmResults(rows);
    } finally {
      setForexHmmLoading(false);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (marketUniverse === 'forex') return;
    if (insightTarget === 'sector') {
      await handleSectorAnalyze();
      return;
    }
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

    setError('');
    if (preferredTickerRow) {
      const t = preferredTickerRow.ticker.toUpperCase();
      setSignalAnalysis(deriveWatchlistSignalAnalysis(preferredTickerRow));
      setInsightScope('Ticker');
      setSymbol(t);
    } else {
      setSignalAnalysis(null);
    }

    setLoading(true);

    try {
      if (preferredTickerRow) {
        const ticker = preferredTickerRow.ticker.toUpperCase();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        const todayNewsBundle = await fetchFinnhubCompanyNewsBundle(ticker, {
          daysBack: 0,
          maxArticles: 1,
        });
        const todayNewsBlock = promptBlockFromBundle(todayNewsBundle);
        const contextualPrompt = buildContextualInsightPrompt(ticker, preferredTickerRow, todayNewsBlock);
        const data = await getStockInsight(ticker, contextualPrompt, { maxOutputTokens: 6200 });
        setInsight(data);
        setInsightReportMeta({ scope: 'Ticker', subject: ticker, display: ticker });
      } else {
        const symbolUpper = rawInput.toUpperCase();
        const inputNorm = normalizeLookupValue(rawInput);
        const sectorMatch = sectorOptions.find((s) => normalizeLookupValue(s) === inputNorm);
        if (sectorMatch) {
          const sectorRows = activeRows.filter((r) => (r.sector || '').trim() === sectorMatch);
          if (sectorRows.length === 0) {
            throw new Error(`No rows found for sector "${sectorMatch}" in the current symbol set.`);
          }
          const prompt = buildSectorInsightPrompt(sectorMatch, sectorRows);
          const data = await getStockInsight(sectorMatch.toUpperCase(), prompt, { maxOutputTokens: 1550 });
          setInsight(data);
          setInsightScope('Sector');
          setInsightReportMeta({ scope: 'Sector', subject: sectorMatch.toUpperCase(), display: sectorMatch.toUpperCase() });
        } else {
          throw new Error('Select a ticker from the loaded watchlist table to run watchlist-only condition and risk analysis.');
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
    if (marketUniverse === 'forex') {
      setError('Sector insight is for equities. Use ticker insight for forex pairs.');
      return;
    }
    if (selectedSector === 'all') {
      setError('Select a specific sector first, then click Generate Sector Insight.');
      return;
    }
    setSignalAnalysis(null);
    setInsightTarget('sector');
    setLoading(true);
    setError('');
    try {
      const sectorRows = sectorSegmentRows;
      if (sectorRows.length === 0) {
        throw new Error(`No rows found for "${sectorSegmentLabel}" in the current symbol set.`);
      }
      const prompt = buildSectorInsightPrompt(sectorSegmentLabel, sectorRows);
      const data = await getStockInsight(sectorSegmentLabel.toUpperCase(), prompt, { maxOutputTokens: 1550 });
      setInsight(data);
      setInsightScope('Sector');
      setInsightReportMeta({
        scope: 'Sector',
        subject: sectorSegmentLabel.toUpperCase(),
        display: sectorSegmentLabel.toUpperCase(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not fetch sector analysis. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setWatchlistConditionBrief(null);
    setWatchlistConditionBriefError('');
  }, [selectedRow?.ticker, selectedSector, selectedSubsector, insightTarget]);

  useEffect(() => {
    if (!growthRiskDashboardJobKey) {
      setGrowthRiskDashboardLoading(false);
      return;
    }

    const syncJob = () => {
      const job = growthRiskReportJobs.get(growthRiskDashboardJobKey);
      if (!job) {
        setGrowthRiskDashboardLoading(false);
        return;
      }
      if (job.status === 'pending') {
        setGrowthRiskDashboardLoading(true);
        setGrowthRiskDashboardError('');
        return;
      }
      setGrowthRiskDashboardLoading(false);
      if (job.status === 'done' && job.report) {
        setGrowthRiskDashboard(job.report);
        setGrowthRiskDashboardError('');
      } else if (job.status === 'error') {
        setGrowthRiskDashboardError(job.error || 'Could not generate growth & risk report.');
      }
    };

    syncJob();
    return subscribeGrowthRiskReportJobs(syncJob);
  }, [growthRiskDashboardJobKey]);

  useEffect(() => {
    if (!growthRiskDashboard) return;
    const el = document.getElementById('growth-risk-llm-report');
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [growthRiskDashboard]);

  const handleWatchlistConditionBrief = useCallback(async () => {
    if (marketUniverse === 'forex') {
      setWatchlistConditionBriefError('Watchlist condition brief is for equities only.');
      return;
    }
    if (watchlistUniverseDataMissing) {
      setWatchlistConditionBriefError('Load a watchlist snapshot before generating this brief.');
      return;
    }
    if (!selectedRow) {
      setWatchlistConditionBriefError('Select a row in the watchlist table first.');
      return;
    }
    setWatchlistConditionBriefLoading(true);
    setWatchlistConditionBriefError('');
    try {
      const dataBlock = buildWatchlistQuantitativeDataBlock(selectedRow);
      const brief = await getTickerWatchlistConditionBrief(
        selectedRow.ticker,
        selectedRow.company || selectedRow.ticker,
        dataBlock,
        900,
      );
      setWatchlistConditionBrief(brief);
    } catch (err) {
      setWatchlistConditionBrief(null);
      setWatchlistConditionBriefError(
        err instanceof Error ? err.message : 'Could not generate watchlist condition brief.',
      );
    } finally {
      setWatchlistConditionBriefLoading(false);
    }
  }, [marketUniverse, selectedRow, watchlistUniverseDataMissing]);

  const handleGrowthRiskDashboard = useCallback(() => {
    if (marketUniverse === 'forex') {
      setGrowthRiskDashboardError('Growth & risk report is for equities only.');
      return;
    }
    if (watchlistUniverseDataMissing) {
      setGrowthRiskDashboardError('Load a watchlist snapshot before generating this report.');
      return;
    }
    if (!growthRiskDashboardJobKey) {
      setGrowthRiskDashboardError('Select a ticker or sector first.');
      return;
    }
    setGrowthRiskDashboardLoading(true);
    setGrowthRiskDashboardError('');

    if (insightTarget === 'ticker') {
      if (!selectedRow) {
        setGrowthRiskDashboard(null);
        setGrowthRiskDashboardError('Select a ticker first.');
        setGrowthRiskDashboardLoading(false);
        return;
      }
      const tickerRow = selectedRow;
      const job = startGrowthRiskReportJob(growthRiskDashboardJobKey, async () => {
        const dataBlock = await buildTickerGrowthRiskContextBlock(tickerRow, watchlistApiUrl);
        return getGrowthRiskDashboard(
          'ticker',
          tickerRow.ticker.toUpperCase(),
          tickerRow.company || tickerRow.ticker,
          dataBlock,
          4200,
        );
      });
      if (job.status === 'done' && job.report) {
        setGrowthRiskDashboard(job.report);
        setGrowthRiskDashboardLoading(false);
      } else if (job.status === 'error') {
        setGrowthRiskDashboard(null);
        setGrowthRiskDashboardError(job.error || 'Could not generate growth & risk report.');
        setGrowthRiskDashboardLoading(false);
      }
      return;
    }

    if (selectedSector === 'all') {
      setGrowthRiskDashboard(null);
      setGrowthRiskDashboardError('Select a sector first.');
      setGrowthRiskDashboardLoading(false);
      return;
    }
    const sectorRows = sectorSegmentRows;
    if (sectorRows.length === 0) {
      setGrowthRiskDashboard(null);
      setGrowthRiskDashboardError(`No symbols in "${sectorSegmentLabel}" for this universe.`);
      setGrowthRiskDashboardLoading(false);
      return;
    }
    const rowsForJob = sectorRows;
    const sectorName = sectorSegmentLabel;
    const job = startGrowthRiskReportJob(growthRiskDashboardJobKey, async () => {
      const dataBlock = buildSectorAggregateMetricsBlock(sectorName, rowsForJob);
      return getGrowthRiskDashboard(
        'sector',
        sectorName,
        `${rowsForJob.length} constituents in current universe`,
        dataBlock,
        2600,
      );
    });
    if (job.status === 'done' && job.report) {
      setGrowthRiskDashboard(job.report);
      setGrowthRiskDashboardLoading(false);
    } else if (job.status === 'error') {
      setGrowthRiskDashboard(null);
      setGrowthRiskDashboardError(job.error || 'Could not generate growth & risk report.');
      setGrowthRiskDashboardLoading(false);
    }
  }, [
    marketUniverse,
    insightTarget,
    selectedRow,
    selectedSector,
    sectorSegmentRows,
    sectorSegmentLabel,
    watchlistUniverseDataMissing,
    watchlistApiUrl,
    growthRiskDashboardJobKey,
  ]);

  const handleIndustryLifecycleAnalysis = useCallback(async () => {
    if (marketUniverse === 'forex') {
      setIndustryLifecycleError('Lifecycle analysis is for equity tickers, sectors, and subsectors only.');
      return;
    }
    if (watchlistUniverseDataMissing) {
      setIndustryLifecycleError('Load a watchlist snapshot before generating lifecycle analysis.');
      return;
    }

    setIndustryLifecycleLoading(true);
    setIndustryLifecycleError('');
    try {
      const isBusinessLifecycle = insightTarget === 'ticker';
      const rows = isBusinessLifecycle ? (selectedRow ? [selectedRow] : []) : sectorSegmentRows;
      const subjectLabel = isBusinessLifecycle
        ? selectedRow
          ? `${selectedRow.ticker} / ${selectedRow.company || selectedRow.ticker}`
          : ''
        : sectorSegmentLabel;
      if (rows.length === 0 || !subjectLabel) {
        throw new Error(
          isBusinessLifecycle
            ? 'Select a ticker first.'
            : `No symbols in "${sectorSegmentLabel}" for this universe.`
        );
      }
      if (!isBusinessLifecycle && selectedSector === 'all') {
        throw new Error('Select a sector or subsector first.');
      }

      let yahooRows: unknown[] = [];
      let yahooError = '';
      try {
        yahooRows = await fetchFinancialsBatchChunked(
          watchlistApiUrl,
          rows.map((r) => r.ticker),
          isBusinessLifecycle ? 1 : 8
        );
      } catch (err) {
        yahooError = err instanceof Error ? err.message : String(err);
      }
      const dataBlock =
        isBusinessLifecycle && selectedRow
          ? buildBusinessLifecycleDataBlock(selectedRow, yahooRows, yahooError)
          : buildIndustryLifecycleDataBlock(sectorSegmentLabel, rows, yahooRows, yahooError);
      const report = await getIndustryLifecycleAnalysis(subjectLabel, dataBlock, 3600);
      if (isBusinessLifecycle) {
        setBusinessLifecycleReport(report);
      } else {
        setIndustryLifecycleReport(report);
        setIndustryLifecycleReportKind('industry');
      }
    } catch (err) {
      if (insightTarget === 'ticker') {
        setBusinessLifecycleReport(null);
      } else {
        setIndustryLifecycleReport(null);
      }
      setIndustryLifecycleError(
        err instanceof Error ? err.message : 'Could not generate lifecycle analysis.'
      );
    } finally {
      setIndustryLifecycleLoading(false);
    }
  }, [
    marketUniverse,
    insightTarget,
    selectedRow,
    selectedSector,
    sectorSegmentRows,
    sectorSegmentLabel,
    watchlistUniverseDataMissing,
    watchlistApiUrl,
  ]);

  const handleLeadershipLifecycleAnalysis = useCallback(async () => {
    if (marketUniverse === 'forex') {
      setIndustryLifecycleError('Leadership lifecycle analysis is for equity tickers only.');
      return;
    }
    if (watchlistUniverseDataMissing) {
      setIndustryLifecycleError('Load a watchlist snapshot before generating leadership lifecycle analysis.');
      return;
    }
    if (!selectedRow) {
      setIndustryLifecycleError('Select a ticker first.');
      return;
    }

    setIndustryLifecycleLoading(true);
    setIndustryLifecycleError('');
    try {
      let yahooRows: unknown[] = [];
      let yahooError = '';
      try {
        yahooRows = await fetchFinancialsBatchChunked(watchlistApiUrl, [selectedRow.ticker], 1);
      } catch (err) {
        yahooError = err instanceof Error ? err.message : String(err);
      }
      const dataBlock = buildLeadershipLifecycleDataBlock(selectedRow, yahooRows, yahooError);
      const leaderName =
        String((yahooRows[0] as Record<string, unknown> | undefined)?.leader_name || selectedRow.leader_name || '').trim();
      const subjectLabel = `${selectedRow.ticker} / ${selectedRow.company || selectedRow.ticker}${
        leaderName ? ` / ${leaderName}` : ''
      }`;
      const report = await getLeadershipLifecycleAnalysis(subjectLabel, dataBlock, 3600);
      setIndustryLifecycleReport(report);
      setIndustryLifecycleReportKind('leadership');
    } catch (err) {
      setIndustryLifecycleReport(null);
      setIndustryLifecycleError(
        err instanceof Error ? err.message : 'Could not generate leadership lifecycle analysis.'
      );
    } finally {
      setIndustryLifecycleLoading(false);
    }
  }, [marketUniverse, selectedRow, watchlistUniverseDataMissing, watchlistApiUrl]);

  const hasCurrentGrowthRiskTarget =
    (insightTarget === 'ticker' && selectedRow) || (insightTarget === 'sector' && selectedSector !== 'all');
  const showGeneratedReportsPanel =
    marketUniverse !== 'forex' &&
    !watchlistUniverseDataMissing &&
    (Boolean(hasCurrentGrowthRiskTarget) ||
      growthRiskDashboard != null ||
      businessLifecycleReport != null ||
      industryLifecycleReport != null ||
      growthRiskDashboardLoading ||
      industryLifecycleLoading);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-gradient-to-br from-indigo-900 to-indigo-700 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
        {/* Abstract background blobs */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full blur-3xl opacity-20 -mr-32 -mt-32"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500 rounded-full blur-3xl opacity-10 -ml-24 -mb-24"></div>
        
        <div className="relative z-10 space-y-4">
          {marketUniverse !== 'forex' ? (
            <div className="text-center">
              <h2 className="text-3xl font-bold">Smart AI Market Intelligence</h2>
              <p className="text-indigo-100 max-w-lg mx-auto">
                {universeReady
                  ? isSp500OnlyMode()
                    ? 'S&P 500 scope: use team watchlist (index members only) or the full team list, then pick a ticker or sector.'
                    : 'Pick a ticker from the loaded watchlist table, or run a sector-style query from the table filters below.'
                  : isSp500OnlyMode()
                    ? 'Loading watchlist data for S&P 500 analysis…'
                    : 'Choose a symbol universe to continue.'}
              </p>
            </div>
          ) : null}

          <div className="max-w-2xl mx-auto text-left">
            <label className="block text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">
              Symbol universe
            </label>
            <select
              value={isSp500OnlyMode() ? marketUniverse : marketUniverse === 'none' ? '' : marketUniverse}
              onChange={(e) => {
                const v = e.target.value;
                setMarketUniverse(v === '' ? 'none' : (v as Exclude<AiMarketUniverse, 'none'>));
              }}
              className="w-full px-3 py-2.5 rounded-xl border border-white/25 bg-white/15 text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-400/50 outline-none"
            >
              {!isSp500OnlyMode() ? (
                <option value="" className="text-slate-900">
                  Choose…
                </option>
              ) : null}
              {aiUniverseSelectKeys.map((key) => (
                <option key={key} value={key} className="text-slate-900">
                  {AI_UNIVERSE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          {universeReady && marketUniverse === 'forex' ? (
            <div className="flex justify-center pt-6">
              <button
                type="button"
                onClick={handleRunForexHmmBatch}
                disabled={forexHmmLoading}
                className="bg-emerald-500 hover:bg-emerald-400 text-white px-10 py-4 rounded-2xl font-bold text-lg shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {forexHmmLoading ? 'Running HMM…' : 'Run HMM'}
              </button>
            </div>
          ) : null}

          {showWatchlistSnapshotPicker ? (
            <div className="max-w-2xl mx-auto text-left space-y-3">
              <label className="block text-[10px] font-black text-indigo-200 uppercase tracking-widest">
                Watchlist data source
              </label>
              <div className="inline-flex rounded-xl border border-white/25 bg-white/10 p-0.5">
                <button
                  type="button"
                  onClick={() => setWatchlistSnapshotSource('team')}
                  className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    watchlistSnapshotSource === 'team'
                      ? 'bg-white text-indigo-900 shadow'
                      : 'text-indigo-100 hover:bg-white/10'
                  }`}
                >
                  Team (server)
                </button>
                <button
                  type="button"
                  onClick={() => setWatchlistSnapshotSource('library')}
                  className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    watchlistSnapshotSource === 'library'
                      ? 'bg-white text-indigo-900 shadow'
                      : 'text-indigo-100 hover:bg-white/10'
                  }`}
                >
                  My saved files
                </button>
              </div>
              {(marketUniverse === 'nasdaq' || marketUniverse === 'commodity') ? (
                <p className="text-[10px] text-indigo-200/90">
                  Optional: directory rows merge metrics from this snapshot when symbols match.
                </p>
              ) : null}
              {marketUniverse === 'sp500' ? (
                <p className="text-[10px] text-indigo-200/90">
                  For S&amp;P mode, only symbols that are S&amp;P 500 constituents in the snapshot appear in the browse table.
                </p>
              ) : null}

              {watchlistSnapshotSource === 'team' ? (
                <div className="space-y-2">
                  {!userId || watchlists.length === 0 ? (
                    <p className="text-xs text-amber-200/95 font-medium">
                      Sign in to load team snapshots from the server, or switch to <span className="font-black">My saved files</span> to use
                      JSON/CSV stored on this device.
                    </p>
                  ) : (
                    <>
                      {selectedWatchlistId === watchlists[0]?.id ? (
                        <p className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wide">
                          Latest snapshot · ordered by publish time
                        </p>
                      ) : null}
                      <select
                        value={selectedWatchlistId}
                        onChange={(e) => setSelectedWatchlistId(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-white/25 bg-white/15 text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-400/50 outline-none"
                      >
                        {watchlists.map((w) => (
                          <option key={w.id} value={w.id} className="text-slate-900">
                            {watchlistSelectOptionText(w)}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-indigo-200/90">
                    Select an uploaded snapshot below, then use <span className="font-semibold text-white">Upload file</span> to add more.
                    Files stay in this browser only.
                  </p>
                  <select
                    value={
                      libraryEntries.length === 0
                        ? ''
                        : selectedWatchlistId.startsWith(LOCAL_LIB_PREFIX)
                          ? selectedWatchlistId
                          : `${LOCAL_LIB_PREFIX}${libraryEntries[0].id}`
                    }
                    onChange={(e) => setSelectedWatchlistId(e.target.value)}
                    disabled={libraryEntries.length === 0}
                    className="w-full px-3 py-2.5 rounded-xl border border-white/25 bg-white/15 text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-400/50 outline-none disabled:opacity-50"
                  >
                    {libraryEntries.length === 0 ? (
                      <option value="" className="text-slate-900">
                        No files yet — upload below
                      </option>
                    ) : (
                      libraryEntries.map((e) => (
                        <option key={e.id} value={`${LOCAL_LIB_PREFIX}${e.id}`} className="text-slate-900">
                          {e.displayName} · {new Date(e.savedAt).toLocaleString()} · {e.snapshot.symbols.length} symbols
                        </option>
                      ))
                    )}
                  </select>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500/30">
                      {libraryUploadBusy ? 'Reading…' : 'Upload file'}
                      <input
                        type="file"
                        accept=".json,.csv,application/json,text/csv"
                        className="hidden"
                        disabled={libraryUploadBusy}
                        onChange={(ev) => {
                          const f = ev.target.files?.[0] ?? null;
                          ev.target.value = '';
                          void handleWatchlistLibraryUpload(f);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={libraryEntries.length === 0 || !selectedWatchlistId.startsWith(LOCAL_LIB_PREFIX)}
                      onClick={removeSelectedLibraryEntry}
                      className="rounded-lg border border-white/30 px-3 py-2 text-xs font-bold text-indigo-100 hover:bg-white/10 disabled:opacity-40"
                    >
                      Remove selected
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {universeReady && marketUniverse !== 'forex' && watchlistUniverseDataMissing ? (
            <p className="text-center text-indigo-200/90 text-sm font-medium max-w-lg mx-auto">
              {watchlistSnapshotSource === 'team'
                ? 'No team watchlists — sign in as a user with access, or switch to My saved files and upload a JSON/CSV snapshot.'
                : 'No saved files yet — choose My saved files and upload a watchlist snapshot (same format as the CLI export).'}
            </p>
          ) : null}

          {universeReady && marketUniverse !== 'forex' && !watchlistUniverseDataMissing ? (
            <div className="max-w-2xl mx-auto text-left space-y-3">
              <div>
                <label className="block text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">
                  Report target
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/20 bg-white/10 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setInsightTarget('ticker');
                      setInsightScope('Ticker');
                    }}
                    className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                      insightTarget === 'ticker'
                        ? 'bg-white text-indigo-900 shadow'
                        : 'text-indigo-100 hover:bg-white/10'
                    }`}
                  >
                    Single ticker
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInsightTarget('sector');
                      setInsightScope('Sector');
                      setSignalAnalysis(null);
                    }}
                    className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                      insightTarget === 'sector'
                        ? 'bg-white text-indigo-900 shadow'
                        : 'text-indigo-100 hover:bg-white/10'
                    }`}
                  >
                    Sector / subsector
                  </button>
                </div>
              </div>

              {insightTarget === 'ticker' ? (
                <div>
                  <label className="block text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">
                    Ticker
                    {marketUniverse !== 'none' && marketUniverse !== 'watchlist' ? (
                      <span className="text-indigo-200/70 font-semibold normal-case tracking-normal">
                        {' '}
                        ({AI_UNIVERSE_LABELS[marketUniverse]})
                      </span>
                    ) : null}
                  </label>
                  <select
                    value={marketTickerSelectValue}
                    disabled={activeRowsLoading || companyOptions.length === 0}
                    onChange={(e) => {
                      const t = e.target.value;
                      if (!t) {
                        setSymbol('');
                        setSelectedRowTicker('');
                        setSelectedCompanyTicker('all');
                        return;
                      }
                      setInsightTarget('ticker');
                      setSymbol(t);
                      setSelectedRowTicker(t);
                      setSelectedCompanyTicker(t);
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-white/25 bg-white/15 text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-400/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="" className="text-slate-900">
                      {activeRowsLoading ? 'Loading symbols…' : 'Select a ticker…'}
                    </option>
                    {companyOptions.map((c) => (
                      <option key={c.ticker} value={c.ticker} className="text-slate-900">
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                  <label className="block text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">
                    Main sector
                  </label>
                  <select
                    value={selectedSector}
                    disabled={activeRowsLoading || sectorOptions.length === 0}
                    onChange={(e) => {
                      setInsightTarget('sector');
                      setSelectedSector(e.target.value);
                      setSelectedSubsector('all');
                      setSelectedRowTicker('');
                      setSelectedCompanyTicker('all');
                      setSignalAnalysis(null);
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-white/25 bg-white/15 text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-400/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="all" className="text-slate-900">
                      {activeRowsLoading ? 'Loading sectors…' : 'Select main sector…'}
                    </option>
                    {sectorOptions.map((s) => (
                      <option key={s} value={s} className="text-slate-900">
                        {s}
                      </option>
                    ))}
                  </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">
                      Subsector from selected main sector
                    </label>
                    <select
                      value={selectedSubsector}
                      disabled={activeRowsLoading || selectedSector === 'all' || subsectorOptions.length === 0}
                      onChange={(e) => {
                        setInsightTarget('sector');
                        setSelectedSubsector(e.target.value);
                        setSelectedRowTicker('');
                        setSelectedCompanyTicker('all');
                        setSignalAnalysis(null);
                      }}
                      className="w-full px-3 py-2.5 rounded-xl border border-white/25 bg-white/15 text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-400/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="all" className="text-slate-900">
                        {selectedSector === 'all'
                          ? 'Select a sector first'
                          : subsectorOptions.length === 0
                            ? 'No subsectors in this sector'
                            : 'All subsectors in this sector'}
                      </option>
                      {subsectorOptions.map((s) => (
                        <option key={s} value={s} className="text-slate-900">
                          {s}
                        </option>
                      ))}
                    </select>
                    {selectedSector !== 'all' ? (
                      <p className="mt-1 text-[10px] text-indigo-200/85">
                        {sectorSegmentRows.length} symbol{sectorSegmentRows.length === 1 ? '' : 's'} selected for{' '}
                        <span className="font-semibold text-white">{sectorSegmentLabel}</span>.
                      </p>
                    ) : null}
                    {selectedSector !== 'all' ? (
                      selectedSectorSubsectorChoices.length > 0 ? (
                        <div className="mt-2 rounded-xl border border-white/15 bg-white/10 p-2">
                          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-indigo-200">
                            Visible subsectors in {selectedSector}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSubsector('all');
                                setSelectedCompanyTicker('all');
                              }}
                              className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${
                                selectedSubsector === 'all'
                                  ? 'bg-white text-indigo-900 shadow'
                                  : 'bg-white/10 text-indigo-100 hover:bg-white/20'
                              }`}
                            >
                              All subsectors ({activeRows.filter((r) => (r.sector || '').trim() === selectedSector).length})
                            </button>
                            {selectedSectorSubsectorChoices.map((industry) => (
                              <button
                                key={industry.name}
                                type="button"
                                onClick={() => {
                                  setInsightTarget('sector');
                                  setSelectedSubsector(industry.name);
                                  setSelectedRowTicker('');
                                  setSelectedCompanyTicker('all');
                                  setSignalAnalysis(null);
                                }}
                                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${
                                  selectedSubsector === industry.name
                                    ? 'bg-emerald-400 text-emerald-950 shadow'
                                    : 'bg-white/10 text-indigo-100 hover:bg-white/20'
                                }`}
                              >
                                {industry.name} ({industry.count})
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-[11px] font-semibold text-amber-100">
                          This sector has no industry/subsector values in the loaded snapshot.
                        </p>
                      )
                    ) : null}
                  </div>
                  {subsectorsBySector.length > 0 ? (
                    <div>
                      <label className="block text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">
                        Quick select subsector by sector
                      </label>
                      <select
                        value={sectorSubsectorSelectValue}
                        disabled={activeRowsLoading}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (!value) return;
                          const [sector, subsector] = value.split('|||');
                          setInsightTarget('sector');
                          setSelectedSector(sector);
                          setSelectedSubsector(subsector);
                          setSelectedRowTicker('');
                          setSelectedCompanyTicker('all');
                          setSignalAnalysis(null);
                        }}
                        className="w-full px-3 py-2.5 rounded-xl border border-white/25 bg-white/15 text-white text-sm font-semibold focus:ring-2 focus:ring-emerald-400/50 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="" className="text-slate-900">
                          Choose a subsector from any sector…
                        </option>
                        {subsectorsBySector.map((group) => (
                          <optgroup key={group.sector} label={group.sector} className="text-slate-900">
                            {group.industries.map((industry) => (
                              <option key={`${group.sector}-${industry.name}`} value={`${group.sector}|||${industry.name}`}>
                                {industry.name} ({industry.count})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {universeReady && marketUniverse !== 'forex' ? (
            <form onSubmit={handleAnalyze} className="max-w-md mx-auto flex items-center bg-white/10 backdrop-blur-md p-2 rounded-2xl border border-white/20">
              <input
                type="text"
                value={symbol}
                onChange={(e) => {
                  setInsightTarget('ticker');
                  setSymbol(e.target.value);
                }}
                placeholder={insightTarget === 'sector' ? 'Select a sector above' : 'e.g. MSFT'}
                disabled={insightTarget === 'sector'}
                className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-indigo-200 px-4 py-3 font-medium uppercase"
              />
              <button
                disabled={loading}
                className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-xl font-bold transition-all disabled:opacity-50"
              >
                {loading ? 'Analyzing...' : insightTarget === 'sector' ? 'Generate Sector Report' : 'Generate Ticker Report'}
              </button>
            </form>
          ) : null}

          {universeReady && marketUniverse !== 'forex' ? (
            <p className="text-center text-[11px] text-indigo-200/85 max-w-xl mx-auto leading-relaxed px-2">
              Choose <span className="font-semibold text-white/95">Single ticker</span> for one company or{' '}
              <span className="font-semibold text-white/95">Whole sector</span> for a sector aggregate report. Sector
              reports use every symbol in that sector from the current universe.
            </p>
          ) : null}
        </div>
      </div>

      {universeReady && marketUniverse === 'forex' && forexHmmResults.length > 0 ? (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-slate-900 font-bold uppercase tracking-widest text-sm mb-1">HMM strategy (OHLC + HMM)</h3>
            <p className="text-xs text-slate-500 mb-4">
              Pairs use the same IDs as OHLC folders: EURUSD, EURCHF, USDCAD, GBPUSD, USDJPY, GBPJPY — Forex Sentinel Alpha (sentiment excluded from blend).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {forexHmmResults.map((row) => (
                <div
                  key={row.symbol}
                  className="border border-slate-100 rounded-2xl p-5 bg-slate-50/80"
                >
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <div>
                      <h4 className="text-lg font-black text-indigo-800 font-mono tracking-tight">{row.symbol}</h4>
                      <p className="text-[11px] text-slate-500 font-medium">{row.label}</p>
                    </div>
                  </div>
                  {row.error ? (
                    <p className="text-sm text-rose-700 font-medium">{row.error}</p>
                  ) : row.insight ? (
                    <div className="space-y-3 text-sm">
                      <p>
                        <span className="font-bold text-slate-800">{row.insight.sentiment}</span>
                        <span className="text-slate-500">
                          {' '}
                          · {row.insight.confidence}% confidence
                        </span>
                      </p>
                      <p className="text-slate-700 leading-relaxed">{row.insight.recommendation}</p>
                      <p className="text-slate-600 text-xs leading-relaxed">{row.insight.summary}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {universeReady && marketUniverse !== 'forex' ? (
      <>
      {/* Browse symbols — team watchlists or built-in directories */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <h3 className="text-slate-900 font-bold uppercase tracking-widest text-sm mb-2">
          {marketUniverse === 'watchlist'
            ? 'All watchlists'
            : marketUniverse === 'sp500'
              ? 'Browse · S&P 500 (from watchlist)'
              : `Browse · ${marketUniverse !== 'none' ? AI_UNIVERSE_LABELS[marketUniverse] : ''}`}
        </h3>
        <p className="text-slate-500 text-xs font-medium mb-4">
          {marketUniverse === 'watchlist'
            ? 'Select a watchlist, then scroll rows and pick the company you want to analyze.'
            : marketUniverse === 'sp500'
              ? 'Uses the same daily snapshots as Team watchlist — only rows whose tickers are S&P 500 constituents appear here.'
              : marketUniverse === 'nasdaq' || marketUniverse === 'forex' || marketUniverse === 'commodity'
                ? 'Built-in symbol list — financial metrics below are populated when you use a team watchlist with saved fundamentals.'
                : ''}
        </p>

        {(marketUniverse !== 'watchlist' && marketUniverse !== 'sp500') ||
        watchlists.length > 0 ||
        (watchlistSnapshotSource === 'library' && libraryEntries.length > 0) ? (
          <div className="space-y-4">
            {(marketUniverse === 'watchlist' || marketUniverse === 'sp500') &&
            watchlistSnapshotSource === 'library' &&
            libraryEntries.length > 0 ? (
              <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Saved file</th>
                      <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Added</th>
                      <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Symbols</th>
                    </tr>
                  </thead>
                  <tbody>
                    {libraryEntries.map((e) => (
                      <tr
                        key={e.id}
                        className={`border-t border-slate-100 cursor-pointer ${
                          selectedWatchlistId === `${LOCAL_LIB_PREFIX}${e.id}` ? 'bg-indigo-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => {
                          setWatchlistSnapshotSource('library');
                          setSelectedWatchlistId(`${LOCAL_LIB_PREFIX}${e.id}`);
                        }}
                      >
                        <td className="px-3 py-2 font-bold text-indigo-700">{e.displayName}</td>
                        <td className="px-3 py-2 text-slate-600">{new Date(e.savedAt).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{e.snapshot.symbols.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {(marketUniverse === 'watchlist' || marketUniverse === 'sp500') &&
            watchlistSnapshotSource === 'team' &&
            watchlists.length > 0 ? (
              <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Published (local time)</th>
                      <th className="text-left px-3 py-2 font-black text-slate-500 uppercase">Calendar day</th>
                      <th className="text-right px-3 py-2 font-black text-slate-500 uppercase">Symbols</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlists.map((w) => (
                      <tr
                        key={w.id}
                        className={`border-t border-slate-100 cursor-pointer ${selectedWatchlistId === w.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                        onClick={() => {
                          setWatchlistSnapshotSource('team');
                          setSelectedWatchlistId(w.id);
                        }}
                      >
                        <td className="px-3 py-2 font-bold text-indigo-700">{w.label || buildWatchlistLabel(w.watchlist_date, w.created_at)}</td>
                        <td className="px-3 py-2 text-slate-600">{w.watchlist_date}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{(w.symbols || []).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="max-h-80 overflow-auto border border-slate-100 rounded-xl">
              <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row gap-3 md:items-end">
                <div className="min-w-[220px]">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Filter by main sector</label>
                  <select
                    value={selectedSector}
                    onChange={(e) => {
                      setSelectedSector(e.target.value);
                      setSelectedSubsector('all');
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white"
                  >
                    <option value="all">All sectors</option>
                    {sectorOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[220px]">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Filter by sector subsector</label>
                  <select
                    value={selectedSubsector}
                    disabled={selectedSector === 'all' || subsectorOptions.length === 0}
                    onChange={(e) => {
                      setSelectedSubsector(e.target.value);
                      setSelectedCompanyTicker('all');
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white disabled:opacity-50"
                  >
                    <option value="all">All subsectors in this sector</option>
                    {subsectorOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                {subsectorsBySector.length > 0 ? (
                  <div className="min-w-[260px]">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Pick subsector by sector</label>
                    <select
                      value={sectorSubsectorSelectValue}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        const [sector, subsector] = value.split('|||');
                        setSelectedSector(sector);
                        setSelectedSubsector(subsector);
                        setSelectedCompanyTicker('all');
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white"
                    >
                      <option value="">Choose subsector…</option>
                      {subsectorsBySector.map((group) => (
                        <optgroup key={group.sector} label={group.sector}>
                          {group.industries.map((industry) => (
                            <option key={`${group.sector}-${industry.name}`} value={`${group.sector}|||${industry.name}`}>
                              {industry.name} ({industry.count})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                ) : null}
                {selectedSector !== 'all' && selectedSectorSubsectorChoices.length > 0 ? (
                  <div className="basis-full rounded-xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Visible subsectors in {selectedSector}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSubsector('all');
                          setSelectedCompanyTicker('all');
                        }}
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${
                          selectedSubsector === 'all'
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        All subsectors ({activeRows.filter((r) => (r.sector || '').trim() === selectedSector).length})
                      </button>
                      {selectedSectorSubsectorChoices.map((industry) => (
                        <button
                          key={industry.name}
                          type="button"
                          onClick={() => {
                            setSelectedSubsector(industry.name);
                            setSelectedCompanyTicker('all');
                          }}
                          className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${
                            selectedSubsector === industry.name
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {industry.name} ({industry.count})
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
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
                  Showing {filteredRows.length} of {activeRows.length} rows (ranked by {rankBy === 'risk_summary' ? 'Risk Summary' : 'Torchlight'})
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setInsightTarget('sector');
                    void handleSectorAnalyze();
                  }}
                  disabled={loading || selectedSector === 'all'}
                  className="px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Analyzing...' : selectedSubsector === 'all' ? 'Generate Sector Report' : 'Generate Subsector Report'}
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
                        setInsightTarget('ticker');
                        setSelectedRowTicker(r.ticker);
                        setSymbol(r.ticker);
                      }}
                    >
                      <td className="px-3 py-2 text-right font-black text-indigo-700">{idx + 1}</td>
                      <td className="px-3 py-2 font-black text-slate-800">{r.ticker}</td>
                      <td className="px-3 py-2 text-slate-700">{r.company || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{r.sector || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{inferredSubsector(r) || '—'}</td>
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
                  {!activeRowsLoading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={33} className="px-3 py-6 text-center text-slate-400 font-medium">No rows match the selected filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {marketUniverse !== 'forex' &&
              insightTarget === 'ticker' &&
              selectedRow &&
              !watchlistUniverseDataMissing &&
              rankedRows.length > 0 && (
                <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-white p-4 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">
                        Watchlist condition brief (LLM)
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Uses only the selected row&apos;s watchlist metrics (IV, Torchlight, CTR, risk).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleWatchlistConditionBrief}
                      disabled={watchlistConditionBriefLoading}
                      className="shrink-0 px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {watchlistConditionBriefLoading ? 'Generating…' : 'Generate brief'}
                    </button>
                  </div>
                  {watchlistConditionBriefError ? (
                    <p className="text-xs text-rose-600 font-medium">{watchlistConditionBriefError}</p>
                  ) : null}
                  {watchlistConditionBrief ? (
                    <div className="rounded-lg border border-slate-200 bg-white/90 p-4 space-y-2">
                      <p className="text-sm leading-relaxed text-slate-800">
                        <span className="font-bold text-slate-900">{watchlistConditionBrief.ticker}</span>
                        <span className="text-slate-500"> — </span>
                        <span
                          className={`font-bold ${
                            watchlistConditionBrief.condition === 'Bullish'
                              ? 'text-emerald-600'
                              : watchlistConditionBrief.condition === 'Bearish'
                                ? 'text-rose-600'
                                : 'text-amber-600'
                          }`}
                        >
                          {watchlistConditionBrief.condition}
                        </span>
                      </p>
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {watchlistConditionBrief.report}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

            {activeRowsLoading && (
              <p className="text-xs text-slate-500 font-medium">Loading selected watchlist data...</p>
            )}
          </div>
        ) : (
          <p className="text-slate-400 text-sm font-medium">
            {isSp500OnlyMode()
              ? 'Sign in and add a daily watchlist snapshot to use Team watchlist or S&P 500 (watchlist members only). Other universes are hidden — set VITE_SP500_ONLY=false in .env to restore them.'
              : 'Sign in and add a daily watchlist snapshot to use Team watchlist or S&P (watchlist). Or switch to NASDAQ, FOREX, or Commodity for a built-in list.'}
          </p>
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
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-slate-900 font-bold uppercase tracking-widest text-sm">Market Insights</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Ranked companies by composite score: IV vs price (when available), IV upside %, Torchlight, risk summary, Sharpe/Sortino, and lower volatility. Scope:{' '}
              <span className="font-bold text-slate-700">{marketInsightScopeLabel}</span> ({marketInsightRows.length} rows).
              {selectedSector !== 'all'
                ? ' Only tickers from the selected sector/subsector are included.'
                : ' Choose a sector or subsector above to populate this section.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              disabled={marketInsights.ranked.length === 0}
              onClick={() =>
                downloadMarketInsightsCsv(marketInsights.ranked, marketInsightScopeLabel)
              }
              className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Download CSV
            </button>
          </div>
        </div>
        {selectedSector === 'all' ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            Select a main sector, or choose a subsector, to show Market Insights for that group only.
          </div>
        ) : (
        <div className="overflow-x-auto">
          <div className="border border-emerald-100 rounded-xl overflow-hidden min-w-[640px]">
            <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100 text-emerald-800 text-xs font-black uppercase tracking-widest">
              Ranked companies (highest composite first)
            </div>
            <table className="w-full table-fixed text-xs min-w-[600px] border-collapse">
              <colgroup>
                <col className="w-[3.25rem]" />
                <col className="w-[4.75rem]" />
                <col />
                <col className="w-[4.5rem]" />
                <col className="w-[4.25rem]" />
                <col className="w-[3.5rem]" />
                <col className="w-[4rem]" />
                <col className="w-[3.25rem]" />
                <col className="w-[3.5rem]" />
              </colgroup>
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-2.5 text-right font-black text-slate-600 text-[10px] whitespace-nowrap">
                    Rank
                  </th>
                  <th className="px-2 py-2.5 text-left font-black text-slate-600 text-[10px] leading-tight">
                    Ticker
                  </th>
                  <th className="px-3 py-2.5 text-left font-black text-slate-600 min-w-0">Company</th>
                  <th className="px-2 py-2.5 text-right font-black text-slate-600 text-[10px] whitespace-nowrap">
                    Composite
                  </th>
                  <th className="px-2 py-2.5 text-right font-black text-slate-600 text-[10px] whitespace-nowrap">
                    IV $
                  </th>
                  <th className="px-2 py-2.5 text-right font-black text-slate-600 text-[10px] whitespace-nowrap">
                    Torch
                  </th>
                  <th className="px-2 py-2.5 text-right font-black text-slate-600 text-[10px] whitespace-nowrap">
                    Upside
                  </th>
                  <th className="px-2 py-2.5 text-right font-black text-slate-600 text-[10px] whitespace-nowrap">
                    Risk
                  </th>
                  <th className="px-2 py-2.5 pr-4 text-right font-black text-slate-600 text-[10px] whitespace-nowrap">
                    Sharpe
                  </th>
                </tr>
              </thead>
              <tbody>
                {marketInsights.ranked.map((x, idx) => (
                  <tr key={`ranked-${x.row.ticker}`} className="border-t border-slate-100">
                    <td className="px-2 py-2.5 text-right font-black text-slate-500 text-[10px] tabular-nums whitespace-nowrap align-middle">
                      {idx + 1}
                    </td>
                    <td
                      className="px-2 py-2.5 font-semibold font-mono text-[10px] leading-tight text-slate-900 whitespace-nowrap align-middle overflow-hidden text-ellipsis"
                      title={x.row.ticker}
                    >
                      {x.row.ticker}
                    </td>
                    <td
                      className="px-3 py-2.5 text-slate-600 min-w-0 truncate align-middle border-l border-slate-100/80"
                      title={x.row.company || ''}
                    >
                      {x.row.company || '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right font-black text-emerald-700 text-[10px] tabular-nums whitespace-nowrap align-middle">
                      {x.score.toFixed(1)}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[10px] tabular-nums whitespace-nowrap align-middle">
                      {x.row.iv_ensemble != null ? `$${x.row.iv_ensemble.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[10px] tabular-nums whitespace-nowrap align-middle">
                      {x.row.torchlight_score != null ? x.row.torchlight_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[10px] tabular-nums whitespace-nowrap align-middle">
                      {x.row.iv_upside_pct != null ? `${x.row.iv_upside_pct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[10px] tabular-nums whitespace-nowrap align-middle">
                      {x.row.risk_summary_score != null ? x.row.risk_summary_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-2.5 pr-4 text-right text-[10px] tabular-nums whitespace-nowrap align-middle">
                      {x.row.risk_sharpe != null ? x.row.risk_sharpe.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
      </>
      ) : null}

      {signalAnalysis && insightScope === 'Ticker' && marketUniverse !== 'forex' && (
        <div className="max-w-4xl mx-auto space-y-3 animate-in fade-in duration-300">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">
              Watchlist signal analysis (instant)
            </h3>
            {loading || growthRiskDashboardLoading ? (
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                {growthRiskDashboardLoading ? 'Dashboard LLM loading…' : 'AI narrative loading…'}
              </span>
            ) : null}
          </div>
          <div className="rounded-2xl border-2 border-indigo-300 bg-indigo-50/95 p-5 shadow-sm ring-1 ring-indigo-200/60">
            <h4 className="text-indigo-900 font-black text-[10px] uppercase tracking-widest mb-2">
              Executive signal read
            </h4>
            <p className="text-indigo-950 font-black text-sm leading-snug mb-3">{signalAnalysis.overview.headline}</p>
            <ul className="text-sm text-indigo-900 space-y-1.5 list-disc pl-5 leading-relaxed">
              {signalAnalysis.overview.bullets.map((line, i) => (
                <li key={`overview-${i}`}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50/95 p-5 shadow-sm ring-1 ring-emerald-200/60">
              <h4 className="text-emerald-900 font-black text-[10px] uppercase tracking-widest mb-2">
                IV &amp; value sentiment
              </h4>
              <p className="text-emerald-950 font-bold text-sm leading-snug mb-3">{signalAnalysis.iv.headline}</p>
              <ul className="text-sm text-emerald-900 space-y-1.5 list-disc pl-5 leading-relaxed">
                {signalAnalysis.iv.bullets.map((line, i) => (
                  <li key={`iv-${i}`}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-rose-400 bg-rose-50/95 p-5 shadow-sm ring-1 ring-rose-200/60">
              <h4 className="text-rose-900 font-black text-[10px] uppercase tracking-widest mb-2">Risk signals</h4>
              <p className="text-rose-950 font-bold text-sm leading-snug mb-3">{signalAnalysis.risk.headline}</p>
              <ul className="text-sm text-rose-900 space-y-1.5 list-disc pl-5 leading-relaxed">
                {signalAnalysis.risk.bullets.map((line, i) => (
                  <li key={`risk-${i}`}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border-2 border-teal-400 bg-teal-50/95 p-5 shadow-sm ring-1 ring-teal-200/60">
              <h4 className="text-teal-900 font-black text-[10px] uppercase tracking-widest mb-2">
                Growth drivers &amp; Torchlight factors
              </h4>
              <p className="text-teal-950 font-bold text-sm leading-snug mb-3">{signalAnalysis.growthDrivers.headline}</p>
              <ul className="text-sm text-teal-900 space-y-1.5 list-disc pl-5 leading-relaxed">
                {signalAnalysis.growthDrivers.bullets.map((line, i) => (
                  <li key={`gd-${i}`}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-sky-500 bg-sky-50/95 p-5 shadow-sm ring-1 ring-sky-200/60">
              <h4 className="text-sky-950 font-black text-[10px] uppercase tracking-widest mb-2">
                Shareholder return (CTR) — full decomposition
              </h4>
              <p className="text-sky-950 font-bold text-sm leading-snug mb-3">{signalAnalysis.ctr.headline}</p>
              <ul className="text-sm text-sky-950 space-y-1.5 list-disc pl-5 leading-relaxed">
                {signalAnalysis.ctr.bullets.map((line, i) => (
                  <li key={`ctr-${i}`}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {showGeneratedReportsPanel && (
        <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-300">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2 min-w-0 flex-1">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-700">
                  Growth &amp; risk {insightTarget === 'sector' ? 'sector' : 'ticker'} report (LLM)
                </h3>
                <p className="text-[11px] text-slate-600 leading-relaxed max-w-3xl">
                  Top <span className="font-bold">5</span> growth drivers and <span className="font-bold">5</span> risk
                  factors, grouped by category, with dashboard summaries for{' '}
                  {insightTarget === 'ticker' && selectedRow ? (
                    <>
                      ticker <span className="font-mono font-bold text-slate-900">{selectedRow.ticker}</span>
                    </>
                  ) : (
                    <>
                      segment <span className="font-bold text-slate-900">{sectorSegmentLabel}</span>
                    </>
                  )}
                  . Uses watchlist values first, then news sentiment and today’s FRED macro context when available. You can
                  leave this page while it runs; the result is kept in memory for this browser session.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleGrowthRiskDashboard}
                  disabled={growthRiskDashboardLoading || !hasCurrentGrowthRiskTarget}
                  className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {growthRiskDashboardLoading ? 'Generating…' : 'Generate report'}
                </button>
                <button
                  type="button"
                  onClick={handleIndustryLifecycleAnalysis}
                  disabled={
                    industryLifecycleLoading ||
                    (insightTarget === 'ticker' ? !selectedRow : selectedSector === 'all')
                  }
                  className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-indigo-700 text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {industryLifecycleLoading
                    ? 'Analyzing…'
                    : insightTarget === 'ticker'
                      ? 'Business lifecycle'
                      : 'Industry lifecycle'}
                </button>
                <button
                  type="button"
                  onClick={handleLeadershipLifecycleAnalysis}
                  disabled={industryLifecycleLoading || !selectedRow || insightTarget !== 'ticker'}
                  className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-violet-700 text-white hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Leadership lifecycle
                </button>
              </div>
            </div>
            {growthRiskDashboardLoading ? (
              <p className="text-[11px] font-bold text-indigo-600">
                Generating dashboard in the background. You can use another platform tab and come back to this result.
              </p>
            ) : null}
            {industryLifecycleLoading ? (
              <p className="text-[11px] font-bold text-indigo-600">
                Collecting Yahoo lifecycle fields for the selected {industryLifecycleReportKind === 'leadership' ? 'leader/ticker' : insightTarget === 'ticker' ? 'ticker' : 'segment'} and classifying its lifecycle stage.
              </p>
            ) : null}
            {growthRiskDashboardError ? (
              <p className="text-xs text-rose-600 font-medium">{growthRiskDashboardError}</p>
            ) : null}
            {industryLifecycleError ? (
              <p className="text-xs text-rose-600 font-medium">{industryLifecycleError}</p>
            ) : null}
            {growthRiskDashboard ? (
              <div id="growth-risk-llm-report" className="space-y-6 pt-1 border-t border-slate-100 scroll-mt-4">
                <div className="flex flex-wrap items-baseline gap-2 text-sm text-slate-800">
                  <span className="font-black text-slate-500 uppercase text-[10px] tracking-widest">Subject</span>
                  <span className="font-mono font-black text-slate-900">
                    {growthRiskDashboard.subjectLabel ||
                      (growthRiskDashboard.scope === 'sector' ? sectorSegmentLabel : selectedRow?.ticker)}
                  </span>
                  <span className="text-[10px] font-bold uppercase text-slate-400 px-2 py-0.5 rounded bg-slate-100">
                    {growthRiskDashboard.scope === 'sector' ? 'Sector view' : 'Ticker view'}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {growthRiskDashboard.growthSummary ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                      <p className="text-[10px] font-black uppercase text-emerald-800 tracking-widest mb-1">
                        Growth summary
                      </p>
                      <p className="text-xs text-emerald-950 leading-relaxed font-medium">
                        {growthRiskDashboard.growthSummary}
                      </p>
                    </div>
                  ) : null}
                  {growthRiskDashboard.riskSummary ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                      <p className="text-[10px] font-black uppercase text-rose-800 tracking-widest mb-1">
                        Risk summary
                      </p>
                      <p className="text-xs text-rose-950 leading-relaxed font-medium">
                        {growthRiskDashboard.riskSummary}
                      </p>
                    </div>
                  ) : null}
                </div>

                {/* Growth: bar chart + trend cards + by category */}
                <div className="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white overflow-hidden">
                  <div className="px-3 py-2 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest flex flex-wrap items-center justify-between gap-2">
                    <span>📊 Growth — score by title</span>
                    <span className="opacity-90">Top 5 · bar chart</span>
                  </div>
                  <div className="p-4 space-y-4">
                    {growthRiskDashboard.growthDrivers.length === 0 ? (
                      <p className="text-xs text-slate-600 leading-relaxed">
                        No growth driver rows were parsed. The model may have skipped{' '}
                        <span className="font-mono">description</span> on items or used a different JSON shape. Click{' '}
                        <span className="font-semibold">Generate report</span> again after this update.
                      </p>
                    ) : (
                      <>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Scores (Y) vs titles (X)</p>
                          <div className="flex h-[140px] items-end justify-between gap-1.5 border-b-2 border-slate-200 pb-0.5 px-0.5">
                            {growthRiskDashboard.growthDrivers.map((item, i) => (
                              <div
                                key={`gbar-${i}`}
                                className="flex flex-1 flex-col items-center justify-end gap-1 min-w-0 max-w-[20%]"
                              >
                                <span className="text-[10px] font-black text-emerald-800 tabular-nums">{item.score}</span>
                                <div
                                  className="w-full min-h-[8px] rounded-t-md bg-emerald-500 shadow-inner"
                                  style={{
                                    height: `${Math.max(10, Math.round((item.score / 100) * 120))}px`,
                                  }}
                                  title={`${item.title} (${item.score})`}
                                />
                              </div>
                            ))}
                          </div>
                          <div className="flex justify-between gap-1.5 mt-1.5 px-0.5">
                            {growthRiskDashboard.growthDrivers.map((item, i) => (
                              <div key={`glabel-${i}`} className="flex-1 min-w-0 max-w-[20%] text-center">
                                <span className="text-[9px] leading-tight text-slate-600 line-clamp-3 font-semibold">
                                  {item.title}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">📈 Trend-style cards</p>
                          <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory">
                            {growthRiskDashboard.growthDrivers.map((item, i) => (
                              <div
                                key={`gc-${i}`}
                                className="snap-start shrink-0 w-[148px] rounded-xl border border-emerald-200 bg-white p-3 shadow-sm"
                              >
                                <p className="text-[9px] font-black text-emerald-700 uppercase truncate">{item.category}</p>
                                <p className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug mt-1 min-h-[2.25rem]">
                                  {item.title}
                                </p>
                                <p className="text-2xl font-black text-emerald-700 tabular-nums mt-2">{item.score}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">By category</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {groupGrowthRiskByCategory(growthRiskDashboard.growthDrivers).map(([cat, arr]) => (
                              <div
                                key={`gcat-${cat}`}
                                className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 space-y-2"
                              >
                                <p className="text-[10px] font-black uppercase text-emerald-900 tracking-wide">{cat}</p>
                                <ul className="space-y-2">
                                  {arr.map((item, j) => (
                                    <li key={`${cat}-g-${j}`} className="text-[11px] text-slate-800 leading-snug">
                                      <span className="font-bold text-slate-900">{item.title}</span>
                                      <span className="text-slate-500"> · {item.score}</span>
                                      <span className="block text-slate-600 mt-0.5">{item.description}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Risk: heatmap + trend cards + by category */}
                <div className="rounded-xl border border-rose-200 bg-gradient-to-b from-rose-50/80 to-white overflow-hidden">
                  <div className="px-3 py-2 bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest flex flex-wrap items-center justify-between gap-2">
                    <span>🔴 Risk heatmap</span>
                    <span className="opacity-90">Color = impact · Top 5</span>
                  </div>
                  <div className="p-4 space-y-4">
                    {growthRiskDashboard.riskFactors.length === 0 ? (
                      <p className="text-xs text-slate-600 leading-relaxed">
                        No risk factor rows were parsed. Regenerate the report; if this persists, the LLM response may
                        not match the expected <span className="font-mono">risk_factors</span> array schema.
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                          {growthRiskDashboard.riskFactors.map((item, i) => (
                            <div
                              key={`rh-${i}`}
                              className={`rounded-xl border-2 p-2 min-h-[88px] flex flex-col justify-between text-center shadow-sm ${growthRiskHeatmapCellClass(
                                item.impactLevel,
                              )}`}
                            >
                              <span className="text-[9px] font-bold leading-tight line-clamp-4">{item.title}</span>
                              <div className="flex flex-col items-center gap-0.5 mt-1">
                                <span className="text-[9px] font-black uppercase opacity-90">{item.impactLevel}</span>
                                <span className="text-xs font-black tabular-nums">{item.score}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">📈 Trend-style cards</p>
                          <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory">
                            {growthRiskDashboard.riskFactors.map((item, i) => (
                              <div
                                key={`rc-${i}`}
                                className="snap-start shrink-0 w-[148px] rounded-xl border border-rose-200 bg-white p-3 shadow-sm"
                              >
                                <p className="text-[9px] font-black text-rose-700 uppercase truncate">{item.category}</p>
                                <p className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug mt-1 min-h-[2.25rem]">
                                  {item.title}
                                </p>
                                <p className="text-2xl font-black text-rose-700 tabular-nums mt-2">{item.score}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">By category</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {groupGrowthRiskByCategory(growthRiskDashboard.riskFactors).map(([cat, arr]) => (
                              <div
                                key={`rcat-${cat}`}
                                className="rounded-lg border border-rose-100 bg-rose-50/40 p-3 space-y-2"
                              >
                                <p className="text-[10px] font-black uppercase text-rose-900 tracking-wide">{cat}</p>
                                <ul className="space-y-2">
                                  {arr.map((item, j) => (
                                    <li key={`${cat}-r-${j}`} className="text-[11px] text-slate-800 leading-snug">
                                      <span className="font-bold text-slate-900">{item.title}</span>
                                      <span className="text-slate-500">
                                        {' '}
                                        · {item.score} · {item.impactLevel}
                                      </span>
                                      <span className="block text-slate-600 mt-0.5">{item.description}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {businessLifecycleReport ? (
              <div className="space-y-4 pt-4 border-t border-emerald-100">
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                        Instrument Level Lifecycle Analysis
                      </p>
                      <h4 className="mt-1 text-xl font-black text-emerald-950">
                        {businessLifecycleReport.subjectLabel}
                      </h4>
                      <p className="mt-2 text-sm text-emerald-950 leading-relaxed">
                        {businessLifecycleReport.summary}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3 border border-emerald-200 text-right shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Business stage</p>
                      <p className="text-2xl font-black text-emerald-900">{businessLifecycleReport.stage}</p>
                      <p className="text-[11px] font-bold text-slate-500">{businessLifecycleReport.confidence}% confidence</p>
                    </div>
                  </div>
                  <div className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                        Business lifecycle stage map
                      </p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${lifecycleStageClass(businessLifecycleReport.stage)}`}>
                        {businessLifecycleReport.stage}
                      </span>
                    </div>
                    <div className="relative pt-5">
                      <div className="absolute left-0 right-0 top-7 h-1.5 rounded-full bg-slate-200" />
                      <div className="absolute left-0 top-7 h-1.5 rounded-full bg-emerald-500" style={{ width: `${lifecycleStagePosition(businessLifecycleReport.stage)}%` }} />
                      <div className="absolute top-5 h-5 w-5 -translate-x-1/2 rounded-full border-4 border-white bg-emerald-700 shadow" style={{ left: `${lifecycleStagePosition(businessLifecycleReport.stage)}%` }} />
                      <div className="relative grid grid-cols-4 gap-2 pt-6">
                        {LIFECYCLE_STAGES.map((stage) => (
                          <div key={`biz-${stage}`} className={`rounded-xl border px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide ${stage === businessLifecycleReport.stage ? lifecycleStageClass(stage) : lifecycleStageMutedClass(stage)}`}>
                            {stage}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white border border-emerald-100 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Strategy</p>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed">{businessLifecycleReport.strategy}</p>
                    </div>
                    <div className="rounded-xl bg-white border border-emerald-100 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Ticker + business lifecycle combo</p>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed">{businessLifecycleReport.subSectorCombo}</p>
                    </div>
                  </div>
                </div>
                {businessLifecycleReport.signals.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600">
                      Business lifecycle signals
                    </div>
                    <div className="p-4 space-y-2">
                      {businessLifecycleReport.signals.map((signal, i) => (
                        <div key={`biz-signal-${i}`} className="rounded-lg border border-slate-100 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-black text-slate-900 text-xs">{signal.metric}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${lifecycleStageMutedClass(signal.stageBias)}`}>
                              {signal.stageBias}
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-700">{signal.value}</p>
                          <p className="mt-1 text-xs text-slate-600 leading-relaxed">{signal.signal}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800 mb-2">Business lifecycle explanation</p>
                    <p className="text-sm text-emerald-950 leading-relaxed whitespace-pre-wrap">{businessLifecycleReport.explanation || 'No explanation returned.'}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-800 mb-2">Business lifecycle rotation</p>
                    <p className="text-sm text-amber-950 leading-relaxed whitespace-pre-wrap">{businessLifecycleReport.lifecycleRotation || 'No rotation note returned.'}</p>
                  </div>
                </div>
              </div>
            ) : null}
            {industryLifecycleReport ? (
              <div className="space-y-4 pt-4 border-t border-indigo-100">
                <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">
                        {industryLifecycleReportKind === 'leadership'
                          ? 'Leadership Lifecycle Analysis'
                          : industryLifecycleReportKind === 'business'
                          ? 'Business Lifecycle Analysis'
                          : 'Industry Lifecycle Analysis'}
                      </p>
                      <h4 className="mt-1 text-xl font-black text-indigo-950">
                        {industryLifecycleReport.subjectLabel}
                      </h4>
                      <p className="mt-2 text-sm text-indigo-950 leading-relaxed">
                        {industryLifecycleReport.summary}
                      </p>
                      {industryLifecycleReportKind === 'leadership' &&
                      (industryLifecycleReport.leaderName || industryLifecycleReport.leaderTitle) ? (
                        <p className="mt-2 text-xs font-bold text-indigo-800">
                          Leader:{' '}
                          <span className="text-indigo-950">
                            {industryLifecycleReport.leaderName || 'Unknown'}
                            {industryLifecycleReport.leaderTitle ? ` — ${industryLifecycleReport.leaderTitle}` : ''}
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3 border border-indigo-200 text-right shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Stage</p>
                      <p className="text-2xl font-black text-indigo-900">{industryLifecycleReport.stage}</p>
                      <p className="text-[11px] font-bold text-slate-500">
                        {industryLifecycleReport.confidence}% confidence
                      </p>
                      {industryLifecycleReportKind === 'leadership' && industryLifecycleReport.leadershipSentiment ? (
                        <span
                          className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${leadershipSentimentClass(
                            industryLifecycleReport.leadershipSentiment,
                          )}`}
                        >
                          {industryLifecycleReport.leadershipSentiment} sentiment
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-5 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">
                        Lifecycle stage map
                      </p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${lifecycleStageClass(industryLifecycleReport.stage)}`}>
                        {industryLifecycleReport.stage}
                      </span>
                    </div>
                    <div className="relative pt-5">
                      <div className="absolute left-0 right-0 top-7 h-1.5 rounded-full bg-slate-200" />
                      <div
                        className="absolute left-0 top-7 h-1.5 rounded-full bg-indigo-500"
                        style={{ width: `${lifecycleStagePosition(industryLifecycleReport.stage)}%` }}
                      />
                      <div
                        className="absolute top-5 h-5 w-5 -translate-x-1/2 rounded-full border-4 border-white bg-indigo-700 shadow"
                        style={{ left: `${lifecycleStagePosition(industryLifecycleReport.stage)}%` }}
                        title={industryLifecycleReport.stage}
                      />
                      <div className="relative grid grid-cols-4 gap-2 pt-6">
                        {LIFECYCLE_STAGES.map((stage) => (
                          <div key={stage} className="text-center">
                            <div
                              className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase tracking-wide ${
                                stage === industryLifecycleReport.stage
                                  ? lifecycleStageClass(stage)
                                  : lifecycleStageMutedClass(stage)
                              }`}
                            >
                              {stage}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <span>Classification confidence</span>
                        <span>{industryLifecycleReport.confidence}%</span>
                      </div>
                      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-indigo-600"
                          style={{ width: `${Math.max(0, Math.min(100, industryLifecycleReport.confidence))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white border border-indigo-100 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        Strategy
                      </p>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed">
                        {industryLifecycleReport.strategy}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white border border-indigo-100 p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                        {industryLifecycleReportKind === 'business'
                          ? 'Ticker + business lifecycle combo'
                          : industryLifecycleReportKind === 'leadership'
                            ? 'Ticker + leader lifecycle combo'
                          : 'Lifecycle + subsector combo'}
                      </p>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed">
                        {industryLifecycleReport.subSectorCombo}
                      </p>
                    </div>
                  </div>
                </div>

                {industryLifecycleReport.signals.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600 flex flex-wrap items-center justify-between gap-2">
                      <span>Data signals used for classification</span>
                      <span>{industryLifecycleReport.signals.length} signals</span>
                    </div>
                    <div className="p-4 border-b border-slate-100">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">
                        Stage bias distribution
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {lifecycleSignalBiasCounts(industryLifecycleReport).map(({ stage, count }) => {
                          const pct = industryLifecycleReport.signals.length
                            ? Math.round((count / industryLifecycleReport.signals.length) * 100)
                            : 0;
                          return (
                            <div key={stage} className={`rounded-xl border p-3 ${lifecycleStageMutedClass(stage)}`}>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[10px] font-black uppercase">{stage}</span>
                                <span className="text-lg font-black tabular-nums">{count}</span>
                              </div>
                              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70">
                                <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${pct}%` }} />
                              </div>
                              <p className="mt-1 text-[10px] font-bold opacity-80">{pct}% of signals</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="p-4 border-b border-slate-100">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">
                        Signal strength bars
                      </p>
                      <div className="space-y-2">
                        {industryLifecycleReport.signals.map((signal, i) => {
                          const width = Math.round(((i + 1) / Math.max(1, industryLifecycleReport.signals.length)) * 100);
                          return (
                            <div key={`${signal.metric}-bar-${i}`} className="grid grid-cols-[8rem_1fr_5.5rem] items-center gap-2 text-[11px]">
                              <span className="truncate font-bold text-slate-700" title={signal.metric}>{signal.metric}</span>
                              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${
                                    signal.stageBias === 'Growth'
                                      ? 'bg-emerald-500'
                                      : signal.stageBias === 'Maturity'
                                        ? 'bg-blue-500'
                                        : signal.stageBias === 'Decline'
                                          ? 'bg-rose-500'
                                          : 'bg-amber-400'
                                  }`}
                                  style={{ width: `${width}%` }}
                                />
                              </div>
                              <span className="text-right font-black text-slate-600">{signal.stageBias}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[680px]">
                        <thead className="bg-white">
                          <tr>
                            <th className="px-3 py-2 text-left font-black text-slate-500">Metric</th>
                            <th className="px-3 py-2 text-left font-black text-slate-500">Value</th>
                            <th className="px-3 py-2 text-left font-black text-slate-500">Signal</th>
                            <th className="px-3 py-2 text-left font-black text-slate-500">Bias</th>
                          </tr>
                        </thead>
                        <tbody>
                          {industryLifecycleReport.signals.map((signal, i) => (
                            <tr key={`${signal.metric}-${i}`} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-bold text-slate-900">{signal.metric}</td>
                              <td className="px-3 py-2 text-slate-700">{signal.value}</td>
                              <td className="px-3 py-2 text-slate-600">{signal.signal}</td>
                              <td className="px-3 py-2 font-black text-indigo-700">{signal.stageBias}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800 mb-2">
                      Explanation layer
                    </p>
                    <p className="text-sm text-emerald-950 leading-relaxed whitespace-pre-wrap">
                      {industryLifecycleReport.explanation || 'No explanation returned.'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-800 mb-2">
                      Lifecycle rotation strategy
                    </p>
                    <p className="text-sm text-amber-950 leading-relaxed whitespace-pre-wrap">
                      {industryLifecycleReport.lifecycleRotation || 'No rotation note returned.'}
                    </p>
                  </div>
                </div>

                {industryLifecycleReportKind === 'leadership' &&
                (industryLifecycleReport.managementStyle ||
                  industryLifecycleReport.leadershipSentiment ||
                  industryLifecycleReport.capitalAllocationStyle ||
                  industryLifecycleReport.executionQuality ||
                  industryLifecycleReport.governanceAssessment) ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {industryLifecycleReport.leadershipSentiment ? (
                      <div className={`rounded-xl border p-4 ${leadershipSentimentClass(industryLifecycleReport.leadershipSentiment)}`}>
                        <p className="text-[10px] font-black uppercase tracking-widest mb-2">
                          Leadership sentiment
                        </p>
                        <p className="text-2xl font-black">
                          {industryLifecycleReport.leadershipSentiment}
                        </p>
                        <p className="mt-1 text-xs font-semibold opacity-80">
                          Based on Yahoo management news, governance risk, execution metrics, and market expectations.
                        </p>
                      </div>
                    ) : null}
                    {industryLifecycleReport.managementStyle ? (
                      <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-800 mb-2">
                          Management style
                        </p>
                        <p className="text-sm text-violet-950 leading-relaxed">
                          {industryLifecycleReport.managementStyle}
                        </p>
                      </div>
                    ) : null}
                    {industryLifecycleReport.capitalAllocationStyle ? (
                      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-sky-800 mb-2">
                          Capital allocation style
                        </p>
                        <p className="text-sm text-sky-950 leading-relaxed">
                          {industryLifecycleReport.capitalAllocationStyle}
                        </p>
                      </div>
                    ) : null}
                    {industryLifecycleReport.executionQuality ? (
                      <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-teal-800 mb-2">
                          Execution quality
                        </p>
                        <p className="text-sm text-teal-950 leading-relaxed">
                          {industryLifecycleReport.executionQuality}
                        </p>
                      </div>
                    ) : null}
                    {industryLifecycleReport.governanceAssessment ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2">
                          Governance assessment
                        </p>
                        <p className="text-sm text-slate-800 leading-relaxed">
                          {industryLifecycleReport.governanceAssessment}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {industryLifecycleReport.eventDetections.length > 0 ? (
                  <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-800 mb-2">
                      Event detection
                    </p>
                    <ul className="space-y-1.5 text-sm text-violet-950 list-disc pl-5">
                      {industryLifecycleReport.eventDetections.map((event, i) => (
                        <li key={`life-event-${i}`}>{event}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    {industryLifecycleReportKind === 'leadership'
                      ? 'Management & governance data needed'
                      : 'Yahoo Finance data collection prompt'}
                  </p>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {industryLifecycleReport.yahooDataPrompt ||
                      'Collect revenueGrowth, earningsGrowth, grossMargins, profitMargins, operatingMargins, ebitdaMargins, marketCap, enterpriseValue, sharesOutstanding, recommendationMean, targetMeanPrice, averageVolume, industry, sector, and annual revenue/margin history for this segment.'}
                  </p>
                  {industryLifecycleReport.missingYahooFields.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {industryLifecycleReport.missingYahooFields.map((field) => (
                        <span
                          key={field}
                          className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-xl text-center font-medium">
          ⚠️ {error}
        </div>
      )}

      {insight && marketUniverse !== 'forex' && (() => {
        const reportScope = insightReportMeta?.scope ?? insightScope;
        const tickerGrowthBullets =
          reportScope === 'Ticker' && signalAnalysis
            ? [
                ...signalAnalysis.iv.bullets,
                ...signalAnalysis.growthDrivers.bullets,
                ...signalAnalysis.ctr.bullets,
              ].slice(0, 6)
            : null;
        const tickerRiskBullets =
          reportScope === 'Ticker' && signalAnalysis
            ? [...signalAnalysis.risk.bullets, ...signalAnalysis.ctr.bullets].slice(0, 6)
            : null;
        const growthBullets = tickerGrowthBullets?.length ? tickerGrowthBullets : insight.pros;
        const riskBullets = tickerRiskBullets?.length ? tickerRiskBullets : insight.cons;
        const showInsightProsConsColumn =
          reportScope === 'Sector' ||
          (reportScope === 'Ticker' &&
            ((tickerGrowthBullets != null && tickerGrowthBullets.length > 0) ||
              !insightProsConsAreLlmPlaceholder(insight)));
        return (
        <div
          className={`grid grid-cols-1 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 ${
            showInsightProsConsColumn ? 'md:grid-cols-3' : ''
          }`}
        >
          {/* Main Recommendation */}
          <div className={`space-y-6 ${showInsightProsConsColumn ? 'md:col-span-2' : ''}`}>
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Build</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {reportScope === 'Ticker' && insightReportBuild.display && insightReportBuild.display !== '—' ? (
                  <span className="text-3xl font-black font-mono tracking-tight text-slate-900">{insightReportBuild.display}</span>
                ) : (
                  <span className="text-2xl font-black tracking-tight text-slate-900">
                    <span className="text-slate-500 text-xs font-black uppercase tracking-widest mr-2">Sector</span>
                    {insightReportBuild.display || '—'}
                  </span>
                )}
                <span className="text-slate-300 text-xl font-light select-none">·</span>
                <span className={`text-2xl font-black ${insightConditionTextClass(insight.sentiment)}`}>
                  {insightConditionDisplayLabel(insight.sentiment)}
                </span>
                {loading ? (
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700 border border-indigo-100">
                    Generating new report…
                  </span>
                ) : null}
              </div>
            </div>
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wider">AI RECOMMENDATION</h3>
                  <p className={`text-3xl font-bold mt-1 ${insightConditionTextClass(insight.sentiment)}`}>
                    {insightConditionDisplayLabel(insight.sentiment)}
                  </p>
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
                    <span
                      className={`text-lg font-bold ${
                        insight.sentiment === 'Bearish'
                          ? 'text-rose-600'
                          : insight.sentiment === 'Neutral'
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                      }`}
                    >
                      {insight.confidence}%
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-slate-700 leading-relaxed text-lg">
                At <span className="font-bold text-slate-900">{insight.confidence}%</span> model confidence, the stance
                is{' '}
                <span className={`font-bold ${insightConditionTextClass(insight.sentiment)}`}>
                  {insightConditionDisplayLabel(insight.sentiment)}
                </span>
                . {insight.recommendation}
              </p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold mb-4">Market Summary</h3>
              <p className="text-slate-600 leading-relaxed">
                {insight.summary}
              </p>
            </div>

            {reportScope === 'Ticker' && insight.extended_report && (
              <div className="bg-gradient-to-br from-indigo-50/90 to-white p-8 rounded-2xl shadow-sm border-2 border-indigo-200/80 ring-1 ring-indigo-100">
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                  <h3 className="text-lg font-black text-indigo-950 tracking-tight">Extended report</h3>
                  {insightReportBuild.display && insightReportBuild.display !== '—' ? (
                    <span className="text-sm font-mono font-bold text-indigo-800 bg-white/80 px-3 py-1 rounded-lg border border-indigo-200">
                      {insightReportBuild.display}
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600/90 mb-3">
                  Ticker narrative · recommendation context
                </p>
                <div className="text-slate-800 leading-relaxed text-[15px] whitespace-pre-wrap">
                  {insight.extended_report}
                </div>
              </div>
            )}

            {(insight.valuation_view ||
              insight.torchlight_view ||
              insight.risk_view ||
              insight.market_catalysts) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {insight.valuation_view ? (
                  <div className="bg-emerald-50/90 p-5 rounded-xl border-2 border-emerald-200 shadow-sm">
                    <h4 className="text-xs font-black uppercase tracking-widest text-emerald-800 mb-2">
                      Value vs price (IV) — AI
                    </h4>
                    <p className="text-sm text-emerald-950 leading-relaxed whitespace-pre-wrap">{insight.valuation_view}</p>
                  </div>
                ) : null}
                {insight.torchlight_view ? (
                  <div className="bg-violet-50/90 p-5 rounded-xl border border-violet-200 shadow-sm">
                    <h4 className="text-xs font-black uppercase tracking-widest text-violet-800 mb-2">Torchlight — AI</h4>
                    <p className="text-sm text-violet-950 leading-relaxed whitespace-pre-wrap">{insight.torchlight_view}</p>
                  </div>
                ) : null}
                {insight.risk_view ? (
                  <div className="bg-rose-50/95 p-5 rounded-xl border-2 border-rose-200 shadow-sm">
                    <h4 className="text-xs font-black uppercase tracking-widest text-rose-900 mb-2">Risk profile — AI</h4>
                    <p className="text-sm text-rose-950 leading-relaxed whitespace-pre-wrap">{insight.risk_view}</p>
                  </div>
                ) : null}
                {insight.market_catalysts ? (
                  <div className="bg-slate-50 p-5 rounded-xl border border-slate-100 md:col-span-2">
                    <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 mb-2">
                      Market & catalysts
                    </h4>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{insight.market_catalysts}</p>
                  </div>
                ) : null}
              </div>
            )}

            {!showInsightProsConsColumn && reportScope === 'Ticker' ? (
              <p className="text-xs text-slate-500 border-t border-slate-100 pt-4">
                Growth/risk driver bullets from the model were omitted because the response did not include usable
                lists. Use the watchlist signal strip above, the IV / Torchlight / risk tiles, and Market Summary for
                this ticker, or generate again.
              </p>
            ) : null}
          </div>

          {showInsightProsConsColumn ? (
          <div className="space-y-6">
            <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
              <h4 className="text-emerald-700 font-bold mb-4 flex items-center">
                <span className="mr-2">🚀</span>{' '}
                {reportScope === 'Sector' ? 'Growth Drivers (sector)' : 'Growth Drivers'}
              </h4>
              <ul className="space-y-3">
                {growthBullets.map((pro, i) => (
                  <li key={i} className="flex items-start text-sm text-emerald-800">
                    <span className="text-emerald-500 mr-2 mt-0.5">✓</span>
                    {pro}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-rose-50 p-6 rounded-2xl border border-rose-100">
              <h4 className="text-rose-700 font-bold mb-4 flex items-center">
                <span className="mr-2">⚠️</span>{' '}
                {reportScope === 'Sector' ? 'Risk Factors (sector)' : 'Risk Factors'}
              </h4>
              <ul className="space-y-3">
                {riskBullets.map((con, i) => (
                  <li key={i} className="flex items-start text-sm text-rose-800">
                    <span className="text-rose-400 mr-2 mt-0.5">✕</span>
                    {con}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          ) : null}
        </div>
        );
      })()}

      {universeReady &&
        marketUniverse !== 'forex' &&
        !insight &&
        !loading && (
        <div className="text-center py-20 bg-slate-100/50 rounded-3xl border border-dashed border-slate-300">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-slate-500 font-medium">Analysis will appear here</h3>
        </div>
      )}
    </div>
  );
};

export default AIAnalysis;
