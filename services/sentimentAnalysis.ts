/**
 * News-based sentiment for simulated portfolio equity tickers.
 * Default: Alpha Vantage via Watchlist API (no Hugging Face).
 * Optional LLM path: Finnhub headlines + VITE_LLM_PROVIDER (set VITE_SENTIMENT_SOURCE=llm).
 */

import { fetchFinnhubCompanyNewsBundle, type FinnhubArticleRow } from './finnhubCompanyNews';
import { generateJsonCompletion, getLlmProvider, parseModelJson } from './geminiService';
import { loadMarketSimulationState } from './marketSimulation';
import {
  fetchPortfolioNewsSentiment,
  type PositionNewsSentiment,
} from './portfolioNewsSentiment';
import type {
  NewsArticleSentimentRow,
  NewsSentimentLabel,
  NewsSentimentPolarity,
  ShortTermImpactDirection,
  TickerNewsSentimentAnalysis,
} from '../types';

const MAX_ARTICLES_FOR_LLM = 14;
const FALLBACK_NEWS_LOOKBACK_DAYS = [90, 180, 365, 730, 1825];

export type SentimentAnalysisSource = 'alphavantage' | 'llm';

/** Default alphavantage — avoids HF when VITE_LLM_PROVIDER is unset or hf fails. */
export function getSentimentAnalysisSource(): SentimentAnalysisSource {
  const v = import.meta.env.VITE_SENTIMENT_SOURCE?.trim().toLowerCase();
  if (v === 'llm' || v === 'hf' || v === 'ollama' || v === 'gemini' || v === 'ai') return 'llm';
  return 'alphavantage';
}

function scoreToPolarity(score: number): NewsSentimentPolarity {
  if (score > 0.05) return 'POSITIVE';
  if (score < -0.05) return 'NEGATIVE';
  return 'NEUTRAL';
}

function scoreToNewsLabel(score: number): NewsSentimentLabel {
  if (score > 0.12) return 'BULLISH';
  if (score < -0.12) return 'BEARISH';
  return 'NEUTRAL';
}

function shortTermFromScore(avg: number): { direction: ShortTermImpactDirection; confidence: number } {
  const confidence = Math.min(1, Math.max(0, Math.abs(avg) * 2));
  if (avg > 0.1) return { direction: 'UP', confidence };
  if (avg < -0.1) return { direction: 'DOWN', confidence };
  return { direction: 'NO IMPACT', confidence };
}

function normalizeAlphaVantageTime(raw: string | null | undefined): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return s;
  const [, y, mo, d, h = '00', mi = '00', sec = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}Z`;
}

function normalizeArticleTextKey(value: string | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function articleDateKey(value: string | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function articleTimeMs(article: NewsArticleSentimentRow): number {
  if (!article.publishedAt) return 0;
  const t = new Date(article.publishedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function articleDedupeKey(article: NewsArticleSentimentRow): string {
  const url = normalizeArticleTextKey(article.url);
  if (url) return `url:${url}`;

  const title = normalizeArticleTextKey(article.title);
  const source = normalizeArticleTextKey(article.source);
  const date = articleDateKey(article.publishedAt);
  return `title:${title}|source:${source}|date:${date}`;
}

function dedupeArticleRows(articles: NewsArticleSentimentRow[]): NewsArticleSentimentRow[] {
  const seen = new Set<string>();
  const out: NewsArticleSentimentRow[] = [];
  for (const article of articles) {
    const key = articleDedupeKey(article);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(article);
  }
  return out;
}

function selectSentimentArticleRows(articles: NewsArticleSentimentRow[]): NewsArticleSentimentRow[] {
  const sorted = dedupeArticleRows(articles).sort((a, b) => articleTimeMs(b) - articleTimeMs(a));
  return sorted.slice(0, 5);
}

function selectFinnhubArticlesForSentiment(articles: FinnhubArticleRow[]): FinnhubArticleRow[] {
  const seen = new Set<string>();
  const deduped: FinnhubArticleRow[] = [];
  for (const article of articles) {
    const publishedAt = article.datetime ? new Date(article.datetime * 1000).toISOString() : '';
    const url = normalizeArticleTextKey(article.url);
    const key = url
      ? `url:${url}`
      : `title:${normalizeArticleTextKey(article.headline)}|source:${normalizeArticleTextKey(article.source)}|date:${articleDateKey(publishedAt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(article);
  }

  const sorted = deduped.sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0));
  return sorted.slice(0, 5);
}

async function fetchLatestFinnhubArticlesForFallback(
  ticker: string,
  maxArticles = 5
): Promise<FinnhubArticleRow[]> {
  for (const daysBack of FALLBACK_NEWS_LOOKBACK_DAYS) {
    const bundle = await fetchFinnhubCompanyNewsBundle(ticker, { daysBack, maxArticles });
    if (bundle.status === 'ok' && bundle.articles.length > 0) {
      return selectFinnhubArticlesForSentiment(bundle.articles).slice(0, maxArticles);
    }
    if (bundle.status === 'skipped_no_key' || bundle.status === 'error') return [];
  }
  return [];
}

function finnhubFallbackArticlesToNeutralRows(articles: FinnhubArticleRow[]): NewsArticleSentimentRow[] {
  return articles.map((a) => ({
    title: String(a.headline ?? '').slice(0, 500),
    sentiment: 'NEUTRAL',
    score: 0,
    reason: 'Latest available article fallback; no ticker sentiment score was returned by the primary news source.',
    publishedAt: a.datetime ? new Date(a.datetime * 1000).toISOString() : undefined,
    source: (a.source || '').trim() || undefined,
    url: (a.url || '').trim() || undefined,
  }));
}

export function articleSignalSentimentSummary(articles: NewsArticleSentimentRow[]): {
  score: number;
  label: NewsSentimentLabel;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  signalCount: number;
  totalCount: number;
} {
  let sum = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;

  for (const article of articles) {
    const sentiment = article.sentiment;
    const score = Number.isFinite(article.score) ? clamp(article.score, -1, 1) : 0;
    if (sentiment === 'POSITIVE') {
      positiveCount += 1;
      sum += score;
    } else if (sentiment === 'NEGATIVE') {
      negativeCount += 1;
      sum += score;
    } else {
      neutralCount += 1;
    }
  }

  const signalCount = positiveCount + negativeCount;
  const score = signalCount > 0 ? sum / signalCount : 0;
  return {
    score,
    label: scoreToNewsLabel(score),
    positiveCount,
    negativeCount,
    neutralCount,
    signalCount,
    totalCount: articles.length,
  };
}

function applyArticleSignalScore(analysis: TickerNewsSentimentAnalysis): TickerNewsSentimentAnalysis {
  const article_analysis = selectSentimentArticleRows(analysis.article_analysis);
  const summary = articleSignalSentimentSummary(article_analysis);
  const score = summary.signalCount > 0 ? summary.score : 0;
  return {
    ...analysis,
    article_analysis,
    overall_sentiment: { score, label: summary.label },
    short_term_impact: shortTermFromScore(score),
  };
}

function mapAvPositionToTickerAnalysis(p: PositionNewsSentiment): TickerNewsSentimentAnalysis {
  const article_analysis: NewsArticleSentimentRow[] = (p.articles ?? []).map((a) => {
    const score = typeof a.sentiment === 'number' && Number.isFinite(a.sentiment) ? a.sentiment : 0;
    return {
      title: String(a.title ?? '').slice(0, 500),
      sentiment: scoreToPolarity(score),
      score: clamp(score, -1, 1),
      reason: `Alpha Vantage: ${a.sentiment_label ?? '—'}`,
      publishedAt: normalizeAlphaVantageTime(a.time),
      source: a.source?.trim() || undefined,
      url: a.url?.trim() || undefined,
    };
  });
  return applyArticleSignalScore({
    ticker: p.symbol.toUpperCase(),
    article_analysis,
    overall_sentiment: { score: 0, label: 'NEUTRAL' },
    short_term_impact: shortTermFromScore(0),
    detected_events: [],
  });
}

/** Batch sentiment from Alpha Vantage (Watchlist API must be running). */
export async function analyzePortfolioViaAlphaVantage(
  tickers: string[]
): Promise<Record<string, TickerNewsSentimentAnalysis>> {
  const payload = await fetchPortfolioNewsSentiment(tickers);
  const out: Record<string, TickerNewsSentimentAnalysis> = {};
  for (const p of payload.positions) {
    const mapped = mapAvPositionToTickerAnalysis(p);
    if (mapped.article_analysis.length === 0) {
      const fallbackArticles = await fetchLatestFinnhubArticlesForFallback(p.symbol, 5);
      if (fallbackArticles.length > 0) {
        out[p.symbol.toUpperCase()] = applyArticleSignalScore({
          ...mapped,
          article_analysis: finnhubFallbackArticlesToNeutralRows(fallbackArticles),
        });
        continue;
      }
    }
    out[p.symbol.toUpperCase()] = mapped;
  }
  return out;
}

export type NewsItemForPrompt = {
  title: string;
  summary?: string;
  source: string;
  url: string;
  published_at: string;
};

export function equityHoldingsFromSimulation(userId: string | null | undefined): Array<{ ticker: string; companyName: string }> {
  const state = loadMarketSimulationState(userId ?? undefined);
  const map = new Map<string, string>();
  for (const p of state.positions) {
    if (p.kind !== 'equity') continue;
    const t = p.symbol.trim().toUpperCase();
    if (!t) continue;
    if (!map.has(t)) map.set(t, (p.assetLabel || t).trim() || t);
  }
  return [...map.entries()].map(([ticker, companyName]) => ({ ticker, companyName }));
}

export function finnhubArticlesToNewsItems(articles: FinnhubArticleRow[]): NewsItemForPrompt[] {
  return articles.slice(0, MAX_ARTICLES_FOR_LLM).map((a) => ({
    title: String(a.headline ?? '').slice(0, 480),
    summary: a.summary?.trim() ? String(a.summary).slice(0, 420) : undefined,
    source: String(a.source ?? ''),
    url: String(a.url ?? '').trim(),
    published_at: a.datetime ? new Date(a.datetime * 1000).toISOString() : '',
  }));
}

function formatNewsList(items: NewsItemForPrompt[]): string {
  const lines: string[] = [];
  items.forEach((n, i) => {
    lines.push(`${i + 1}. title: ${n.title}`);
    if (n.summary?.trim()) lines.push(`   summary: ${n.summary}`);
    lines.push(`   source: ${n.source}`);
    if (n.url) lines.push(`   url: ${n.url}`);
    lines.push(`   published_at: ${n.published_at || '(unknown)'}`);
  });
  return lines.join('\n');
}

function buildSentimentPrompt(ticker: string, companyName: string, newsItems: NewsItemForPrompt[]): string {
  const newsBlock = formatNewsList(newsItems);
  return `Your task is to analyze the sentiment impact of news articles on a given stock ticker.

INPUT:
- Ticker: ${ticker}
- Company: ${companyName}
- News Articles:
${newsBlock}

---

INSTRUCTIONS:

1. For EACH news article:
   - Determine sentiment: POSITIVE, NEGATIVE, or NEUTRAL
   - Assign a sentiment score between -1 and +1
   - Explain briefly (1 sentence) WHY

2. Then compute:
   - Overall sentiment score (average)
   - Sentiment label (BULLISH, BEARISH, NEUTRAL)

3. Estimate SHORT-TERM IMPACT (next 1–3 days):
   - UP / DOWN / NO IMPACT
   - Confidence score (0–1)

4. Detect if news contains:
   - Earnings
   - M&A
   - Regulation
   - Macro events
   - Product launches

5. Weight more heavily:
   - Recent news
   - Reputable sources
   - High-impact events

---

OUTPUT FORMAT (STRICT JSON ONLY — no markdown, no commentary):

{
  "ticker": "${ticker}",
  "article_analysis": [
    {
      "title": "...",
      "sentiment": "POSITIVE | NEGATIVE | NEUTRAL",
      "score": 0.0,
      "reason": "..."
    }
  ],
  "overall_sentiment": {
    "score": 0.0,
    "label": "BULLISH | BEARISH | NEUTRAL"
  },
  "short_term_impact": {
    "direction": "UP | DOWN | NO IMPACT",
    "confidence": 0.0
  },
  "detected_events": ["earnings", "macro"]
}

RULES:
- Be objective and data-driven.
- Do NOT invent facts outside the provided news text.
- If information is insufficient, use NEUTRAL scores and NO IMPACT where appropriate.
- Keep explanations concise.
- detected_events: use lowercase snake-style tags such as earnings, ma, regulation, macro, product_launch when clearly suggested by the articles.`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parsePolarity(s: unknown): NewsSentimentPolarity {
  const u = String(s ?? '').toUpperCase();
  if (u === 'POSITIVE' || u === 'NEGATIVE' || u === 'NEUTRAL') return u;
  return 'NEUTRAL';
}

function parseLabel(s: unknown): NewsSentimentLabel {
  const u = String(s ?? '').toUpperCase();
  if (u === 'BULLISH' || u === 'BEARISH' || u === 'NEUTRAL') return u;
  return 'NEUTRAL';
}

function parseDirection(s: unknown): ShortTermImpactDirection {
  const u = String(s ?? '').toUpperCase().replace(/\s+/g, ' ');
  if (u === 'UP' || u === 'DOWN') return u;
  if (u === 'NO IMPACT' || u === 'NO_IMPACT' || u === 'NONE') return 'NO IMPACT';
  return 'NO IMPACT';
}

/** Attach Finnhub source + article URL by matching LLM titles to fetched headlines. */
function enrichArticleAnalysisWithFinnhub(rows: NewsArticleSentimentRow[], finnhub: FinnhubArticleRow[]): NewsArticleSentimentRow[] {
  let remaining = [...finnhub];
  return rows.map((r) => {
    const t = r.title.trim().toLowerCase();
    let mi = remaining.findIndex((a) => String(a.headline ?? '').trim().toLowerCase() === t);
    if (mi < 0 && t.length >= 10) {
      mi = remaining.findIndex((a) =>
        String(a.headline ?? '')
          .toLowerCase()
          .includes(t.slice(0, Math.min(48, t.length)))
      );
    }
    if (mi < 0 && t.length >= 8) {
      mi = remaining.findIndex((a) =>
        String(a.headline ?? '')
          .toLowerCase()
          .includes(t.slice(0, 24))
      );
    }
    if (mi >= 0) {
      const [a] = remaining.splice(mi, 1);
      return {
        ...r,
        source: (a.source || '').trim() || 'Unknown',
        url: (a.url || '').trim(),
        publishedAt: a.datetime ? new Date(a.datetime * 1000).toISOString() : r.publishedAt,
      };
    }
    return {
      ...r,
      source: (r.source && r.source.trim()) || 'Unknown',
      url: (r.url || '').trim(),
    };
  });
}

function normalizeAnalysis(raw: unknown, ticker: string): TickerNewsSentimentAnalysis {
  const base: TickerNewsSentimentAnalysis = {
    ticker: ticker.toUpperCase(),
    article_analysis: [],
    overall_sentiment: { score: 0, label: 'NEUTRAL' },
    short_term_impact: { direction: 'NO IMPACT', confidence: 0 },
    detected_events: [],
  };

  if (!raw || typeof raw !== 'object') return base;

  const o = raw as Record<string, unknown>;

  const articlesRaw = Array.isArray(o.article_analysis) ? o.article_analysis : [];
  base.article_analysis = articlesRaw.map((row): NewsArticleSentimentRow => {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    return {
      title: String(r.title ?? '').slice(0, 500),
      sentiment: parsePolarity(r.sentiment),
      score: clamp(typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0, -1, 1),
      reason: String(r.reason ?? '').slice(0, 400),
      publishedAt: String(r.publishedAt ?? r.published_at ?? '').trim().slice(0, 80) || undefined,
      source: String(r.source ?? '').trim().slice(0, 120) || undefined,
      url: String(r.url ?? '').trim().slice(0, 2000) || undefined,
    };
  });

  const overall = o.overall_sentiment && typeof o.overall_sentiment === 'object' ? (o.overall_sentiment as Record<string, unknown>) : {};
  base.overall_sentiment = {
    score: clamp(typeof overall.score === 'number' && Number.isFinite(overall.score) ? overall.score : 0, -1, 1),
    label: parseLabel(overall.label),
  };

  const st = o.short_term_impact && typeof o.short_term_impact === 'object' ? (o.short_term_impact as Record<string, unknown>) : {};
  const conf =
    typeof st.confidence === 'number' && Number.isFinite(st.confidence) ? clamp(st.confidence, 0, 1) : 0;
  base.short_term_impact = {
    direction: parseDirection(st.direction),
    confidence: conf,
  };

  const ev = o.detected_events;
  if (Array.isArray(ev)) {
    base.detected_events = ev.map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  }

  return base;
}

/** Neutral stub when there are no articles (caller shows a short message). */
export function emptyNewsSentimentStub(ticker: string): TickerNewsSentimentAnalysis {
  return {
    ticker: ticker.trim().toUpperCase(),
    article_analysis: [],
    overall_sentiment: { score: 0, label: 'NEUTRAL' },
    short_term_impact: { direction: 'NO IMPACT', confidence: 0 },
    detected_events: [],
  };
}

/**
 * Fetch Finnhub company news and run structured sentiment JSON via HF.
 */
export async function analyzeTickerNewsSentiment(
  ticker: string,
  companyName: string,
  options?: { daysBack?: number; maxArticles?: number; source?: SentimentAnalysisSource }
): Promise<TickerNewsSentimentAnalysis> {
  const sym = ticker.trim().toUpperCase();
  const source = options?.source ?? getSentimentAnalysisSource();

  if (source === 'alphavantage') {
    const batch = await analyzePortfolioViaAlphaVantage([sym]);
    const data = batch[sym];
    if (data) return data;
    return emptyNewsSentimentStub(sym);
  }

  let bundle = await fetchFinnhubCompanyNewsBundle(sym, {
    daysBack: options?.daysBack ?? 21,
    maxArticles: options?.maxArticles ?? 18,
  });

  if (bundle.status === 'empty') {
    for (const daysBack of FALLBACK_NEWS_LOOKBACK_DAYS) {
      bundle = await fetchFinnhubCompanyNewsBundle(sym, {
        daysBack,
        maxArticles: options?.maxArticles ?? 18,
      });
      if (bundle.status !== 'empty') break;
    }
  }

  if (bundle.status === 'skipped_no_key') {
    throw new Error('Finnhub API key missing. Add VITE_FINNHUB_KEY to load company news.');
  }
  if (bundle.status === 'error') {
    throw new Error(bundle.message || 'Finnhub news request failed.');
  }
  if (bundle.status !== 'ok' || bundle.articles.length === 0) {
    return emptyNewsSentimentStub(sym);
  }

  return analyzeArticlesSentiment(sym, companyName, bundle.articles);
}

export type FetchNewsResult =
  | { status: 'ok'; articles: FinnhubArticleRow[] }
  | { status: 'skipped_no_key' }
  | { status: 'empty' }
  | { status: 'error'; message: string };

export async function fetchNewsOnly(
  ticker: string,
  options?: { daysBack?: number; maxArticles?: number }
): Promise<FetchNewsResult> {
  const bundle = await fetchFinnhubCompanyNewsBundle(ticker.trim().toUpperCase(), options);
  if (bundle.status === 'skipped_no_key') return { status: 'skipped_no_key' };
  if (bundle.status === 'error') return { status: 'error', message: bundle.message };
  if (bundle.status === 'empty') return { status: 'empty' };
  return { status: 'ok', articles: bundle.articles };
}

/** Run sentiment on already-fetched articles (e.g. batch flow). */
export async function analyzeArticlesSentiment(
  ticker: string,
  companyName: string,
  articles: FinnhubArticleRow[]
): Promise<TickerNewsSentimentAnalysis> {
  const sym = ticker.trim().toUpperCase();
  const selectedArticles = selectFinnhubArticlesForSentiment(articles);
  if (!selectedArticles.length) {
    return {
      ticker: sym,
      article_analysis: [],
      overall_sentiment: { score: 0, label: 'NEUTRAL' },
      short_term_impact: { direction: 'NO IMPACT', confidence: 0 },
      detected_events: [],
    };
  }
  const items = finnhubArticlesToNewsItems(selectedArticles);
  const prompt = buildSentimentPrompt(sym, companyName || sym, items);
  const raw = await generateJsonCompletion(prompt, 8192);
  const jsonStr = parseModelJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('AI returned invalid JSON for sentiment analysis.');
  }
  const normalized = normalizeAnalysis(parsed, sym);
  normalized.article_analysis = enrichArticleAnalysisWithFinnhub(normalized.article_analysis, selectedArticles);
  return applyArticleSignalScore(normalized);
}

/** Ticker counts toward portfolio average only if overall score or article-level signal is non-neutral / non-zero. */
function tickerHasMeaningfulSentimentSignal(r: TickerNewsSentimentAnalysis): boolean {
  const overall = r.overall_sentiment?.score;
  if (typeof overall === 'number' && Number.isFinite(overall) && Math.abs(overall) > 1e-9) return true;
  return (r.article_analysis ?? []).some((a) => {
    const sc = a.score;
    if (typeof sc === 'number' && Number.isFinite(sc) && Math.abs(sc) > 1e-9) return true;
    const pol = String(a.sentiment ?? '').toUpperCase();
    return pol === 'POSITIVE' || pol === 'NEGATIVE';
  });
}

export function portfolioAggregateSentiment(results: TickerNewsSentimentAnalysis[]): {
  avgScore: number | null;
  label: NewsSentimentLabel;
  /** Tickers included in the average denominator (non-zero / non-neutral sentiment signal). */
  count: number;
  /** How many tickers had a meaningful signal; if 0, average falls back to all analyzed tickers. */
  eligibleForAvg: number;
  totalAnalyzed: number;
  usedFallback: boolean;
} {
  if (results.length === 0) {
    return { avgScore: null, label: 'NEUTRAL', count: 0, eligibleForAvg: 0, totalAnalyzed: 0, usedFallback: false };
  }
  const pool = results.filter(tickerHasMeaningfulSentimentSignal);
  const usedFallback = pool.length === 0;
  const basis = usedFallback ? results : pool;
  const scores = basis.map((r) => r.overall_sentiment.score).filter((s) => Number.isFinite(s));
  if (scores.length === 0) {
    return {
      avgScore: null,
      label: 'NEUTRAL',
      count: 0,
      eligibleForAvg: pool.length,
      totalAnalyzed: results.length,
      usedFallback,
    };
  }
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const label: NewsSentimentLabel =
    avgScore > 0.12 ? 'BULLISH' : avgScore < -0.12 ? 'BEARISH' : 'NEUTRAL';
  return {
    avgScore,
    label,
    count: scores.length,
    eligibleForAvg: pool.length,
    totalAnalyzed: results.length,
    usedFallback,
  };
}
