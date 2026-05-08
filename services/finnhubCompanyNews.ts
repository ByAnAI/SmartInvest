/**
 * Finnhub company news for AI insight prompts and on-screen “Recent company news”.
 * https://finnhub.io/docs/api/company-news — symbol, from, to (YYYY-MM-DD), token.
 */

export interface FinnhubArticleRow {
  datetime: number;
  headline: string;
  source: string;
  summary: string;
  url: string;
}

export type FinnhubNewsBundle =
  | { status: 'ok'; ticker: string; articles: FinnhubArticleRow[] }
  | { status: 'skipped_no_key' }
  | { status: 'empty'; ticker: string }
  | { status: 'error'; ticker: string; message: string };

export type FinnhubNewsFetchResult =
  | { status: 'ok'; text: string }
  | { status: 'skipped_no_key' }
  | { status: 'empty' }
  | { status: 'error'; message: string };

/** Latest N company-news items per ticker (Finnhub returns symbol-scoped results). Used for AI prompts on CPU. */
export const FINNHUB_COMPANY_NEWS_MAX_ARTICLES_AI = 3;

function articlesToPromptText(articles: FinnhubArticleRow[]): string {
  const lines: string[] = [];
  articles.forEach((item, i) => {
    const dt = item.datetime
      ? new Date(item.datetime * 1000).toISOString().slice(0, 10)
      : '?';
    const headline = String(item.headline ?? '').slice(0, 240);
    const src = String(item.source ?? '');
    const summary = item.summary ? String(item.summary).slice(0, 320) : '';
    lines.push(`${i + 1}. [${dt}] ${headline}`);
    if (summary.trim()) lines.push(`   Summary: ${summary}`);
    lines.push(`   Source: ${src}`);
  });
  return lines.join('\n');
}

/** Shared fetch — use for UI list and for prompt text. */
export async function fetchFinnhubCompanyNewsBundle(
  symbol: string,
  options?: { daysBack?: number; maxArticles?: number }
): Promise<FinnhubNewsBundle> {
  const token = import.meta.env.VITE_FINNHUB_KEY?.trim();
  if (!token) return { status: 'skipped_no_key' };

  const sym = symbol.trim().toUpperCase();
  if (!sym) return { status: 'empty', ticker: '' };

  const daysBack = options?.daysBack ?? 21;
  const maxArticles = options?.maxArticles ?? 18;

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const url = new URL('https://finnhub.io/api/v1/company-news');
  url.searchParams.set('symbol', sym);
  url.searchParams.set('from', fromStr);
  url.searchParams.set('to', toStr);
  url.searchParams.set('token', token);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      const t = await res.text();
      return { status: 'error', ticker: sym, message: `${res.status}: ${t.slice(0, 200)}` };
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { status: 'empty', ticker: sym };
    }

    const sorted = [...data].sort(
      (a: { datetime?: number }, b: { datetime?: number }) =>
        (b.datetime ?? 0) - (a.datetime ?? 0)
    );

    const articles: FinnhubArticleRow[] = sorted.slice(0, maxArticles).map((item: Record<string, unknown>) => ({
      datetime: typeof item.datetime === 'number' ? item.datetime : 0,
      headline: String(item.headline ?? ''),
      source: String(item.source ?? ''),
      summary: item.summary != null ? String(item.summary) : '',
      url: item.url != null ? String(item.url) : '',
    }));

    return { status: 'ok', ticker: sym, articles };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 'error', ticker: sym, message: msg };
  }
}

export async function fetchFinnhubCompanyNewsForInsight(
  symbol: string,
  options?: { daysBack?: number; maxArticles?: number }
): Promise<FinnhubNewsFetchResult> {
  const bundle = await fetchFinnhubCompanyNewsBundle(symbol, options);
  switch (bundle.status) {
    case 'skipped_no_key':
      return { status: 'skipped_no_key' };
    case 'empty':
      return { status: 'empty' };
    case 'error':
      return { status: 'error', message: bundle.message };
    case 'ok':
      return { status: 'ok', text: articlesToPromptText(bundle.articles) };
    default:
      return { status: 'empty' };
  }
}

/** Format article list for the LLM (same text as inside `fetchFinnhubCompanyNewsForInsight`). */
export function formatArticlesForInsightPrompt(articles: FinnhubArticleRow[]): string {
  return articlesToPromptText(articles);
}

/** Map a loaded bundle to the string we pass into `buildContextualInsightPrompt`. */
export function promptBlockFromBundle(bundle: FinnhubNewsBundle): string {
  if (bundle.status === 'ok') return articlesToPromptText(bundle.articles);
  if (bundle.status === 'skipped_no_key') return formatFinnhubNewsBlockForPrompt({ status: 'skipped_no_key' });
  if (bundle.status === 'empty') return formatFinnhubNewsBlockForPrompt({ status: 'empty' });
  return formatFinnhubNewsBlockForPrompt({ status: 'error', message: bundle.message });
}

/** Human-readable block for LLM prompts (never throws). */
export function formatFinnhubNewsBlockForPrompt(result: FinnhubNewsFetchResult): string {
  switch (result.status) {
    case 'skipped_no_key':
      return '(Finnhub company news not loaded — set VITE_FINNHUB_KEY in project .env and restart the dev server.)';
    case 'empty':
      return '(No Finnhub articles returned for this symbol in the requested date range — coverage may be limited by exchange or tier.)';
    case 'error':
      return `(Finnhub company news request failed: ${result.message})`;
    default:
      return result.text;
  }
}
