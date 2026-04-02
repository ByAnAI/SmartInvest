#!/usr/bin/env node
/**
 * Create or update the master admin auth user in Supabase.
 *
 * Usage:
 *   SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
 *   node scripts/set-admin-user.mjs
 */

import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'admin@bts.com';
const ADMIN_PASSWORD = '123abc';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}

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
      password: ADMIN_PASSWORD,
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
      password: ADMIN_PASSWORD,
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
          updated_at: new Date().toISOString(),
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
