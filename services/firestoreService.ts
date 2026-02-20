
import {
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  writeBatch
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db, app } from "./firebase";
import { PortfolioItem, UserMetadata, Folder, FileItem, Note, TeamMember, MarketAsset } from "../types";

// --- EXISTING MOCKS (Kept for compatibility with existing components if needed) ---

export const initializeUser = async (uid: string, email?: string | null, displayName?: string | null) => {
  // Check if user exists first
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as UserMetadata;
  }

  // Auto-promote specific email to admin
  const MASTER_ADMIN_EMAIL = "idris.elfeghi@byanai.com";
  const role = (email === MASTER_ADMIN_EMAIL) ? 'admin' : 'user';

  // Create new user if not exists
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

  await setDoc(docRef, newUser);
  return newUser;
};

export const markUserAsVerified = async (uid: string) => {
  await updateDoc(doc(db, "users", uid), {
    isVerified: true,
    updatedAt: new Date().toISOString()
  });
};

export const getUserMetadata = async (uid: string): Promise<UserMetadata | null> => {
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? docSnap.data() as UserMetadata : null;
};

export const getAllUsers = async (): Promise<UserMetadata[]> => {
  // In a real app, this should be paginated and protected
  const q = query(collection(db, "users"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as UserMetadata);
};

export const updateUserStatus = async (uid: string, status: 'active' | 'disabled') => {
  await updateDoc(doc(db, "users", uid), { status });
};

export const updateUserRole = async (uid: string, role: 'user' | 'admin') => {
  await updateDoc(doc(db, "users", uid), { role });
};

export const deleteUserRecord = async (uid: string) => {
  await deleteDoc(doc(db, "users", uid));
};

export const deleteUserFully = async (uid: string) => {
  const functions = getFunctions(app);
  const deleteUserAccount = httpsCallable(functions, 'deleteUserAccount');
  try {
    const result = await deleteUserAccount({ uid });
    return result.data;
  } catch (error) {
    console.error("Full Deletion Failed:", error);
    // Fallback to record deletion if function fails or isn't deployed
    await deleteUserRecord(uid);
    throw error;
  }
};

export const purgeUsers = async (uids: string[]) => {
  const promises = uids.map(uid => deleteDoc(doc(db, "users", uid)));
  await Promise.all(promises);
};

export const getPortfolio = async (uid: string): Promise<PortfolioItem[]> => {
  const q = query(collection(db, `users/${uid}/portfolio`));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data() as PortfolioItem);
};

export const addStock = async (uid: string, item: PortfolioItem) => {
  // Using symbol as doc ID to prevent duplicates easily
  await setDoc(doc(db, `users/${uid}/portfolio`, item.symbol), item);
};

export const removeStock = async (uid: string, symbol: string) => {
  await deleteDoc(doc(db, `users/${uid}/portfolio`, symbol));
};

export const clearPortfolio = async (uid: string) => {
  const q = query(collection(db, `users/${uid}/portfolio`));
  const snapshot = await getDocs(q);
  const promises = snapshot.docs.map(d => deleteDoc(d.ref));
  await Promise.all(promises);
};

// --- REAL WATCHLIST IMPLEMENTATION ---

export const getWatchlist = async (uid: string): Promise<string[]> => {
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data();
    return data.watchlist || [];
  }
  return [];
};

export const addToWatchlist = async (uid: string, symbol: string) => {
  const docRef = doc(db, "users", uid);
  // Using arrayUnion ensures no duplicates are added
  await setDoc(docRef, { watchlist: arrayUnion(symbol) }, { merge: true });
};

export const removeFromWatchlist = async (uid: string, symbol: string) => {
  const docRef = doc(db, "users", uid);
  await updateDoc(docRef, { watchlist: arrayRemove(symbol) });
};


// --- REAL FIRESTORE IMPLEMENTATION FOR NEW FEATURES ---

// 1. My Files (Folders & Files)
export const getFolders = async (uid: string): Promise<Folder[]> => {
  const q = query(collection(db, `users/${uid}/folders`), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Folder));
};

export const addFolder = async (uid: string, name: string) => {
  await addDoc(collection(db, `users/${uid}/folders`), {
    name,
    createdAt: serverTimestamp()
  });
};

export const deleteFolder = async (uid: string, folderId: string) => {
  await deleteDoc(doc(db, `users/${uid}/folders/${folderId}`));
};

export const getFiles = async (uid: string): Promise<FileItem[]> => {
  const q = query(collection(db, `users/${uid}/files`), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileItem));
};

export const addFile = async (uid: string, name: string, size: string, folderId?: string) => {
  await addDoc(collection(db, `users/${uid}/files`), {
    name,
    size,
    folderId: folderId || null,
    createdAt: serverTimestamp()
  });
};

export const deleteFile = async (uid: string, fileId: string) => {
  await deleteDoc(doc(db, `users/${uid}/files/${fileId}`));
};

// 2. My Notes
export const getNotes = async (uid: string): Promise<Note[]> => {
  const q = query(collection(db, `users/${uid}/notes`), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note));
};

export const addNote = async (uid: string, title: string, content: string) => {
  await addDoc(collection(db, `users/${uid}/notes`), {
    title,
    content,
    createdAt: serverTimestamp()
  });
};

export const deleteNote = async (uid: string, noteId: string) => {
  await deleteDoc(doc(db, `users/${uid}/notes/${noteId}`));
};

// 3. Team Members
export const getTeamMembers = async (uid: string): Promise<TeamMember[]> => {
  const q = query(collection(db, `users/${uid}/teamMembers`), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TeamMember));
};

export const addTeamMember = async (uid: string, name: string, role: string) => {
  await addDoc(collection(db, `users/${uid}/teamMembers`), {
    name,
    role,
    createdAt: serverTimestamp()
  });
};

export const deleteTeamMember = async (uid: string, memberId: string) => {
  await deleteDoc(doc(db, `users/${uid}/teamMembers/${memberId}`));
};

// --- MARKET DATA MANAGEMENT ---

// Batch upload market assets (e.g. S&P 500 list)
export const batchUploadMarketData = async (market: string, assets: { symbol: string; name: string }[]) => {
  // Firestore batch limit is 500 operations. We must chunk the data.
  const CHUNK_SIZE = 450;
  const collectionName = `market_${market.toLowerCase()}`;

  for (let i = 0; i < assets.length; i += CHUNK_SIZE) {
    const chunk = assets.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(asset => {
      // Use symbol as Doc ID to prevent duplicates
      const docRef = doc(db, collectionName, asset.symbol);
      batch.set(docRef, {
        symbol: asset.symbol,
        name: asset.name,
        market: market,
        updatedAt: serverTimestamp()
      });
    });

    await batch.commit();
  }
};

// Fetch aggregated assets from multiple market databases
export const getAllMarketAssets = async (): Promise<MarketAsset[]> => {
  const markets = ['sp500', 'nasdaq', 'asia', 'crypto', 'commodity'];
  let allAssets: MarketAsset[] = [];

  const promises = markets.map(async (m) => {
    try {
      const q = query(collection(db, `market_${m}`));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        symbol: doc.id,
        ...doc.data()
      } as MarketAsset));
    } catch (e) {
      console.warn(`Could not fetch market_${m}`, e);
      return [];
    }
  });

  const results = await Promise.all(promises);
  results.forEach(res => {
    allAssets = [...allAssets, ...res];
  });

  return allAssets;
};
