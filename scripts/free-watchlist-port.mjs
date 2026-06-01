#!/usr/bin/env node
/**
 * Kill whatever is listening on WATCHLIST_API_PORT (default 8000) so `npm run dev:all` can bind.
 * Linux/macOS: uses `lsof`. Safe no-op if nothing listens or lsof missing.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function parsePortFromEnvFile(dotEnvPath) {
  if (!existsSync(dotEnvPath)) return null;
  const text = readFileSync(dotEnvPath, 'utf8');
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('WATCHLIST_API_PORT=')) continue;
    const val = line.slice('WATCHLIST_API_PORT='.length).trim();
    const m = val.match(/^(\d{2,5})/);
    if (m) return m[1];
  }
  return null;
}

const fromFile =
  parsePortFromEnvFile(path.join(root, '.env.local')) ||
  parsePortFromEnvFile(path.join(root, '.env'));
const port = String(process.env.WATCHLIST_API_PORT || fromFile || '8000').trim() || '8000';

function killListeners() {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
        console.info(`[SmartInvest] freed port ${port}: sent SIGTERM to PID ${pid}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no listeners or lsof failed */
  }
}

killListeners();
