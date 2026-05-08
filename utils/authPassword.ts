import { MASTER_ADMIN_EMAIL } from '../config/masterAdmin';

/** Accepts true / 1 / yes (case-insensitive) from `.env` string values. */
export function envTruthy(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * Supabase always checks a password hash server-side.
 *
 * - **Admin only** (`VITE_ADMIN_ANY_PASSWORD=true`): for `MASTER_ADMIN_EMAIL` only, we send
 *   `VITE_AUTH_UNIVERSAL_PASSWORD` instead of what was typed. That user’s password in Supabase must match
 *   that value (set once in Dashboard → Authentication → Users, or `scripts/set-admin-user.mjs`).
 *
 * - **Everyone** (`VITE_ALLOW_ANY_PASSWORD=true`): same substitution for every login + run
 *   `npm run auth:bulk-set-universal-password` so all accounts share the secret.
 */
export function getAuthPassword(typed: string, emailNormalized: string): string {
  const universal = String(import.meta.env.VITE_AUTH_UNIVERSAL_PASSWORD ?? '').trim();
  if (!universal) return typed;

  const adminOnly = envTruthy(import.meta.env.VITE_ADMIN_ANY_PASSWORD);
  const allUsers = envTruthy(import.meta.env.VITE_ALLOW_ANY_PASSWORD);

  if (adminOnly && emailNormalized === MASTER_ADMIN_EMAIL) {
    return universal;
  }
  if (allUsers) {
    return universal;
  }
  return typed;
}
