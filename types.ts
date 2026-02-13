
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
}

export interface InsightResponse {
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  summary: string;
  pros: string[];
  cons: string[];
  recommendation: string;
  confidence: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}
