
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
