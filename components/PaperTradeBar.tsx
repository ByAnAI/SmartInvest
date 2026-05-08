import React, { useEffect, useState } from 'react';
import { simulateBuy, simulateSell } from '../services/marketSimulation';
import type { SimAssetKind } from '../services/marketSimulation';

export default function PaperTradeBar({
  userId,
  kind,
  symbol,
  assetLabel,
  price,
  defaultQty,
  paperTradingAllowed = true,
}: {
  userId: string | null;
  kind: SimAssetKind;
  symbol: string;
  assetLabel: string;
  price: number | undefined;
  defaultQty?: string;
  /** Set false for administrator accounts — paper fills are for standard members only. */
  paperTradingAllowed?: boolean;
}) {
  const [qty, setQty] = useState(defaultQty ?? '1');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!paperTradingAllowed) {
    return (
      <p className="text-[10px] text-slate-500 leading-snug max-w-[240px]">
        Paper trading is for standard member accounts. Administrators manage the workspace; use a non-admin login for simulated buys and sells.
      </p>
    );
  }

  if (!userId || price == null || !Number.isFinite(price)) {
    return (
      <p className="text-[10px] text-slate-400">
        {!userId ? 'Sign in to paper trade.' : 'Need a live price for this asset.'}
      </p>
    );
  }

  const parsed = Number(String(qty).replace(/,/g, ''));
  const goBuy = () => {
    if (!(parsed > 0)) {
      setToast('Enter a positive quantity.');
      return;
    }
    const r = simulateBuy(userId, { kind, symbol, assetLabel, qty: parsed, priceUsd: price });
    if (r.ok === false) setToast(r.reason);
    else setToast(`Bought ${parsed} ${symbol}`);
  };
  const goSell = () => {
    if (!(parsed > 0)) {
      setToast('Enter a positive quantity.');
      return;
    }
    const r = simulateSell(userId, { kind, symbol, qty: parsed, priceUsd: price });
    if (r.ok === false) setToast(r.reason);
    else
      setToast(
        `Sold ${r.soldQty.toLocaleString()} ${symbol} · +$${r.proceedsUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} added to cash`
      );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`qty-${symbol}-${kind}`}>
        Quantity
      </label>
      <input
        id={`qty-${symbol}-${kind}`}
        type="text"
        inputMode="decimal"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-mono tabular-nums shadow-sm"
      />
      <button
        type="button"
        onClick={goBuy}
        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-sm hover:bg-emerald-700"
      >
        Buy
      </button>
      <button
        type="button"
        onClick={goSell}
        className="rounded-lg bg-rose-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-sm hover:bg-rose-700"
      >
        Sell
      </button>
      {toast ? <span className="text-[10px] font-medium text-slate-600 max-w-[220px]">{toast}</span> : null}
    </div>
  );
}
