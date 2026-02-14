
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

export interface UserMetadata {
  uid: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  role: 'user' | 'admin';
  lastLogin: string;
  createdAt: string;
  updatedAt: string;
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