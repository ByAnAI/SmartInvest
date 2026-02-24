import { supabase } from './supabase';
import { PortfolioItem, UserMetadata, Folder, FileItem, Note, TeamMember, MarketAsset } from "../types";

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

    const newUser: UserMetadata = {
        uid,
        email: email || '',
        displayName: displayName || 'Investor',
        status: 'active',
        role: role,
        isVerified: false,
        lastLogin: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
        .from('profiles')
        .insert(newUser);

    if (insertError) {
        console.error("Supabase: initializeUser failure:", insertError);
    }

    return newUser;
};

export const markUserAsVerified = async (uid: string) => {
    await supabase
        .from('profiles')
        .update({ isVerified: true, updatedAt: new Date().toISOString() })
        .eq('uid', uid);
};

export const getUserMetadata = async (uid: string): Promise<UserMetadata | null> => {
    const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('uid', uid)
        .single();
    return data as UserMetadata || null;
};

export const getAllUsers = async (): Promise<UserMetadata[]> => {
    const { data } = await supabase
        .from('profiles')
        .select('*');
    return (data || []) as UserMetadata[];
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

export const deleteUserFully = async (uid: string) => {
    // Supabase Auth deletion is tricky from the client side without service role key.
    // Usually done via an Edge Function or RPC if granted enough permission.
    // For now, we delete from profiles table.
    const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('uid', uid);

    if (error) throw error;
    return { success: true };
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
