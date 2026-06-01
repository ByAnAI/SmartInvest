import { fetchWatchlistApi, getDefaultWatchlistApiBase, readWatchlistJson } from '../utils/watchlistApiFetch';

export type MacroReportCachePayload = {
  report_date: string | null;
  found: boolean;
  content: string | null;
  path?: string | null;
  saved_at_utc?: string;
};

/** Local calendar date YYYY-MM-DD (matches report file label for "today"). */
export function localReportDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function fetchMacroReportForDate(
  reportDate: string,
  apiBase?: string
): Promise<MacroReportCachePayload> {
  const base = apiBase ?? getDefaultWatchlistApiBase();
  const res = await fetchWatchlistApi(
    base,
    `/api/macro/report?report_date=${encodeURIComponent(reportDate)}`
  );
  return readWatchlistJson<MacroReportCachePayload>(res);
}

export async function fetchLatestMacroReport(apiBase?: string): Promise<MacroReportCachePayload> {
  const base = apiBase ?? getDefaultWatchlistApiBase();
  const res = await fetchWatchlistApi(base, '/api/macro/report?latest=1');
  return readWatchlistJson<MacroReportCachePayload>(res);
}

export async function saveMacroReportForDate(
  reportDate: string,
  content: string,
  apiBase?: string
): Promise<{ report_date: string; path?: string; saved?: boolean }> {
  const base = apiBase ?? getDefaultWatchlistApiBase();
  const res = await fetchWatchlistApi(base, '/api/macro/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_date: reportDate, content }),
  });
  return readWatchlistJson(res);
}

/** Strip file header lines when displaying saved report text. */
export function stripMacroReportFileHeader(raw: string): string {
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].startsWith('#')) i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  return lines.slice(i).join('\n').trim();
}
