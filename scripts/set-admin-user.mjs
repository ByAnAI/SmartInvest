#!/usr/bin/env node
/**
 * Create or update the master admin auth user in Supabase.
 *
 * Loads `.env` and `.env.local` (same as other scripts). Use values from your project:
 *   SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_MASTER_ADMIN_EMAIL, VITE_AUTH_UNIVERSAL_PASSWORD
 *
 *   npm run auth:sync-admin
 *
 * Or pass env once:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/set-admin-user.mjs
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

const ADMIN_EMAIL = String(
  process.env.ADMIN_EMAIL || process.env.VITE_MASTER_ADMIN_EMAIL || 'idris.elfeghi@byanai.com'
)
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.VITE_AUTH_UNIVERSAL_PASSWORD || '')
  .trim();

const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

if (!url || !serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY (and URL).');
  console.error('In Supabase → Project Settings → API, copy the secret service_role JWT.');
  console.error('Add to .env: SUPABASE_SERVICE_ROLE_KEY=eyJ...   then run: npm run auth:sync-admin');
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.error('Set VITE_AUTH_UNIVERSAL_PASSWORD (or ADMIN_PASSWORD) in .env to the password you want for this user.');
  process.exit(1);
}

const passwordToUse = ADMIN_PASSWORD;

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    console.error('listUsers failed:', listError.message);
    process.exit(1);
  }

  const existing = (listed?.users || []).find((u) => (u.email || '').trim().toLowerCase() === ADMIN_EMAIL);

  if (existing) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      email: ADMIN_EMAIL,
      password: passwordToUse,
      email_confirm: true,
      user_metadata: { full_name: 'admin' },
    });
    if (updateError) {
      console.error('Failed to update existing admin user:', updateError.message);
      process.exit(1);
    }
    console.log(`Updated admin user: ${ADMIN_EMAIL}`);
  } else {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: passwordToUse,
      email_confirm: true,
      user_metadata: { full_name: 'admin' },
    });
    if (createError) {
      console.error('Failed to create admin user:', createError.message);
      process.exit(1);
    }
    console.log(`Created admin user: ${created?.user?.email || ADMIN_EMAIL}`);
  }

  // Ensure profile role/status are correct if profile row exists.
  const { data: listedAfter } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const adminUser = (listedAfter?.users || []).find((u) => (u.email || '').trim().toLowerCase() === ADMIN_EMAIL);
  if (adminUser?.id) {
    // Omit updated_at: some projects have older `profiles` without that column (see supabase-profiles-table.sql for full shape).
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert(
        {
          uid: adminUser.id,
          email: ADMIN_EMAIL,
          display_name: 'admin',
          status: 'active',
          role: 'admin',
          is_verified: true,
        },
        { onConflict: 'uid' },
      );
    if (profileErr) {
      console.warn('Warning: profile upsert failed:', profileErr.message);
    } else {
      console.log('Ensured profiles row is admin/active.');
    }
  }

  console.log('Done.');
}

main();
