
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyApnLnmb8RuoyScX8bW7Gk0iMf6DRrx9gQ",
  authDomain: "stock-invest-b0c72.firebaseapp.com",
  projectId: "stock-invest-b0c72",
  storageBucket: "stock-invest-b0c72.firebasestorage.app",
  messagingSenderId: "445671059504",
  appId: "1:445671059504:web:ac08b67360a90e1d953df5"
};

// Initialize Firebase
// Singleton pattern to prevent multiple initializations during hot reloads
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, googleProvider };
export default app;
