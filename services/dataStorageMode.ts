/**
 * Opt-in local persistence for tables that do not need the hosted Postgres row overhead.
 * Auth + user rows stay on Supabase always (`profiles`, `portfolios`, session).
 *
 * Set in `.env`:  VITE_LOCAL_STORAGE_TABLES=company_fundamentals,market_data
 * Restart `npm run dev` after changing.
 */
export type MirrorableLocalTable = 'company_fundamentals' | 'market_data';

export function browserIndexedDbAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

/** True when this logical table should read/write IndexedDB instead of Supabase. */
export function useLocalTable(table: MirrorableLocalTable): boolean {
    if (!browserIndexedDbAvailable()) return false;
    const raw = (import.meta.env.VITE_LOCAL_STORAGE_TABLES || '').trim();
    if (!raw) return false;
    const allow = new Set(
        raw
            .split(/[,;\s]+/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
    );
    return allow.has(table.toLowerCase());
}
