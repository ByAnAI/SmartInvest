#!/usr/bin/env node
/**
 * Sanity-check password login against Supabase using the SAME keys as Vite (.env).
 * Usage:
 *   npm run test:login -- email password
 * If you omit the password, uses VITE_AUTH_UNIVERSAL_PASSWORD from .env (avoids shell issues with ! and #).
 *
 * If this prints invalid credentials but the JWT anon key works in Dashboard SQL, switch
 * VITE_SUPABASE_ANON_KEY from sb_publishable_… to the legacy anon JWT (eyJ…).
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

const email = (process.argv[2] || '').trim().toLowerCase();
const password = (
  process.argv[3] ||
  String(process.env.VITE_AUTH_UNIVERSAL_PASSWORD ?? '').trim()
);

const url = (process.env.VITE_SUPABASE_URL || '').trim();
const primary = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const jwtOverride = (process.env.VITE_SUPABASE_ANON_JWT || '').trim();

if (primary.startsWith('sb_publishable_') && !jwtOverride.startsWith('eyJ')) {
  console.error('');
  console.error('BLOCKED: VITE_SUPABASE_ANON_KEY is publishable (sb_publishable_…). Password login does not work with that key.');
  console.error('Fix one of these, then re-run:');
  console.error('  1) In Supabase → Project Settings → API, copy the legacy anon public JWT (long string starting with eyJ).');
  console.error('     It may appear under "Project API keys" / "anon" / "public" — not the sb_publishable_ key.');
  console.error('  2) In .env set: VITE_SUPABASE_ANON_JWT=eyJ...   (same line, no spaces around =)');
  console.error('     OR replace VITE_SUPABASE_ANON_KEY entirely with that JWT and remove the publishable line.');
  console.error('');
  process.exit(2);
}

let key = primary;
if (primary.startsWith('sb_publishable_') && jwtOverride.startsWith('eyJ')) {
  key = jwtOverride;
  console.error('Using VITE_SUPABASE_ANON_JWT for client key (publishable key cannot do password auth).');
}

if (!email || !password) {
  console.error('Usage: npm run test:login -- <email> [password]');
  console.error('Omit password to use VITE_AUTH_UNIVERSAL_PASSWORD from .env.');
  process.exit(1);
}

if (!process.argv[3]) {
  console.error('(password from VITE_AUTH_UNIVERSAL_PASSWORD in .env)');
}

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or anon key (VITE_SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_JWT) in .env');
  process.exit(1);
}

console.error('Using URL:', url);
console.error('Key prefix:', key.slice(0, 12) + '…');

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.auth.signInWithPassword({ email, password });

if (error) {
  console.error('FAILED:', error.message);
  console.error('code:', error.code, 'status:', error.status);
  if (String(error.code || '').toLowerCase() === 'invalid_credentials') {
    const sr = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    console.error('');
    if (!sr) {
      console.error('The password stored in Supabase for this user is not the same as VITE_AUTH_UNIVERSAL_PASSWORD.');
      console.error('SUPABASE_SERVICE_ROLE_KEY is empty in .env — the CLI cannot push your .env password yet.');
      console.error('Do one of:');
      console.error('  A) Dashboard → Authentication → Users → idris.elfeghi@byanai.com → set password to exactly match .env');
      console.error('  B) Project Settings → API → copy service_role JWT → add SUPABASE_SERVICE_ROLE_KEY=… to .env → npm run auth:sync-admin');
    } else {
      console.error('Password mismatch or wrong user. Try: npm run auth:sync-admin');
    }
    console.error('');
  }
  process.exit(1);
}

console.error('OK — session user:', data.session?.user?.email || '(none)');
process.exit(0);
