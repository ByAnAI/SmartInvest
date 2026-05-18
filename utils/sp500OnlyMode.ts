/**
 * Product is scoped to S&P 500–centric flows by default.
 * Set `VITE_SP500_ONLY=false` in `.env` to restore Nasdaq, forex, crypto, and commodities in the UI.
 */
export function isSp500OnlyMode(): boolean {
  const v = String(import.meta.env.VITE_SP500_ONLY ?? '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
}
