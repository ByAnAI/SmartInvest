
import React, { useState, useEffect } from 'react';
import { supabase } from './services/supabase';
import { initializeUser } from './services/supabaseService';
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
  const [activeTab, setActiveTab] = useState('portfolio');
  const [user, setUser] = useState<any | null>(null);
  const [userMetadata, setUserMetadata] = useState<UserMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'reset-password' | 'verify-email'>('login');
  const [authActionCode, setAuthActionCode] = useState<string | null>(null);

  /**
   * Auth: resolve session quickly so UI shows, then load profile in background.
   * Timeout so we never stay stuck on "Initializing" if Supabase is slow or unreachable.
   */
  useEffect(() => {
    setLoading(true);

    const applySession = (session: { user: any } | null) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setLoading(false);

      if (!currentUser) {
        setUserMetadata(null);
        return;
      }

      // Load profile in background so we don't block initial paint
      initializeUser(
        currentUser.id,
        currentUser.email,
        currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0]
      ).then((metadata) => {
        if (metadata.status === 'disabled') {
          supabase.auth.signOut();
          setUser(null);
          setUserMetadata(null);
        } else {
          setUserMetadata(metadata);
        }
      }).catch(() => setUserMetadata(null));
    };

    const timeout = setTimeout(() => {
      setLoading(false);
      setUser(null);
      setUserMetadata(null);
    }, 5000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        clearTimeout(timeout);
        applySession(session);
      })
      .catch(() => {
        clearTimeout(timeout);
        setLoading(false);
        setUser(null);
        setUserMetadata(null);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      applySession(session);
      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('reset-password');
        setShowAuth(true);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  // Allow child components to change tabs via a custom event
  useEffect(() => {
    const handler = (e: CustomEvent) => setActiveTab(e.detail);
    window.addEventListener('changeTab', handler as EventListener);
    return () => window.removeEventListener('changeTab', handler as EventListener);
  }, []);

  const handleAuthOpen = (mode: 'login' | 'signup' | 'reset-password') => {
    setAuthMode(mode);
    setShowAuth(true);
  };

  // When user clicks password-reset link in email, they land with ?mode=reset-password — open Auth in reset mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'reset-password') {
      setAuthMode('reset-password');
      setShowAuth(true);
    }
  }, []);

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
        return <Portfolio userId={user?.id} />;
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
            onClose={() => {
              setShowAuth(false);
              // Clean up URL so reset-password link doesn't reopen reset form next time
              const url = new URL(window.location.href);
              url.searchParams.delete('mode');
              if (url.search !== window.location.search || authActionCode) {
                window.history.replaceState({}, document.title, url.pathname + url.search);
                setAuthActionCode(null);
              }
            }}
            initialMode={authMode}
            actionCode={authActionCode || undefined}
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
      user={user}
      userMetadata={userMetadata}
    >
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
        {renderContent()}
      </div>
    </Layout>
  );
};

export default App;
