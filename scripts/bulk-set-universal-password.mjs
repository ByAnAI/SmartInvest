#!/usr/bin/env node
/**
 * Sets every Supabase Auth user’s password to one shared value (Auth “any password” mode).
 * Pair with `.env`: VITE_ALLOW_ANY_PASSWORD=true and VITE_AUTH_UNIVERSAL_PASSWORD=same_value
 *
 * Requires in `.env.local`:
 *   SUPABASE_SERVICE_ROLE_KEY=...
 * And URL from VITE_SUPABASE_URL or SUPABASE_URL.
 *
 * Usage:
 *   UNIVERSAL_PASSWORD=YourSecret npm run auth:bulk-set-universal-password
 * Or set UNIVERSAL_PASSWORD / VITE_AUTH_UNIVERSAL_PASSWORD in `.env.local`.
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
    /* missing */
  }
}

parseEnvFile(path.join(root, '.env'));
parseEnvFile(path.join(root, '.env.local'));

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const universal =
  process.env.UNIVERSAL_PASSWORD?.trim() ||
  process.env.VITE_AUTH_UNIVERSAL_PASSWORD?.trim() ||
  '';

if (!supabaseUrl || !serviceRole || !universal) {
  console.error(
    'Need SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, and UNIVERSAL_PASSWORD or VITE_AUTH_UNIVERSAL_PASSWORD.'
  );
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.error(`Setting all user passwords to length=${universal.length} (value hidden)`);
  let page = 1;
  const perPage = 1000;
  let ok = 0;
  let fail = 0;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('listUsers:', error.message);
      process.exit(1);
    }
    const users = data?.users ?? [];
    for (const u of users) {
      const id = u.id;
      const email = u.email || id;
      const { error: upErr } = await admin.auth.admin.updateUserById(id, { password: universal });
      if (upErr) {
        console.error(`FAIL ${email}: ${upErr.message}`);
        fail++;
      } else {
        console.error(`OK   ${email}`);
        ok++;
      }
    }
    if (users.length < perPage) break;
    page += 1;
  }

  console.error(`\nDone. Updated ${ok}, failed ${fail}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
