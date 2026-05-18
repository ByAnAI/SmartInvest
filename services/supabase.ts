import { createClient } from '@supabase/supabase-js';

const isLocalTesting = import.meta.env.VITE_LOCAL_TESTING === 'true';

/**
 * Supabase Dashboard often shows a "publishable" anon key (`sb_publishable_…`). That key does not work with
 * `signInWithPassword` / `signUp` (GoTrue returns invalid_credentials). The legacy anon **JWT** (`eyJ…`) from the
 * same API page must be used for the browser client. Optionally set `VITE_SUPABASE_ANON_JWT` when the main
 * `VITE_SUPABASE_ANON_KEY` is publishable-only.
 */
function resolveAnonKey(isLocal: boolean): string {
    const primary = String(
        isLocal
            ? (import.meta.env.VITE_SUPABASE_LOCAL_ANON_KEY ?? '')
            : (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
    ).trim();
    const jwtOverride = String(
        isLocal
            ? (import.meta.env.VITE_SUPABASE_LOCAL_ANON_JWT ?? '')
            : (import.meta.env.VITE_SUPABASE_ANON_JWT ?? '')
    ).trim();
    if (primary.startsWith('sb_publishable_') && jwtOverride.startsWith('eyJ')) {
        if (import.meta.env.DEV) {
            console.info(
                '[SmartInvest] Using VITE_SUPABASE_*_ANON_JWT for the client; publishable key cannot be used for email/password auth.'
            );
        }
        return jwtOverride;
    }
    if (!primary && jwtOverride.startsWith('eyJ')) {
        return jwtOverride;
    }
    return primary;
}

// In local testing mode we never use production Supabase; only local or placeholder
const supabaseUrl = isLocalTesting
    ? (import.meta.env.VITE_SUPABASE_LOCAL_URL ?? '')
    : (import.meta.env.VITE_SUPABASE_URL ?? '');
const supabaseAnonKey = resolveAnonKey(isLocalTesting);

if (isLocalTesting) {
    if (supabaseUrl && supabaseAnonKey) {
        console.info('[SmartInvest] Local testing mode: using local Supabase only (no deployed project).');
    } else {
        console.warn('[SmartInvest] Local testing mode: set VITE_SUPABASE_LOCAL_URL and VITE_SUPABASE_LOCAL_ANON_KEY in .env.local (from `supabase start`). Using placeholder until then.');
    }
} else if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'YOUR_SUPABASE_URL') {
    console.warn('Supabase credentials missing. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
}

/**
 * Skip browser `navigator.locks` for Supabase Auth — avoids deadlocks on sign-in and reduces “tab won’t close” waits.
 * Default: always use this in-memory lock. Enable native Web Locks only if you need strict multi-tab coordination:
 * `VITE_SUPABASE_AUTH_WEB_LOCKS=true`
 *
 * Legacy: `VITE_SUPABASE_AUTH_MEMORY_LOCK=true` still forces memory lock (redundant with new default).
 */
async function authMemoryLock(
    _name: string,
    _acquireTimeout: number,
    fn: () => Promise<unknown>
): Promise<unknown> {
    return fn();
}

const useWebLocksForAuth =
    import.meta.env.VITE_SUPABASE_AUTH_WEB_LOCKS === 'true' ||
    import.meta.env.VITE_SUPABASE_AUTH_WEB_LOCKS === '1';

const legacyMemoryLock =
    import.meta.env.VITE_SUPABASE_AUTH_MEMORY_LOCK === 'true' ||
    import.meta.env.VITE_SUPABASE_AUTH_MEMORY_LOCK === '1';

/** Prefer memory lock unless Web Locks explicitly requested (or legacy MEMORY_LOCK flag — always memory). */
const useMemoryLockForAuth = !useWebLocksForAuth || legacyMemoryLock;

const authClientOptions = {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce' as const,
    /** Longer wait before “steal” recovery reduces Abort churn when tabs compete (default ~5s). */
    lockAcquireTimeout: 20000,
    ...(useMemoryLockForAuth ? { lock: authMemoryLock } : {}),
};

export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-anon-key',
    {
        auth: authClientOptions,
    }
);

/**
 * Sign out this browser session. Prefer `scope: 'local'` so revoke doesn’t depend as heavily on the auth Web Lock
 * (helps when `signOut()` hangs after cross-tab lock contention).
 */
export async function signOutSafely(): Promise<void> {
    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
        console.warn('[SmartInvest] signOut(local) failed, retrying global', e);
        try {
            await supabase.auth.signOut();
        } catch (e2) {
            console.warn('[SmartInvest] signOut failed', e2);
        }
    }
}

/** False when `.env` is missing keys or local testing expects `supabase start` keys that are not set. */
export function isSupabaseConfigured(): boolean {
    if (import.meta.env.VITE_LOCAL_TESTING === 'true') {
        const u = String(import.meta.env.VITE_SUPABASE_LOCAL_URL ?? '').trim();
        const k = resolveAnonKey(true);
        return Boolean(u && k);
    }
    const u = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
    const k = resolveAnonKey(false);
    return Boolean(
        u &&
            k &&
            u !== 'YOUR_SUPABASE_URL' &&
            !u.includes('placeholder.supabase.co') &&
            !/YOUR_PROJECT_REF|YOUR_ACTUAL_REF/i.test(u)
    );
}

/**
 * User-facing copy when `isSupabaseConfigured()` is false — pinpoints empty anon key vs missing URL.
 */
export function getSupabaseSetupInstructions(): string {
    if (import.meta.env.VITE_LOCAL_TESTING === 'true') {
        return (
            'Local Supabase: set VITE_SUPABASE_LOCAL_URL and VITE_SUPABASE_LOCAL_ANON_KEY in .env (copy from `supabase start`). Restart npm run dev.'
        );
    }
    const u = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
    const k = resolveAnonKey(false);
    if (u && !k) {
        return (
            'Your Supabase project URL is set, but VITE_SUPABASE_ANON_KEY is empty. Open Project Settings → API, copy the anon public key (JWT starting with eyJ) onto the same line: VITE_SUPABASE_ANON_KEY=eyJ... — save .env and restart npm run dev. If Dashboard only shows sb_publishable_…, put that in ANON_KEY and add VITE_SUPABASE_ANON_JWT=eyJ… (legacy JWT).'
        );
    }
    if (/YOUR_PROJECT_REF|YOUR_ACTUAL_REF/i.test(u)) {
        return 'Replace the placeholder in VITE_SUPABASE_URL with your real URL (e.g. https://umyfvbqvdoxsjjxslwpa.supabase.co). Restart npm run dev.';
    }
    return (
        'Supabase is not configured. Use .env with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY and VITE_LOCAL_TESTING=false for your hosted project — or enable local testing with VITE_SUPABASE_LOCAL_URL + VITE_SUPABASE_LOCAL_ANON_KEY from `supabase start`. Restart npm run dev after editing .env.'
    );
}

/**
 * True when the only key in env is the publishable key and no legacy JWT override is set.
 * Email/password sign-in will not work until `VITE_SUPABASE_ANON_JWT` (eyJ…) is added.
 */
export function isPasswordAuthBlockedByKey(): boolean {
    if (isLocalTesting) {
        const primary = String(import.meta.env.VITE_SUPABASE_LOCAL_ANON_KEY ?? '').trim();
        const jwt = String(import.meta.env.VITE_SUPABASE_LOCAL_ANON_JWT ?? '').trim();
        return primary.startsWith('sb_publishable_') && !jwt.startsWith('eyJ');
    }
    const primary = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
    const jwt = String(import.meta.env.VITE_SUPABASE_ANON_JWT ?? '').trim();
    return primary.startsWith('sb_publishable_') && !jwt.startsWith('eyJ');
}

if (import.meta.env.DEV) {
    const host = String(supabaseUrl || '')
        .replace(/^https?:\/\//, '')
        .split('/')[0];
    console.info(
        `[SmartInvest] Supabase: ${isLocalTesting ? 'LOCAL' : 'hosted'} · configured=${isSupabaseConfigured()} · api host=${host || '(missing — check .env)'}`
    );
    if (!isLocalTesting && isPasswordAuthBlockedByKey()) {
        console.warn(
            '[SmartInvest] Password auth disabled: VITE_SUPABASE_ANON_KEY is publishable only. Add VITE_SUPABASE_ANON_JWT=<legacy JWT eyJ… from Project Settings → API> or replace ANON_KEY with that JWT, then restart npm run dev.'
        );
    }
}

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

/**
 * Drop Realtime connections before unload so the browser can close the tab without waiting on WebSockets.
 * Safe to call multiple times.
 */
export function teardownSupabaseForPageUnload(): void {
    try {
        supabase.removeAllChannels();
    } catch {
        /* ignore */
    }
    try {
        void supabase.realtime.disconnect();
    } catch {
        /* ignore */
    }
}
