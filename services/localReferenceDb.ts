/**
 * IndexedDB mirror for bulky reference datasets (company CSVs, market ingestion).
 * DB name/version bump if store shapes change.
 */
import type { CompanyFundamental, MarketAsset } from '../types';

const DB_NAME = 'smartinvest-local-v1';
const DB_VERSION = 1;
const STORE_CF = 'company_fundamentals';
const STORE_MARKET = 'market_data';

type MarketRow = MarketAsset & { updated_at?: string };

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_CF)) {
                db.createObjectStore(STORE_CF, { keyPath: 'ticker' });
            }
            if (!db.objectStoreNames.contains(STORE_MARKET)) {
                db.createObjectStore(STORE_MARKET, { keyPath: 'symbol' });
            }
        };
    });
}

function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
    });
}

function cfRowFromRaw(r: Record<string, unknown>): CompanyFundamental {
    return {
        ticker: String(r.ticker ?? '').toUpperCase(),
        company: String(r.company ?? ''),
        sector: String(r.sector ?? ''),
        location: String(r.location ?? ''),
        industry: String(r.industry ?? ''),
        website: String(r.website ?? ''),
        updated_at: r.updated_at as string | undefined,
    };
}

export async function localCfGetAll(): Promise<CompanyFundamental[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CF, 'readonly');
        const req = tx.objectStore(STORE_CF).getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const rows = (req.result as Record<string, unknown>[]).map(cfRowFromRaw);
            rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
            resolve(rows);
        };
    });
}

export async function localCfGetMany(tickers: string[]): Promise<CompanyFundamental[]> {
    const normalized = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
    if (normalized.length === 0) return [];
    const db = await openDb();
    const out: CompanyFundamental[] = [];
    await Promise.all(
        normalized.map(
            (ticker) =>
                new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(STORE_CF, 'readonly');
                    const req = tx.objectStore(STORE_CF).get(ticker);
                    req.onerror = () => reject(req.error);
                    req.onsuccess = () => {
                        const v = req.result as Record<string, unknown> | undefined;
                        if (v) out.push(cfRowFromRaw(v));
                        resolve();
                    };
                })
        )
    );
    return out;
}

export async function localCfUpsertMany(rows: CompanyFundamental[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(STORE_CF, 'readwrite');
    const store = tx.objectStore(STORE_CF);
    for (const r of rows) {
        const ticker = String(r.ticker).trim().toUpperCase();
        if (!ticker) continue;
        store.put({
            ticker,
            company: (r.company ?? '').trim(),
            sector: (r.sector ?? '').trim(),
            location: (r.location ?? '').trim(),
            industry: (r.industry ?? '').trim(),
            website: (r.website ?? '').trim(),
            updated_at: new Date().toISOString(),
        });
    }
    await txDone(tx);
}

export async function localCfUpdate(ticker: string, updates: Partial<Omit<CompanyFundamental, 'ticker'>>): Promise<void> {
    const t = ticker.trim().toUpperCase();
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CF, 'readwrite');
        const store = tx.objectStore(STORE_CF);
        const g = store.get(t);
        g.onerror = () => reject(g.error);
        g.onsuccess = () => {
            const cur = (g.result as Record<string, unknown>) ?? {
                ticker: t,
                company: '',
                sector: '',
                location: '',
                industry: '',
                website: '',
            };
            if (updates.company !== undefined) cur.company = updates.company.trim();
            if (updates.sector !== undefined) cur.sector = updates.sector.trim();
            if (updates.location !== undefined) cur.location = updates.location.trim();
            if (updates.industry !== undefined) cur.industry = updates.industry.trim();
            if (updates.website !== undefined) cur.website = updates.website.trim();
            cur.updated_at = new Date().toISOString();
            store.put(cur);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('localCfUpdate tx failed'));
    });
}

export async function localCfDelete(ticker: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE_CF, 'readwrite');
    tx.objectStore(STORE_CF).delete(ticker.trim().toUpperCase());
    await txDone(tx);
}

export async function localMarketUpsertRows(rows: MarketRow[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(STORE_MARKET, 'readwrite');
    const store = tx.objectStore(STORE_MARKET);
    for (const r of rows) {
        const symbol = String(r.symbol).trim().toUpperCase();
        if (!symbol) continue;
        store.put({
            symbol,
            name: String(r.name ?? ''),
            market: String(r.market ?? '').toLowerCase(),
            updated_at: r.updated_at ?? new Date().toISOString(),
        });
    }
    await txDone(tx);
}

export async function localMarketGetAll(): Promise<MarketAsset[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MARKET, 'readonly');
        const req = tx.objectStore(STORE_MARKET).getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const raw = req.result as MarketRow[];
            resolve(
                raw.map((r) => ({
                    symbol: String(r.symbol),
                    name: String(r.name ?? ''),
                    market: String(r.market ?? ''),
                }))
            );
        };
    });
}
