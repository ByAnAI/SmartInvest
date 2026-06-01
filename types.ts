
export interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  history: { time: string; price: number }[];
  marketCap: string;
  peRatio: string;
}

export interface PortfolioItem {
  symbol: string;
  shares: number;
  avgCost: number;
  /** ISO timestamp in UTC of the **most recent** buy (Supabase `opened_at`); set on every `addStock`. */
  openedAt?: string;
  /** Per-share price at first purchase; fixed after first fill (`first_buy_price`). Blended average is `avgCost`. */
  firstBuyPrice?: number;
}

export interface UserMetadata {
  uid: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  role: 'user' | 'admin';
  isVerified: boolean;
  lastLogin: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsightResponse {
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  /** Short synthesis; when structured views exist, this is usually the executive_summary from the model. */
  summary: string;
  pros: string[];
  cons: string[];
  recommendation: string;
  confidence: number;
  /** IV / price / upside — only when the model returns structured equity JSON. */
  valuation_view?: string;
  /** Headline Torchlight + sub-scores + rank_factors — structured equity JSON. */
  torchlight_view?: string;
  /** Risk metrics narrative — structured equity JSON. */
  risk_view?: string;
  /** Today-news / catalysts grounded in the Finnhub block only — structured equity JSON. */
  market_catalysts?: string;
  /**
   * Long-form narrative for ticker analysis: ties ticker + recommendation to valuation,
   * Torchlight/CTR, risk, catalysts, and monitoring (multi-paragraph plain text).
   */
  extended_report?: string;
}

/** LLM brief for one watchlist row: condition + short narrative (watchlist numbers only). */
export interface TickerWatchlistConditionBrief {
  ticker: string;
  condition: 'Bullish' | 'Bearish' | 'Hold';
  report: string;
}

/** LLM growth/risk dashboard item (JSON uses snake_case; we normalize in parser). */
export type GrowthRiskImpactLevel = 'Low' | 'Medium' | 'High';

export interface GrowthRiskDashboardItem {
  title: string;
  description: string;
  impactLevel: GrowthRiskImpactLevel;
  category: string;
  /** 0–100; higher = stronger relevance to the ticker per the model. */
  score: number;
}

export interface GrowthRiskDashboardReport {
  /** Ticker row vs sector aggregate. */
  scope?: 'ticker' | 'sector';
  /** Display label (e.g. ticker or sector name). */
  subjectLabel?: string;
  /** One–two short dashboard sentences for growth side. */
  growthSummary?: string;
  /** One–two short dashboard sentences for risk side. */
  riskSummary?: string;
  growthDrivers: GrowthRiskDashboardItem[];
  riskFactors: GrowthRiskDashboardItem[];
}

export type IndustryLifecycleStage = 'Introduction' | 'Growth' | 'Maturity' | 'Decline';

export interface IndustryLifecycleSignal {
  metric: string;
  value: string;
  signal: string;
  stageBias: IndustryLifecycleStage;
}

export interface IndustryLifecycleReport {
  subjectLabel: string;
  stage: IndustryLifecycleStage;
  confidence: number;
  strategy: string;
  summary: string;
  leaderName?: string;
  leaderTitle?: string;
  leadershipSentiment?: 'Positive' | 'Neutral' | 'Negative' | 'Mixed';
  managementStyle?: string;
  capitalAllocationStyle?: string;
  executionQuality?: string;
  governanceAssessment?: string;
  yahooDataPrompt: string;
  missingYahooFields: string[];
  signals: IndustryLifecycleSignal[];
  explanation: string;
  lifecycleRotation: string;
  eventDetections: string[];
  subSectorCombo: string;
}

/** Structured news sentiment (portfolio sentiment tab); matches LLM JSON contract. */
export type NewsSentimentPolarity = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type NewsSentimentLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type ShortTermImpactDirection = 'UP' | 'DOWN' | 'NO IMPACT';

export interface NewsArticleSentimentRow {
  title: string;
  sentiment: NewsSentimentPolarity;
  score: number;
  reason: string;
  /** Article publish date/time, normalized to ISO when available. */
  publishedAt?: string;
  /** Publisher (from Finnhub). */
  source?: string;
  /** Link to full article when available. */
  url?: string;
}

export interface TickerNewsSentimentAnalysis {
  ticker: string;
  article_analysis: NewsArticleSentimentRow[];
  overall_sentiment: { score: number; label: NewsSentimentLabel };
  short_term_impact: { direction: ShortTermImpactDirection; confidence: number };
  detected_events: string[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

// New Types for Dashboard Features

export interface Folder {
  id: string;
  name: string;
  createdAt: any; // Timestamp
}

export interface FileItem {
  id: string;
  name: string;
  folderId?: string;
  size: string;
  createdAt: any; // Timestamp
}

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: any; // Timestamp
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  createdAt: any; // Timestamp
}

// Market Data
export interface MarketAsset {
  symbol: string;
  name: string;
  market: string; // 'SP500', 'NASDAQ', 'ASIA', etc.
}

// Daily watchlist (manager-created; all users can view)
export interface DailyWatchlist {
  id: string;
  watchlist_date: string; // YYYY-MM-DD
  symbols: string[];
  created_by: string;
  created_at: string;
  label?: string;
}

/** Snapshot row for `daily_watchlist_items` (and CSV export). */
export interface DailyWatchlistItem {
  watchlist_id?: string;
  watchlist_date: string;
  symbol: string;
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
  torchlight_rank_factors?: string | null;
  torchlight_momentum?: number | null;
  torchlight_valuation_edge?: number | null;
  torchlight_quality?: number | null;
  torchlight_growth?: number | null;
  torchlight_sentiment?: number | null;
  torchlight_macro_fit?: number | null;
  torchlight_execution_feasibility?: number | null;
  torchlight_risk_adjusted_alpha?: number | null;
  torchlight_capital_efficiency?: number | null;
  torchlight_analyst_drift?: number | null;
  ctr_total_return?: number | null;
  ctr_price_return?: number | null;
  ctr_cash_return?: number | null;
  ctr_annualized?: number | null;
  torchlight_ctr_score?: number | null;
  risk_daily_return_mean?: number | null;
  risk_volatility_daily?: number | null;
  risk_volatility_annual?: number | null;
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
  created_at?: string;
}

// Company fundamentals (reference data; only admins can write)
export interface CompanyFundamental {
  ticker: string;
  company: string;
  sector: string;
  location: string;
  industry: string;
  website: string;
  updated_at?: string;
}

/** Shared team bulletin (`news_board_posts` in Supabase). */
export interface NewsBoardPost {
  id: string;
  title: string;
  body: string;
  author_uid: string;
  author_email: string;
  author_display_name: string | null;
  created_at: string;
}
