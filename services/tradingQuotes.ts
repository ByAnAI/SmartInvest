/**
 * Live quotes for Trading Platform: forex via open.er-api (USD base), crypto/metals via Finnhub quote.
 */

const FINNHUB_QUOTE = 'https://finnhub.io/api/v1/quote';

/** Base / quote for pairs used on the Trading Platform (aligned with components/ForexData). */
const FOREX_PAIR_META: Record<string, { base: string; quote: string }> = {
  EURUSD: { base: 'EUR', quote: 'USD' },
  GBPUSD: { base: 'GBP', quote: 'USD' },
  USDCAD: { base: 'USD', quote: 'CAD' },
  USDCHF: { base: 'USD', quote: 'CHF' },
  EURCHF: { base: 'EUR', quote: 'CHF' },
  EURGBP: { base: 'EUR', quote: 'GBP' },
  USDJPY: { base: 'USD', quote: 'JPY' },
  EURJPY: { base: 'EUR', quote: 'JPY' },
  GBPJPY: { base: 'GBP', quote: 'JPY' },
};

export function getFinnhubToken(): string | undefined {
  return (import.meta.env.VITE_FINNHUB_KEY as string | undefined)?.trim() || undefined;
}

/** Internal keys for `FOREX_PAIR_META` (GBP/EUR is derived from `EURGBP`). */
export const TRADING_FOREX_SYMBOLS = [
  'EURUSD',
  'GBPUSD',
  'USDCAD',
  'USDCHF',
  'EURCHF',
  'EURGBP', // used to derive GBP/EUR
  'USDJPY',
  'EURJPY',
  'GBPJPY',
] as const;

export type TradingForexSymbol = (typeof TRADING_FOREX_SYMBOLS)[number];

/** Display rows: synthetic GBPEUR = 1/EURGBP */
export const TRADING_FOREX_DISPLAY: { symbol: string; label: string; synthetic?: boolean }[] = [
  { symbol: 'EURUSD', label: 'EUR/USD' },
  { symbol: 'GBPUSD', label: 'GBP/USD' },
  { symbol: 'USDCAD', label: 'USD/CAD' },
  { symbol: 'USDCHF', label: 'USD/CHF' },
  { symbol: 'EURCHF', label: 'EUR/CHF' },
  { symbol: 'GBPEUR', label: 'GBP/EUR', synthetic: true },
  { symbol: 'USDJPY', label: 'USD/JPY' },
  { symbol: 'EURJPY', label: 'EUR/JPY' },
  { symbol: 'GBPJPY', label: 'GBP/JPY' },
];

export async function fetchForexTradingPrices(): Promise<Record<string, number>> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  const data = await res.json();
  if (!data?.rates) return {};

  const computed: Record<string, number> = {};
  TRADING_FOREX_SYMBOLS.forEach((sym) => {
    const pair = FOREX_PAIR_META[sym];
    if (!pair) return;
    const { base, quote } = pair;
    const baseInUsd = base === 'USD' ? 1 : 1 / (data.rates[base] || 1);
    const quotePerUsd = data.rates[quote] || 1;
    computed[sym] = Number((baseInUsd * quotePerUsd).toFixed(5));
  });

  const eurgbp = computed.EURGBP;
  if (eurgbp != null && eurgbp !== 0) {
    computed.GBPEUR = Number((1 / eurgbp).toFixed(5));
  }

  return computed;
}

export type FinnhubCryptoRow = { id: string; label: string; hint: string; finnhub: string };

/** Binance-style USDT pairs on Finnhub */
export const CRYPTO_QUOTE_ROWS: FinnhubCryptoRow[] = [
  { id: 'BTC', label: 'Bitcoin', hint: 'BTC', finnhub: 'BINANCE:BTCUSDT' },
  { id: 'ETH', label: 'Ethereum', hint: 'ETH', finnhub: 'BINANCE:ETHUSDT' },
  { id: 'SOL', label: 'Solana', hint: 'SOL', finnhub: 'BINANCE:SOLUSDT' },
  { id: 'XRP', label: 'XRP', hint: 'XRP', finnhub: 'BINANCE:XRPUSDT' },
  { id: 'BNB', label: 'BNB', hint: 'BNB', finnhub: 'BINANCE:BNBUSDT' },
  { id: 'ADA', label: 'Cardano', hint: 'ADA', finnhub: 'BINANCE:ADAUSDT' },
  { id: 'DOGE', label: 'Dogecoin', hint: 'DOGE', finnhub: 'BINANCE:DOGEUSDT' },
  { id: 'AVAX', label: 'Avalanche', hint: 'AVAX', finnhub: 'BINANCE:AVAXUSDT' },
  { id: 'DOT', label: 'Polkadot', hint: 'DOT', finnhub: 'BINANCE:DOTUSDT' },
  { id: 'MATIC', label: 'Polygon', hint: 'MATIC', finnhub: 'BINANCE:MATICUSDT' },
  { id: 'LINK', label: 'Chainlink', hint: 'LINK', finnhub: 'BINANCE:LINKUSDT' },
  { id: 'ATOM', label: 'Cosmos', hint: 'ATOM', finnhub: 'BINANCE:ATOMUSDT' },
];

export type MetalQuoteRow = { id: string; label: string; finnhub: string; icon: string };

/** Futures / proxy symbols for Finnhub `quote` (ETF rows are spot-style USD). */
export const METAL_QUOTE_ROWS: MetalQuoteRow[] = [
  { id: 'XAU', label: 'Gold', finnhub: 'GC=F', icon: '🥇' },
  { id: 'XAG', label: 'Silver', finnhub: 'SI=F', icon: '🥈' },
  { id: 'OIL', label: 'Oil', finnhub: 'CL=F', icon: '🛢️' },
  { id: 'XCU', label: 'Copper', finnhub: 'HG=F', icon: '🔶' },
  { id: 'NI', label: 'Nickel (ETF)', finnhub: 'JJN', icon: '⬛' },
  { id: 'XPT', label: 'Platinum', finnhub: 'PL=F', icon: '⚪' },
  { id: 'ALI', label: 'Aluminum', finnhub: 'ALI=F', icon: '▫️' },
];

export async function fetchFinnhubQuotes(
  finnhubSymbols: string[],
  token: string
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const symbols = [...new Set(finnhubSymbols)];
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (i > 0) await delay(120);
    try {
      const r = await fetch(`${FINNHUB_QUOTE}?symbol=${encodeURIComponent(sym)}&token=${token}`);
      const data = await r.json();
      const cur =
        data?.c != null && typeof data.c === 'number' && Number.isFinite(data.c) ? data.c : undefined;
      const prevClose =
        data?.pc != null && typeof data.pc === 'number' && Number.isFinite(data.pc) ? data.pc : undefined;
      const px =
        cur != null && cur > 0 ? cur : prevClose != null && prevClose > 0 ? prevClose : undefined;
      if (px != null) out[sym] = px;
    } catch {
      /* keep empty */
    }
  }
  return out;
}
