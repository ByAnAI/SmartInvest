#!/usr/bin/env node
/**
 * Check if an email exists in Supabase Auth and whether a password works (requires service role).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-auth-user.mjs idris.elfeghi@byanai.com
 *
 * Optional: test password (same as test:login)
 *   … node scripts/check-auth-user.mjs idris.elfeghi@byanai.com OneSecretYouChoose
 *
 * Loads .env and .env.local for SUPABASE_* if not set in the environment.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (let line of raw.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* skip */
  }
}

parseEnvFile(path.join(root, '.env'));
parseEnvFile(path.join(root, '.env.local'));

const emailArg = (process.argv[2] || '').trim().toLowerCase();
const passwordTry = process.argv[3] || '';

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!emailArg) {
  console.error('Usage: node scripts/check-auth-user.mjs <email> [password-to-test]');
  console.error('Requires SUPABASE_SERVICE_ROLE_KEY (Dashboard → API → secret / service_role legacy JWT).');
  process.exit(1);
}

if (!url || !serviceRole) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Put the service role key in .env.local (never commit).');
  process.exit(1);
}

const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) {
  console.error('listUsers failed:', listErr.message);
  process.exit(1);
}

const users = listed?.users || [];
const match = users.find((u) => (u.email || '').trim().toLowerCase() === emailArg);

if (!match) {
  console.error('');
  console.error(`NOT FOUND: no Auth user with email "${emailArg}".`);
  console.error('Create one: Dashboard → Authentication → Users → Add user → Email,');
  console.error('or run: ADMIN_EMAIL=' +
    emailArg +
    ' ADMIN_PASSWORD=YourPassword SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/set-admin-user.mjs');
  console.error('');
  process.exit(3);
}

console.error(`FOUND: uid=${match.id}`);
console.error(`      email=${match.email}`);
console.error(`      email_confirmed_at=${match.email_confirmed_at ?? '(null — confirm email or disable confirm in Email provider)'}`);
console.error(`      last_sign_in_at=${match.last_sign_in_at ?? '(never)'}`);

if (!passwordTry) {
  console.error('');
  console.error('Password not tested. Pass a second argument to try signInWithPassword with the anon key from .env.');
  process.exit(0);
}

const primary = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const jwtOverride = (process.env.VITE_SUPABASE_ANON_JWT || '').trim();
let anon = primary;
if (primary.startsWith('sb_publishable_') && jwtOverride.startsWith('eyJ')) {
  anon = jwtOverride;
}

if (!anon.startsWith('eyJ')) {
  console.error('Cannot test password: set VITE_SUPABASE_ANON_JWT (eyJ…) or use legacy anon JWT in .env.');
  process.exit(1);
}

const anonClient = createClient(url, anon, { auth: { persistSession: false } });
const { error: signErr } = await anonClient.auth.signInWithPassword({
  email: emailArg,
  password: passwordTry,
});

if (signErr) {
  console.error('');
  console.error('PASSWORD TEST: FAILED —', signErr.message);
  console.error('The user exists, but this password does not match what is stored in Supabase.');
  console.error('Fix: Dashboard → Users → … → Reset password, or set-admin-user.mjs with ADMIN_PASSWORD.');
  console.error('');
  process.exit(4);
}

console.error('');
console.error('PASSWORD TEST: OK — this password works for signInWithPassword.');
process.exit(0);
