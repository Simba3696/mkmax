// Reading the saved data at startup, and keeping a copy of it when it can't be read. Kept apart from store.tsx,
// which imports the service worker, so tests can run it against a stubbed localStorage.
import type { AppState } from './types';
import { defaultState } from './defaults';
import { normalize } from './normalize';
import { loadSyncConfig, saveSyncConfig } from './sync';

const KEY = 'mkmax:v1';
/** A save that couldn't be read, kept until the user downloads or discards it. */
export const UNREADABLE_KEY = 'mkmax:v1:unreadable';

export function load(): AppState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    if (raw) keepUnreadable(raw);
  }
  return defaultState();
}

/**
 * The fresh data is saved over the unreadable save as soon as the app starts, so keep a copy first. With sync on,
 * forget what was last agreed: the fresh data has no stamp, so it would count as agreed with the gist, and its first
 * edit would upload it over everything. With nothing agreed, the first sync downloads the gist's copy instead.
 */
function keepUnreadable(raw: string) {
  try {
    localStorage.setItem(UNREADABLE_KEY, raw);
  } catch {
    /* storage full or blocked; nothing more to do */
  }
  const cfg = loadSyncConfig();
  if (cfg) saveSyncConfig({ ...cfg, baseUpdatedAt: 0 });
}

export function save(state: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked; state still lives in memory */
  }
}

export function loadUnreadable() {
  try {
    return localStorage.getItem(UNREADABLE_KEY);
  } catch {
    return null;
  }
}

export function discardUnreadable() {
  try {
    localStorage.removeItem(UNREADABLE_KEY);
  } catch {
    /* storage blocked, so the copy was never kept */
  }
}
