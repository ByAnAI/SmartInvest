export type MarketAssetRow = { symbol: string; name: string };

/** One ticker per line, or comma/tab-separated Symbol,Name. Skips blank lines and # comments. */
export function parseTickerListCsv(text: string): MarketAssetRow[] {
  const seen = new Set<string>();
  const out: MarketAssetRow[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^symbol\s*,/i.test(line) || /^ticker\s*,/i.test(line)) continue;
    const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    const raw = parts[0];
    if (!raw) continue;
    const symbol = raw.toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9^.-]+$/.test(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const name = (parts[1] || symbol).trim() || symbol;
    out.push({ symbol, name });
  }
  return out;
}

/** Excel first sheet → rows with flexible Ticker/Symbol + optional Name. Name defaults to symbol. */
export function parseExcelSheetToMarketAssets(jsonData: Record<string, unknown>[]): MarketAssetRow[] {
  const seen = new Set<string>();
  const out: MarketAssetRow[] = [];
  for (const row of jsonData) {
    const symbolRaw =
      row['Ticker'] ??
      row['Symbol'] ??
      row['symbol'] ??
      row['ticker'] ??
      row['SYMBOL'] ??
      row['TICKER'];
    const nameRaw = row['Name'] ?? row['Company'] ?? row['name'] ?? row['company'] ?? row['NAME'];
    if (symbolRaw == null || String(symbolRaw).trim() === '') continue;
    const symbol = String(symbolRaw).toUpperCase().trim();
    if (!symbol) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const name = nameRaw != null && String(nameRaw).trim() !== '' ? String(nameRaw).trim() : symbol;
    out.push({ symbol, name });
  }
  return out;
}
