
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  arrayUnion, 
  arrayRemove 
} from "firebase/firestore";
import { db } from "./firebase";
import { PortfolioItem } from "../types";

const COLLECTION_NAME = "user_portfolios";

/**
 * Robustly initializes a user document with identity info.
 */
export const initializeUser = async (uid: string, email?: string | null, displayName?: string | null) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  
  const metadata = { 
    status: "active",
    email: email || "unknown",
    displayName: displayName || "Investor",
    lastLogin: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // We use setDoc with merge: true to ensure identity info is always present/updated
  await setDoc(docRef, metadata, { merge: true });

  const docSnap = await getDoc(docRef);
  if (!docSnap.exists() || !docSnap.data().items) {
    await setDoc(docRef, { 
      items: [],
      createdAt: new Date().toISOString()
    }, { merge: true });
  }
};

export const getPortfolio = async (uid: string): Promise<PortfolioItem[]> => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data().items || [];
  } else {
    const initialData = { 
      items: [], 
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString() 
    };
    await setDoc(docRef, initialData);
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
      lastActive: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } else {
    await updateDoc(docRef, {
      items: arrayUnion(item),
      lastActive: new Date().toISOString(),
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
      lastActive: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
};

export const clearPortfolio = async (uid: string) => {
  const docRef = doc(db, COLLECTION_NAME, uid);
  await updateDoc(docRef, {
    items: [],
    lastActive: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
};
