import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { defaultState, defaultWeights } from './defaults';
import { pruneDone } from './engine';
import { decideSync, findOrCreateGist, loadSyncConfig, readRemote, saveSyncConfig, stamp, writeRemote, type SyncConfig } from './sync';

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
 * Version 1 saves counted the first copy as F1; version 2 starts at F0. Shift owned levels up one,
 * reset built-in rarities to the new fusion tables (keeping kard counts), and extend custom ones.
 */
function migrateV1(s: Partial<AppState>): Partial<AppState> {
  const defaults = new Map(defaultState().rarities.map((r) => [r.id, r]));
  return {
    ...s,
    rarities: s.rarities?.map((r) => {
      const d = defaults.get(r.id);
      return d ? { ...d, label: r.label, color: r.color, fusionUpKards: r.fusionUpKards } : { ...r, dupesPerLevel: [...r.dupesPerLevel, 1] };
    }),
    cards: s.cards!.map((c) => {
      const { spare: _spare, ...rest } = c as typeof c & { spare?: number };
      return { ...rest, fusion: c.fusion > 0 ? c.fusion + 1 : 0, maxLevel: c.maxLevel != null ? c.maxLevel + 1 : c.maxLevel };
    }),
  };
}

/** Fill in fields missing from older saves or hand-edited imports. */
export function normalize(input: unknown): AppState {
  let s = input as Partial<AppState>;
  if (!s || typeof s !== 'object' || !Array.isArray(s.cards) || !Array.isArray(s.packs)) {
    throw new Error('Not an MK Max save file');
  }
  if ((s.version as number) !== 2) s = migrateV1(s);
  const base = defaultState();
  const out: AppState = {
    version: 2,
    rarities: s.rarities?.length
      ? s.rarities.map((r) => ({
          ...r,
          fusionMax: r.fusionMax ?? 10,
          goal: r.goal ?? 'max',
          hasGuests: r.hasGuests ?? r.id === 'diamond',
        }))
      : base.rarities,
    currencies: s.currencies?.length ? s.currencies : base.currencies,
    cards: s.cards!,
    packs: s.packs!,
    towers: s.towers ?? [],
    weights: { ...defaultWeights, ...s.weights, tier: { ...defaultWeights.tier, ...s.weights?.tier } },
    updatedAt: s.updatedAt,
  };
  pruneDone(out);
  return out;
}

/** Pass an undo label to offer "Undo <label>" for this change. */
type Update = (recipe: (draft: AppState) => void, undoLabel?: string) => void;

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

  /** Pull if the gist moved on, push if only this device did, or report a conflict if both did. */
  async function syncNow() {
    const cfg = cfgRef.current;
    if (!cfg || busy.current) return;
    busy.current = true;
    setStatus({ kind: 'syncing' });
    try {
      const remote = await readRemote(cfg);
      const local = stateRef.current;
      const action = decideSync(remote, local, cfg.baseUpdatedAt);
      if (action === 'conflict') {
        setStatus({ kind: 'conflict', remote: remote! });
        return;
      }
      if (action === 'pull') {
        applyRemote(remote!);
        setConfig({ ...cfg, baseUpdatedAt: stamp(remote) });
      } else if (action === 'push') {
        await writeRemote(cfg, local);
        setConfig({ ...cfg, baseUpdatedAt: stamp(local) });
      } else {
        setConfig({ ...cfg, baseUpdatedAt: Math.max(cfg.baseUpdatedAt, stamp(local)) });
      }
      setStatus({ kind: 'idle', at: Date.now() });
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      busy.current = false;
      // Edits made while this sync was in flight still need pushing.
      const cfgNow = cfgRef.current;
      if (cfgNow && stamp(stateRef.current) > cfgNow.baseUpdatedAt) schedulePush();
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

  const update: Update = (recipe, undoLabel) => {
    // Built from the ref rather than a setState updater so the undo label can include what got pruned.
    const prev = stateRef.current;
    const draft = structuredClone(prev);
    recipe(draft);
    const removed = pruneDone(draft);
    draft.updatedAt = Date.now();
    stateRef.current = draft;
    setState(draft);
    const label = [undoLabel, removed.length > 0 && `${removed.join(', ')} ${removed.length > 1 ? 'are' : 'is'} maxed and removed`].filter(Boolean).join(' · ');
    if (label) setLastUndo({ label, prev, at: Date.now() });
    schedulePush();
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
        const { gistId, created } = await findOrCreateGist(token.trim(), stateRef.current);
        // A new gist already holds this device's data; an existing one gets compared on the first sync.
        setConfig({ token: token.trim(), gistId, baseUpdatedAt: created ? stamp(stateRef.current) : 0 });
        setStatus({ kind: 'idle', at: created ? Date.now() : null });
        if (!created) await syncRef.current();
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message });
        throw e;
      }
    },
    disconnect() {
      clearTimeout(pushTimer.current);
      setConfig(null);
      setStatus({ kind: 'off' });
    },
    syncNow: () => syncRef.current(),
    async resolve(keep) {
      const cfg = cfgRef.current;
      if (!cfg || status.kind !== 'conflict') return;
      if (keep === 'theirs') {
        applyRemote(status.remote);
        setConfig({ ...cfg, baseUpdatedAt: stamp(status.remote) });
        setStatus({ kind: 'idle', at: Date.now() });
        return;
      }
      setStatus({ kind: 'syncing' });
      try {
        await writeRemote(cfg, stateRef.current);
        setConfig({ ...cfg, baseUpdatedAt: stamp(stateRef.current) });
        setStatus({ kind: 'idle', at: Date.now() });
      } catch (e) {
        setStatus({ kind: 'error', message: (e as Error).message });
      }
    },
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
