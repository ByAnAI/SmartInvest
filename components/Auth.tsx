import React, { useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import {
  supabase,
  isSupabaseConfigured,
  getSupabaseSetupInstructions,
  isPasswordAuthBlockedByKey,
  signOutSafely,
} from '../services/supabase';
import { getAuthPassword, envTruthy } from '../utils/authPassword';
import { MASTER_ADMIN_EMAIL } from '../config/masterAdmin';

interface AuthProps {
  onClose: () => void;
  /** Apply session in parent immediately after password/OAuth resolves (belt-and-suspenders with `onAuthStateChange`). */
  onSessionReady?: (session: { user: any }) => void;
  onVerificationSuccess?: (user: any) => void;
  initialError?: string | null;
  onHardReset?: () => void;
  initialMode?: 'login' | 'signup' | 'forgot-password' | 'reset-password' | 'verify-email';
  actionCode?: string;
}

type AuthMode = 'login' | 'signup' | 'forgot-password' | 'reset-password' | 'verify-email';

/** Lightweight RFC-5322-ish check; backend Supabase still validates authoritatively. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Parse hash fragment for Supabase redirect params (e.g. password reset link)
// Handles both #access_token=... and #/recovery?access_token=... styles
function getHashParam(name: string): string | null {
  if (typeof window === 'undefined' || !window.location.hash) return null;
  const hash = window.location.hash;
  const re = new RegExp(`[#&?]${name}=([^&]*)`);
  const match = hash.match(re);
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ').trim()) : null;
}

/** Supabase auth can hang on navigator.locks or slow networks — never leave the UI stuck on "Processing…". */
const AUTH_NETWORK_TIMEOUT_MS = 28_000;

function withAuthTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${AUTH_NETWORK_TIMEOUT_MS / 1000}s. Try: close other tabs of this app; if you set VITE_SUPABASE_AUTH_WEB_LOCKS=true, remove it unless you need multi-tab coordination; then check network / Supabase status.`
        )
      );
    }, AUTH_NETWORK_TIMEOUT_MS);
    promise
      .then((v) => {
        window.clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        window.clearTimeout(id);
        reject(e);
      });
  });
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

const Auth: React.FC<AuthProps> = ({ onClose, onSessionReady, initialError, initialMode = 'login' }) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  const [email, setEmail] = useState(() => localStorage.getItem('rememberedEmail') || '');
  const [password, setPassword] = useState(() => localStorage.getItem('rememberedPassword') || '');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [rememberMe, setRememberMe] = useState(() => !!localStorage.getItem('rememberedEmail'));

  const emailNormForUi = (email || '').trim().toLowerCase();
  /** Master admin + env: browser can submit with empty password (Supabase still receives VITE_AUTH_UNIVERSAL_PASSWORD). */
  const adminLoginNoPasswordRequired =
    mode === 'login' &&
    envTruthy(import.meta.env.VITE_ADMIN_ANY_PASSWORD) &&
    emailNormForUi === MASTER_ADMIN_EMAIL;

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [recoverySessionReady, setRecoverySessionReady] = useState(false);

  useEffect(() => {
    if (initialError) setError(initialError);
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
          const url = new URL(window.location.href);
          url.hash = '';
          window.history.replaceState(null, '', url.pathname + url.search);
        } catch (e: any) {
          console.error('Recovery session setup failed:', e);
          setError('This reset link is invalid or expired. Please use Forgot Password again to get a new link.');
        }
        return;
      }

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
      if (!isSupabaseConfigured()) {
        setError(getSupabaseSetupInstructions());
        setLoading(false);
        return;
      }

      const emailNormalized = (email || '').trim().toLowerCase();
      const passwordTrimmed = (password || '').trim();
      const passwordForSupabase = getAuthPassword(passwordTrimmed, emailNormalized);

      if (
        (mode === 'login' || mode === 'signup' || mode === 'forgot-password') &&
        emailNormalized &&
        !EMAIL_REGEX.test(emailNormalized)
      ) {
        setError('Enter a valid email address (e.g. you@example.com).');
        setLoading(false);
        return;
      }

      if (mode === 'login' && emailNormalized === MASTER_ADMIN_EMAIL) {
        if (envTruthy(import.meta.env.VITE_ADMIN_ANY_PASSWORD) && !String(import.meta.env.VITE_AUTH_UNIVERSAL_PASSWORD ?? '').trim()) {
          setError('Add VITE_AUTH_UNIVERSAL_PASSWORD to .env (same value as this user’s password in Supabase). Restart npm run dev.');
          setLoading(false);
          return;
        }
      }

      if (mode === 'login') {
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', emailNormalized);
          localStorage.setItem('rememberedPassword', passwordTrimmed);
        } else {
          localStorage.removeItem('rememberedEmail');
          localStorage.removeItem('rememberedPassword');
        }

        const { data, error } = await withAuthTimeout(
          supabase.auth.signInWithPassword({
            email: emailNormalized,
            password: passwordForSupabase,
          }),
          'Sign-in'
        );

        if (error) throw error;
        if (data.session?.user) {
          flushSync(() => {
            onSessionReady?.(data.session);
          });
          setLoading(false);
          onClose();
          return;
        }
        setError('No session returned. If email confirmation is required, verify your inbox first.');
        setLoading(false);

      } else if (mode === 'signup') {
        const { data, error } = await withAuthTimeout(
          supabase.auth.signUp({
            email: emailNormalized,
            password: passwordForSupabase,
            options: {
              data: { full_name: emailNormalized.split('@')[0] },
            },
          }),
          'Sign-up'
        );

        if (error) throw error;
        if (data?.session?.user) {
          flushSync(() => {
            onSessionReady?.(data.session);
          });
          setLoading(false);
          onClose();
          return;
        }
        const { data: signInData, error: signInError } = await withAuthTimeout(
          supabase.auth.signInWithPassword({
            email: emailNormalized,
            password: passwordForSupabase,
          }),
          'Sign-in after sign-up'
        );
        if (!signInError && signInData?.session?.user) {
          flushSync(() => {
            onSessionReady?.(signInData.session);
          });
          setLoading(false);
          onClose();
          return;
        }
        setVerificationSent(true);
        setLoading(false);

      } else if (mode === 'forgot-password') {
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
            ? "Recovery link sent. Check your inbox. The link will open this app on localhost. If it opens a different host instead, add http://localhost:3000 (and your port if different) to Supabase → Authentication → URL Configuration → Redirect URLs, then request a new link."
            : "Recovery link sent. Check your inbox (and spam)."
        );
        setTimeout(() => setMode('login'), 6000);
        setLoading(false);
      } else if (mode === 'reset-password') {
        const pwd = (newPassword || '').trim();
        const conf = (confirmPassword || '').trim();
        if (pwd !== conf) throw new Error('Passwords do not match.');
        if (pwd.length < 6) throw new Error('Password must be at least 6 characters.');

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Recovery session expired or invalid. Please use Forgot Password again to get a new link.');

        const userEmail = (session.user?.email ?? '').trim().toLowerCase();
        const { error } = await supabase.auth.updateUser({
          password: pwd,
        });
        if (error) throw error;

        localStorage.removeItem('rememberedPassword');
        localStorage.removeItem('rememberedEmail');
        await signOutSafely();
        setEmail(userEmail);
        setNewPassword('');
        setConfirmPassword('');
        setPassword('');
        setSuccessMsg('Password updated. Sign in with your new password.');
        setMode('login');
        const url = new URL(window.location.href);
        url.searchParams.delete('mode');
        window.history.replaceState(null, '', url.pathname + url.search);
        setLoading(false);
      }
    } catch (err: any) {
      console.error('Auth Error:', err);
      setLoading(false);

      const raw =
        typeof err === 'string'
          ? err
          : String(err?.message ?? err?.msg ?? err?.error_description ?? '');
      const msg = raw.toLowerCase();
      const code = String(err?.code ?? err?.status ?? '').toLowerCase();
      const isInvalidCreds =
        code === 'invalid_credentials' || msg.includes('invalid login credentials');

      if (msg.includes('email not confirmed') || code.includes('email_not_confirmed')) {
        setError(
          'Email not confirmed. Open the link Supabase sent you, or in Dashboard → Authentication → Providers → Email, turn off “Confirm email” for testing. Then try again or sign up again.'
        );
      } else if (isInvalidCreds) {
        localStorage.removeItem('rememberedPassword');
        const triedEmail = (email || '').trim().toLowerCase();
        if (
          envTruthy(import.meta.env.VITE_ADMIN_ANY_PASSWORD) &&
          triedEmail === MASTER_ADMIN_EMAIL &&
          String(import.meta.env.VITE_AUTH_UNIVERSAL_PASSWORD ?? '').trim()
        ) {
          setError(
            `Supabase rejected login. Set user ${MASTER_ADMIN_EMAIL} password in Dashboard → Authentication → Users to exactly match VITE_AUTH_UNIVERSAL_PASSWORD in .env (character-for-character). Restart npm run dev after changing .env. If you use the publishable anon key and errors persist, try the legacy JWT anon key from Project Settings → API.`
          );
        } else {
          setError(
            'Invalid email or password. Double-check your email (try lowercase) and current password. If you just reset your password, use the new one.'
          );
        }
      } else if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('dns') || msg.includes('nxdomain')) {
        setError(
          'Authentication server is unreachable. Put VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in a file named `.env` in this project folder (same level as package.json), save, restart npm run dev.'
        );
      } else if (msg.includes('rate limit exceeded')) {
        setError('Too many attempts. Wait a few minutes, or add a custom SMTP provider in Supabase (Project Settings → Auth → SMTP).');
      } else if (msg.includes('recovery email') || msg.includes('error sending')) {
        setError(
          'Recovery email could not be sent. In Supabase Dashboard: 1) Project Settings → Auth → SMTP — enable a custom SMTP provider (SendGrid, Resend, etc.). 2) Authentication → URL Configuration — add this redirect URL: ' +
            `${window.location.origin}/?mode=reset-password`
        );
      } else if (msg.includes('email logins are disabled')) {
        setError(
          'Email sign-in is disabled in Supabase. Dashboard → Authentication → Providers → Email → enable the Email provider, then try again.'
        );
      } else if (mode === 'reset-password' && (msg.includes('password') || msg.includes('update') || msg.includes('session'))) {
        setError(
          raw ||
            'Could not save new password. Use at least 6 characters and try again. If the link expired, use Forgot Password to get a new one.'
        );
      } else {
        setError(raw || 'Sign-in failed. Check the browser console (F12 → Console) or run: npm run test:login');
      }
    }
  };

  /** Passwordless: Supabase emails a link; click it to return here with a session (needs SMTP / redirect URLs configured). */
  const handleMagicLinkLogin = async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      if (!isSupabaseConfigured()) {
        setError(getSupabaseSetupInstructions());
        setLoading(false);
        return;
      }
      const emailNormalized = (email || '').trim().toLowerCase();
      if (!emailNormalized) {
        setError('Enter your email above first.');
        setLoading(false);
        return;
      }
      if (!EMAIL_REGEX.test(emailNormalized)) {
        setError('Enter a valid email address (e.g. you@example.com).');
        setLoading(false);
        return;
      }
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await withAuthTimeout(
        supabase.auth.signInWithOtp({
          email: emailNormalized,
          options: {
            emailRedirectTo: redirectTo,
          },
        }),
        'Magic link request'
      );
      if (error) throw error;
      setSuccessMsg(
        'Login link sent. Check your inbox and spam — click the link to finish signing in. If nothing arrives, enable SMTP in Supabase (Auth settings) and add this site to Authentication → URL Configuration → Redirect URLs: ' +
          redirectTo
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Could not send login email.');
    } finally {
      setLoading(false);
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
        },
      });

      if (error) throw error;
      setSuccessMsg('Verification email resent. Please check your inbox.');
    } catch (err: any) {
      console.error('Resend Error:', err.message);
      if (err.message?.toLowerCase().includes('rate limit exceeded')) {
        setError('Too many attempts. Please wait before trying again or configure custom SMTP.');
      } else {
        setError(err.message || 'Failed to resend verification email.');
      }
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- Shared UI tokens ---------------- */

  const cardClass =
    'bg-white w-full max-w-md rounded-2xl shadow-xl ring-1 ring-slate-200 relative';
  const overlayClass =
    'fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/50 backdrop-blur-sm';
  const inputClass =
    'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 disabled:bg-slate-50 disabled:text-slate-500';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';
  const primaryBtnClass =
    'w-full inline-flex items-center justify-center gap-2 bg-emerald-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-emerald-700 active:bg-emerald-800 transition shadow-sm disabled:bg-emerald-300 disabled:cursor-not-allowed';
  const secondaryBtnClass =
    'w-full inline-flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-700 py-2.5 rounded-lg font-medium text-sm hover:bg-slate-50 active:bg-slate-100 transition disabled:opacity-50 disabled:cursor-not-allowed';
  const linkClass =
    'text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:underline';

  /* ---------------- Verification-sent screen ---------------- */

  if (verificationSent) {
    return (
      <div className={overlayClass} role="dialog" aria-modal="true" aria-labelledby="auth-verify-title">
        <div className={cardClass}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            ✕
          </button>

          <div className="p-8 sm:p-10 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-5">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </div>

            <h2 id="auth-verify-title" className="text-xl font-semibold text-slate-900 mb-2">
              Check your email
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              We sent a verification link to <span className="font-medium text-slate-900">{email}</span>.
              Click it to activate your account, then return here to sign in.
            </p>

            {error && (
              <div className="mb-4 px-3 py-2.5 text-sm rounded-lg border bg-rose-50 border-rose-200 text-rose-700 text-left">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="mb-4 px-3 py-2.5 text-sm rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-700 text-left">
                {successMsg}
              </div>
            )}

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => { setVerificationSent(false); setMode('login'); setError(''); setSuccessMsg(''); }}
                className={primaryBtnClass}
              >
                I’ve verified — continue to sign in
              </button>
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={loading}
                className={secondaryBtnClass}
              >
                {loading ? 'Resending…' : 'Resend verification email'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Per-mode copy ---------------- */

  const titleByMode: Record<AuthMode, string> = {
    login: 'Sign in',
    signup: 'Create your account',
    'forgot-password': 'Forgot your password?',
    'reset-password': 'Set a new password',
    'verify-email': 'Verify your email',
  };
  const subtitleByMode: Record<AuthMode, string> = {
    login: 'Welcome back. Sign in to continue.',
    signup: 'Start tracking and analyzing your portfolio.',
    'forgot-password': 'Enter your email and we’ll send you a reset link.',
    'reset-password': 'Choose a new password (at least 6 characters).',
    'verify-email': 'Click below to finish verifying your email.',
  };
  const submitLabel: Record<AuthMode, string> = {
    login: loading ? 'Signing in…' : 'Sign in',
    signup: loading ? 'Creating account…' : 'Create account',
    'forgot-password': loading ? 'Sending…' : 'Send reset link',
    'reset-password': loading ? 'Updating…' : recoverySessionReady ? 'Update password' : 'Preparing…',
    'verify-email': loading ? 'Verifying…' : 'Verify account',
  };

  return (
    <div className={overlayClass} role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <div className={cardClass}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
        >
          ✕
        </button>

        <div className="p-8 sm:p-10">
          <div className="mb-7">
            <h2 id="auth-title" className="text-2xl font-semibold text-slate-900 tracking-tight">
              {titleByMode[mode]}
            </h2>
            <p className="text-sm text-slate-500 mt-1">{subtitleByMode[mode]}</p>
          </div>

          {error && (
            <div role="alert" className="mb-4 px-3 py-2.5 text-sm rounded-lg border bg-rose-50 border-rose-200 text-rose-700">
              {error}
            </div>
          )}
          {successMsg && (
            <div role="status" className="mb-4 px-3 py-2.5 text-sm rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-700">
              {successMsg}
            </div>
          )}

          {isPasswordAuthBlockedByKey() && (mode === 'login' || mode === 'signup') && (
            <div className="mb-4 px-3 py-2.5 text-sm rounded-lg border bg-amber-50 border-amber-200 text-amber-900 leading-relaxed">
              <p className="font-semibold mb-1">Sign-in needs the legacy anon JWT</p>
              <p>
                The anon key in <code className="font-mono text-[12px]">.env</code> is publishable-only
                (<code className="font-mono text-[12px]">sb_publishable_…</code>). Password login needs the legacy JWT
                anon key from <strong>Supabase → Project Settings → API</strong> (starts with{' '}
                <code className="font-mono text-[12px]">eyJ</code>). Add{' '}
                <code className="font-mono text-[12px] break-all">VITE_SUPABASE_ANON_JWT=eyJ…</code> next to your existing
                lines, or replace <code className="font-mono text-[12px]">VITE_SUPABASE_ANON_KEY</code> with that JWT.
                Save and restart <code className="font-mono text-[12px]">npm run dev</code>.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {(mode === 'login' || mode === 'signup' || mode === 'forgot-password') && (
              <div>
                <label htmlFor="auth-email" className={labelClass}>Email</label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                  disabled={mode === 'forgot-password' && successMsg !== ''}
                />
              </div>
            )}

            {(mode === 'login' || mode === 'signup') && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="auth-password" className="block text-sm font-medium text-slate-700">
                    Password
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => { setMode('forgot-password'); setError(''); setSuccessMsg(''); }}
                      className={linkClass}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                {adminLoginNoPasswordRequired && (
                  <p className="text-xs text-slate-500 mb-1.5">
                    Optional for the master admin — unlock uses{' '}
                    <code className="font-mono text-[11px]">VITE_AUTH_UNIVERSAL_PASSWORD</code>.
                  </p>
                )}
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required={mode === 'signup' ? true : mode === 'login' ? !adminLoginNoPasswordRequired : true}
                    minLength={
                      mode === 'signup'
                        ? 6
                        : mode === 'login'
                          ? adminLoginNoPasswordRequired
                            ? undefined
                            : 6
                          : undefined
                    }
                    name="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pr-10`}
                    placeholder={adminLoginNoPasswordRequired ? '(optional for master admin)' : '••••••••'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>
            )}

            {mode === 'reset-password' && (
              <>
                {!recoverySessionReady && !error && (
                  <p className="text-sm text-slate-500">Preparing reset session…</p>
                )}
                <div>
                  <label htmlFor="auth-new-password" className={labelClass}>New password</label>
                  <div className="relative">
                    <input
                      id="auth-new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className={`${inputClass} pr-10`}
                      placeholder="At least 6 characters"
                      disabled={!recoverySessionReady}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                    >
                      <EyeIcon open={showNewPassword} />
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="auth-confirm-password" className={labelClass}>Confirm new password</label>
                  <div className="relative">
                    <input
                      id="auth-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`${inputClass} pr-10`}
                      placeholder="Re-enter new password"
                      disabled={!recoverySessionReady}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                    >
                      <EyeIcon open={showConfirmPassword} />
                    </button>
                  </div>
                </div>
              </>
            )}

            {mode === 'verify-email' && (
              <p className="text-sm text-slate-500">
                Click verify to finalize your email verification.
              </p>
            )}

            {mode === 'login' && (
              <label className="flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 focus:ring-2 accent-emerald-600 cursor-pointer"
                />
                <span className="text-sm text-slate-600">Remember me on this device</span>
              </label>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                (mode === 'forgot-password' && successMsg !== '') ||
                (mode === 'reset-password' && !recoverySessionReady)
              }
              className={primaryBtnClass}
            >
              {submitLabel[mode]}
            </button>

            {mode === 'login' && (
              <button
                type="button"
                disabled={loading || !(email || '').trim()}
                onClick={handleMagicLinkLogin}
                className={secondaryBtnClass}
              >
                Email me a sign-in link instead
              </button>
            )}

            {mode === 'forgot-password' && (
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
                className={secondaryBtnClass}
              >
                Back to sign in
              </button>
            )}
          </form>

          {(mode === 'login' || mode === 'signup') && (
            <p className="mt-6 text-center text-sm text-slate-500">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                  setSuccessMsg('');
                }}
                className="font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
              >
                {mode === 'login' ? 'Create account' : 'Sign in'}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
