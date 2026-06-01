/**
 * Deterministic “signal lane” from watchlist numbers only (no LLM).
 * IV/value (green), risk (red), growth drivers (Torchlight + fundamentals), full CTR stack.
 */

export type WatchlistSignalRow = {
  ticker: string;
  company?: string;
  current_price?: number | null;
  total_assets?: number | null;
  total_liabilities?: number | null;
  total_revenue?: number | null;
  net_income?: number | null;
  operating_cash_flow?: number | null;
  free_cash_flow?: number | null;
  iv_dcf?: number | null;
  iv_ri?: number | null;
  iv_multiples?: number | null;
  iv_ensemble?: number | null;
  iv_quality_score?: number | null;
  iv_upside_pct?: number | null;
  torchlight_score?: number | null;
  torchlight_rank_factors?: string;
  torchlight_momentum?: number | null;
  torchlight_valuation_edge?: number | null;
  torchlight_quality?: number | null;
  torchlight_growth?: number | null;
  torchlight_sentiment?: number | null;
  torchlight_macro_fit?: number | null;
  torchlight_execution_feasibility?: number | null;
  torchlight_risk_adjusted_alpha?: number | null;
  ctr_total_return?: number | null;
  ctr_price_return?: number | null;
  ctr_cash_return?: number | null;
  ctr_annualized?: number | null;
  torchlight_ctr_score?: number | null;
  risk_summary_score?: number | null;
  risk_beta?: number | null;
  risk_sharpe?: number | null;
  risk_sortino?: number | null;
  risk_volatility_annual?: number | null;
  risk_max_drawdown?: number | null;
  risk_var_95_hist?: number | null;
  risk_cvar_95?: number | null;
};

export type SignalLane = {
  headline: string;
  bullets: string[];
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${n.toFixed(2)}`;
}

/** Watchlist financials: same spirit as UI statement formatter (compact). */
function fmtStmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Stored as fraction (e.g. 0.12 = 12%). */
function fmtPctFrac(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

/** IV upside field: already in percent points in this feed (e.g. 12.5 = 12.5%). */
function fmtPctPoints(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function fmtQualityScore(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n <= 1 ? `${(n * 100).toFixed(1)} / 100` : `${n.toFixed(1)} / 100`;
}

function fmtSignedPctFrac(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  const pct = n * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

function meanFinite(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export type WatchlistSignalBundle = {
  overview: SignalLane;
  iv: SignalLane;
  risk: SignalLane;
  growthDrivers: SignalLane;
  ctr: SignalLane;
};

/** Higher `risk_summary_score` = better risk profile in this codebase’s composite usage. */
export function deriveWatchlistSignalAnalysis(r: WatchlistSignalRow): WatchlistSignalBundle {
  const price = r.current_price;
  const ens = r.iv_ensemble;
  const upside = r.iv_upside_pct;

  const ivBullets: string[] = [];
  let ivHeadline = 'IV / value — insufficient numeric IV fields in this snapshot.';

  if (price != null && price > 0 && ens != null) {
    const gap = (ens - price) / price;
    ivBullets.push(`Mark ${fmtUsd(price)} vs IV ensemble ${fmtUsd(ens)} (${(gap * 100).toFixed(1)}% ${gap >= 0 ? 'below' : 'above'} IV).`);
  }
  if (upside != null && !Number.isNaN(upside)) {
    ivBullets.push(`Model IV upside vs mark: ${fmtPctPoints(upside, 2)}.`);
  }
  if (r.iv_dcf != null) ivBullets.push(`IV DCF anchor: ${fmtUsd(r.iv_dcf)}.`);
  if (r.iv_ri != null) ivBullets.push(`IV residual income: ${fmtUsd(r.iv_ri)}.`);
  if (r.iv_multiples != null) ivBullets.push(`IV multiples: ${fmtUsd(r.iv_multiples)}.`);
  if (r.iv_quality_score != null && !Number.isNaN(r.iv_quality_score)) {
    ivBullets.push(`IV quality score: ${fmtQualityScore(r.iv_quality_score)}.`);
  }

  if (upside != null && !Number.isNaN(upside)) {
    if (upside >= 12) ivHeadline = 'IV stance: material implied headroom vs current price (watchlist model).';
    else if (upside >= 3) ivHeadline = 'IV stance: modest positive headroom vs mark.';
    else if (upside <= -8) ivHeadline = 'IV stance: mark trades rich vs IV anchors — discount / catalyst diligence.';
    else ivHeadline = 'IV stance: roughly fair vs IV anchors on watchlist numbers.';
  } else if (price != null && ens != null && price > 0) {
    const gap = (ens - price) / price;
    if (gap > 0.08) ivHeadline = 'IV stance: ensemble meaningfully above mark — implied value tailwind.';
    else if (gap < -0.08) ivHeadline = 'IV stance: ensemble below mark — price ahead of model IV.';
    else ivHeadline = 'IV stance: ensemble close to mark — balanced vs model IV.';
  }

  const riskBullets: string[] = [];
  const rs = r.risk_summary_score;
  if (rs != null && !Number.isNaN(rs)) {
    riskBullets.push(`Risk summary score: ${rs.toFixed(1)} (higher = calmer profile in internal blend).`);
  }
  if (r.risk_volatility_annual != null) {
    riskBullets.push(`Annualized vol: ${fmtPctFrac(r.risk_volatility_annual, 2)}.`);
  }
  if (r.risk_max_drawdown != null) {
    riskBullets.push(`Max drawdown (sample): ${fmtPctFrac(r.risk_max_drawdown, 2)}.`);
  }
  if (r.risk_sharpe != null) riskBullets.push(`Sharpe: ${r.risk_sharpe.toFixed(2)}.`);
  if (r.risk_sortino != null) riskBullets.push(`Sortino: ${r.risk_sortino.toFixed(2)}.`);
  if (r.risk_beta != null) riskBullets.push(`Beta: ${r.risk_beta.toFixed(2)}.`);
  if (r.risk_var_95_hist != null) riskBullets.push(`VaR 95% (hist): ${fmtPctFrac(r.risk_var_95_hist, 2)}.`);
  if (r.risk_cvar_95 != null) riskBullets.push(`CVaR 95%: ${fmtPctFrac(r.risk_cvar_95, 2)}.`);

  let riskHeadline = 'Risk lane: no strong stress flags from populated watchlist fields.';
  const stresses: string[] = [];
  if (rs != null && rs < 32) stresses.push('low risk summary score');
  if (r.risk_volatility_annual != null && r.risk_volatility_annual > 0.42) stresses.push('elevated annual volatility');
  if (r.risk_max_drawdown != null && r.risk_max_drawdown < -0.38) stresses.push('deep historical drawdown');
  if (r.risk_sharpe != null && r.risk_sharpe < 0.15) stresses.push('weak Sharpe');
  if (r.risk_beta != null && r.risk_beta > 1.45) stresses.push('high beta vs market');
  if (stresses.length) {
    riskHeadline = `Risk lane: watchlist flags → ${stresses.join('; ')}.`;
  }

  // --- Growth drivers: Torchlight stack + fundamentals ---
  const gBullets: string[] = [];
  if (r.torchlight_score != null) gBullets.push(`Torchlight headline: ${r.torchlight_score.toFixed(1)} / 100.`);
  if (r.torchlight_rank_factors) {
    const rf = String(r.torchlight_rank_factors);
    gBullets.push(`Rank factors: ${rf.slice(0, 260)}${rf.length > 260 ? '…' : ''}`);
  }
  if (r.torchlight_momentum != null) gBullets.push(`Momentum: ${r.torchlight_momentum.toFixed(1)}.`);
  if (r.torchlight_valuation_edge != null) gBullets.push(`Valuation edge: ${r.torchlight_valuation_edge.toFixed(1)}.`);
  if (r.torchlight_quality != null) gBullets.push(`Quality: ${r.torchlight_quality.toFixed(1)}.`);
  if (r.torchlight_growth != null) gBullets.push(`Growth: ${r.torchlight_growth.toFixed(1)}.`);
  if (r.torchlight_sentiment != null) gBullets.push(`Sentiment: ${r.torchlight_sentiment.toFixed(1)}.`);
  if (r.torchlight_macro_fit != null) gBullets.push(`Macro fit: ${r.torchlight_macro_fit.toFixed(1)}.`);
  if (r.torchlight_execution_feasibility != null) {
    gBullets.push(`Execution feasibility: ${r.torchlight_execution_feasibility.toFixed(1)}.`);
  }
  if (r.torchlight_risk_adjusted_alpha != null) {
    gBullets.push(`Risk-adjusted alpha: ${r.torchlight_risk_adjusted_alpha.toFixed(1)}.`);
  }
  if (r.total_revenue != null) gBullets.push(`Revenue (statement scale): ${fmtStmt(r.total_revenue)}.`);
  if (r.net_income != null) gBullets.push(`Net income: ${fmtStmt(r.net_income)}.`);
  if (r.operating_cash_flow != null) gBullets.push(`Operating cash flow: ${fmtStmt(r.operating_cash_flow)}.`);
  if (r.free_cash_flow != null) gBullets.push(`Free cash flow: ${fmtStmt(r.free_cash_flow)}.`);
  if (r.total_revenue != null && r.total_revenue > 0 && r.net_income != null) {
    gBullets.push(`Net margin: ${fmtSignedPctFrac(r.net_income / r.total_revenue, 1)}.`);
  }
  if (r.total_revenue != null && r.total_revenue > 0 && r.free_cash_flow != null) {
    gBullets.push(`FCF margin: ${fmtSignedPctFrac(r.free_cash_flow / r.total_revenue, 1)}.`);
  }
  if (r.total_assets != null && r.total_assets > 0 && r.total_liabilities != null) {
    gBullets.push(`Liabilities / assets: ${fmtPctFrac(r.total_liabilities / r.total_assets, 1)}.`);
  }

  const driverScores = [
    r.torchlight_growth,
    r.torchlight_quality,
    r.torchlight_momentum,
    r.torchlight_sentiment,
    r.torchlight_macro_fit,
    r.torchlight_execution_feasibility,
    r.torchlight_risk_adjusted_alpha,
    r.torchlight_valuation_edge,
  ].filter((v): v is number => v != null && !Number.isNaN(v));

  const driverAvg = meanFinite(driverScores);
  const ann = r.ctr_annualized;
  let growthHeadline = 'Growth drivers: limited Torchlight / fundamental fields in this row.';
  if (driverAvg != null) {
    if (driverAvg >= 62 && ann != null && ann > 0.06) {
      growthHeadline = 'Growth drivers: strong Torchlight factor mix aligning with positive CTR annualized pace.';
    } else if (driverAvg >= 55) {
      growthHeadline = 'Growth drivers: constructive Torchlight factor profile on watchlist numbers.';
    } else if (driverAvg <= 42) {
      growthHeadline = 'Growth drivers: soft Torchlight factor mix — quality/growth/momentum trail typical leaders.';
    } else {
      growthHeadline = 'Growth drivers: mixed Torchlight factor scores — pair with CTR and IV lanes.';
    }
  } else if (r.torchlight_score != null) {
    growthHeadline =
      r.torchlight_score >= 65
        ? 'Growth drivers: headline Torchlight elevated; sub-scores partially sparse.'
        : 'Growth drivers: headline Torchlight mid/soft; use fundamentals and CTR for context.';
  }

  const posFund =
    (r.net_income != null && r.net_income > 0) ||
    (r.free_cash_flow != null && r.free_cash_flow > 0) ||
    (r.operating_cash_flow != null && r.operating_cash_flow > 0);
  if (posFund && driverAvg != null && driverAvg >= 50) {
    growthHeadline = `${growthHeadline} Fundamentals show positive earnings/cash generation vs statement lines.`;
  }

  // --- CTR: all return decomposition fields ---
  const cBullets: string[] = [];
  if (r.ctr_total_return != null) cBullets.push(`CTR total return (full): ${fmtPctFrac(r.ctr_total_return, 2)}.`);
  if (r.ctr_price_return != null) cBullets.push(`CTR price return: ${fmtPctFrac(r.ctr_price_return, 2)}.`);
  if (r.ctr_cash_return != null) cBullets.push(`CTR cash return (dividends / cash yield leg): ${fmtPctFrac(r.ctr_cash_return, 2)}.`);
  if (r.ctr_annualized != null) cBullets.push(`CTR annualized: ${fmtPctFrac(r.ctr_annualized, 2)}.`);
  if (r.torchlight_ctr_score != null) cBullets.push(`Torchlight CTR composite: ${r.torchlight_ctr_score.toFixed(1)} / 100.`);

  const pt = r.ctr_price_return;
  const ct = r.ctr_cash_return;
  const tt = r.ctr_total_return;
  let ctrHeadline = 'CTR: populate total / price / cash / annualized returns for a full shareholder-return read.';
  const havePair = pt != null && ct != null && !Number.isNaN(pt) && !Number.isNaN(ct);
  if (havePair && Math.abs(pt - ct) > 0.055) {
    ctrHeadline =
      pt > ct
        ? 'CTR: price return dominates cash yield — capital gains led the sample; check dividend policy vs buybacks.'
        : 'CTR: cash return leg meaningfully exceeds price return — income component lifted total shareholder return.';
  } else if (tt != null && pt != null && ct != null && tt > 0.03 && pt > 0 && ct >= 0) {
    ctrHeadline = 'CTR: total, price, and cash legs all supportive in the sample window.';
  } else if (ann != null && ann > 0.08) {
    ctrHeadline = 'CTR: annualized pace strong vs typical single-name watchlist band.';
  } else if (ann != null && ann < -0.05) {
    ctrHeadline = 'CTR: negative annualized pace — total return profile warrants caution vs peers.';
  } else if (tt != null || ann != null) {
    ctrHeadline = 'CTR: blended return profile is mixed or modest — compare price vs cash legs below.';
  }

  const scoreParts: number[] = [];
  if (upside != null && !Number.isNaN(upside)) scoreParts.push(Math.max(0, Math.min(100, 50 + upside)));
  if (r.torchlight_score != null && !Number.isNaN(r.torchlight_score)) scoreParts.push(r.torchlight_score);
  if (rs != null && !Number.isNaN(rs)) scoreParts.push(rs);
  if (ann != null && !Number.isNaN(ann)) scoreParts.push(Math.max(0, Math.min(100, 50 + ann * 100)));
  const composite = meanFinite(scoreParts);
  const hasPositiveCash = (r.free_cash_flow ?? 0) > 0 || (r.operating_cash_flow ?? 0) > 0;
  const overviewBullets: string[] = [];
  if (composite != null) overviewBullets.push(`Composite signal read: ${composite.toFixed(1)} / 100 from populated IV, Torchlight, risk, and CTR fields.`);
  if (upside != null) overviewBullets.push(`Value setup: ${fmtPctPoints(upside, 1)} model upside to IV ensemble.`);
  if (r.torchlight_score != null) overviewBullets.push(`Torchlight rank signal: ${r.torchlight_score.toFixed(1)} / 100.`);
  if (rs != null) overviewBullets.push(`Risk quality: ${rs.toFixed(1)} / 100.`);
  if (ann != null) overviewBullets.push(`Recent annualized CTR: ${fmtSignedPctFrac(ann, 1)}.`);
  if (hasPositiveCash) overviewBullets.push('Fundamental support: positive earnings/cash-flow fields are present in the snapshot.');

  let posture = 'Balanced / watchlist candidate';
  if (
    (upside ?? 0) >= 12 &&
    (r.torchlight_score ?? 0) >= 60 &&
    (rs ?? 0) >= 45 &&
    (ann == null || ann > -0.05)
  ) {
    posture = 'Constructive / high-priority candidate';
  } else if ((upside ?? 0) >= 10 && hasPositiveCash && (rs == null || rs >= 35)) {
    posture = 'Constructive value candidate, risk-check required';
  } else if ((rs != null && rs < 32) || (ann != null && ann < -0.15)) {
    posture = 'Speculative / risk-first review';
  } else if ((upside ?? 0) <= -8) {
    posture = 'Valuation caution / low-priority candidate';
  }

  const company = r.company ? `${r.company} ` : '';
  const overviewHeadline = `${r.ticker} — ${company}${posture}.`;

  return {
    overview: { headline: overviewHeadline, bullets: overviewBullets.slice(0, 8) },
    iv: { headline: ivHeadline, bullets: ivBullets.slice(0, 8) },
    risk: { headline: riskHeadline, bullets: riskBullets.slice(0, 10) },
    growthDrivers: { headline: growthHeadline, bullets: gBullets.slice(0, 16) },
    ctr: { headline: ctrHeadline, bullets: cBullets.slice(0, 8) },
  };
}
