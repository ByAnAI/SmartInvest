import React, { useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { FxChartResolutionId, OhlcBar } from '../services/forexCandles';
import {
  classicPivotLevels,
  PIVOT_LINE_COLORS,
  type ClassicPivotLevels,
} from '../services/pivotPoints';

type Props = {
  bars: OhlcBar[];
  loading: boolean;
  error: string | null;
  dataSource: 'finnhub' | 'yahoo' | 'local' | 'none' | null;
  diagnostic?: string | null;
  pairLabel: string;
  /** Internal id e.g. EURUSD, USDJPY — drives chart identity & CSV paths */
  forexSymbol: string;
  resolutionId: FxChartResolutionId;
  /** Price axis: 4 dp + 0.0001 for majors; 3 dp + 0.01 for JPY crosses */
  pricePrecision: number;
  priceMinMove: number;
};

/** Non-4h: zoom to recent logical bars after load */
const DEFAULT_VISIBLE_BARS: Record<FxChartResolutionId, number> = {
  '1': 420,
  '15': 160,
  '60': 168,
  '240': 48,
  D: 140,
  W: 84,
  M: 48,
};

/**
 * 4h only: Yahoo/local often return years of bars. Feeding all points keeps hidden highs/lows
 * in play for autoscale — candles look flat. We plot only the tail so scale matches what you see.
 */
const FOUR_H_MAX_BARS = 48;

function timeScaleLayout(resolutionId: FxChartResolutionId): { barSpacing: number; rightOffset: number } {
  switch (resolutionId) {
    case '240':
      return { barSpacing: 36, rightOffset: 14 };
    case 'M':
    case 'W':
      return { barSpacing: 10, rightOffset: 4 };
    default:
      return { barSpacing: 6, rightOffset: 4 };
  }
}

function priceScaleMargins(resolutionId: FxChartResolutionId): { top: number; bottom: number } {
  return resolutionId === '240'
    ? { top: 0.02, bottom: 0.06 }
    : { top: 0.1, bottom: 0.18 };
}

function chartMinHeightPx(resolutionId: FxChartResolutionId): number {
  return resolutionId === '240' ? 480 : 280;
}

function toCandlestickData(bars: OhlcBar[]) {
  return bars.map((b) => ({
    time: b.time as UTCTimestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}

/** Points actually sent to lightweight-charts (4h tail only). */
function chartPlotData(mapped: ReturnType<typeof toCandlestickData>, resolutionId: FxChartResolutionId) {
  if (resolutionId !== '240') return mapped;
  if (mapped.length <= FOUR_H_MAX_BARS) return mapped;
  return mapped.slice(-FOUR_H_MAX_BARS);
}

function clampLogicalRange(range: LogicalRange | null, barCount: number): { from: number; to: number } | null {
  if (!range || barCount < 1) return null;
  const maxIdx = barCount - 1;
  let from = Number(range.from);
  let to = Number(range.to);
  from = Math.max(0, Math.min(from, maxIdx));
  to = Math.max(0, Math.min(to, maxIdx));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  return { from, to };
}

function narrowToRecent(
  chart: ReturnType<typeof createChart>,
  barCount: number,
  resolutionId: FxChartResolutionId
): void {
  if (barCount < 1) return;
  const win = Math.min(DEFAULT_VISIBLE_BARS[resolutionId] ?? 120, barCount);
  const last = barCount - 1;
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, last - win + 1), to: last });
}

function fitFourH(chart: ReturnType<typeof createChart>): void {
  chart.timeScale().fitContent();
  requestAnimationFrame(() => {
    chart.timeScale().fitContent();
    try {
      chart.priceScale('right').applyOptions({ autoScale: true });
    } catch {
      /* ignore */
    }
  });
}

function removePivotPriceLines(series: ISeriesApi<'Candlestick', Time>, lines: IPriceLine[]): void {
  for (const line of lines) {
    series.removePriceLine(line);
  }
}

function addPivotPriceLines(
  series: ISeriesApi<'Candlestick', Time>,
  levels: ClassicPivotLevels
): IPriceLine[] {
  const lx = [
    series.createPriceLine({
      price: levels.pivot,
      color: PIVOT_LINE_COLORS.pivot,
      lineWidth: 2,
      axisLabelVisible: true,
      title: 'P',
    }),
    series.createPriceLine({
      price: levels.r1,
      color: PIVOT_LINE_COLORS.resistance,
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'R1',
    }),
    series.createPriceLine({
      price: levels.r2,
      color: PIVOT_LINE_COLORS.resistance,
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'R2',
    }),
    series.createPriceLine({
      price: levels.r3,
      color: PIVOT_LINE_COLORS.resistance,
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'R3',
    }),
    series.createPriceLine({
      price: levels.s1,
      color: PIVOT_LINE_COLORS.support,
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'S1',
    }),
    series.createPriceLine({
      price: levels.s2,
      color: PIVOT_LINE_COLORS.support,
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'S2',
    }),
    series.createPriceLine({
      price: levels.s3,
      color: PIVOT_LINE_COLORS.support,
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'S3',
    }),
  ];
  return lx;
}

/** Second-to-last displayed bar supplies H,L,C for classic pivots (prior completed candle). */
function pivotLevelsFromPlot(plotData: ReturnType<typeof toCandlestickData>): ClassicPivotLevels | null {
  if (plotData.length < 2) return null;
  const prev = plotData[plotData.length - 2];
  return classicPivotLevels({ high: prev.high, low: prev.low, close: prev.close });
}

const ForexCandleChart: React.FC<Props> = ({
  bars,
  loading,
  error,
  dataSource,
  diagnostic,
  pairLabel,
  forexSymbol,
  resolutionId,
  pricePrecision,
  priceMinMove,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const pivotLinesRef = useRef<IPriceLine[]>([]);
  const fitKeyRef = useRef<string>('');

  const mapped = useMemo(() => toCandlestickData(bars), [bars]);
  const plotData = useMemo(() => chartPlotData(mapped, resolutionId), [mapped, resolutionId]);
  const fitKey = `${forexSymbol}:${resolutionId}`;

  useEffect(() => {
    if (bars.length === 0) {
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      pivotLinesRef.current = [];
      fitKeyRef.current = '';
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    const tsLayout = timeScaleLayout(resolutionId);
    const commonScale = {
      borderColor: '#e2e8f0',
      scaleMargins: priceScaleMargins(resolutionId),
      autoScale: true,
    };

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#475569',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      crosshair: {
        vertLine: { color: '#cbd5e1', labelBackgroundColor: '#64748b' },
        horzLine: { color: '#cbd5e1', labelBackgroundColor: '#64748b' },
      },
      rightPriceScale: { ...commonScale },
      localization: {
        locale: navigator.language,
        priceFormatter: (priceValue: number | bigint) => {
          const n = typeof priceValue === 'bigint' ? Number(priceValue) : priceValue;
          return Number.isFinite(n) ? n.toFixed(pricePrecision) : '—';
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
      },
      timeScale: {
        borderColor: '#e2e8f0',
        timeVisible: true,
        secondsVisible: resolutionId === '1',
        rightOffset: tsLayout.rightOffset,
        barSpacing: tsLayout.barSpacing,
      },
      width: el.clientWidth,
      height: Math.max(el.clientHeight, chartMinHeightPx(resolutionId)),
    };

    const seriesOpts = {
      upColor: '#059669',
      downColor: '#e11d48',
      borderVisible: true,
      borderUpColor: '#059669',
      borderDownColor: '#e11d48',
      wickUpColor: '#059669',
      wickDownColor: '#e11d48',
      priceFormat: {
        type: 'price' as const,
        precision: pricePrecision,
        minMove: priceMinMove,
      },
    };

    const needNewChart = !chartRef.current || fitKeyRef.current !== fitKey;

    if (needNewChart) {
      chartRef.current?.remove();
      const chart = createChart(el, chartOptions);
      const series = chart.addSeries(CandlestickSeries, seriesOpts);
      series.setData(plotData);
      pivotLinesRef.current = [];
      const pivotsNew = pivotLevelsFromPlot(plotData);
      if (pivotsNew) pivotLinesRef.current = addPivotPriceLines(series, pivotsNew);
      if (resolutionId === '240') {
        fitFourH(chart);
      } else {
        narrowToRecent(chart, plotData.length, resolutionId);
      }
      chartRef.current = chart;
      seriesRef.current = series;
      fitKeyRef.current = fitKey;
    } else {
      const chart = chartRef.current;
      if (!chart) return;
      const ts = chart.timeScale();
      const s = seriesRef.current;
      if (s) {
        removePivotPriceLines(s, pivotLinesRef.current);
        pivotLinesRef.current = [];
      }
      seriesRef.current?.setData(plotData);
      const pivotsUpd = pivotLevelsFromPlot(plotData);
      if (s && pivotsUpd) pivotLinesRef.current = addPivotPriceLines(s, pivotsUpd);
      if (resolutionId === '240') {
        fitFourH(chart);
      } else {
        const before = ts.getVisibleLogicalRange();
        const restored = clampLogicalRange(before, plotData.length);
        if (restored) ts.setVisibleLogicalRange(restored);
        else narrowToRecent(chart, plotData.length, resolutionId);
      }
      chart.applyOptions({
        localization: {
          priceFormatter: (priceValue: number | bigint) => {
            const n = typeof priceValue === 'bigint' ? Number(priceValue) : priceValue;
            return Number.isFinite(n) ? n.toFixed(pricePrecision) : '—';
          },
        },
        rightPriceScale: {
          scaleMargins: priceScaleMargins(resolutionId),
        },
        timeScale: {
          secondsVisible: resolutionId === '1',
          rightOffset: tsLayout.rightOffset,
          barSpacing: tsLayout.barSpacing,
        },
      });
      seriesRef.current?.applyOptions({
        priceFormat: {
          type: 'price',
          precision: pricePrecision,
          minMove: priceMinMove,
        },
      });
    }

    const chart = chartRef.current;
    if (!chart) return;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      chartRef.current.applyOptions({
        width: clientWidth,
        height: Math.max(clientHeight, chartMinHeightPx(resolutionId)),
      });
      if (resolutionId === '240') {
        fitFourH(chartRef.current);
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, [plotData, mapped, bars.length, fitKey, resolutionId, pricePrecision, priceMinMove]);

  useEffect(() => {
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      pivotLinesRef.current = [];
      fitKeyRef.current = '';
    };
  }, []);

  if (loading) {
    return (
      <div className="h-full min-h-[160px] flex items-center justify-center bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Loading candles…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full min-h-[160px] flex items-center justify-center bg-rose-50/50 rounded-xl border border-dashed border-rose-200 px-4">
        <p className="text-sm text-rose-700 text-center">{error}</p>
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="h-full min-h-[160px] flex flex-col items-center justify-center gap-2 bg-slate-50/60 rounded-xl border border-dashed border-slate-200 px-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 text-center">No candle data</p>
        {diagnostic ? (
          <p className="text-[11px] text-rose-700/90 text-center max-w-lg font-mono break-all">{diagnostic}</p>
        ) : (
          <p className="text-[11px] text-slate-500 text-center max-w-md">
            Run the app via <code className="text-[10px] bg-slate-100 px-1 rounded">npm run dev</code> (port 3000) so{' '}
            <code className="text-[10px] bg-slate-100 px-1 rounded">/yahoo-chart</code> proxies Yahoo. Symbols must stay as{' '}
            <code className="text-[10px] bg-slate-100 px-1 rounded">EURUSD=X</code> in the URL (recent builds fix encoded{' '}
            <code className="text-[10px] bg-slate-100 px-1 rounded">%3D</code>).
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full gap-2 ${resolutionId === '240' ? 'min-h-[520px]' : 'min-h-[300px]'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{pairLabel}</span>
        <div className="flex flex-wrap items-center gap-2">
          {dataSource && dataSource !== 'none' ? (
            <span className="text-[10px] font-semibold text-slate-400">
              Source: <span className="text-indigo-600 capitalize">{dataSource}</span>
            </span>
          ) : null}
          <span className="text-[9px] text-slate-400 hidden sm:inline">
            {resolutionId === '240'
              ? `4h: last ${FOUR_H_MAX_BARS} bars · pivots P,R/S from prior candle · drag · wheel`
              : 'Classic pivots (prior bar H/L/C) · drag · wheel'}
          </span>
        </div>
      </div>
      <div
        ref={containerRef}
        className={`w-full flex-1 rounded-xl overflow-hidden border border-slate-100 bg-white touch-pan-y ${
          resolutionId === '240' ? 'min-h-[480px]' : 'min-h-[280px]'
        }`}
      />
    </div>
  );
};

export default ForexCandleChart;
