import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchMacroDaily,
  formatMacroValue,
  MACRO_INDICATOR_GROUPS,
  type MacroIndicatorRow,
} from '../services/macroDaily';
import { generateMacroEconomicReport } from '../services/macroEconomicReport';
import {
  fetchMacroReportForDate,
  localReportDateKey,
  saveMacroReportForDate,
  stripMacroReportFileHeader,
} from '../services/macroReportCache';
import { formatWatchlistApiFetchError, getDefaultWatchlistApiBase } from '../utils/watchlistApiFetch';
import MacroReportBody from './MacroReportBody';

function formatAsOf(date: string | null): string {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function IndicatorCard({ row }: { row: MacroIndicatorRow; key?: React.Key }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 hover:border-blue-300 hover:bg-blue-50 transition-colors">
      <p className="text-[9px] font-black uppercase tracking-widest text-blue-700 leading-tight line-clamp-2 min-h-[2rem]">
        {row.indicator}
      </p>
      <p className="mt-1 text-lg font-black tabular-nums text-blue-900 tracking-tight">
        {formatMacroValue(row.indicator, row.value)}
      </p>
      <p className="mt-0.5 text-[9px] font-semibold text-blue-500/90 uppercase tracking-wide">
        As of {formatAsOf(row.date)}
      </p>
    </div>
  );
}

const MacroIndicatorsPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MacroIndicatorRow[]>([]);
  const [collectionDate, setCollectionDate] = useState<string | null>(null);
  const [collectionUtc, setCollectionUtc] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportDateLabel, setReportDateLabel] = useState<string | null>(null);
  const [reportFromCache, setReportFromCache] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const apiBase = getDefaultWatchlistApiBase();
    try {
      const data = await fetchMacroDaily(apiBase);
      setRows(data.indicators ?? []);
      setCollectionDate(data.collection_date ?? null);
      setCollectionUtc(data.collection_utc ?? null);
    } catch (e: unknown) {
      setRows([]);
      setError(formatWatchlistApiFetchError(e, `${apiBase}/api/macro/daily`));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byName = useMemo(() => {
    const m = new Map<string, MacroIndicatorRow>();
    for (const r of rows) {
      if (r.indicator) m.set(r.indicator, r);
    }
    return m;
  }, [rows]);

  const ungrouped = useMemo(() => {
    const grouped = new Set(MACRO_INDICATOR_GROUPS.flatMap((g) => g.keys));
    return rows.filter((r) => r.indicator && !grouped.has(r.indicator));
  }, [rows]);

  const collectedLabel = collectionUtc
    ? new Date(collectionUtc).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : collectionDate ?? null;
  const todayReportDate = localReportDateKey();

  const applyCachedReport = useCallback((reportDate: string, raw: string) => {
    setReport(stripMacroReportFileHeader(raw));
    setReportDateLabel(reportDate);
    setReportFromCache(true);
  }, []);

  const loadTodayReportIfSaved = useCallback(async () => {
    const day = localReportDateKey();
    try {
      const apiBase = getDefaultWatchlistApiBase();
      const cached = await fetchMacroReportForDate(day, apiBase);
      if (cached.found && cached.report_date === day && cached.content?.trim()) {
        applyCachedReport(day, cached.content);
        return true;
      }
      setReport(null);
      setReportDateLabel(null);
      setReportFromCache(false);
    } catch {
      /* optional on mount */
    }
    return false;
  }, [applyCachedReport]);

  useEffect(() => {
    if (rows.length === 0) return;
    void loadTodayReportIfSaved();
  }, [rows.length, loadTodayReportIfSaved]);

  const runReport = useCallback(async () => {
    if (rows.length === 0) {
      setReportError('Load macro indicators first.');
      return;
    }
    setReportLoading(true);
    setReportError(null);
    try {
      const day = localReportDateKey();
      const apiBase = getDefaultWatchlistApiBase();
      const cached = await fetchMacroReportForDate(day, apiBase);
      if (cached.found && cached.report_date === day && cached.content?.trim()) {
        applyCachedReport(day, cached.content);
        return;
      }

      const text = await generateMacroEconomicReport(rows, {
        collection_date: collectionDate,
        collection_utc: collectionUtc,
      });
      await saveMacroReportForDate(day, text, apiBase);
      setReport(text);
      setReportDateLabel(day);
      setReportFromCache(false);
    } catch (e: unknown) {
      setReport(null);
      setReportDateLabel(null);
      setReportFromCache(false);
      setReportError(e instanceof Error ? e.message : 'Could not generate macro report.');
    } finally {
      setReportLoading(false);
    }
  }, [rows, collectionDate, collectionUtc, applyCachedReport]);

  return (
    <div className="bg-white border border-blue-100 rounded-[1.5rem] shadow-sm overflow-hidden">
      <div className="p-4 border-b border-blue-50 bg-gradient-to-r from-blue-50/80 to-white flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-blue-900 tracking-tight uppercase tracking-wider">
            US macro indicators
          </h2>
          <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mt-0.5">
            FRED snapshot · backend/data/macro_daily.csv
          </p>
          {collectedLabel ? (
            <p className="text-[10px] text-blue-600/80 mt-1 font-medium">Collected {collectedLabel}</p>
          ) : null}
          <p className="text-[10px] text-blue-600/80 mt-1 font-medium">
            Daily report file: macro_report_{todayReportDate}.txt
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-[10px] font-bold uppercase tracking-wide text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh data'}
          </button>
          <button
            type="button"
            onClick={() => void runReport()}
            disabled={loading || reportLoading || rows.length === 0}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {reportLoading
              ? 'Loading…'
              : report && reportDateLabel === todayReportDate
                ? "Upload today's report"
                : 'Generate macro report'}
          </button>
        </div>
      </div>

      {reportError ? <p className="px-6 pt-2 text-xs text-rose-700 leading-snug">{reportError}</p> : null}

      {error ? <p className="px-6 pb-4 text-xs text-rose-700 leading-snug">{error}</p> : null}
      {!error && loading ? <p className="px-6 pb-6 text-xs text-blue-600">Loading macro data…</p> : null}
      {!error && !loading && rows.length === 0 ? (
        <p className="px-6 pb-6 text-xs text-blue-600/80">
          No rows in macro_daily.csv. Run the macro indicator agent on the backend to populate the file.
        </p>
      ) : null}

      {!error && !loading && rows.length > 0 ? (
        <div className="p-4 space-y-5">
          {MACRO_INDICATOR_GROUPS.map((group) => {
            const items = group.keys.map((k) => byName.get(k)).filter((r): r is MacroIndicatorRow => r != null);
            if (items.length === 0) return null;
            return (
              <section key={group.title}>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 mb-2">
                  {group.title}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {items.map((row) => (
                    <IndicatorCard key={row.indicator} row={row} />
                  ))}
                </div>
              </section>
            );
          })}
          {ungrouped.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 mb-2">Other</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {ungrouped.map((row) => (
                  <IndicatorCard key={row.indicator} row={row} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {report ? (
        <div className="border-t border-blue-100 bg-gradient-to-b from-blue-50/40 to-white px-6 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-800">
              Macroeconomic report
              {reportDateLabel ? (
                <span className="text-blue-600/80 font-bold normal-case tracking-normal ml-2">
                  · {reportDateLabel}
                </span>
              ) : null}
            </h3>
            {reportFromCache ? (
              <span className="text-[9px] font-bold uppercase tracking-widest text-blue-500">
                Saved for today
              </span>
            ) : reportDateLabel ? (
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600">
                New · saved
              </span>
            ) : null}
          </div>
          <MacroReportBody text={report} />
          <p className="mt-4 text-[9px] text-slate-400 uppercase tracking-widest">
            AI-generated from macro_daily.csv · stored as backend/data/macro_reports/macro_report_
            {reportDateLabel ?? todayReportDate}.txt · not investment advice
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default MacroIndicatorsPanel;
