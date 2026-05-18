
import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { supabase, signOutSafely } from './services/supabase';
import { getUserMetadata } from './services/supabaseService';
import NewsBoard from './components/NewsBoard';
import { UserMetadata } from './types';
import { MASTER_ADMIN_EMAIL } from './config/masterAdmin';

const StandaloneNewsBoardApp: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [userMetadata, setUserMetadata] = useState<UserMetadata | null>(null);

  const applySession = useCallback(async (session: { user: any } | null) => {
    const currentUser = session?.user ?? null;
    setUser(currentUser);

    if (!currentUser?.id) {
      setUserMetadata(null);
      setLoading(false);
      return;
    }

    try {
      const meta = await getUserMetadata(currentUser.id);
      const emailNorm = (currentUser.email || '').trim().toLowerCase();
      const isMasterAdmin = emailNorm === MASTER_ADMIN_EMAIL;
      if (meta?.status === 'disabled' && !isMasterAdmin) {
        await signOutSafely();
        setUser(null);
        setUserMetadata(null);
      } else {
        setUserMetadata(meta);
      }
    } catch {
      setUserMetadata(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => applySession(session))
      .catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => subscription.unsubscribe();
  }, [applySession]);

  const isAdmin =
    ((user?.email || '').trim().toLowerCase() === MASTER_ADMIN_EMAIL) ||
    userMetadata?.role === 'admin';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user?.id) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg max-w-md w-full p-8 text-center space-y-4">
          <h1 className="text-xl font-black text-slate-900">News Board</h1>
          <p className="text-slate-600 text-sm">
            Sign in from the main app first (same browser). Your session is shared on this origin.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
          >
            Open SmartInvest to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Standalone</p>
          <h1 className="text-lg font-bold text-slate-800">News Board</h1>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 uppercase tracking-wide"
          >
            Main app →
          </a>
          <button
            type="button"
            onClick={() => void signOutSafely()}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 uppercase tracking-wide"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="p-4 md:p-8">
        <NewsBoard
          user={user}
          userMetadata={userMetadata}
          isAdmin={isAdmin}
          standalone
        />
      </main>
    </div>
  );
};

const el = document.getElementById('root');
if (el) {
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <StandaloneNewsBoardApp />
    </React.StrictMode>
  );
}
