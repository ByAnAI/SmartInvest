/** Remove markdown # and * for on-screen macro report reading. */
export function cleanMacroReportLine(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/#/g, '')
    .replace(/\*/g, '')
    .trim();
}

/** Numbered report sections (1–8) from the macro strategist prompt. */
export function isMacroReportSectionHeading(line: string): boolean {
  const t = cleanMacroReportLine(line);
  if (!t) return false;
  return /^[1-8]\.\s+\S/.test(t);
}

export type MacroReportLine = { kind: 'heading' | 'paragraph' | 'blank'; text: string };

export function parseMacroReportLines(raw: string): MacroReportLine[] {
  const lines = raw.split(/\r?\n/);
  const out: MacroReportLine[] = [];
  for (const line of lines) {
    const cleaned = cleanMacroReportLine(line);
    if (!cleaned) {
      out.push({ kind: 'blank', text: '' });
      continue;
    }
    if (isMacroReportSectionHeading(line)) {
      out.push({ kind: 'heading', text: cleaned });
      continue;
    }
    out.push({ kind: 'paragraph', text: cleaned });
  }
  return out;
}
