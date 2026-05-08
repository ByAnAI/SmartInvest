#!/usr/bin/env node
/**
 * Load company_fundamentals.csv into Supabase table company_fundamentals.
 * Uses service role so it can insert regardless of RLS. Run once after creating the table.
 *
 *   CSV_PATH=/path/to/company_fundamentals.csv \
 *   SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
 *   node scripts/load-company-fundamentals.mjs
 *
 * Default CSV_PATH: /home/idris/Desktop/signaling_system/data/company_fundamentals.csv
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSV_PATH = process.env.CSV_PATH || resolve('/home/idris/Desktop/signaling_system/data/company_fundamentals.csv');
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from Dashboard → Settings → API).');
  process.exit(1);
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

const csvText = readFileSync(CSV_PATH, 'utf8');
const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
const header = parseCSVLine(lines[0]);
const rows = lines.slice(1).map((line) => {
  const values = parseCSVLine(line);
  const row = {};
  header.forEach((h, i) => {
    row[h] = values[i] ?? '';
  });
  return row;
});

const now = new Date().toISOString();
const records = rows.map((r) => ({
  ticker: (r.Ticker || '').trim(),
  company: (r.Company || '').trim(),
  sector: (r.Sector || '').trim(),
  location: (r.Location || '').trim(),
  industry: (r.Industry || '').trim(),
  website: (r.Website || '').trim(),
  updated_at: now,
})).
  filter((r) => r.ticker);

const supabase = createClient(url, serviceRoleKey);

async function main() {
  const { data, error } = await supabase.from('company_fundamentals').upsert(records, {
    onConflict: 'ticker',
    ignoreDuplicates: false,
  });
  if (error) {
    console.error('Upsert error:', error.message);
    process.exit(1);
  }
  console.log(`Loaded ${records.length} company fundamentals into company_fundamentals.`);
}

main();
