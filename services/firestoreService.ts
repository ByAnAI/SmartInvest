import { 
  doc, 
  getDoc, 
  getDocs,
  collection,
  setDoc, 
  updateDoc, 
  deleteDoc,
  writeBatch,
  arrayUnion, 
  arrayRemove,
} from "firebase/firestore";
import { db } from "./firebase";
import { PortfolioItem, UserMetadata } from "../types";

const COLLECTION_NAME = "user_portfolios";
const MASTER_ADMIN_EMAIL = "idris.elfeghi@byanai.com";

export const initializeUser = async (uid: string, email?: string | null, displayName?: string | null) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  
  let existingData: any = {};
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      existingData = docSnap.data();
    }
  } catch (e) {
    console.warn("Firestore: Initializing new user record for UID:", uid);
  }
  
  const isMasterAdmin = email?.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();
  const role = isMasterAdmin ? "admin" : (existingData.role || "user");
  const status = existingData.status || "active";
  const createdAt = existingData.createdAt || new Date().toISOString();

  const metadata: UserMetadata = { 
    uid,
    status,
    role,
    email: email || "unknown",
    displayName: displayName || "Investor",
    lastLogin: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdAt
  };

  await setDoc(docRef, metadata, { merge: true });

  // Ensure items and watchlist arrays exist
  if (!existingData.items) {
    await setDoc(docRef, { items: [] }, { merge: true });
  }
  if (!existingData.watchlist) {
    await setDoc(docRef, { watchlist: ['AAPL', 'MSFT', 'NVDA', 'TSLA'] }, { merge: true });
  }

  return metadata;
};

export const getUserMetadata = async (uid: string): Promise<UserMetadata | null> => {
  try {
    const docRef = doc(db, COLLECTION_NAME, uid);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? (docSnap.data() as UserMetadata) : null;
  } catch (e) {
    console.error("Firestore: Error fetching user metadata:", e);
    return null;
  }
};

export const getAllUsers = async (): Promise<UserMetadata[]> => {
  try {
    const colRef = collection(db, COLLECTION_NAME);
    const querySnapshot = await getDocs(colRef);
    return querySnapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserMetadata));
  } catch (error: any) {
    console.error("Firestore Error in getAllUsers:", error.code, error.message);
    throw error;
  }
};

export const updateUserStatus = async (uid: string, status: 'active' | 'disabled') => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  await updateDoc(docRef, { status, updatedAt: new Date().toISOString() });
};

export const updateUserRole = async (uid: string, role: 'user' | 'admin') => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  await updateDoc(docRef, { role, updatedAt: new Date().toISOString() });
};

export const deleteUserRecord = async (uid: string) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  await deleteDoc(docRef);
};

export const purgeUsers = async (uids: string[]) => {
  const batch = writeBatch(db);
  uids.forEach((uid) => {
    const docRef = doc(db, COLLECTION_NAME, uid);
    batch.delete(docRef);
  });
  await batch.commit();
};

export const getPortfolio = async (uid: string): Promise<PortfolioItem[]> => {
  try {
    const docRef = doc(db, COLLECTION_NAME, uid);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? (docSnap.data().items || []) : [];
  } catch (e) {
    console.error("Firestore: Error fetching portfolio:", e);
    return [];
  }
};

export const addStock = async (uid: string, item: PortfolioItem) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  const portfolio = await getPortfolio(uid);
  
  const existingIndex = portfolio.findIndex(i => i.symbol === item.symbol);
  
  if (existingIndex > -1) {
    const updatedItems = [...portfolio];
    const existing = updatedItems[existingIndex];
    const totalShares = existing.shares + item.shares;
    const totalCost = (existing.shares * existing.avgCost) + (item.shares * item.avgCost);
    updatedItems[existingIndex] = {
      symbol: item.symbol,
      shares: totalShares,
      avgCost: totalCost / totalShares
    };
    await updateDoc(docRef, { 
      items: updatedItems, 
      updatedAt: new Date().toISOString()
    });
  } else {
    await updateDoc(docRef, {
      items: arrayUnion(item),
      updatedAt: new Date().toISOString()
    });
  }
};

export const removeStock = async (uid: string, symbol: string) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  const portfolio = await getPortfolio(uid);
  const itemToRemove = portfolio.find(i => i.symbol === symbol);
  
  if (itemToRemove) {
    await updateDoc(docRef, {
      items: arrayRemove(itemToRemove),
      updatedAt: new Date().toISOString()
    });
  }
};

export const clearPortfolio = async (uid: string) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  await updateDoc(docRef, {
    items: [],
    updatedAt: new Date().toISOString()
  });
};

// --- WATCHLIST SERVICE ---

export const getWatchlist = async (uid: string): Promise<string[]> => {
  try {
    const docRef = doc(db, COLLECTION_NAME, uid);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? (docSnap.data().watchlist || []) : [];
  } catch (e) {
    console.error("Firestore: Error fetching watchlist:", e);
    return [];
  }
};

export const addToWatchlist = async (uid: string, symbol: string) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  await updateDoc(docRef, {
    watchlist: arrayUnion(symbol.toUpperCase()),
    updatedAt: new Date().toISOString()
  });
};

export const removeFromWatchlist = async (uid: string, symbol: string) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  await updateDoc(docRef, {
    watchlist: arrayRemove(symbol.toUpperCase()),
    updatedAt: new Date().toISOString()
  });
};