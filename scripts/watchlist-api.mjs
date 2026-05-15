#!/usr/bin/env node
/**
 * Start the FastAPI Watchlist API (default port 8000). Requires backend/.venv (see npm run watchlist-api:setup).
 * Port: set WATCHLIST_API_PORT in repo root `.env` or `.env.local` if 8000 is busy (must match Vite proxy).
 * Forwards CSV-related keys from `.env` and `.env.local` into the Python process (Vite does not do that).
 * Usage: npm run watchlist-api
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(__dirname, '..', 'backend');
const venvUnix = path.join(backend, '.venv', 'bin', 'python');
const venvWin = path.join(backend, '.venv', 'Scripts', 'python.exe');

/** Keys read by backend/data_loader.py — pull from root .env so you don't need a separate shell export. */
const BACKEND_ENV_KEYS = new Set([
  'SP500_INSTRUMENT_CSV',
  'CSV_PATH',
  'ALPACA_WATCHLIST_EXPORT_DIR',
  'WATCHLIST_EXPORT_FILENAME',
  'WATCHLIST_EXPORT_DISABLED',
  'SMARTINVEST_WATCHLIST_CSV_DIR',
  'WATCHLIST_SNAPSHOT_CSV_DISABLED',
  'WATCHLIST_API_PORT',
  'WATCHLIST_API_GC_TICKER',
]);

function parseBackendEnvFromDotEnv(dotEnvPath) {
  const out = {};
  if (!existsSync(dotEnvPath)) return out;
  const text = readFileSync(dotEnvPath, 'utf8');
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!BACKEND_ENV_KEYS.has(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function printMissingVenv() {
  console.error(`
Watchlist API: no Python virtualenv at backend/.venv

Option A — Python (from repo root):
  npm run watchlist-api:setup
  npm run watchlist-api

If setup fails on Mac with Xcode errors:  xcode-select --install
Or install Python from https://www.python.org/downloads/ or  brew install python

Option B — Docker (no local Python needed; requires Docker Desktop running):
  npm run watchlist-api:docker

Then test (replace port if you set WATCHLIST_API_PORT):  curl http://127.0.0.1:8000/api/health
`);
}

function run(python) {
  const root = path.join(__dirname, '..');
  const fromFile = {
    ...parseBackendEnvFromDotEnv(path.join(root, '.env')),
    ...parseBackendEnvFromDotEnv(path.join(root, '.env.local')),
  };
  const merged = { ...process.env, ...fromFile };
  const port =
    merged.WATCHLIST_API_PORT?.trim() ||
    process.env.WATCHLIST_API_PORT?.trim() ||
    '8000';
  console.info(`Watchlist API listening on http://127.0.0.1:${port} (proxy from Vite: /watchlist-api)`);
  const proc = spawn(
    python,
    ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', port],
    { cwd: backend, stdio: 'inherit', env: merged }
  );
  proc.on('exit', (code) => process.exit(code ?? 0));
  proc.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

if (existsSync(venvUnix)) {
  run(venvUnix);
} else if (existsSync(venvWin)) {
  run(venvWin);
} else {
  printMissingVenv();
  process.exit(1);
}
