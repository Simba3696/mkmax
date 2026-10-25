// Reading the saved data at startup, keeping a copy of it when it can't be read, and holding one from a newer version
// (shown, but never saved over). Kept apart from store.tsx (React), so tests can run it against a stubbed localStorage.
import type { AppState } from './types';
import { defaultState } from './defaults';
import { normalize } from './normalize';
import { fromNewerApp, loadSyncConfig, saveSyncConfig } from './sync';

const KEY = 'mkmax:v1';
/** A save that couldn't be read, kept until the user downloads or discards it. */
export const UNREADABLE_KEY = 'mkmax:v1:unreadable';

/**
 * The save is from a newer version of MK Max: this build started on it (a deploy rolled back past a version bump), or
 * another tab running the newer build saved it. This build reads what it can to show it, but leaves the save as it is:
 * saving would drop the fields it doesn't know (the Maxed record from version 17, say) and the next sync could push that
 * reading over the synced one. Set by `load` or `holdIfNewer`, until a reload.
 */
let heldForNewerApp = false;
export const savedByNewerApp = () => heldForNewerApp;

/**
 * For another tab's save (a `storage` event): holds it if it's from a newer version, and says whether it did. Text that
 * isn't JSON throws: every build saves whole JSON, so that's a broken save, not one to read past.
 */
export function holdIfNewer(key: string | null, raw: string | null) {
  if (key !== KEY || !raw) return false;
  if (fromNewerApp(JSON.parse(raw))) heldForNewerApp = true;
  return heldForNewerApp;
}

/** The save exactly as stored, for a backup while it's held: this build's reading of it drops what it doesn't know. */
export const savedText = () => localStorage.getItem(KEY);

export function load(): AppState {
  let raw: string | null = null;
  heldForNewerApp = false;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    heldForNewerApp = fromNewerApp(saved);
    return normalize(saved);
  } catch {
    // A newer save this copy can't read stays where it is too: the newer build reads it once the app updates.
    if (raw && !heldForNewerApp) keepUnreadable(raw);
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
  if (heldForNewerApp) return;
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
