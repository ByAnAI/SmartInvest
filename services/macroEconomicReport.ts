import { generateTextCompletion } from './geminiService';
import { formatMacroValue, type MacroIndicatorRow } from './macroDaily';

const MACRO_ECONOMIC_REPORT_PROMPT = `You are a senior macroeconomic strategist at a top-tier investment firm.

You will be given a dataset of US macroeconomic indicators including:
- Growth indicators (GDP, Industrial Production, Retail Sales)
- Employment indicators (Unemployment, Payrolls, Jobless Claims, Labor Participation)
- Inflation indicators (CPI, PPI)
- Interest rates (Fed Funds, 10Y, 2Y yields)
- Yield curve spread
- Business sentiment indicators (Consumer Confidence, ISM PMI if available)
- Financial conditions (USD index, credit spreads, Fed balance sheet, money supply)

Your task is to produce a professional macroeconomic report for investors.

---

## INPUT DATA
You will receive a table or JSON with:
- indicator name
- latest value
- last release date

---

## OUTPUT REQUIREMENTS

Write a structured report with the following sections:

### 1. Executive Summary
- 5–8 bullet points summarizing the current macro regime
- Clearly state if the environment is:
  (risk-on / risk-off / recessionary / expansion / stagflation / tightening / easing)

---

### 2. Growth Outlook
- Analyze GDP, Industrial Production, Retail Sales
- Explain whether growth is accelerating or slowing
- Connect to equity market implications (bullish/bearish)

---

### 3. Labor Market Conditions
- Analyze unemployment, payrolls, jobless claims, participation rate
- Explain if labor market is tight or weakening
- Link to Fed policy expectations

---

### 4. Inflation Trend
- Analyze CPI and PPI
- State whether inflation is sticky, rising, or cooling
- Explain impact on interest rates and equity valuations

---

### 5. Interest Rates & Yield Curve
- Analyze Fed Funds Rate, 10Y, 2Y yields
- Explicitly interpret yield curve slope:
  - positive = expansion
  - inverted = recession risk
- Explain implications for banks, equities, and risk assets

---

### 6. Market Liquidity & Financial Conditions
- Analyze USD index, credit spreads, Fed balance sheet, M2
- Explain if liquidity is tightening or easing
- Connect to risk assets (stocks, crypto, credit)

---

### 7. Overall Market Impact
- Combine all signals into a single market view:
  - bullish / bearish / neutral
- Explain sector implications:
  - tech, financials, energy, defensive sectors
- Mention risk scenarios

---

### 8. Final Investment Takeaway
- One clear paragraph summarizing positioning guidance
- Keep it concise and institutional-grade

---

## STYLE RULES
- Be professional and concise (Wall Street research style)
- No fluff or generic explanations
- Always connect macro data → market impact
- Use clear cause-and-effect reasoning
- Avoid repeating indicator values without interpretation

---

## INPUT DATA
{macro_indicators_data}

---

Now generate the macroeconomic report.`;

export function buildMacroIndicatorsDataBlock(
  rows: MacroIndicatorRow[],
  meta?: { collection_date?: string | null; collection_utc?: string | null }
): string {
  const payload = {
    collection_date: meta?.collection_date ?? null,
    collection_utc: meta?.collection_utc ?? null,
    indicators: rows.map((r) => ({
      indicator: r.indicator,
      latest_value: r.value,
      latest_value_display: formatMacroValue(r.indicator, r.value),
      last_release_date: r.date,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function buildMacroEconomicReportPrompt(dataBlock: string): string {
  return MACRO_ECONOMIC_REPORT_PROMPT.replace('{macro_indicators_data}', dataBlock);
}

/** Institutional macro report (markdown sections) from latest macro_daily.csv snapshot. */
export async function generateMacroEconomicReport(
  rows: MacroIndicatorRow[],
  meta?: { collection_date?: string | null; collection_utc?: string | null }
): Promise<string> {
  if (!rows.length) {
    throw new Error('No macro indicators loaded. Refresh data before generating a report.');
  }
  const dataBlock = buildMacroIndicatorsDataBlock(rows, meta);
  const prompt = buildMacroEconomicReportPrompt(dataBlock);
  const text = await generateTextCompletion(prompt, 8192, { temperature: 0.35 });
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('AI returned an empty macro report. Please retry.');
  }
  return trimmed;
}
