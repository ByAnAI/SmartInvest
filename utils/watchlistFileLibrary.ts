import type { WatchlistSnapshotFileV1 } from './watchlistSnapshotJson';

export const WATCHLIST_FILE_LIBRARY_KEY = 'smartinvest_watchlist_file_library_v1';
export const LOCAL_LIB_PREFIX = 'local-lib:' as const;

export type WatchlistLibraryEntry = {
  id: string;
  displayName: string;
  sourceFileName: string;
  savedAt: string;
  snapshot: WatchlistSnapshotFileV1;
};

function safeParse(raw: string | null): WatchlistLibraryEntry[] {
  if (!raw?.trim()) return [];
  try {
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is WatchlistLibraryEntry => {
      if (!x || typeof x !== 'object') return false;
      const o = x as WatchlistLibraryEntry;
      return (
        typeof o.id === 'string' &&
        typeof o.snapshot === 'object' &&
        o.snapshot != null &&
        (o.snapshot as WatchlistSnapshotFileV1).format === 'smartinvest-watchlist-snapshot-v1'
      );
    });
  } catch {
    return [];
  }
}

export function getWatchlistFileLibrary(): WatchlistLibraryEntry[] {
  try {
    return safeParse(localStorage.getItem(WATCHLIST_FILE_LIBRARY_KEY));
  } catch {
    return [];
  }
}

function persist(entries: WatchlistLibraryEntry[]): void {
  localStorage.setItem(WATCHLIST_FILE_LIBRARY_KEY, JSON.stringify(entries));
}

export function addWatchlistToLibrary(snapshot: WatchlistSnapshotFileV1, sourceFileName: string): string {
  const id = crypto.randomUUID();
  const displayName =
    snapshot.label?.trim() ||
    sourceFileName.replace(/\.[^.]+$/, '') ||
    `Watchlist ${new Date().toLocaleString()}`;
  const entry: WatchlistLibraryEntry = {
    id,
    displayName,
    sourceFileName,
    savedAt: new Date().toISOString(),
    snapshot,
  };
  const cur = getWatchlistFileLibrary();
  cur.unshift(entry);
  persist(cur);
  return id;
}

export function removeWatchlistFromLibrary(id: string): void {
  persist(getWatchlistFileLibrary().filter((e) => e.id !== id));
}

export function getWatchlistLibraryEntry(id: string): WatchlistLibraryEntry | null {
  return getWatchlistFileLibrary().find((e) => e.id === id) ?? null;
}
