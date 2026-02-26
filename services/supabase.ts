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

export const loginWithGoogle = async () => {
    return await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin,
        },
    });
};
