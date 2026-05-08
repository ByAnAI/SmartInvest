import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { PIVOT_LINE_COLORS, type ClassicPivotLevels } from '../services/pivotPoints';

interface ChartProps {
  data: { time: string; price: number }[];
  color?: string;
  /** Optional classic pivots (e.g. from prior bar H/L/C). Same scheme as forex chart. */
  pivotLevels?: ClassicPivotLevels | null;
}

const StockChart: React.FC<ChartProps> = ({ data, color = '#6366f1', pivotLevels }) => {
  // Check if data exists and has length to prevent chart errors
  if (!data || data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">No Historical Data Available</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-[inherit]">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <AreaChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis 
            dataKey="time" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: '#94a3b8', fontSize: 10 }} 
            dy={10}
          />
          <YAxis 
            hide 
            domain={['auto', 'auto']}
          />
          <Tooltip 
            contentStyle={{ 
              borderRadius: '12px', 
              border: 'none', 
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
              padding: '8px 12px'
            }}
            labelStyle={{ display: 'none' }}
          />
          {pivotLevels ? (
            <>
              <ReferenceLine
                y={pivotLevels.pivot}
                stroke={PIVOT_LINE_COLORS.pivot}
                strokeWidth={2}
                label={{ value: 'P', fill: PIVOT_LINE_COLORS.pivot, fontSize: 10 }}
              />
              <ReferenceLine
                y={pivotLevels.r1}
                stroke={PIVOT_LINE_COLORS.resistance}
                strokeWidth={1}
                label={{ value: 'R1', fill: PIVOT_LINE_COLORS.resistance, fontSize: 9 }}
              />
              <ReferenceLine
                y={pivotLevels.r2}
                stroke={PIVOT_LINE_COLORS.resistance}
                strokeWidth={1}
                label={{ value: 'R2', fill: PIVOT_LINE_COLORS.resistance, fontSize: 9 }}
              />
              <ReferenceLine
                y={pivotLevels.r3}
                stroke={PIVOT_LINE_COLORS.resistance}
                strokeWidth={1}
                label={{ value: 'R3', fill: PIVOT_LINE_COLORS.resistance, fontSize: 9 }}
              />
              <ReferenceLine
                y={pivotLevels.s1}
                stroke={PIVOT_LINE_COLORS.support}
                strokeWidth={1}
                label={{ value: 'S1', fill: PIVOT_LINE_COLORS.support, fontSize: 9 }}
              />
              <ReferenceLine
                y={pivotLevels.s2}
                stroke={PIVOT_LINE_COLORS.support}
                strokeWidth={1}
                label={{ value: 'S2', fill: PIVOT_LINE_COLORS.support, fontSize: 9 }}
              />
              <ReferenceLine
                y={pivotLevels.s3}
                stroke={PIVOT_LINE_COLORS.support}
                strokeWidth={1}
                label={{ value: 'S3', fill: PIVOT_LINE_COLORS.support, fontSize: 9 }}
              />
            </>
          ) : null}
          <Area
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#colorPrice)"
            animationDuration={1000}
            isAnimationActive={true}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StockChart;
