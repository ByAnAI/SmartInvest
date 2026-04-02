import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

interface AuthProps {
  onClose: () => void;
  onVerificationSuccess?: (user: any) => void;
  initialError?: string | null;
  onHardReset?: () => void;
  initialMode?: 'login' | 'signup' | 'forgot-password' | 'reset-password' | 'verify-email';
  actionCode?: string;
}

type AuthMode = 'login' | 'signup' | 'forgot-password' | 'reset-password' | 'verify-email';

// Parse hash fragment for Supabase redirect params (e.g. password reset link)
// Handles both #access_token=... and #/recovery?access_token=... styles
function getHashParam(name: string): string | null {
  if (typeof window === 'undefined' || !window.location.hash) return null;
  const hash = window.location.hash;
  const re = new RegExp(`[#&?]${name}=([^&]*)`);
  const match = hash.match(re);
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ').trim()) : null;
}

const Auth: React.FC<AuthProps> = ({ onClose, initialError, initialMode = 'login', actionCode }) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  // Initialize email from local storage if exists (never use remembered password for reset flow)
  const [email, setEmail] = useState(() => {
    return localStorage.getItem('rememberedEmail') || '';
  });

  const [password, setPassword] = useState(() => {
    return localStorage.getItem('rememberedPassword') || '';
  });

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [rememberMe, setRememberMe] = useState(() => {
    return !!localStorage.getItem('rememberedEmail');
  });

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [recoverySessionReady, setRecoverySessionReady] = useState(false);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  // When user lands from reset-password email link: establish session from URL hash so updateUser() works
  useEffect(() => {
    if (initialMode !== 'reset-password') return;

    const establishRecoverySession = async () => {
      const access_token = getHashParam('access_token');
      const refresh_token = getHashParam('refresh_token');
      const type = getHashParam('type');
      const token_hash = getHashParam('token_hash');
      const hasRecoveryTokens = (type === 'recovery' || access_token) && (token_hash || (access_token && refresh_token));

      if (hasRecoveryTokens) {
        try {
          if (token_hash) {
            const { error: otpError } = await supabase.auth.verifyOtp({
              token_hash,
              type: 'recovery',
            });
            if (otpError) throw otpError;
          } else if (access_token && refresh_token) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (sessionError) throw sessionError;
          }
          setRecoverySessionReady(true);
          setError('');
          // Remove only the hash (tokens); keep ?mode=reset-password so user stays on reset form
          const url = new URL(window.location.href);
          url.hash = '';
          window.history.replaceState(null, '', url.pathname + url.search);
        } catch (e: any) {
          console.error('Recovery session setup failed:', e);
          setError('This reset link is invalid or expired. Please use Forgot Password again to get a new link.');
        }
        return;
      }

      // Client may have already parsed the hash; check session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setRecoverySessionReady(true);
        setError('');
        const url = new URL(window.location.href);
        url.hash = '';
        window.history.replaceState(null, '', url.pathname + url.search);
      } else {
        setError('This reset link is invalid or expired. Please use Forgot Password again to get a new link.');
      }
    };

    establishRecoverySession();
  }, [initialMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      // Supabase treats email as case-sensitive; normalize so login matches signup
      const emailNormalized = (email || '').trim().toLowerCase();
      const passwordTrimmed = (password || '').trim();

      if (mode === 'login') {
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', emailNormalized);
          localStorage.setItem('rememberedPassword', passwordTrimmed);
        } else {
          localStorage.removeItem('rememberedEmail');
          localStorage.removeItem('rememberedPassword');
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailNormalized,
          password: passwordTrimmed,
        });

        if (error) throw error;
        void data;

        onClose();

      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: emailNormalized,
          password: passwordTrimmed,
          options: {
            data: { full_name: emailNormalized.split('@')[0] },
          },
        });

        if (error) throw error;
        // If email confirmations are disabled in Supabase, session is returned and user is logged in immediately.
        if (data?.session) {
          onClose();
          return;
        }
        // Fallback for projects that still require confirmation.
        setVerificationSent(true);
        setLoading(false);

      } else if (mode === 'forgot-password') {
        // When app is open on localhost, always send localhost so reset link never goes to Netlify
        const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        const baseUrl = isLocalhost
          ? window.location.origin
          : (import.meta.env.VITE_APP_URL || import.meta.env.VITE_AUTH_REDIRECT_URL || '')
            ? (import.meta.env.VITE_APP_URL || import.meta.env.VITE_AUTH_REDIRECT_URL || 'http://localhost:3000').replace(/\/$/, '')
            : import.meta.env.VITE_LOCAL_TESTING === 'true'
              ? 'http://localhost:3000'
              : window.location.origin;
        const redirectTo = `${baseUrl}/?mode=reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(emailNormalized, {
          redirectTo,
        });
        if (error) throw error;
        setSuccessMsg(
          isLocalhost
            ? "Recovery link sent. Check your inbox. The link will open this app on localhost. If it opens Netlify instead, add http://localhost:3000 (and your port if different) to Supabase → Authentication → URL Configuration → Redirect URLs, then request a new link."
            : "Recovery link sent. Check your inbox (and spam)."
        );
        setTimeout(() => setMode('login'), 6000);
        setLoading(false);
      } else if (mode === 'reset-password') {
        const pwd = (newPassword || '').trim();
        const conf = (confirmPassword || '').trim();
        if (pwd !== conf) throw new Error("Passwords do not match.");
        if (pwd.length < 6) throw new Error("Password must be at least 6 characters.");

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Recovery session expired or invalid. Please use Forgot Password again to get a new link.");

        const userEmail = (session.user?.email ?? '').trim().toLowerCase();
        const { error } = await supabase.auth.updateUser({
          password: pwd,
        });
        if (error) throw error;

        localStorage.removeItem('rememberedPassword');
        localStorage.removeItem('rememberedEmail');
        await supabase.auth.signOut();
        setEmail(userEmail);
        setNewPassword('');
        setConfirmPassword('');
        setPassword('');
        setSuccessMsg("Password updated. Log in with your new password.");
        setMode('login');
        const url = new URL(window.location.href);
        url.searchParams.delete('mode');
        window.history.replaceState(null, '', url.pathname + url.search);
        setLoading(false);
      }
    } catch (err: any) {
      console.error("Auth Error:", err.message);
      setLoading(false);

      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("invalid login credentials")) {
        localStorage.removeItem('rememberedPassword');
        setError("Invalid login credentials. Use the exact email you signed up with (try lowercase) and your current password. If you just reset your password, use the new one.");
      } else if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("dns") || msg.includes("nxdomain")) {
        setError("Authentication server is unreachable. Check VITE_SUPABASE_URL in .env, then restart npm run dev.");
      } else if (msg.includes("rate limit exceeded")) {
        setError("Email rate limit exceeded. Wait an hour or add custom SMTP in Supabase (Project Settings → Auth → SMTP).");
      } else if (msg.includes("recovery email") || msg.includes("error sending")) {
        setError("Recovery email could not be sent. In Supabase Dashboard: 1) Project Settings → Auth → SMTP — enable custom SMTP (SendGrid, Resend, etc.). 2) Authentication → URL Configuration — add this redirect URL: " + `${window.location.origin}/?mode=reset-password`);
      } else if (mode === 'reset-password' && (msg.includes("password") || msg.includes("update") || msg.includes("session"))) {
        setError(err?.message || "Could not save new password. Use at least 6 characters and try again. If the link expired, use Forgot Password to get a new one.");
      } else if (!msg.includes("invalid login credentials")) {
        setError(err?.message || "An unexpected error occurred.");
      }
    }
  };

  const handleResendEmail = async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: window.location.origin,
        }
      });

      if (error) throw error;
      setSuccessMsg("Verification email resent. Please check your inbox.");
    } catch (err: any) {
      console.error("Resend Error:", err.message);
      if (err.message?.toLowerCase().includes("rate limit exceeded")) {
        setError("Rate limit exceeded. Please wait before trying again or use a custom SMTP.");
      } else {
        setError(err.message || "Failed to resend verification email.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (verificationSent) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden relative border border-slate-100 p-10 text-center">
          <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 p-2 transition-colors">✕</button>

          <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl shadow-sm">
            ✉️
          </div>

          <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-4">Verify Your Email</h2>

          <p className="text-slate-500 font-medium leading-relaxed mb-8">
            A verification link has been sent to <br />
            <span className="font-bold text-slate-900">{email}</span>.
            <br /><br />
            Check your inbox (and spam). Once you click the link in the email, you can return here and log in.
          </p>

          <div className="space-y-4">
            <button
              onClick={() => { setVerificationSent(false); setMode('login'); }}
              className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-700 shadow-xl transition-all active:scale-95"
            >
              I've Verified, Continue to Log In
            </button>

            <button
              onClick={handleResendEmail}
              disabled={loading}
              className="w-full bg-slate-100 text-slate-700 py-4 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Resending...' : 'Resend Verification Email'}
            </button>

            {error && <p className="text-rose-500 text-[10px] font-bold mt-2 uppercase">⚠️ {error}</p>}
            {successMsg && <p className="text-emerald-500 text-[10px] font-bold mt-2 uppercase">✓ {successMsg}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden relative border border-slate-100">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 p-2 transition-colors">✕</button>

        <div className="p-10">
          <div className="text-center mb-10">
            <h2 className="text-4xl font-black text-slate-900 tracking-tight">
              {mode === 'login' ? 'Authorize' :
                mode === 'signup' ? 'Join Vault' :
                  mode === 'forgot-password' ? 'Recovery' :
                    mode === 'reset-password' ? 'New Password' : 'Verify Email'}
            </h2>
            <p className="text-slate-400 mt-2 font-black uppercase tracking-[0.2em] text-[10px]">Institutional Wealth OS</p>
          </div>

          {error && (
            <div className="mb-6 p-4 text-xs rounded-2xl border bg-rose-50 border-rose-100 text-rose-600 font-bold text-center">
              ⚠️ {error}
            </div>
          )}
          {successMsg && <div className="mb-6 p-4 text-xs rounded-2xl border bg-emerald-50 border-emerald-100 text-emerald-600 font-bold text-center">✓ {successMsg}</div>}

          <form onSubmit={handleSubmit} className="space-y-5">
            {(mode !== 'reset-password' && mode !== 'verify-email') && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Identifier</label>
                <input
                  type="email"
                  required
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold text-slate-700"
                  placeholder="investor@vault.com"
                  disabled={mode === 'forgot-password' && successMsg !== ''}
                />
              </div>
            )}

            {mode === 'reset-password' && (
              <div className="space-y-5">
                {!recoverySessionReady && (
                  <p className="text-amber-600 text-xs font-bold">Preparing reset… Please wait a moment.</p>
                )}
                <p className="text-slate-500 text-xs">Choose a new password and confirm it. After you confirm, you will be taken to the login screen to sign in with your new password.</p>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">New password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold text-slate-700"
                    placeholder="At least 6 characters"
                    disabled={!recoverySessionReady}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Confirm new password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold text-slate-700"
                    placeholder="Re-enter your new password"
                    disabled={!recoverySessionReady}
                  />
                </div>
              </div>
            )}

            {mode === 'verify-email' && (
              <div className="py-4 text-center">
                <p className="text-slate-500 font-medium mb-2">Click below to finalize your email verification.</p>
              </div>
            )}

            {mode !== 'forgot-password' && mode !== 'reset-password' && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Access Password</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => setMode('forgot-password')} className="text-[10px] font-black text-emerald-600 hover:underline">Forgot Password?</button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    name="password"
                    autoComplete={mode === 'login' ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold text-slate-700"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 text-xs font-bold"
                  >
                    {showPassword ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>
            )}

            {/* Remember Me Checkbox */}
            {mode === 'login' && (
              <div className="flex items-center ml-1 py-1">
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 bg-slate-50 border-slate-300 rounded focus:ring-emerald-500 focus:ring-2 accent-emerald-600 cursor-pointer"
                />
                <label htmlFor="remember-me" className="ml-2 text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer select-none">
                  Remember Me
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'forgot-password' && successMsg !== '') || (mode === 'reset-password' && !recoverySessionReady)}
              className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-700 shadow-2xl transition-all active:scale-95 disabled:opacity-50 mt-4"
            >
              {loading ? 'Processing...' :
                mode === 'login' ? 'Authorize Dashboard' :
                  mode === 'signup' ? 'Create Vault' :
                    mode === 'forgot-password' ? 'Send Recovery Link' :
                      mode === 'reset-password' ? (recoverySessionReady ? 'Confirm and go to login' : 'Preparing…') : 'Verify Account'}
            </button>
          </form>

          {(mode === 'login' || mode === 'signup') && (
            <div className="mt-8 text-center">
              <button
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                  setSuccessMsg('');
                }}
                className="text-[10px] font-black text-emerald-600 hover:underline uppercase tracking-widest"
              >
                {mode === 'login' ? 'Establish New Profile' : 'Return to Authorization'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
