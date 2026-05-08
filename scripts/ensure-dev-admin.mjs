#!/usr/bin/env node
/**
 * Runs before `vite` so `npm run dev` alone can sync Supabase Auth + profiles for the master admin.
 * Loads `.env` / `.env.local` (same as other scripts). Safe to skip if service role is unset.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

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

const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
if (!serviceRole) {
  console.info(
    '[SmartInvest] dev: add SUPABASE_SERVICE_ROLE_KEY to .env (service_role JWT from Dashboard → API) to auto-sync master admin on startup.'
  );
  process.exit(0);
}

const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
if (!url) {
  console.warn('[SmartInvest] dev: SUPABASE_URL / VITE_SUPABASE_URL missing; skipping admin sync.');
  process.exit(0);
}

const adminEmail = String(process.env.VITE_MASTER_ADMIN_EMAIL || 'idris.elfeghi@byanai.com')
  .trim()
  .toLowerCase();
const adminPassword = String(process.env.VITE_AUTH_UNIVERSAL_PASSWORD ?? '').trim();
if (!adminPassword) {
  console.warn('[SmartInvest] dev: VITE_AUTH_UNIVERSAL_PASSWORD empty; skipping admin sync.');
  process.exit(0);
}

const env = {
  ...process.env,
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  ADMIN_EMAIL: adminEmail,
  ADMIN_PASSWORD: adminPassword,
};

const r = spawnSync(process.execPath, ['scripts/set-admin-user.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env,
});

if (r.status !== 0) {
  console.warn('[SmartInvest] dev: admin sync failed (invalid service role or network). Starting Vite anyway.');
}
process.exit(0);
