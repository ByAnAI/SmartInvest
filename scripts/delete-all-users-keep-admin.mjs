#!/usr/bin/env node
/**
 * Delete all Supabase Auth users EXCEPT idris.elfeghi@byanai.com.
 * Uses the service_role key (Admin API). Run once from project root:
 *
 *   SUPABASE_URL=https://YOUR_PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=your_service_role_key node scripts/delete-all-users-keep-admin.mjs
 *
 * Get the service_role key from: Supabase Dashboard → Project Settings → API → service_role (secret).
 * Never commit the service_role key or expose it in the frontend.
 */

import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'idris.elfeghi@byanai.com';
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from Dashboard → Settings → API).');
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

async function main() {
  const toKeep = normalizeEmail(ADMIN_EMAIL);
  let page = 1;
  const perPage = 1000;
  let totalDeleted = 0;
  let kept = 0;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('listUsers error:', error.message);
      process.exit(1);
    }
    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (email === toKeep) {
        kept++;
        console.log('Keeping admin:', user.email);
        continue;
      }
      const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
      if (delErr) {
        console.error('Failed to delete', user.email, user.id, delErr.message);
        continue;
      }
      totalDeleted++;
      console.log('Deleted:', user.email || user.id);
    }

    if (users.length < perPage) break;
    page++;
  }

  console.log('\nDone. Kept 1 admin, deleted', totalDeleted, 'user(s).');
}

main();
