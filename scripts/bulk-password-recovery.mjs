#!/usr/bin/env node
/**
 * Bulk “reset passwords” via Supabase Auth Admin (service role).
 *
 * You cannot safely NULL passwords in SQL — Supabase stores bcrypt hashes in auth.users.
 * This script lists every auth user and generates a password-recovery link per email so each
 * person can choose a new password (same flow as “Forgot password”).
 *
 * Usage (from repo root):
 *   1. Supabase Dashboard → Settings → API → copy Project URL + service_role key (secret).
 *   2. Put them in `.env.local` (never commit):
 *        SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *      URL is read from VITE_SUPABASE_URL or SUPABASE_URL in `.env` / `.env.local`.
 *   3. Add your app URL to Authentication → URL Configuration → Redirect URLs, e.g.
 *        http://localhost:3000/**
 *        http://localhost:3001/**
 *   4. Run:
 *        node scripts/bulk-password-recovery.mjs
 *      Or:
 *        npm run auth:bulk-recovery-links
 *
 * Output: CSV lines `email,recovery_link` to stdout — treat as secret; send each user their row.
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
    /* missing file */
  }
}

parseEnvFile(path.join(root, '.env'));
parseEnvFile(path.join(root, '.env.local'));

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
/** Must match Supabase → Authentication → URL Configuration → Redirect URLs. */
const recoveryRedirect =
  process.env.AUTH_RECOVERY_REDIRECT_URL?.trim() ||
  `${(process.env.VITE_APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/?mode=reset-password`;

if (!supabaseUrl || !serviceRole) {
  console.error(
    'Missing SUPABASE_URL (or VITE_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Add them to .env.local at the project root, then run again.'
  );
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.error(`Using API: ${supabaseUrl.replace(/^(https:\/\/[^.]+).*/, '$1…')}`);
  console.error(`Recovery redirect: ${recoveryRedirect}\n`);

  const rows = [];
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('listUsers failed:', error.message);
      process.exit(1);
    }
    const users = data?.users ?? [];
    for (const u of users) {
      const email = (u.email || '').trim();
      if (!email) continue;
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: recoveryRedirect },
      });
      if (linkErr) {
        console.error(`SKIP ${email}: ${linkErr.message}`);
        continue;
      }
      const link = linkData?.properties?.action_link;
      if (!link || typeof link !== 'string') {
        console.error(`SKIP ${email}: no action_link in response`, JSON.stringify(linkData?.properties || {}));
        continue;
      }
      rows.push({ email, link });
    }
    if (users.length < perPage) break;
    page += 1;
  }

  console.log('email,recovery_link');
  for (const { email, link } of rows) {
    const safeEmail = /[",\n]/.test(email) ? `"${email.replace(/"/g, '""')}"` : email;
    const safeLink = /[",\n]/.test(link) ? `"${link.replace(/"/g, '""')}"` : link;
    console.log(`${safeEmail},${safeLink}`);
  }
  console.error(`\nDone: ${rows.length} recovery link(s). Send each user their link securely.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
