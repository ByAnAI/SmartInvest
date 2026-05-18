import { fetchWatchlistApi, getDefaultWatchlistApiBase, readWatchlistJson } from '../utils/watchlistApiFetch';

export type MacroIndicatorRow = {
  indicator: string;
  value: number | null;
  date: string | null;
  collection_date: string | null;
  collection_utc: string | null;
};

export type MacroDailyPayload = {
  path?: string;
  collection_date: string | null;
  collection_utc: string | null;
  indicators: MacroIndicatorRow[];
};

export async function fetchMacroDaily(apiBase?: string): Promise<MacroDailyPayload> {
  const base = apiBase ?? getDefaultWatchlistApiBase();
  const res = await fetchWatchlistApi(base, '/api/macro/daily');
  return readWatchlistJson<MacroDailyPayload>(res);
}

/** Format values for dashboard display based on indicator name. */
export function formatMacroValue(indicator: string, value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  const name = indicator.toLowerCase();
  if (name === 'cpi' || name === 'ppi') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  if (
    name.includes('rate') ||
    name.includes('yield') ||
    name.includes('spread') ||
    name.includes('participation') ||
    name.includes('curve')
  ) {
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }
  if (name.includes('gdp') || name.includes('retail') || name.includes('payrolls') || name.includes('balance sheet')) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (name.includes('claims')) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (name.includes('money supply')) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (name.includes('usd index')) return value.toFixed(4);
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export const MACRO_INDICATOR_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: 'Growth',
    keys: ['GDP', 'Industrial Production', 'Retail Sales'],
  },
  {
    title: 'Labor',
    keys: ['Unemployment Rate', 'Non-Farm Payrolls', 'Jobless Claims', 'Labor Participation Rate'],
  },
  {
    title: 'Inflation & rates',
    keys: [
      'CPI',
      'PPI',
      'Fed Funds Rate',
      '10Y Treasury Yield',
      '2Y Treasury Yield',
      'Yield Curve (10Y-2Y)',
    ],
  },
  {
    title: 'Liquidity & FX',
    keys: ['USD Index', 'High Yield Credit Spread', 'Fed Balance Sheet', 'Money Supply'],
  },
];
