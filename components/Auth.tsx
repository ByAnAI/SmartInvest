import React, { useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  reload
} from 'firebase/auth';
import { auth, googleProvider } from '../services/firebase';
import { initializeUser, getUserMetadata } from '../services/firestoreService';

interface AuthProps {
  onClose: () => void;
  initialError?: string | null;
}

type AuthMode = 'login' | 'signup' | 'forgot-password';

const Auth: React.FC<AuthProps> = ({ onClose, initialError }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [checkingStatus, setCheckingStatus] = useState(false);

  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  const handleCheckVerification = async () => {
    if (!auth.currentUser) return;
    setCheckingStatus(true);
    try {
      await reload(auth.currentUser);
      if (auth.currentUser.emailVerified) {
        // User has confirmed! Now initialize them in Firestore to ensure they are in the DB.
        await initializeUser(auth.currentUser.uid, auth.currentUser.email, auth.currentUser.displayName);
        onClose(); // Close modal and log them directly into the dashboard
      } else {
        setError("Account not yet confirmed. Please click the link in your email.");
        setTimeout(() => setError(''), 3000);
      }
    } catch (err: any) {
      setError("Status check failed: " + err.message);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');
    
    try {
      if (mode === 'login') {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!user.emailVerified) {
          await sendEmailVerification(user);
          setRegisteredEmail(email);
          setVerificationRequired(true);
          setLoading(false);
          return;
        }
        
        await initializeUser(user.uid, user.email, user.displayName);
        const metadata = await getUserMetadata(user.uid);
        
        if (metadata?.status === 'disabled') {
          setError("Your institutional access has been suspended.");
          await signOut(auth);
          setLoading(false);
          return;
        }

        onClose();

      } else if (mode === 'signup') {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const user = userCredential.user;
          
          if (user) {
            await sendEmailVerification(user);
            setRegisteredEmail(email);
            setVerificationRequired(true);
          }
        } catch (err: any) {
          if (err.code === 'auth/email-already-in-use') {
            setError("This account already exists. Please sign in instead.");
            setTimeout(() => setMode('login'), 2000);
          } else if (err.code === 'auth/weak-password') {
            setError("Password must be at least 6 characters.");
          } else {
            setError(err.message || "Registration failed.");
          }
        }
      } else if (mode === 'forgot-password') {
        await sendPasswordResetEmail(auth, email);
        setSuccessMsg("Reset link sent! Please check your email.");
        setTimeout(() => setMode('login'), 3000);
      }
    } catch (err: any) {
      if (mode === 'login') {
        setError("Invalid email or password.");
      } else {
        setError(err.message || "An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        if (result.user.emailVerified) {
          await initializeUser(result.user.uid, result.user.email, result.user.displayName);
          const metadata = await getUserMetadata(result.user.uid);
          if (metadata?.status === 'disabled') {
            setError("Your access has been suspended.");
            await signOut(auth);
          } else {
            onClose();
          }
        } else {
          await sendEmailVerification(result.user);
          setRegisteredEmail(result.user.email || '');
          setVerificationRequired(true);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  if (verificationRequired) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative border border-slate-200 p-10 text-center">
          <div className="mb-8 inline-flex items-center justify-center w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full text-3xl animate-bounce">
            📧
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Account Verification</h2>
          <p className="text-slate-600 mb-8 leading-relaxed font-medium">
            A message link is sent to the email <span className="text-indigo-600 font-bold">{registeredEmail}</span>. <br/>
            <span className="text-indigo-500 mt-2 block font-bold">Please confirm.</span>
          </p>
          
          {error && (
            <div className="mb-4 p-3 text-xs bg-rose-50 text-rose-600 rounded-xl font-bold animate-pulse">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleCheckVerification}
              disabled={checkingStatus}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-indigo-600 transition-all active:scale-95 shadow-xl disabled:opacity-50"
            >
              {checkingStatus ? 'Verifying Status...' : "I've Confirmed, Log Me In"}
            </button>
            <button
              onClick={async () => {
                await signOut(auth);
                setVerificationRequired(false);
                setMode('login');
              }}
              className="w-full bg-slate-100 text-slate-500 py-3 rounded-2xl font-bold hover:bg-slate-200 transition-all text-xs"
            >
              Back to Login
            </button>
            <p className="text-[10px] text-slate-400 font-medium">
              Check your spam folder if you don't see the link. Once confirmed, you will be directly logged in and added to our database.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative border border-slate-200">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-2 transition-colors"
        >
          ✕
        </button>

        <div className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-slate-900">
              {mode === 'login' ? 'Investor Login' : mode === 'signup' ? 'Create Vault' : 'Account Recovery'}
            </h2>
            <p className="text-slate-500 mt-2 text-sm font-medium">
              {mode === 'forgot-password' ? 'Restore access to your secure portal' : 'Access Institutional Wealth OS'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 text-sm rounded-xl text-center font-bold animate-in fade-in zoom-in duration-200 border bg-rose-50 border-rose-100 text-rose-600">
              ⚠️ {error}
            </div>
          )}

          {successMsg && (
            <div className="mb-6 p-4 text-sm rounded-xl text-center font-bold animate-in fade-in zoom-in duration-200 border bg-emerald-50 border-emerald-100 text-emerald-600">
              ✓ {successMsg}
            </div>
          )}

          {mode !== 'forgot-password' && (
            <>
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center space-x-3 py-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-semibold mb-6 disabled:opacity-50"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                <span>Continue with Google</span>
              </button>

              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-100"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-3 text-slate-400 font-bold tracking-widest">Or Use Email</span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Corporate Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-medium"
                placeholder="investor@secure.com"
              />
            </div>
            {mode !== 'forgot-password' && (
              <div>
                <div className="flex justify-between items-center mb-1.5 ml-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Access Password</label>
                  {mode === 'login' && (
                    <button 
                      type="button"
                      onClick={() => setMode('forgot-password')}
                      className="text-xs font-bold text-indigo-600 hover:underline"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-medium"
                  placeholder="••••••••"
                />
              </div>
            )}
            <button
              disabled={loading}
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-indigo-600 shadow-xl shadow-slate-200 transition-all active:scale-95 disabled:opacity-50 mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
                  Security Check...
                </span>
              ) : mode === 'login' ? 'Authorize Dashboard' : mode === 'signup' ? 'Create Account' : 'Request Reset Link'}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-slate-500 font-medium">
            {mode === 'forgot-password' ? (
              <button 
                onClick={() => setMode('login')}
                className="text-indigo-600 font-bold hover:underline"
              >
                Return to Login
              </button>
            ) : (
              <>
                {mode === 'login' ? "New to institutional wealth?" : "Already an member?"}
                <button 
                  onClick={() => {
                    setMode(mode === 'login' ? 'signup' : 'login');
                    setError('');
                    setSuccessMsg('');
                  }}
                  className="ml-2 text-indigo-600 font-bold hover:underline"
                >
                  {mode === 'login' ? 'Create Account' : 'Login here'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;