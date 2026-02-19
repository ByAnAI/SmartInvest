
import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './services/firebase';
import { initializeUser } from './services/firestoreService';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AIAnalysis from './components/AIAnalysis';
import NewsSection from './components/NewsSection';
import Portfolio from './components/Portfolio';
import AdminDashboard from './components/AdminDashboard';
import LandingPage from './components/LandingPage';
import Auth from './components/Auth';
import MyFiles from './components/MyFiles';
import MyNotes from './components/MyNotes';
import TeamMembers from './components/TeamMembers';
import { UserMetadata } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [userMetadata, setUserMetadata] = useState<UserMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

  /**
   * Auth State Observer
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      try {
        // STRICT CHECK: Only allow access if user is present AND email is verified
        if (currentUser && currentUser.emailVerified) {
          setUser(currentUser);
          // We are not saving profile data to DB yet as requested, 
          // but we initialize the mock service for the UI to function.
          const metadata = await initializeUser(
            currentUser.uid,
            currentUser.email,
            currentUser.displayName
          );
          setUserMetadata(metadata);
        } else {
          // Block access for unverified users. 
          // Note: Auth.tsx handles the explicit signOut calls during the login/signup interaction
          // to prompt the verification screen. Here we ensure they don't see the dashboard.
          setUser(null);
          setUserMetadata(null);
        }
      } catch (err) {
        console.error("Auth State Error", err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleAuthOpen = (mode: 'login' | 'signup') => {
    setAuthMode(mode);
    setShowAuth(true);
  };

  // Logic to determine admin status: 
  // 1. Hard check for specific master email
  // 2. Database role check
  const isAdmin = user?.email === 'idris.elfeghi@byanai.com' || userMetadata?.role === 'admin';

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'analysis':
        return <AIAnalysis />;
      case 'news':
        return <NewsSection />;
      case 'portfolio':
        return <Portfolio />;
      case 'files':
        return <MyFiles />;
      case 'notes':
        return <MyNotes />;
      case 'team':
        return <TeamMembers />;
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

  if (!user) {
    return (
      <>
        <LandingPage onAuth={handleAuthOpen} />
        {showAuth && (
          <Auth
            onClose={() => setShowAuth(false)}
            initialMode={authMode}
          />
        )}
      </>
    );
  }

  return (
    <Layout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      isAdmin={isAdmin}
    >
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
        {renderContent()}
      </div>
    </Layout>
  );
};

export default App;
