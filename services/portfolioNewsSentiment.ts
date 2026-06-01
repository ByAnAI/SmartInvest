import { fetchWatchlistApi, getDefaultWatchlistApiBase, readWatchlistJson } from '../utils/watchlistApiFetch';

export type NewsArticleRow = {
  title: string | null;
  source: string | null;
  url: string | null;
  time: string | null;
  sentiment: number | null;
  sentiment_label: string | null;
};

export type PositionNewsSentiment = {
  symbol: string;
  average_sentiment: number | null;
  article_count: number;
  articles: NewsArticleRow[];
  sentiment_label: string;
  error?: string;
};

export type PortfolioNewsSentimentResult = {
  source: string;
  source_url: string;
  positions: PositionNewsSentiment[];
  portfolio_average_sentiment: number | null;
  portfolio_health_score: number | null;
  portfolio_health_label: string;
  positions_with_data: number;
  positions_requested: number;
  skipped_symbols: string[];
  max_symbols_applied: number;
};

export async function fetchPortfolioNewsSentiment(
  symbols: string[],
  apiBase?: string
): Promise<PortfolioNewsSentimentResult> {
  const base = apiBase ?? getDefaultWatchlistApiBase();
  const normalized = [...new Set(symbols.map((s) => String(s).toUpperCase().trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new Error('No equity symbols in portfolio to analyze.');
  }
  const res = await fetchWatchlistApi(base, '/api/news/portfolio-sentiment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: normalized }),
  });
  return readWatchlistJson<PortfolioNewsSentimentResult>(res);
}

export function formatAvSentiment(score: number | null): string {
  if (score == null || Number.isNaN(score)) return '—';
  const sign = score > 0 ? '+' : '';
  return `${sign}${score.toFixed(3)}`;
}

export function newsHealthColor(score: number | null): string {
  if (score == null) return 'text-slate-500';
  if (score >= 60) return 'text-emerald-600';
  if (score <= 40) return 'text-rose-600';
  return 'text-amber-600';
}
