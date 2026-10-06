import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { defaultState } from './defaults';
import { normalize } from './normalize';
import { pruneDone } from './engine';
import { OUTDATED_MESSAGE, decideSync, findOrCreateGist, loadSyncConfig, readRemote, sameData, saveSyncConfig, stamp, writeRemote, type SyncConfig } from './sync';

export { normalize };

const KEY = 'mkmax:v1';

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* fall through to defaults */
  }
  return defaultState();
}

/**
 * Pass an undo label to offer "Undo <label>" for this change. `auto` marks a change the app makes by itself that
 * every device works out the same way (catalog art, or the season end on a fresh install): it's saved but doesn't count as an edit for sync, so it can't
 * make two devices disagree.
 */
type Update = (recipe: (draft: AppState) => void, undoLabel?: string, opts?: { auto?: boolean }) => void;

/** The most recent undoable change: the state from just before it. */
export interface UndoEntry {
  label: string;
  prev: AppState;
  at: number;
}

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'idle'; at: number | null }
  | { kind: 'syncing' }
  | { kind: 'error'; message: string }
  /** Both devices changed data since the last sync; the user picks which copy wins. */
  | { kind: 'conflict'; remote: AppState };

export interface SyncApi {
  status: SyncStatus;
  connected: boolean;
  connect: (token: string) => Promise<void>;
  disconnect: () => void;
  syncNow: () => Promise<void>;
  resolve: (keep: 'mine' | 'theirs') => Promise<void>;
  /** False until this launch's first sync attempt has finished (true when sync is off), so automatic changes can wait for fresh data. */
  settled: boolean;
}

interface StoreApi {
  state: AppState;
  update: Update;
  replace: (s: AppState) => void;
  sync: SyncApi;
  lastUndo: UndoEntry | null;
  undo: () => void;
  dismissUndo: () => void;
}

const Ctx = createContext<StoreApi | null>(null);

const PUSH_DELAY_MS = 1500;
const PULL_EVERY_MS = 2 * 60 * 1000;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const stateRef = useRef(state);
  stateRef.current = state;

  const cfgRef = useRef<SyncConfig | null>(loadSyncConfig());
  const [connected, setConnected] = useState(!!cfgRef.current);
  const [status, setStatus] = useState<SyncStatus>(cfgRef.current ? { kind: 'idle', at: null } : { kind: 'off' });
  const busy = useRef(false);
  /** A conflict waiting for the user. Background syncs hold off so the prompt stays put and GitHub isn't polled. */
  const conflictPending = useRef(false);
  const [settled, setSettled] = useState(!cfgRef.current);
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [lastUndo, setLastUndo] = useState<UndoEntry | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked; state still lives in memory */
    }
  }, [state]);

  const setConfig = (cfg: SyncConfig | null) => {
    cfgRef.current = cfg;
    saveSyncConfig(cfg);
    setConnected(!!cfg);
  };

  const applyRemote = (remote: AppState) => {
    const s = normalize(remote);
    stateRef.current = s;
    setState(s);
    // The snapshot predates the other device's changes; restoring it would silently drop them.
    setLastUndo(null);
  };

  /**
   * Stamps this device's copy after both the gist's and the last agreed one before it overwrites the gist, so the
   * other device sees it as newer than anything it has and pulls it (or asks, if it has changed since) instead of
   * carrying on with its own copy.
   */
  function restampToKeep(cfg: SyncConfig, remote: AppState | null) {
    const kept = { ...stateRef.current, updatedAt: Math.max(Date.now(), stamp(remote) + 1, cfg.baseUpdatedAt + 1) };
    stateRef.current = kept;
    setState(kept);
    return kept;
  }

  /** Still connected to the gist a sync started with (not disconnected or switched while GitHub answered). */
  function sameGist(cfg: SyncConfig) {
    return cfgRef.current?.gistId === cfg.gistId && cfgRef.current.token === cfg.token;
  }

  /** Pull if the gist moved on, push if only this device did, or report a conflict if both did. */
  async function syncNow() {
    const cfg = cfgRef.current;
    if (!cfg || busy.current || conflictPending.current) return;
    busy.current = true;
    let ok = false;
    setStatus({ kind: 'syncing' });
    try {
      const remote = await readRemote(cfg);
      // Disconnected (or switched gist) while GitHub answered: this sync's result no longer applies.
      if (!sameGist(cfg)) return;
      const local = stateRef.current;
      const action = decideSync(remote, local, cfg.baseUpdatedAt);
      if (action === 'conflict') {
        conflictPending.current = true;
        setStatus({ kind: 'conflict', remote: remote! });
        return;
      }
      if (action === 'outdated') {
        const kept = restampToKeep(cfg, remote);
        await writeRemote(cfg, kept);
        if (!sameGist(cfg)) return;
        setConfig({ ...cfg, baseUpdatedAt: stamp(kept) });
        setStatus({ kind: 'error', message: OUTDATED_MESSAGE });
        return;
      }
      if (action === 'pull') {
        applyRemote(remote!);
        setConfig({ ...cfg, baseUpdatedAt: stamp(remote) });
      } else if (action === 'push') {
        await writeRemote(cfg, local);
        if (!sameGist(cfg)) return;
        setConfig({ ...cfg, baseUpdatedAt: stamp(local) });
      } else {
        // Same data on both sides (maybe with different stamps), so both stamps count as agreed.
        setConfig({ ...cfg, baseUpdatedAt: Math.max(cfg.baseUpdatedAt, stamp(local), stamp(remote)) });
      }
      setStatus({ kind: 'idle', at: Date.now() });
      ok = true;
    } catch (e) {
      if (sameGist(cfg)) setStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      busy.current = false;
      // Offline or refused, automatic changes still go ahead rather than wait for the whole session.
      setSettled(true);
      // Edits made while this sync was in flight still need pushing. After a conflict or an error, the next pull
      // (every 2 minutes, on reconnect or on return to the app) picks them up instead of retrying in a tight loop.
      const cfgNow = cfgRef.current;
      if (ok && cfgNow && stamp(stateRef.current) > cfgNow.baseUpdatedAt) schedulePush();
    }
  }
  const syncRef = useRef(syncNow);
  syncRef.current = syncNow;

  function schedulePush() {
    if (!cfgRef.current) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => syncRef.current(), PUSH_DELAY_MS);
  }

  // Pull when the app opens, comes back to the foreground, reconnects, and every couple of minutes.
  useEffect(() => {
    const pull = () => document.visibilityState === 'visible' && syncRef.current();
    pull();
    document.addEventListener('visibilitychange', pull);
    window.addEventListener('online', pull);
    const t = setInterval(pull, PULL_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', pull);
      window.removeEventListener('online', pull);
      clearInterval(t);
    };
  }, []);

  const update: Update = (recipe, undoLabel, opts) => {
    // Built from the ref rather than a setState updater so the undo label can include what got pruned.
    const prev = stateRef.current;
    const draft = structuredClone(prev);
    recipe(draft);
    const removed = pruneDone(draft);
    if (!opts?.auto) draft.updatedAt = Date.now();
    stateRef.current = draft;
    setState(draft);
    const label = [undoLabel, removed.length > 0 && `${removed.join(', ')} ${removed.length > 1 ? 'are' : 'is'} maxed and removed`].filter(Boolean).join(' · ');
    if (label) setLastUndo({ label, prev, at: Date.now() });
    if (!opts?.auto) schedulePush();
  };

  const replace = (s: AppState) => {
    const next = { ...structuredClone(s), updatedAt: Date.now() };
    pruneDone(next);
    stateRef.current = next;
    setState(next);
    setLastUndo(null);
    schedulePush();
  };

  const undo = () => {
    if (!lastUndo) return;
    // A fresh timestamp so sync treats the restored copy as this device's newest change.
    setState({ ...lastUndo.prev, updatedAt: Date.now() });
    setLastUndo(null);
    schedulePush();
  };

  const sync: SyncApi = {
    status,
    connected,
    async connect(token) {
      setStatus({ kind: 'syncing' });
      try {
        // The copy a new gist is made from; edits made while GitHub answers come after it and still need pushing.
        const snap = stateRef.current;
        const { gistId, created } = await findOrCreateGist(token.trim(), snap);
        // A new gist already holds this device's data; an existing one gets compared on the first sync.
        setConfig({ token: token.trim(), gistId, baseUpdatedAt: created ? stamp(snap) : 0 });
        setStatus({ kind: 'idle', at: created ? Date.now() : null });
        if (!created) await syncRef.current();
        else if (stamp(stateRef.current) > stamp(snap)) schedulePush();
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message });
        throw e;
      }
    },
    disconnect() {
      clearTimeout(pushTimer.current);
      conflictPending.current = false;
      setConfig(null);
      setStatus({ kind: 'off' });
      setSettled(true);
    },
    syncNow: () => syncRef.current(),
    async resolve(keep) {
      const cfg = cfgRef.current;
      if (!cfg || status.kind !== 'conflict' || busy.current) return;
      clearTimeout(pushTimer.current);
      conflictPending.current = false;
      if (keep === 'theirs') {
        applyRemote(status.remote);
        setConfig({ ...cfg, baseUpdatedAt: stamp(status.remote) });
        setStatus({ kind: 'idle', at: Date.now() });
        return;
      }
      busy.current = true;
      setStatus({ kind: 'syncing' });
      let ok = false;
      try {
        // Background syncs hold off while the prompt is up, so the other device may have pushed again since. Show
        // that copy instead of overwriting it unseen.
        const fresh = await readRemote(cfg);
        if (!sameGist(cfg)) return;
        if (fresh && stamp(fresh) !== stamp(status.remote) && !sameData(fresh, status.remote)) {
          conflictPending.current = true;
          setStatus({ kind: 'conflict', remote: fresh });
          return;
        }
        const kept = restampToKeep(cfg, fresh);
        await writeRemote(cfg, kept);
        if (!sameGist(cfg)) return;
        setConfig({ ...cfg, baseUpdatedAt: stamp(kept) });
        setStatus({ kind: 'idle', at: Date.now() });
        ok = true;
      } catch (e) {
        if (sameGist(cfg)) setStatus({ kind: 'error', message: (e as Error).message });
      } finally {
        busy.current = false;
        // Edits made while the kept copy was uploading still need pushing.
        const cfgNow = cfgRef.current;
        if (ok && cfgNow && stamp(stateRef.current) > cfgNow.baseUpdatedAt) schedulePush();
      }
    },
    settled,
  };

  return <Ctx.Provider value={{ state, update, replace, sync, lastUndo, undo, dismissUndo: () => setLastUndo(null) }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

export const newId = () => crypto.randomUUID().slice(0, 8);

/** Starter data transcribed from the OneNote "MK Mobile" page, served from public/. */
export async function fetchStarterData(): Promise<AppState> {
  const res = await fetch(`${import.meta.env.BASE_URL}onenote-import.json`);
  if (!res.ok) throw new Error(`Starter data not found (${res.status})`);
  return normalize(await res.json());
}
