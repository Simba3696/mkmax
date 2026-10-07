import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { defaultState } from './defaults';
import { normalize } from './normalize';
import { pruneDone } from './engine';
import { findOrCreateGist, loadSyncConfig, readRemote, saveSyncConfig, writeRemote } from './sync';
import { SyncLoop, type SyncStatus } from './syncLoop';

export { normalize };
export type { SyncStatus };

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

  const [lastUndo, setLastUndo] = useState<UndoEntry | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked; state still lives in memory */
    }
  }, [state]);

  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setLocal = (s: AppState) => {
    stateRef.current = s;
    setState(s);
  };
  // Created once; its callbacks only use refs and state setters, which stay the same across renders.
  const [loop] = useState(
    () =>
      new SyncLoop(
        {
          readRemote,
          writeRemote,
          findOrCreateGist,
          getState: () => stateRef.current,
          applyRemote: (remote) => {
            setLocal(normalize(remote));
            // The snapshot predates the other device's changes; restoring it would silently drop them.
            setLastUndo(null);
          },
          setLocal,
          saveConfig: (cfg) => {
            saveSyncConfig(cfg);
            setConnected(!!cfg);
          },
          onStatus: (st) => setStatus(st),
          onSettled: () => setSettled(true),
          schedulePush: () => schedulePush(),
          cancelPush: () => clearTimeout(pushTimer.current),
          now: () => Date.now(),
        },
        loadSyncConfig(),
      ),
  );
  const [connected, setConnected] = useState(() => !!loop.config);
  const [status, setStatus] = useState<SyncStatus>(() => (loop.config ? { kind: 'idle', at: null } : { kind: 'off' }));
  const [settled, setSettled] = useState(() => !loop.config);

  function schedulePush() {
    if (!loop.config) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => void loop.syncNow(), PUSH_DELAY_MS);
  }

  // Pull when the app opens, comes back to the foreground, reconnects, and every couple of minutes.
  useEffect(() => {
    const pull = () => document.visibilityState === 'visible' && void loop.syncNow();
    pull();
    document.addEventListener('visibilitychange', pull);
    window.addEventListener('online', pull);
    const t = setInterval(pull, PULL_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', pull);
      window.removeEventListener('online', pull);
      clearInterval(t);
    };
  }, [loop]);

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
    connect: (token) => loop.connect(token.trim()),
    disconnect: () => loop.disconnect(),
    syncNow: () => loop.syncNow(),
    resolve: (keep) => loop.resolve(keep),
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
