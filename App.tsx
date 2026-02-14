
import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { auth } from './services/firebase';
import { getUserMetadata, initializeUser } from './services/firestoreService';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AIAnalysis from './components/AIAnalysis';
import NewsSection from './components/NewsSection';
import Portfolio from './components/Portfolio';
import AdminDashboard from './components/AdminDashboard';
import LandingPage from './components/LandingPage';
import Auth from './components/Auth';
import { UserMetadata } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [userMetadata, setUserMetadata] = useState<UserMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);

  /**
   * Security Redirect Hook
   * Ensures that if a user's role is not 'admin' but they are currently on the 'admin' tab
   * they are redirected back to the dashboard.
   */
  useEffect(() => {
    const isAdmin = userMetadata?.role === 'admin';
    if (activeTab === 'admin' && userMetadata && !isAdmin) {
      setActiveTab('dashboard');
    }
  }, [activeTab, userMetadata]);

  /**
   * Auth State Observer
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        // If unverified, we don't clear the user state immediately if showAuth is open,
        // because the Auth.tsx component might be handling the verification flow.
        if (!currentUser.emailVerified) {
          // If the Auth modal isn't open, we assume they are trying to bypass or stale session.
          // Otherwise, we let them stay "logged in" so the Auth modal can check verification status.
          if (!showAuth) {
            setBlockMessage("Activation required. Please verify your account via the link sent to your email.");
            await signOut(auth);
            setUser(null);
            setUserMetadata(null);
          } else {
             // Let Auth.tsx handle it
             setUser(currentUser);
          }
        } else {
          // User is confirmed! Initialize/Update user record.
          const metadata = await initializeUser(
            currentUser.uid, 
            currentUser.email, 
            currentUser.displayName
          );
          
          if (metadata && metadata.status === 'disabled') {
            setBlockMessage("Your institutional access has been suspended by an administrator.");
            await signOut(auth);
            setUser(null);
            setUserMetadata(null);
          } else {
            setUser(currentUser);
            setUserMetadata(metadata);
            setBlockMessage(null);
          }
        }
      } else {
        setUser(null);
        setUserMetadata(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [showAuth]);

  const handleStart = () => {
    if (!user) {
      setShowAuth(true);
    }
  };

  const renderContent = () => {
    const isAdmin = userMetadata?.role === 'admin';

    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'analysis':
        return <AIAnalysis />;
      case 'news':
        return <NewsSection />;
      case 'portfolio':
        return <Portfolio />;
      case 'admin':
        return isAdmin ? <AdminDashboard /> : <Dashboard />;
      default:
        return <Dashboard />;
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
          <p className="text-indigo-200 font-medium animate-pulse tracking-widest text-xs uppercase">Initializing Wealth OS...</p>
        </div>
      </div>
    );
  }

  // Only show the app if verified. If unverified but "logged in", the landing page/auth modal stays visible.
  if (!user || !user.emailVerified) {
    return (
      <>
        <LandingPage onStart={handleStart} />
        {showAuth && (
          <Auth 
            onClose={() => setShowAuth(false)} 
            initialError={blockMessage}
          />
        )}
      </>
    );
  }

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab} 
      isAdmin={userMetadata?.role === 'admin'}
    >
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
        {renderContent()}
      </div>
    </Layout>
  );
};

export default App;
