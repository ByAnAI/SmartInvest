import { createClient } from '@supabase/supabase-js';

const isLocalTesting = import.meta.env.VITE_LOCAL_TESTING === 'true';

// In local testing mode we never use production Supabase; only local or placeholder
const supabaseUrl = isLocalTesting
    ? (import.meta.env.VITE_SUPABASE_LOCAL_URL ?? '')
    : (import.meta.env.VITE_SUPABASE_URL ?? '');
const supabaseAnonKey = isLocalTesting
    ? (import.meta.env.VITE_SUPABASE_LOCAL_ANON_KEY ?? '')
    : (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');

if (isLocalTesting) {
    if (supabaseUrl && supabaseAnonKey) {
        console.info('[SmartInvest] Local testing mode: using local Supabase only (no deployed project).');
    } else {
        console.warn('[SmartInvest] Local testing mode: set VITE_SUPABASE_LOCAL_URL and VITE_SUPABASE_LOCAL_ANON_KEY in .env.local (from `supabase start`). Using placeholder until then.');
    }
} else if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'YOUR_SUPABASE_URL') {
    console.warn('Supabase credentials missing. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
}

export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-anon-key'
);

function getAuthRedirectOrigin(): string {
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        return window.location.origin;
    }
    const explicit = import.meta.env.VITE_APP_URL || import.meta.env.VITE_AUTH_REDIRECT_URL;
    if (explicit) return explicit.replace(/\/$/, '');
    if (import.meta.env.VITE_LOCAL_TESTING === 'true') {
        return 'http://localhost:3000';
    }
    return window.location.origin;
}

export const loginWithGoogle = async () => {
    return await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: getAuthRedirectOrigin(),
        },
    });
};
