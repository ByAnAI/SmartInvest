#!/usr/bin/env node
/**
 * Kill whatever is listening on WATCHLIST_API_PORT (default 8000) so `npm run dev:all` can bind.
 * Linux/macOS: uses `lsof`. Safe no-op if nothing listens or lsof missing.
 */
import { execSync } from 'node:child_process';

const port = String(process.env.WATCHLIST_API_PORT || '8000').trim() || '8000';

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
