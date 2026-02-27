import { supabase } from './supabase';
import { PortfolioItem, UserMetadata, Folder, FileItem, Note, TeamMember, MarketAsset, DailyWatchlist, CompanyFundamental } from "../types";

// --- USER MANAGEMENT ---

export const initializeUser = async (uid: string, email?: string | null, displayName?: string | null) => {
    // Try to fetch user from 'profiles' table (renamed from 'users' to avoid confusion with internal auth)
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', uid)
        .single();

    if (data) {
        return data as UserMetadata;
    }

    // Auto-promote specific email to admin
    const MASTER_ADMIN_EMAIL = "idris.elfeghi@byanai.com";
    const role = (email === MASTER_ADMIN_EMAIL) ? 'admin' : 'user';

    const { error: insertError } = await supabase
        .from('profiles')
        .insert({ uid, email: email || '', status: 'active', role });

    if (insertError) throw insertError;
    return { uid, email: email || '', displayName: displayName || 'Investor', status: 'active' as const, role, isVerified: false, lastLogin: '', createdAt: '', updatedAt: '' };
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
            throw tableError;
        }
        return (tableData || []).map(rowToUserMetadata);
    }
    console.error('getAllUsers:', error);
    throw error;
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
    }));
};

export const addStock = async (uid: string, item: PortfolioItem) => {
    const { error } = await supabase
        .from('portfolios')
        .upsert({
            user_id: uid,
            symbol: item.symbol,
            shares: item.shares,
            avg_cost: item.avgCost
        }, { onConflict: 'user_id, symbol' });
    if (error) throw error;
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
    const collectionName = `market_data`; // Using a single table with a 'market' column is better in SQL

    const payload = assets.map(asset => ({
        symbol: asset.symbol,
        name: asset.name,
        market: market.toLowerCase(),
        updated_at: new Date().toISOString()
    }));

    const { error } = await supabase
        .from(collectionName)
        .upsert(payload, { onConflict: 'symbol' });

    if (error) throw error;
};

export const getAllMarketAssets = async (): Promise<MarketAsset[]> => {
    const { data, error } = await supabase
        .from('market_data')
        .select('*');

    if (error) {
        console.warn("Could not fetch market_data", error);
        return [];
    }

    return (data || []) as MarketAsset[];
};

// --- DAILY WATCHLIST (manager-created; all users can view) ---

const todayDateString = () => new Date().toISOString().slice(0, 10);

export const getDailyWatchlist = async (): Promise<DailyWatchlist | null> => {
    const today = todayDateString();
    const { data, error } = await supabase
        .from('daily_watchlist')
        .select('*')
        .eq('watchlist_date', today)
        .maybeSingle();

    if (error) {
        console.warn("Could not fetch daily watchlist", error);
        return null;
    }
    if (!data) return null;
    return {
        id: data.id,
        watchlist_date: data.watchlist_date,
        symbols: Array.isArray(data.symbols) ? data.symbols : [],
        created_by: data.created_by,
        created_at: data.created_at,
    };
};

export const createOrUpdateDailyWatchlist = async (createdByUid: string, symbols: string[]): Promise<void> => {
    const today = todayDateString();
    const normalized = symbols.map(s => String(s).toUpperCase().trim()).filter(Boolean);
    const { error } = await supabase
        .from('daily_watchlist')
        .upsert(
            {
                watchlist_date: today,
                symbols: normalized,
                created_by: createdByUid,
                created_at: new Date().toISOString(),
            },
            { onConflict: 'watchlist_date' }
        );

    if (error) throw error;
};

// --- COMPANY FUNDAMENTALS (reference data; admin-only write) ---

export const getCompanyFundamentals = async (opts?: { limit?: number; offset?: number; search?: string }): Promise<CompanyFundamental[]> => {
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
    const { data, error } = await supabase.from('company_fundamentals').select('*').eq('ticker', ticker.trim().toUpperCase()).single();
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
    const { error } = await supabase.from('company_fundamentals').upsert(payload, { onConflict: 'ticker' });
    if (error) throw error;
};

export const updateCompanyFundamental = async (ticker: string, updates: Partial<Omit<CompanyFundamental, 'ticker'>>): Promise<void> => {
    const body: Record<string, string> = {};
    if (updates.company !== undefined) body.company = updates.company.trim();
    if (updates.sector !== undefined) body.sector = updates.sector.trim();
    if (updates.location !== undefined) body.location = updates.location.trim();
    if (updates.industry !== undefined) body.industry = updates.industry.trim();
    if (updates.website !== undefined) body.website = updates.website.trim();
    const { error } = await supabase.from('company_fundamentals').update(body).eq('ticker', ticker.trim().toUpperCase());
    if (error) throw error;
};

export const deleteCompanyFundamental = async (ticker: string): Promise<void> => {
    const { error } = await supabase.from('company_fundamentals').delete().eq('ticker', ticker.trim().toUpperCase());
    if (error) throw error;
};
