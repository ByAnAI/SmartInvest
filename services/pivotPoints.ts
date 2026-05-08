/**
 * Classic pivot points from the prior period's high, low, close.
 * P = (H + L + C) / 3 — see standard R1–R3 / S1–S3 formulas.
 */

export type ClassicPivotLevels = {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

/** Prior bar/session H, L, C */
export type HlcPrevious = {
  high: number;
  low: number;
  close: number;
};

/** Chart styling: resistance above pivot (red), support below (green), pivot neutral */
export const PIVOT_LINE_COLORS = {
  pivot: '#64748b',
  resistance: '#dc2626',
  support: '#059669',
} as const;

export function classicPivotLevels(prev: HlcPrevious): ClassicPivotLevels {
  const H = prev.high;
  const L = prev.low;
  const C = prev.close;
  const P = (H + L + C) / 3;
  return {
    pivot: P,
    r1: 2 * P - L,
    r2: P + (H - L),
    r3: H + 2 * (P - L),
    s1: 2 * P - H,
    s2: P - (H - L),
    s3: L - 2 * (H - P),
  };
}
