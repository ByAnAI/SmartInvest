
import React, { useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendEmailVerification,
  signOut
} from 'firebase/auth';
import { auth, googleProvider } from '../services/firebase';

interface AuthProps {
  onClose: () => void;
  onVerificationSuccess?: (user: any) => void;
  initialError?: string | null;
  onHardReset?: () => void;
  initialMode?: 'login' | 'signup';
}

type AuthMode = 'login' | 'signup' | 'forgot-password';

const Auth: React.FC<AuthProps> = ({ onClose, initialError, initialMode = 'login' }) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  // Initialize email from local storage if exists
  const [email, setEmail] = useState(() => {
    return localStorage.getItem('rememberedEmail') || '';
  });

  // Initialize password from local storage if exists
  const [password, setPassword] = useState(() => {
    return localStorage.getItem('rememberedPassword') || '';
  });

  const [showPassword, setShowPassword] = useState(false);

  // Default rememberMe to true if we have a saved email
  const [rememberMe, setRememberMe] = useState(() => {
    return !!localStorage.getItem('rememberedEmail');
  });

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');

    try {
      // Apply persistence based on the checkbox state even for Google Sign In
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const res = await signInWithPopup(auth, googleProvider);

      // Enforce email verification for Google Sign In as well (though usually verified)
      if (!res.user.emailVerified) {
        await signOut(auth);
        setVerificationSent(true);
        return;
      }

      onClose();
    } catch (err: any) {
      console.error("Google Auth Error:", err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError("Sign-in cancelled.");
      } else {
        setError("Google Sign-in failed. Please try again.");
      }
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      if (mode === 'login') {
        // Handle Remember Me (Local Storage for Email AND Password)
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', email);
          localStorage.setItem('rememberedPassword', password);
        } else {
          localStorage.removeItem('rememberedEmail');
          localStorage.removeItem('rememberedPassword');
        }

        // Set persistence before signing in
        await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
        const userCredential = await signInWithEmailAndPassword(auth, email, password);

        // Check Email Verification
        if (!userCredential.user.emailVerified) {
          // Explicitly resend verification if they try to login while unverified
          await sendEmailVerification(userCredential.user);
          await signOut(auth);
          setVerificationSent(true);
          setLoading(false);
          return;
        }

        // Successful login automatically triggers onAuthStateChanged in App.tsx
        onClose();

      } else if (mode === 'signup') {
        // Signup
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // Send Verification Email - Simplified for reliability
        await sendEmailVerification(userCredential.user);

        // Sign out immediately to prevent auto-login
        await signOut(auth);

        setVerificationSent(true);
        setLoading(false);

      } else if (mode === 'forgot-password') {
        // Send Password Reset Email - Simplified for reliability
        await sendPasswordResetEmail(auth, email);
        setSuccessMsg("Recovery link dispatched. Check your inbox.");
        setTimeout(() => setMode('login'), 3000);
        setLoading(false);
      }
    } catch (err: any) {
      console.error("Auth Error Code:", err.code);
      setLoading(false);

      // Specific error mapping as requested
      if (mode === 'signup' && (err.code === 'auth/email-already-in-use')) {
        setError("User already exists. Please sign in");
      } else if (
        mode === 'login' &&
        (err.code === 'auth/invalid-credential' ||
          err.code === 'auth/user-not-found' ||
          err.code === 'auth/wrong-password' ||
          err.code === 'auth/invalid-email')
      ) {
        setError("Email or password is incorrect");
      } else {
        setError(err.message || "Authentication failed.");
      }
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

          <button
            onClick={() => { setVerificationSent(false); setMode('login'); }}
            className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-700 shadow-xl transition-all active:scale-95"
          >
            I've Verified, Continue to Log In
          </button>
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
              {mode === 'login' ? 'Authorize' : mode === 'signup' ? 'Join Vault' : 'Recovery'}
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
              />
            </div>

            {mode !== 'forgot-password' && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Access Password</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => setMode('forgot-password')} className="text-[10px] font-black text-emerald-600 hover:underline">RECOVER</button>
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
              disabled={loading}
              className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-700 shadow-2xl transition-all active:scale-95 disabled:opacity-50 mt-4"
            >
              {loading ? 'Processing...' : mode === 'login' ? 'Authorize Dashboard' : mode === 'signup' ? 'Create Vault' : 'Send Link'}
            </button>
          </form>

          {mode !== 'forgot-password' && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-100"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-slate-300 text-[9px] font-black uppercase tracking-widest">Or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full bg-white border-2 border-slate-100 text-slate-700 py-4 rounded-2xl font-bold hover:bg-slate-50 hover:border-slate-200 transition-all flex items-center justify-center space-x-3 active:scale-95"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.96l3.66-2.84z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84c.87-2.6 3.3-4.5 6.16-4.5z"
                    fill="#EA4335"
                  />
                </svg>
                <span>Sign in with Google</span>
              </button>
            </>
          )}

          <div className="mt-8 text-center">
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
              className="text-[10px] font-black text-emerald-600 hover:underline uppercase tracking-widest"
            >
              {mode === 'login' ? 'Establish New Profile' : 'Return to Authorization'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
