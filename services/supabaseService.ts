import { supabase } from './supabase';
import { PortfolioItem, UserMetadata, Folder, FileItem, Note, TeamMember, MarketAsset, DailyWatchlist } from "../types";

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
 * The user is removed from the users table and must sign up again. Does not fall back to profile-only delete
 * when the function fails, so the user is never left in Auth with a missing profile.
 */
export const deleteUserFully = async (uid: string) => {
    const { data, error: fnError } = await supabase.functions.invoke('delete-user', { body: { uid } });
    if (!fnError && data?.success) return { success: true };
    const msg = (data?.error ?? fnError?.message ?? '') as string;
    const status = (fnError as { context?: { status?: number } })?.context?.status;
    const isNotFound = status === 404 || msg.toLowerCase().includes('user not found');
    if (isNotFound) {
        await supabase.from('profiles').delete().eq('uid', uid);
        return { success: true };
    }
    if (status === 401 || status === 403) throw new Error(msg || 'Not authorized to delete users.');
    throw new Error(
        msg || 'User could not be permanently deleted. Ensure the delete-user Edge Function is deployed and SUPABASE_SERVICE_ROLE_KEY is set, then try again.'
    );
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
