import { PortfolioItem, UserMetadata } from "../types";

// MOCK IMPLEMENTATION - NO FIRESTORE CONNECTION

export const initializeUser = async (uid: string, email?: string | null, displayName?: string | null) => {
  // Return dummy metadata so the app doesn't crash
  return {
    uid,
    email: email || '',
    displayName: displayName || 'Investor',
    status: 'active',
    role: 'user',
    lastLogin: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as UserMetadata;
};

export const getUserMetadata = async (uid: string): Promise<UserMetadata | null> => {
  return null;
};

export const getAllUsers = async (): Promise<UserMetadata[]> => {
  // Return some mock users so the Admin Dashboard is populated and actions can be tested
  return [
    {
      uid: 'mock-user-1',
      email: 'active@investor.com',
      displayName: 'Active Investor',
      status: 'active',
      role: 'user',
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      uid: 'mock-user-2',
      email: 'trader@vault.com',
      displayName: 'Day Trader',
      status: 'disabled',
      role: 'user',
      lastLogin: new Date(Date.now() - 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  ];
};

export const updateUserStatus = async (uid: string, status: 'active' | 'disabled') => {
  console.log(`Mock: Updating status for user ${uid} to ${status}`);
};

export const updateUserRole = async (uid: string, role: 'user' | 'admin') => {
  console.log(`Mock: Updating role for user ${uid} to ${role}`);
};

export const deleteUserRecord = async (uid: string) => {
  console.log(`Mock: Deleting user record ${uid}`);
};

export const purgeUsers = async (uids: string[]) => {
  console.log(`Mock: Purging users ${uids.join(', ')}`);
};

// --- PORTFOLIO & WATCHLIST (MOCK) ---

export const getPortfolio = async (uid: string): Promise<PortfolioItem[]> => {
  return [];
};

export const addStock = async (uid: string, item: PortfolioItem) => {
  console.log("Mock: Added stock", item);
};

export const removeStock = async (uid: string, symbol: string) => {
  console.log("Mock: Removed stock", symbol);
};

export const clearPortfolio = async (uid: string) => {
  console.log("Mock: Cleared portfolio");
};

export const getWatchlist = async (uid: string): Promise<string[]> => {
  // Return default watchlist so UI looks populated
  return ['AAPL', 'MSFT', 'NVDA', 'TSLA'];
};

export const addToWatchlist = async (uid: string, symbol: string) => {
  console.log("Mock: Added to watchlist", symbol);
};

export const removeFromWatchlist = async (uid: string, symbol: string) => {
  console.log("Mock: Removed from watchlist", symbol);
};
