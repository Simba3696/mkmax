import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { normalize } from './normalize';
import { pruneDone } from './engine';
import { NEWER_SAVE_MESSAGE, findOrCreateGist, loadSyncConfig, readRemote, saveSyncConfig, writeRemote } from './sync';
import { SyncLoop, type SyncStatus } from './syncLoop';
import { discardUnreadable as removeUnreadable, holdIfNewer, load, loadUnreadable, save, savedByNewerApp } from './storage';

export { normalize };
export type { SyncStatus };

/**
 * Pass an undo label to offer "Undo <label>" for this change; it can be a function, called after the recipe, when it
 * depends on what the recipe changed. `auto` marks a change the app makes by itself that
 * every device works out the same way (catalog art, or the season end on a fresh install): it's saved but doesn't count as an edit for sync, so it can't
 * make two devices disagree. `ruleChange` marks a change to a rarity's rules: cards it leaves done are removed but not
 * put on the Maxed record. A recipe that finds nothing to change returns `noChange`: the draft is thrown away, so
 * nothing is saved, stamped or synced and no Undo is offered, though anything the recipe did outside the draft (like a
 * flag its caller reads) still happened.
 */
type Update = (
  recipe: (draft: AppState) => void | typeof noChange,
  undoLabel?: string | (() => string),
  // `undoFrom` adjusts the state Undo goes back to, for a change whose first steps were saved without Undo (a Tower box
  // saves as it's typed, then its finish re-spells other cards): Undo then takes back those steps too.
  opts?: { auto?: boolean; ruleChange?: boolean; undoFrom?: (prev: AppState) => void },
) => void;

/**
 * What an update recipe returns when there's nothing to change, like a tap on a screen a sync has made out of date. A
 * symbol rather than `false`, since a one-line recipe hands back whatever it assigns, and `(d) => (d.on = false)`
 * would then drop the change without a word.
 */
export const noChange: unique symbol = Symbol('noChange');

/** The most recent undoable change: the state from just before it. */
export interface UndoEntry {
  label: string;
  prev: AppState;
  at: number;
}

interface SyncApi {
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
  /** Given the change the Undo bar showed, only while that's still the one to undo (see UndoToast). */
  undo: (shown?: UndoEntry) => void;
  dismissUndo: (shown?: UndoEntry) => void;
  /** The saved data as it was when it couldn't be read, until the user discards it. */
  unreadable: string | null;
  discardUnreadable: () => void;
  /** This browser's save is from a newer version of MK Max: it's shown but nothing changes, saves or syncs until a reload. */
  newerSave: boolean;
}

const Ctx = createContext<StoreApi | null>(null);

const PUSH_DELAY_MS = 1500;
const PULL_EVERY_MS = 2 * 60 * 1000;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Read after load(), which keeps the copy.
  const [unreadable, setUnreadable] = useState(loadUnreadable);
  // Also set by load(). Changes are refused rather than kept in memory, where the next reload would lose them without
  // a word, and sync stays off: pulling would replace the newer save and pushing would send this copy's older reading.
  // Checked through savedByNewerApp() where it matters, since the sync loop keeps the first render's callbacks.
  const [newerSave, setNewerSave] = useState(savedByNewerApp);

  const [lastUndo, setLastUndo] = useState<UndoEntry | null>(null);

  useEffect(() => save(state), [state]);

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
          canRead: (remote) => {
            try {
              // A copy, since normalize changes some of what it's given in place.
              normalize(structuredClone(remote));
              return true;
            } catch {
              return false;
            }
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
  // With sync off there's nothing paused, so no sync error; the notice on every tab says why taps do nothing.
  const [status, setStatus] = useState<SyncStatus>(() =>
    !loop.config ? { kind: 'off' } : newerSave ? { kind: 'error', message: NEWER_SAVE_MESSAGE } : { kind: 'idle', at: null },
  );
  const [settled, setSettled] = useState(() => newerSave || !loop.config);

  function schedulePush() {
    if (!loop.config || savedByNewerApp()) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => void loop.syncNow(), PUSH_DELAY_MS);
  }

  // Pull when the app opens, comes back to the foreground, reconnects, and every couple of minutes.
  useEffect(() => {
    if (newerSave) return;
    const pull = () => document.visibilityState === 'visible' && void loop.syncNow();
    // Some browsers restore a page from the back-forward cache with only pageshow, no visibility change.
    const onPageShow = (e: PageTransitionEvent) => e.persisted && pull();
    pull();
    document.addEventListener('visibilitychange', pull);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', pull);
    const t = setInterval(pull, PULL_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', pull);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', pull);
      clearInterval(t);
    };
  }, [loop, newerSave]);

  // A tab left open on the older build when another tab, on the newer one, saves: hold from then on, as at startup
  // (the update itself reloads this tab, but not while a pop-up or the Undo bar is up).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!holdIfNewer(e.key, e.newValue)) return;
      clearTimeout(pushTimer.current);
      setNewerSave(true);
      setLastUndo(null);
      if (loop.config) setStatus({ kind: 'error', message: NEWER_SAVE_MESSAGE });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loop]);

  const update: Update = (recipe, undoLabel, opts) => {
    if (savedByNewerApp()) return;
    // Built from the ref rather than a setState updater so the undo label can include what got pruned.
    const prev = stateRef.current;
    const draft = structuredClone(prev);
    // No save, no stamp and no sync push, so a tap that does nothing can't make this device's copy look newest.
    if (recipe(draft) === noChange) return;
    const split = { maxed: [] as string[], done: [] as string[] };
    pruneDone(draft, new Date(), split, !opts?.ruleChange);
    if (!opts?.auto) draft.updatedAt = loop.nextStamp();
    stateRef.current = draft;
    setState(draft);
    // A card done at its kard threshold (gear, by default) isn't maxed (it's not on the Maxed page), and nor is a card a
    // Settings rule change removes, so those are only "done".
    const gone = (names: string[], how: string) => names.length > 0 && `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} ${how} and removed`;
    const label = [typeof undoLabel === 'function' ? undoLabel() : undoLabel, gone(split.maxed, 'maxed'), gone(split.done, 'done')].filter(Boolean).join(' · ');
    if (label) {
      const base = opts?.undoFrom ? structuredClone(prev) : prev;
      opts?.undoFrom?.(base);
      setLastUndo({ label, prev: base, at: Date.now() });
    }
    if (!opts?.auto) schedulePush();
  };

  const replace = (s: AppState) => {
    if (savedByNewerApp()) return;
    const next = { ...structuredClone(s), updatedAt: loop.nextStamp() };
    pruneDone(next);
    stateRef.current = next;
    setState(next);
    setLastUndo(null);
    schedulePush();
  };

  const undo = (shown?: UndoEntry) => {
    if (!lastUndo || (shown && shown !== lastUndo) || savedByNewerApp()) return;
    // A fresh stamp so sync treats the restored copy as this device's newest change.
    setLocal({ ...lastUndo.prev, updatedAt: loop.nextStamp() });
    setLastUndo(null);
    schedulePush();
  };

  const paused = () => Promise.resolve();
  const sync: SyncApi = {
    status,
    connected,
    connect: newerSave ? paused : (token) => loop.connect(token.trim()),
    disconnect: () => loop.disconnect(),
    syncNow: newerSave ? paused : () => loop.syncNow(),
    resolve: newerSave ? paused : (keep) => loop.resolve(keep),
    settled,
  };

  const discardUnreadable = () => {
    removeUnreadable();
    setUnreadable(null);
  };

  return (
    <Ctx.Provider value={{ state, update, replace, sync, lastUndo, undo, dismissUndo: (shown) => setLastUndo((cur) => (shown && cur !== shown ? cur : null)), unreadable, discardUnreadable, newerSave }}>{children}</Ctx.Provider>
  );
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

export const newId = () => crypto.randomUUID().slice(0, 8);
