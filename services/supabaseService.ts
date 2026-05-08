import { supabase } from './supabase';
import { useLocalTable } from './dataStorageMode';
import {
    localCfDelete,
    localCfGetAll,
    localCfGetMany,
    localCfUpsertMany,
    localCfUpdate as localCfUpdateRow,
    localMarketGetAll,
    localMarketUpsertRows,
} from './localReferenceDb';
import { PortfolioItem, UserMetadata, Folder, FileItem, Note, TeamMember, MarketAsset, DailyWatchlist, DailyWatchlistItem, CompanyFundamental, NewsBoardPost } from "../types";
import { formatWatchlistCreatedAt } from "../utils/watchlistDisplay";
import { MASTER_ADMIN_EMAIL } from '../config/masterAdmin';

/** Keeps DB role in sync for the master account so RLS policies that use profiles.role allow writes. */
async function syncMasterAdminProfile(uid: string, emailHint?: string | null): Promise<void> {
    let email = (emailHint ?? '').trim().toLowerCase();
    if (!email) {
        const { data: { user } } = await supabase.auth.getUser();
        email = (user?.email ?? '').trim().toLowerCase();
    }
    if (email !== MASTER_ADMIN_EMAIL) return;
    const { error } = await supabase.from('profiles').update({ role: 'admin', status: 'active' }).eq('uid', uid);
    if (error) console.warn('[SmartInvest] syncMasterAdminProfile:', error.message);
}

// --- USER MANAGEMENT ---

export const initializeUser = async (uid: string, email?: string | null, displayName?: string | null) => {
    const emailNormalized = (email || '').trim().toLowerCase();

    /** RLS admin checks use profiles.role; always heal master row after profile load/insert. */
    const finalize = async (meta: UserMetadata): Promise<UserMetadata> => {
        if (emailNormalized === MASTER_ADMIN_EMAIL) {
            await syncMasterAdminProfile(uid, emailNormalized);
        }
        return meta;
    };

    // Try to fetch user from 'profiles' table (renamed from 'users' to avoid confusion with internal auth)
    const { data, error: selectErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', uid)
        .maybeSingle();

    if (selectErr) {
        console.warn('[SmartInvest] profiles lookup:', selectErr.message);
    }

    if (data) {
        // Keep the master account admin even if profile role was changed accidentally.
        if (emailNormalized === MASTER_ADMIN_EMAIL && data.role !== 'admin') {
            const { error: promoteError } = await supabase
                .from('profiles')
                .update({ role: 'admin', status: 'active' })
                .eq('uid', uid);
            if (!promoteError) {
                return finalize({ ...data, role: 'admin', status: 'active' } as UserMetadata);
            }
        }
        return finalize(data as UserMetadata);
    }

    // Auto-promote specific email to admin
    const role = (emailNormalized === MASTER_ADMIN_EMAIL) ? 'admin' : 'user';

    const { error: insertError } = await supabase
        .from('profiles')
        .insert({ uid, email: emailNormalized, status: 'active', role });

    if (insertError) {
        /** Concurrent sign-in / retry can race another insert — row exists but first read missed it. */
        if (insertError.code === '23505') {
            const { data: retry } = await supabase.from('profiles').select('*').eq('uid', uid).maybeSingle();
            if (retry) return finalize(retry as UserMetadata);
        }
        throw insertError;
    }
    return finalize({
        uid,
        email: emailNormalized,
        displayName: displayName || 'Investor',
        status: 'active' as const,
        role,
        isVerified: false,
        lastLogin: '',
        createdAt: '',
        updatedAt: '',
    });
};

export const markUserAsVerified = async (uid: string) => {
    const { error: e1 } = await supabase.from('profiles').update({ is_verified: true, updated_at: new Date().toISOString() }).eq('uid', uid);
    if (!e1) return;
    await supabase.from('profiles').update({ isVerified: true, updatedAt: new Date().toISOString() }).eq('uid', uid);
};

export const getUserMetadata = async (uid: string): Promise<UserMetadata | null> => {
    const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', uid)
        .single();
    return data as UserMetadata || null;
};

/** Clearer UX when Postgres RLS blocks RPC or table reads. */
function throwIfRlsShowAdminHint(err: { message?: string; code?: string } | null | undefined): never {
    if (!err) throw new Error('getAllUsers failed');
    const msg = err.message || '';
    const low = msg.toLowerCase();
    const code = String((err as { code?: string }).code ?? '');
    if (
        /row-level security|violates .*policy|permission denied|42501|pgrst301|insufficient_privilege/i.test(low) ||
        code === '42501'
    ) {
        throw new Error(
            'Admin panel blocked by database security (RLS). In Supabase → SQL Editor, run supabase/migrations/20260428200000_admin_policies_role_only.sql from this repo, then set public.profiles.role = \'admin\' for your user.'
        );
    }
    throw new Error(msg || 'getAllUsers failed');
}

function rowToUserMetadata(row: any): UserMetadata {
    return {
        uid: row.uid,
        email: row.email ?? '',
        displayName: row.displayName ?? row.display_name ?? 'Investor',
        status: (row.status === 'disabled' ? 'disabled' : 'active') as 'active' | 'disabled',
        role: (row.role === 'admin' ? 'admin' : 'user') as 'user' | 'admin',
        isVerified: Boolean(row.isVerified ?? row.is_verified),
        lastLogin: row.lastLogin ?? row.last_login ?? '',
        createdAt: row.createdAt ?? row.created_at ?? '',
        updatedAt: row.updatedAt ?? row.updated_at ?? '',
    };
}

export const getAllUsers = async (): Promise<UserMetadata[]> => {
    const { data, error } = await supabase.rpc('get_all_profiles_for_admin');
    if (!error && data != null) {
        return (Array.isArray(data) ? data : []).map(rowToUserMetadata);
    }
    const rpcMissing =
        error?.code === '42883' ||
        error?.message?.includes('does not exist') ||
        error?.message?.includes('Could not find the function') ||
        error?.message?.includes('schema cache');
    if (rpcMissing) {
        const { data: tableData, error: tableError } = await supabase.from('profiles').select('*');
        if (tableError) {
            console.error('getAllUsers:', tableError);
            throwIfRlsShowAdminHint(tableError);
        }
        return (tableData || []).map(rowToUserMetadata);
    }
    console.error('getAllUsers:', error);
    throwIfRlsShowAdminHint(error);
};

export const updateUserStatus = async (uid: string, status: 'active' | 'disabled') => {
    await supabase
        .from('profiles')
        .update({ status })
        .eq('uid', uid);
};

export const updateUserRole = async (uid: string, role: 'user' | 'admin') => {
    await supabase
        .from('profiles')
        .update({ role })
        .eq('uid', uid);
};

/**
 * Admin-only: permanently delete a user from Auth (and profile via CASCADE) using the delete-user Edge Function.
 * When the function is unreachable, falls back to profile-only delete so the user is removed from the list.
 */
export const deleteUserFully = async (uid: string): Promise<{ success: true; permanent?: boolean }> => {
    const { data, error: fnError } = await supabase.functions.invoke('delete-user', { body: { uid } });
    if (!fnError && data?.success) return { success: true, permanent: true };
    const msg = (data?.error ?? fnError?.message ?? '') as string;
    const status = (fnError as { context?: { status?: number } })?.context?.status;
    const isNotFound = status === 404 || msg.toLowerCase().includes('user not found');
    if (isNotFound) {
        await supabase.from('profiles').delete().eq('uid', uid);
        return { success: true, permanent: true };
    }
    if (status === 401 || status === 403) throw new Error(msg || 'Not authorized to delete users.');
    const isNetworkError = /failed to send a request|fetch failed|network|connection refused|cors/i.test(msg);
    if (isNetworkError) {
        await supabase.from('profiles').delete().eq('uid', uid);
        return { success: true, permanent: false };
    }
    throw new Error(msg || 'User could not be permanently deleted. Deploy the delete-user Edge Function and set SUPABASE_SERVICE_ROLE_KEY.');
};

// --- PORTFOLIO MANAGEMENT ---

/** Normalize DB timestamp for `opened_at` — PostgREST usually returns ISO strings; tolerate numbers / camelCase keys. */
function portfolioRowOpenedAtIso(row: Record<string, unknown>): string | undefined {
    const raw = row.opened_at ?? row.openedAt;
    if (raw == null) return undefined;
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return undefined;
        const t = new Date(s).getTime();
        return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof raw === 'object' && raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return raw.toISOString();
    }
    return undefined;
}

export const getPortfolio = async (uid: string): Promise<PortfolioItem[]> => {
    const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .eq('user_id', uid);
    if (error) throw error;
    const rows = (data || []) as any[];
    return rows.map((r) => ({
        symbol: r.symbol,
        shares: Number(r.shares),
        avgCost: Number(r.avgCost ?? r.avg_cost ?? 0),
        openedAt: portfolioRowOpenedAtIso(r as Record<string, unknown>),
        firstBuyPrice:
            r.first_buy_price != null && r.first_buy_price !== ''
                ? Number(r.first_buy_price)
                : undefined,
    }));
};

export const addStock = async (uid: string, item: PortfolioItem) => {
    const sym = String(item.symbol).toUpperCase().trim();
    const { data: existing, error: selErr } = await supabase
        .from('portfolios')
        .select('first_buy_price')
        .eq('user_id', uid)
        .eq('symbol', sym)
        .maybeSingle();
    if (selErr && selErr.code !== 'PGRST116') throw selErr;

    const ex = existing as { first_buy_price?: number | string | null } | null;

    /** Every buy (add/upsert) records the current moment in UTC. */
    const openedAt = new Date().toISOString();

    /** Frozen at first purchase; later adds only change avg_cost / shares. */
    let firstBuyPrice: number;
    if (ex?.first_buy_price != null && ex.first_buy_price !== '') {
        firstBuyPrice = Number(ex.first_buy_price);
    } else if (ex) {
        firstBuyPrice =
            item.firstBuyPrice != null && Number.isFinite(item.firstBuyPrice)
                ? item.firstBuyPrice
                : item.avgCost;
    } else {
        firstBuyPrice =
            item.firstBuyPrice != null && Number.isFinite(item.firstBuyPrice)
                ? item.firstBuyPrice
                : item.avgCost;
    }

    const row = {
        user_id: uid,
        symbol: sym,
        shares: item.shares,
        avg_cost: item.avgCost,
        opened_at: openedAt,
        first_buy_price: firstBuyPrice,
    };
    const { error } = await supabase.from('portfolios').upsert(row, { onConflict: 'user_id,symbol' });
    if (error) throw error;
    /** Ensure `opened_at` is persisted — some PostgREST upsert paths omit non-PK columns on conflict updates. */
    await supabase
        .from('portfolios')
        .update({ opened_at: openedAt })
        .eq('user_id', uid)
        .eq('symbol', sym);
};

export const removeStock = async (uid: string, symbol: string) => {
    const { error } = await supabase
        .from('portfolios')
        .delete()
        .eq('user_id', uid)
        .eq('symbol', symbol);
    if (error) throw error;
};

export const updateStock = async (uid: string, symbol: string, updates: { shares?: number }) => {
    const payload: Record<string, unknown> = {};
    if (updates.shares !== undefined) payload.shares = updates.shares;
    if (Object.keys(payload).length === 0) return;
    const { error } = await supabase
        .from('portfolios')
        .update(payload)
        .eq('user_id', uid)
        .eq('symbol', symbol);
    if (error) throw error;
};

export const clearPortfolio = async (uid: string) => {
    await supabase
        .from('portfolios')
        .delete()
        .eq('user_id', uid);
};

// --- WATCHLIST ---

export const getWatchlist = async (uid: string): Promise<string[]> => {
    const { data } = await supabase
        .from('profiles')
        .select('watchlist')
        .eq('uid', uid)
        .single();
    return data?.watchlist || [];
};

export const addToWatchlist = async (uid: string, symbol: string) => {
    // Get current watchlist
    const watchlist = await getWatchlist(uid);
    if (watchlist.includes(symbol)) return;

    await supabase
        .from('profiles')
        .update({ watchlist: [...watchlist, symbol] })
        .eq('uid', uid);
};

export const removeFromWatchlist = async (uid: string, symbol: string) => {
    const watchlist = await getWatchlist(uid);
    await supabase
        .from('profiles')
        .update({ watchlist: watchlist.filter(s => s !== symbol) })
        .eq('uid', uid);
};

// --- FILES & NOTES ---

export const getFolders = async (uid: string): Promise<Folder[]> => {
    const { data } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', uid)
        .order('createdAt', { ascending: false });
    return (data || []) as Folder[];
};

export const addFolder = async (uid: string, name: string) => {
    await supabase
        .from('folders')
        .insert({ user_id: uid, name, createdAt: new Date().toISOString() });
};

export const deleteFolder = async (uid: string, folderId: string) => {
    await supabase
        .from('folders')
        .delete()
        .eq('user_id', uid)
        .eq('id', folderId);
};

export const getNotes = async (uid: string): Promise<Note[]> => {
    const { data } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', uid)
        .order('createdAt', { ascending: false });
    return (data || []) as Note[];
};

export const addNote = async (uid: string, title: string, content: string) => {
    await supabase
        .from('notes')
        .insert({ user_id: uid, title, content, createdAt: new Date().toISOString() });
};

// --- MARKET DATA MANAGEMENT ---

export const batchUploadMarketData = async (market: string, assets: { symbol: string; name: string }[]) => {
    const payload = assets.map((asset) => ({
        symbol: asset.symbol,
        name: asset.name,
        market: market.toLowerCase(),
        updated_at: new Date().toISOString(),
    }));

    if (useLocalTable('market_data')) {
        await localMarketUpsertRows(payload);
        return;
    }

    const { error } = await supabase.from('market_data').upsert(payload, { onConflict: 'symbol' });
    if (error) throw error;
};

export const getAllMarketAssets = async (): Promise<MarketAsset[]> => {
    if (useLocalTable('market_data')) {
        try {
            return await localMarketGetAll();
        } catch (e) {
            console.warn('local market_data read failed', e);
            return [];
        }
    }

    const { data, error } = await supabase.from('market_data').select('*');

    if (error) {
        console.warn("Could not fetch market_data", error);
        return [];
    }

    return (data || []) as MarketAsset[];
};

// --- DAILY WATCHLIST (manager-created; all users can view) ---

/** YYYY-MM-DD in the user's local calendar (avoid labelling "yesterday" when UTC date rolled over). */
export function localCalendarDateStamp(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

const todayDateString = () => localCalendarDateStamp();

/** Human-readable line: publish date/time first, then local calendar day. Each save is a new DB row — old snapshots are kept. */
export const buildWatchlistLabel = (watchlistDate: string, createdAt?: string): string => {
    const day = (watchlistDate || '').trim() || todayDateString();
    const when = formatWatchlistCreatedAt(createdAt ?? new Date().toISOString());
    return `${when} · calendar day ${day}`;
};

/** Normalize JSON/text[] `symbols` so UI always gets strings (avoids render quirks). */
function normalizeDailyWatchlistSymbols(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s ?? '').trim()).filter(Boolean);
}

export const getDailyWatchlist = async (): Promise<DailyWatchlist | null> => {
    const { data, error } = await supabase
        .from('daily_watchlist')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.warn("Could not fetch daily watchlist", error);
        return null;
    }
    if (!data) return null;
    return {
        id: String(data.id ?? ''),
        watchlist_date: String(data.watchlist_date ?? ''),
        symbols: normalizeDailyWatchlistSymbols(data.symbols),
        created_by: data.created_by != null ? String(data.created_by) : '',
        created_at: data.created_at != null ? String(data.created_at) : '',
        label: buildWatchlistLabel(data.watchlist_date, data.created_at),
    };
};

export const getAllDailyWatchlists = async (): Promise<DailyWatchlist[]> => {
    /** Most recently published snapshot first (same as getDailyWatchlist single-row semantics). */
    const { data, error } = await supabase
        .from('daily_watchlist')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.warn("Could not fetch all daily watchlists", error);
        return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows.map((r: any) => ({
        id: String(r.id ?? ''),
        watchlist_date: String(r.watchlist_date ?? ''),
        symbols: normalizeDailyWatchlistSymbols(r.symbols),
        created_by: r.created_by != null ? String(r.created_by) : '',
        created_at: r.created_at != null ? String(r.created_at) : '',
        label: buildWatchlistLabel(r.watchlist_date, r.created_at),
    }));
};

export const getDailyWatchlistItems = async (watchlistId: string, watchlistDate?: string): Promise<DailyWatchlistItem[]> => {
    const id = (watchlistId || '').trim();
    const date = (watchlistDate || '').trim();
    if (!id && !date) return [];
    let rows: any[] = [];
    if (id) {
        const { data, error } = await supabase
            .from('daily_watchlist_items')
            .select('*')
            .eq('watchlist_id', id)
            .order('symbol', { ascending: true });
        if (error) {
            console.warn("Could not fetch daily watchlist items by watchlist_id", error);
        } else {
            rows = data || [];
        }
    }
    // Legacy fallback for old snapshots keyed only by date.
    if (rows.length === 0 && date) {
        const { data, error } = await supabase
            .from('daily_watchlist_items')
            .select('*')
            .eq('watchlist_date', date)
            .order('symbol', { ascending: true });
        if (error) {
            console.warn("Could not fetch daily watchlist items by watchlist_date", error);
            return [];
        }
        rows = data || [];
    }
    return rows.map((r: any) => ({
        watchlist_id: r.watchlist_id ?? undefined,
        watchlist_date: r.watchlist_date,
        symbol: r.symbol,
        company: r.company ?? '',
        sector: r.sector ?? '',
        industry: r.industry ?? '',
        location: r.location ?? '',
        current_price: r.current_price != null ? Number(r.current_price) : null,
        total_assets: r.total_assets != null ? Number(r.total_assets) : null,
        total_liabilities: r.total_liabilities != null ? Number(r.total_liabilities) : null,
        total_revenue: r.total_revenue != null ? Number(r.total_revenue) : null,
        net_income: r.net_income != null ? Number(r.net_income) : null,
        operating_cash_flow: r.operating_cash_flow != null ? Number(r.operating_cash_flow) : null,
        free_cash_flow: r.free_cash_flow != null ? Number(r.free_cash_flow) : null,
        iv_dcf: r.iv_dcf != null ? Number(r.iv_dcf) : null,
        iv_ri: r.iv_ri != null ? Number(r.iv_ri) : null,
        iv_multiples: r.iv_multiples != null ? Number(r.iv_multiples) : null,
        iv_quality_score: r.iv_quality_score != null ? Number(r.iv_quality_score) : null,
        iv_ensemble: r.iv_ensemble != null ? Number(r.iv_ensemble) : null,
        iv_upside_pct: r.iv_upside_pct != null ? Number(r.iv_upside_pct) : null,
        torchlight_score: r.torchlight_score != null ? Number(r.torchlight_score) : null,
        torchlight_rank_factors: r.torchlight_rank_factors ?? '',
        torchlight_momentum: r.torchlight_momentum != null ? Number(r.torchlight_momentum) : null,
        torchlight_valuation_edge: r.torchlight_valuation_edge != null ? Number(r.torchlight_valuation_edge) : null,
        torchlight_quality: r.torchlight_quality != null ? Number(r.torchlight_quality) : null,
        torchlight_growth: r.torchlight_growth != null ? Number(r.torchlight_growth) : null,
        torchlight_sentiment: r.torchlight_sentiment != null ? Number(r.torchlight_sentiment) : null,
        torchlight_macro_fit: r.torchlight_macro_fit != null ? Number(r.torchlight_macro_fit) : null,
        torchlight_execution_feasibility: r.torchlight_execution_feasibility != null ? Number(r.torchlight_execution_feasibility) : null,
        torchlight_risk_adjusted_alpha: r.torchlight_risk_adjusted_alpha != null ? Number(r.torchlight_risk_adjusted_alpha) : null,
        torchlight_capital_efficiency: r.torchlight_capital_efficiency != null ? Number(r.torchlight_capital_efficiency) : null,
        torchlight_analyst_drift: r.torchlight_analyst_drift != null ? Number(r.torchlight_analyst_drift) : null,
        ctr_total_return: r.ctr_total_return != null ? Number(r.ctr_total_return) : null,
        ctr_price_return: r.ctr_price_return != null ? Number(r.ctr_price_return) : null,
        ctr_cash_return: r.ctr_cash_return != null ? Number(r.ctr_cash_return) : null,
        ctr_annualized: r.ctr_annualized != null ? Number(r.ctr_annualized) : null,
        torchlight_ctr_score: r.torchlight_ctr_score != null ? Number(r.torchlight_ctr_score) : null,
        risk_daily_return_mean: r.risk_daily_return_mean != null ? Number(r.risk_daily_return_mean) : null,
        risk_volatility_daily: r.risk_volatility_daily != null ? Number(r.risk_volatility_daily) : null,
        risk_volatility_annual: r.risk_volatility_annual != null ? Number(r.risk_volatility_annual) : null,
        risk_sharpe: r.risk_sharpe != null ? Number(r.risk_sharpe) : null,
        risk_sortino: r.risk_sortino != null ? Number(r.risk_sortino) : null,
        risk_max_drawdown: r.risk_max_drawdown != null ? Number(r.risk_max_drawdown) : null,
        risk_var_95_hist: r.risk_var_95_hist != null ? Number(r.risk_var_95_hist) : null,
        risk_var_99_hist: r.risk_var_99_hist != null ? Number(r.risk_var_99_hist) : null,
        risk_var_95_param: r.risk_var_95_param != null ? Number(r.risk_var_95_param) : null,
        risk_var_99_param: r.risk_var_99_param != null ? Number(r.risk_var_99_param) : null,
        risk_cvar_95: r.risk_cvar_95 != null ? Number(r.risk_cvar_95) : null,
        risk_beta: r.risk_beta != null ? Number(r.risk_beta) : null,
        risk_summary_score: r.risk_summary_score != null ? Number(r.risk_summary_score) : null,
        created_at: r.created_at,
    }));
};

export const getCompanyFundamentalsByTickers = async (tickers: string[]): Promise<Record<string, CompanyFundamental>> => {
    const normalized = tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean);
    if (normalized.length === 0) return {};

    if (useLocalTable('company_fundamentals')) {
        try {
            const rows = await localCfGetMany(normalized);
            const out: Record<string, CompanyFundamental> = {};
            rows.forEach((r) => {
                out[r.ticker] = r;
            });
            return out;
        } catch (e) {
            console.warn('Could not read local company_fundamentals', e);
            return {};
        }
    }

    const { data, error } = await supabase
        .from('company_fundamentals')
        .select('ticker, company, sector, location, industry, website, updated_at')
        .in('ticker', normalized);
    if (error) {
        console.warn("Could not fetch company fundamentals by tickers", error);
        return {};
    }
    const out: Record<string, CompanyFundamental> = {};
    (data || []).forEach((r: any) => {
        out[r.ticker] = {
            ticker: r.ticker,
            company: r.company ?? '',
            sector: r.sector ?? '',
            location: r.location ?? '',
            industry: r.industry ?? '',
            website: r.website ?? '',
            updated_at: r.updated_at,
        };
    });
    return out;
};

function throwWatchlistWriteError(scope: string, error: { message?: string; code?: string; details?: string; hint?: string }): never {
    const raw = error.message || 'Unknown error';
    const parts = [scope, raw, error.code, error.details, error.hint].filter(Boolean) as string[];
    const msg = parts.join(' · ');
    const low = msg.toLowerCase();
    if (/row-level security|violates .*policy|permission denied for table/i.test(low)) {
        throw new Error(
            'Could not save watchlist (database blocked the insert). In Supabase → SQL Editor, run supabase/migrations/20260428200000_admin_policies_role_only.sql from this repo. Your row in public.profiles must have role = admin (sign out/in after fixing).'
        );
    }
    throw new Error(msg);
}

/** Inserts a **new** snapshot row every time — never replaces prior lists. Items upsert only for this new row’s id. */
export const createOrUpdateDailyWatchlist = async (
    createdByUid: string,
    symbols: string[],
    createdAtIso?: string,
    items?: DailyWatchlistItem[]
): Promise<void> => {
    await syncMasterAdminProfile(createdByUid);
    const normalized = symbols.map(s => String(s).toUpperCase().trim()).filter(Boolean);
    const createdAt = createdAtIso ?? new Date().toISOString();
    /** Local calendar column for filtering; distinct from exact `created_at` timestamp. */
    const watchlistDate = localCalendarDateStamp();
    const { data: inserted, error } = await supabase
        .from('daily_watchlist')
        .insert({
            watchlist_date: watchlistDate,
            symbols: normalized,
            created_by: createdByUid,
            created_at: createdAt,
        })
        .select('id, watchlist_date')
        .single();

    if (error) throwWatchlistWriteError('daily_watchlist insert', error);
    if (!inserted?.id) throw new Error('Failed to get saved watchlist id.');

    if (Array.isArray(items)) {
        const payload = items
            .map((r) => ({
                watchlist_id: inserted.id,
                watchlist_date: inserted.watchlist_date || watchlistDate,
                symbol: String(r.symbol || '').toUpperCase().trim(),
                company: (r.company || '').trim(),
                sector: (r.sector || '').trim(),
                industry: (r.industry || '').trim(),
                location: (r.location || '').trim(),
                current_price: r.current_price ?? null,
                total_assets: r.total_assets ?? null,
                total_liabilities: r.total_liabilities ?? null,
                total_revenue: r.total_revenue ?? null,
                net_income: r.net_income ?? null,
                operating_cash_flow: r.operating_cash_flow ?? null,
                free_cash_flow: r.free_cash_flow ?? null,
                iv_dcf: r.iv_dcf ?? null,
                iv_ri: r.iv_ri ?? null,
                iv_multiples: r.iv_multiples ?? null,
                iv_quality_score: r.iv_quality_score ?? null,
                iv_ensemble: r.iv_ensemble ?? null,
                iv_upside_pct: r.iv_upside_pct ?? null,
                torchlight_score: r.torchlight_score ?? null,
                torchlight_rank_factors: r.torchlight_rank_factors ?? null,
                torchlight_momentum: r.torchlight_momentum ?? null,
                torchlight_valuation_edge: r.torchlight_valuation_edge ?? null,
                torchlight_quality: r.torchlight_quality ?? null,
                torchlight_growth: r.torchlight_growth ?? null,
                torchlight_sentiment: r.torchlight_sentiment ?? null,
                torchlight_macro_fit: r.torchlight_macro_fit ?? null,
                torchlight_execution_feasibility: r.torchlight_execution_feasibility ?? null,
                torchlight_risk_adjusted_alpha: r.torchlight_risk_adjusted_alpha ?? null,
                torchlight_capital_efficiency: r.torchlight_capital_efficiency ?? null,
                torchlight_analyst_drift: r.torchlight_analyst_drift ?? null,
                ctr_total_return: r.ctr_total_return ?? null,
                ctr_price_return: r.ctr_price_return ?? null,
                ctr_cash_return: r.ctr_cash_return ?? null,
                ctr_annualized: r.ctr_annualized ?? null,
                torchlight_ctr_score: r.torchlight_ctr_score ?? null,
                risk_daily_return_mean: r.risk_daily_return_mean ?? null,
                risk_volatility_daily: r.risk_volatility_daily ?? null,
                risk_volatility_annual: r.risk_volatility_annual ?? null,
                risk_sharpe: r.risk_sharpe ?? null,
                risk_sortino: r.risk_sortino ?? null,
                risk_max_drawdown: r.risk_max_drawdown ?? null,
                risk_var_95_hist: r.risk_var_95_hist ?? null,
                risk_var_99_hist: r.risk_var_99_hist ?? null,
                risk_var_95_param: r.risk_var_95_param ?? null,
                risk_var_99_param: r.risk_var_99_param ?? null,
                risk_cvar_95: r.risk_cvar_95 ?? null,
                risk_beta: r.risk_beta ?? null,
                risk_summary_score: r.risk_summary_score ?? null,
                created_at: createdAt,
            }))
            .filter((r) => r.symbol);

        if (payload.length > 0) {
            const chunkSize = 150;
            for (let i = 0; i < payload.length; i += chunkSize) {
                const chunk = payload.slice(i, i + chunkSize);
                const { error: insErr } = await supabase
                    .from('daily_watchlist_items')
                    .upsert(chunk, { onConflict: 'watchlist_id,symbol' });
                if (insErr) throwWatchlistWriteError('daily_watchlist_items upsert', insErr);
            }
        }
    }
};

// --- COMPANY FUNDAMENTALS (reference data; admin-only write) ---

export const getCompanyFundamentals = async (opts?: { limit?: number; offset?: number; search?: string }): Promise<CompanyFundamental[]> => {
    if (useLocalTable('company_fundamentals')) {
        let rows = await localCfGetAll();
        const s = opts?.search?.trim();
        if (s) {
            const q = s.toLowerCase();
            rows = rows.filter(
                (r) =>
                    r.ticker.toLowerCase().includes(q) ||
                    r.company.toLowerCase().includes(q) ||
                    r.sector.toLowerCase().includes(q) ||
                    r.industry.toLowerCase().includes(q)
            );
        }
        const offset = Math.max(0, opts?.offset ?? 0);
        const lim = opts?.limit;
        if (lim != null) return rows.slice(offset, offset + lim);
        return rows.slice(offset);
    }

    let q = supabase.from('company_fundamentals').select('ticker, company, sector, location, industry, website, updated_at').order('ticker');
    if (opts?.search?.trim()) {
        const s = opts.search.trim().replace(/"/g, '');
        q = q.or(`ticker.ilike."%${s}%",company.ilike."%${s}%",sector.ilike."%${s}%",industry.ilike."%${s}%"`);
    }
    if (opts?.limit != null) q = q.limit(opts.limit);
    if (opts?.offset != null) q = q.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
        ticker: r.ticker,
        company: r.company ?? '',
        sector: r.sector ?? '',
        location: r.location ?? '',
        industry: r.industry ?? '',
        website: r.website ?? '',
        updated_at: r.updated_at,
    }));
};

export const getCompanyFundamentalByTicker = async (ticker: string): Promise<CompanyFundamental | null> => {
    const t = ticker.trim().toUpperCase();
    if (useLocalTable('company_fundamentals')) {
        const rows = await localCfGetMany([t]);
        return rows[0] ?? null;
    }

    const { data, error } = await supabase.from('company_fundamentals').select('*').eq('ticker', t).single();
    if (error || !data) return null;
    return {
        ticker: data.ticker,
        company: data.company ?? '',
        sector: data.sector ?? '',
        location: data.location ?? '',
        industry: data.industry ?? '',
        website: data.website ?? '',
        updated_at: data.updated_at,
    };
};

export const upsertCompanyFundamentals = async (rows: CompanyFundamental[]): Promise<void> => {
    const payload = rows.map((r) => ({
        ticker: r.ticker.trim().toUpperCase(),
        company: (r.company ?? '').trim(),
        sector: (r.sector ?? '').trim(),
        location: (r.location ?? '').trim(),
        industry: (r.industry ?? '').trim(),
        website: (r.website ?? '').trim(),
    })).filter((r) => r.ticker);
    if (payload.length === 0) return;

    if (useLocalTable('company_fundamentals')) {
        await localCfUpsertMany(
            payload.map((r) => ({
                ticker: r.ticker,
                company: r.company,
                sector: r.sector,
                location: r.location,
                industry: r.industry,
                website: r.website,
            }))
        );
        return;
    }

    const { error } = await supabase.from('company_fundamentals').upsert(payload, { onConflict: 'ticker' });
    if (error) throw error;
};

export const updateCompanyFundamental = async (ticker: string, updates: Partial<Omit<CompanyFundamental, 'ticker'>>): Promise<void> => {
    const t = ticker.trim().toUpperCase();
    if (useLocalTable('company_fundamentals')) {
        await localCfUpdateRow(ticker, updates);
        return;
    }

    const body: Record<string, string> = {};
    if (updates.company !== undefined) body.company = updates.company.trim();
    if (updates.sector !== undefined) body.sector = updates.sector.trim();
    if (updates.location !== undefined) body.location = updates.location.trim();
    if (updates.industry !== undefined) body.industry = updates.industry.trim();
    if (updates.website !== undefined) body.website = updates.website.trim();
    const { error } = await supabase.from('company_fundamentals').update(body).eq('ticker', t);
    if (error) throw error;
};

export const deleteCompanyFundamental = async (ticker: string): Promise<void> => {
    if (useLocalTable('company_fundamentals')) {
        await localCfDelete(ticker);
        return;
    }

    const { error } = await supabase.from('company_fundamentals').delete().eq('ticker', ticker.trim().toUpperCase());
    if (error) throw error;
};

// --- NEWS BOARD (shared; all signed-in members + admins) ---

export const getNewsBoardPosts = async (): Promise<NewsBoardPost[]> => {
    const { data, error } = await supabase
        .from('news_board_posts')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as NewsBoardPost[];
};

export const addNewsBoardPost = async (args: {
    authorUid: string;
    authorEmail: string;
    authorDisplayName: string;
    title: string;
    body: string;
}): Promise<void> => {
    const { error } = await supabase.from('news_board_posts').insert({
        title: args.title.trim(),
        body: args.body.trim(),
        author_uid: args.authorUid,
        author_email: (args.authorEmail || '').trim().toLowerCase(),
        author_display_name: args.authorDisplayName?.trim() || null,
    });
    if (error) throw error;
};

export const deleteNewsBoardPost = async (postId: string): Promise<void> => {
    const { error } = await supabase.from('news_board_posts').delete().eq('id', postId);
    if (error) throw error;
};
