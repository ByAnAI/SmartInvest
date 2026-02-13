
import React, { useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup,
  sendEmailVerification,
  signOut
} from 'firebase/auth';
import { auth, googleProvider } from '../services/firebase';
import { initializeUser } from '../services/firestoreService';

interface AuthProps {
  onClose: () => void;
}

const Auth: React.FC<AuthProps> = ({ onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      if (isLogin) {
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          const user = userCredential.user;
          
          // CRITICAL: Initialize Firestore doc with identity while token is fresh
          await initializeUser(user.uid, user.email, user.displayName);

          if (!user.emailVerified) {
            await signOut(auth);
            setRegisteredEmail(email);
            setVerificationSent(true);
            return;
          }
          
          onClose();
        } catch (err: any) {
          if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            setError("Invalid email or password. Please verify your credentials.");
          } else {
            setError("Authentication failed. " + err.message);
          }
        }
      } else {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const user = userCredential.user;
          
          if (user) {
            // Write to Firestore before any redirect or signout
            await initializeUser(user.uid, user.email, user.displayName);
            
            // Send verification email
            await sendEmailVerification(user);
            
            // Sign out only after DB write is guaranteed
            await signOut(auth);
            
            setRegisteredEmail(email);
            setVerificationSent(true);
          }
        } catch (err: any) {
          if (err.code === 'auth/email-already-in-use') {
            setError("This account already exists. Redirecting to Sign In...");
            setTimeout(() => {
              setIsLogin(true);
              setError('');
            }, 2000);
          } else if (err.code === 'auth/weak-password') {
            setError("Password is too weak. Please use at least 6 characters.");
          } else {
            setError(err.message || "An error occurred during sign up");
          }
        }
      }
    } catch (err: any) {
      setError("Network or connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = async () => {
    setResendStatus('sending');
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(userCredential.user);
      await signOut(auth);
      setResendStatus('sent');
      setTimeout(() => setResendStatus('idle'), 5000);
    } catch (err: any) {
      setError("Could not resend email. Please verify credentials or try again later.");
      setVerificationSent(false);
      setResendStatus('idle');
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        await initializeUser(result.user.uid, result.user.email, result.user.displayName);
        
        if (result.user.emailVerified) {
          onClose();
        } else {
          // Generally Google accounts are pre-verified, but we check just in case
          await signOut(auth);
          setRegisteredEmail(result.user.email || '');
          setVerificationSent(true);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  if (verificationSent) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative border border-slate-200 p-8 text-center">
          <div className="mb-6 inline-flex items-center justify-center w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full text-2xl">
            ✉️
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Verification Sent</h2>
          <p className="text-slate-600 mb-8 leading-relaxed">
            A confirmation link was sent to <span className="font-bold text-slate-900">{registeredEmail}</span>. Once verified, you'll have full access to the AI portfolio dashboard.
          </p>
          
          <div className="space-y-3">
            <button
              onClick={() => {
                setVerificationSent(false);
                setIsLogin(true);
                setError('');
              }}
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold hover:bg-indigo-700 shadow-lg transition-all active:scale-95"
            >
              Back to Login
            </button>
            
            <button
              onClick={handleResendEmail}
              disabled={resendStatus !== 'idle'}
              className="w-full bg-slate-50 text-slate-600 py-3 rounded-xl font-semibold hover:bg-slate-100 transition-all disabled:opacity-50 text-sm"
            >
              {resendStatus === 'sending' ? 'Sending...' : 
               resendStatus === 'sent' ? '✓ Email Resent' : 'Resend Verification Email'}
            </button>
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
              {isLogin ? 'Security Portal' : 'Create Vault'}
            </h2>
            <p className="text-slate-500 mt-2 text-sm font-medium">
              Enterprise Wealth OS Login
            </p>
          </div>

          {error && (
            <div className={`mb-6 p-4 text-sm rounded-xl text-center font-medium animate-in fade-in zoom-in duration-200 border ${
              error.includes("Redirecting") 
                ? "bg-indigo-50 border-indigo-100 text-indigo-600" 
                : "bg-rose-50 border-rose-100 text-rose-600"
            }`}>
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center space-x-3 py-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-semibold mb-6 disabled:opacity-50"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            <span>{loading ? 'Authenticating...' : 'Continue with Google'}</span>
          </button>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-100"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 text-slate-400 font-bold tracking-widest">Standard Identity</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Work Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-medium"
                placeholder="investor@secure.com"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-medium"
                placeholder="••••••••"
              />
            </div>
            <button
              disabled={loading}
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-indigo-600 shadow-xl shadow-slate-200 transition-all active:scale-95 disabled:opacity-50 mt-2"
            >
              {loading ? 'Verifying...' : isLogin ? 'Open Dashboard' : 'Initialize Account'}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-slate-500 font-medium">
            {isLogin ? "Need a new vault?" : "Returning investor?"}
            <button 
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="ml-2 text-indigo-600 font-bold hover:underline"
            >
              {isLogin ? 'Join SmartInvest' : 'Login here'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
