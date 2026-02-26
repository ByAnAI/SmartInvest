import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const isLocalTesting = import.meta.env.VITE_LOCAL_TESTING === 'true';

// Your web app's Firebase configuration (emulators use this config but point to localhost)
const firebaseConfig = {
  apiKey: "AIzaSyApnLnmb8RuoyScX8bW7Gk0iMf6DRrx9gQ",
  authDomain: "stock-invest-b0c72.firebaseapp.com",
  projectId: "stock-invest-b0c72",
  storageBucket: "stock-invest-b0c72.firebasestorage.app",
  messagingSenderId: "445671059504",
  appId: "1:445671059504:web:ac08b67360a90e1d953df5"
};

const appCreated = getApps().length === 0;
const app = appCreated ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

if (isLocalTesting && appCreated) {
  const authEmulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR || 'http://127.0.0.1:9099';
  const firestoreHost = import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR || '127.0.0.1';
  const firestorePort = Number(import.meta.env.VITE_FIREBASE_FIRESTORE_PORT || '8080');
  try {
    connectAuthEmulator(auth, authEmulator, { disableWarnings: true });
    connectFirestoreEmulator(db, firestoreHost, firestorePort);
    console.info('[SmartInvest] Local testing: Firebase using Auth and Firestore emulators.');
  } catch (e) {
    console.warn('[SmartInvest] Local testing: Firebase emulators not connected. Run "firebase emulators:start" if you use Firebase features.');
  }
}

export { app, auth, db, googleProvider };
export default app;
