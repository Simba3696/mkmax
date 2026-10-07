// The sync loop: when to pull, push or ask, around a connection that can change while GitHub answers. Plain TS with
// GitHub, the app state and timers passed in, so tests can run two devices against one fake gist. store.tsx wires it
// to React.
import type { AppState } from './types';
import { NEWER_MESSAGE, OUTDATED_MESSAGE, UNREADABLE_MESSAGE, decideSync, fromNewerApp, sameData, stamp, type SyncConfig } from './sync';

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'idle'; at: number | null }
  | { kind: 'syncing' }
  | { kind: 'error'; message: string }
  /** Both devices changed data since the last sync; the user picks which copy wins. */
  | { kind: 'conflict'; remote: AppState };

export interface SyncDeps {
  readRemote: (cfg: SyncConfig) => Promise<AppState | null>;
  writeRemote: (cfg: SyncConfig, state: AppState) => Promise<void>;
  findOrCreateGist: (token: string, state: AppState) => Promise<{ gistId: string; created: boolean }>;
  /** This device's current data, including edits made while a request was out. */
  getState: () => AppState;
  /** Replace this device's data with the gist's copy (which the store normalizes, and which clears Undo). */
  applyRemote: (remote: AppState) => void;
  /** Whether this build can load the gist's copy (normalize doesn't throw on it). */
  canRead: (remote: AppState) => boolean;
  /** Replace this device's data with a restamped copy of itself. */
  setLocal: (state: AppState) => void;
  saveConfig: (cfg: SyncConfig | null) => void;
  onStatus: (status: SyncStatus) => void;
  /** The first sync attempt since launch has finished, whatever the outcome. */
  onSettled: () => void;
  /** Run a sync a moment from now (the store debounces it), for edits that still need pushing. */
  schedulePush: () => void;
  cancelPush: () => void;
  now: () => number;
}

export class SyncLoop {
  private cfg: SyncConfig | null;
  private busy = false;
  /** The gist's copy while a conflict waits for the user. Background syncs hold off so the prompt stays put. */
  private conflict: AppState | null = null;

  constructor(
    private deps: SyncDeps,
    cfg: SyncConfig | null,
  ) {
    this.cfg = cfg;
  }

  get config() {
    return this.cfg;
  }

  private setConfig(cfg: SyncConfig | null) {
    this.cfg = cfg;
    this.deps.saveConfig(cfg);
  }

  /** Still connected to the gist a sync started with (not disconnected or switched while GitHub answered). */
  private sameGist(cfg: SyncConfig) {
    return this.cfg?.gistId === cfg.gistId && this.cfg.token === cfg.token;
  }

  /**
   * The stamp for a change on this device: after its own copy and the last agreed one. After a pull the agreed stamp
   * comes from the other device's clock, so on a device whose clock runs behind, the time alone would stamp edits as
   * older than what was agreed, and sync would never upload them.
   */
  nextStamp() {
    return Math.max(this.deps.now(), stamp(this.deps.getState()) + 1, (this.cfg?.baseUpdatedAt ?? 0) + 1);
  }

  /**
   * Stamps this device's copy after both the gist's and the last agreed one before it overwrites the gist, so the
   * other device sees it as newer than anything it has and pulls it (or asks, if it has changed since) instead of
   * carrying on with its own copy.
   */
  private restampToKeep(cfg: SyncConfig, remote: AppState | null) {
    const kept = { ...this.deps.getState(), updatedAt: Math.max(this.nextStamp(), stamp(remote) + 1, cfg.baseUpdatedAt + 1) };
    this.deps.setLocal(kept);
    return kept;
  }

  /**
   * Neither pull nor push until this device runs the newer build; the regular pulls check again. It doesn't look for
   * the update itself: that reloads the app straight away, which would throw away an open pack editor.
   */
  private waitForNewerApp() {
    this.deps.onStatus({ kind: 'error', message: NEWER_MESSAGE });
  }

  /**
   * Neither pull nor push while this build can't read the gist's copy. Pulling would fail, and pushing (or asking,
   * where Keep mine pushes) would replace the user's data with this device's copy, which is fresh if its own save
   * couldn't be read either.
   */
  private unreadable(remote: AppState | null) {
    if (!remote || this.deps.canRead(remote)) return false;
    this.deps.onStatus({ kind: 'error', message: UNREADABLE_MESSAGE });
    return true;
  }

  /** Edits made while a request was out still need pushing. */
  private pushLaterEdits() {
    if (this.cfg && stamp(this.deps.getState()) > this.cfg.baseUpdatedAt) this.deps.schedulePush();
  }

  /** Pull if the gist moved on, push if only this device did, or report a conflict if both did. */
  async syncNow() {
    const cfg = this.cfg;
    if (!cfg || this.busy || this.conflict) return;
    this.busy = true;
    let ok = false;
    this.deps.onStatus({ kind: 'syncing' });
    try {
      const remote = await this.deps.readRemote(cfg);
      if (!this.sameGist(cfg)) return;
      const local = this.deps.getState();
      const action = decideSync(remote, local, cfg.baseUpdatedAt);
      if (action === 'newer') {
        this.waitForNewerApp();
        return;
      }
      if (action !== 'none' && action !== 'outdated' && this.unreadable(remote)) return;
      if (action === 'conflict') {
        this.conflict = remote!;
        this.deps.onStatus({ kind: 'conflict', remote: remote! });
        return;
      }
      if (action === 'outdated') {
        const kept = this.restampToKeep(cfg, remote);
        await this.deps.writeRemote(cfg, kept);
        if (!this.sameGist(cfg)) return;
        this.setConfig({ ...cfg, baseUpdatedAt: stamp(kept) });
        this.deps.onStatus({ kind: 'error', message: OUTDATED_MESSAGE });
        return;
      }
      if (action === 'pull') {
        this.deps.applyRemote(remote!);
        this.setConfig({ ...cfg, baseUpdatedAt: stamp(remote) });
      } else if (action === 'push') {
        await this.deps.writeRemote(cfg, local);
        if (!this.sameGist(cfg)) return;
        this.setConfig({ ...cfg, baseUpdatedAt: stamp(local) });
      } else {
        // Same data on both sides (maybe with different stamps), so both stamps count as agreed.
        this.setConfig({ ...cfg, baseUpdatedAt: Math.max(cfg.baseUpdatedAt, stamp(local), stamp(remote)) });
      }
      this.deps.onStatus({ kind: 'idle', at: this.deps.now() });
      ok = true;
    } catch (e) {
      if (this.sameGist(cfg)) this.deps.onStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      this.busy = false;
      // Offline or refused, automatic changes still go ahead rather than wait for the whole session.
      this.deps.onSettled();
      // After a conflict or an error, the next pull (every 2 minutes, on reconnect or on return to the app) picks
      // later edits up instead of retrying in a tight loop.
      if (ok) this.pushLaterEdits();
    }
  }

  async connect(token: string) {
    this.deps.onStatus({ kind: 'syncing' });
    try {
      // The copy a new gist is made from; edits made while GitHub answers come after it and still need pushing.
      const snap = this.deps.getState();
      const { gistId, created } = await this.deps.findOrCreateGist(token, snap);
      // A new gist already holds this device's data; an existing one gets compared on the first sync.
      this.setConfig({ token, gistId, baseUpdatedAt: created ? stamp(snap) : 0 });
      this.deps.onStatus({ kind: 'idle', at: created ? this.deps.now() : null });
      if (!created) await this.syncNow();
      else this.pushLaterEdits();
    } catch (e) {
      this.deps.onStatus({ kind: 'error', message: (e as Error).message });
      throw e;
    }
  }

  disconnect() {
    this.deps.cancelPush();
    this.conflict = null;
    this.setConfig(null);
    this.deps.onStatus({ kind: 'off' });
    this.deps.onSettled();
  }

  async resolve(keep: 'mine' | 'theirs') {
    const cfg = this.cfg;
    const shown = this.conflict;
    if (!cfg || !shown || this.busy) return;
    this.deps.cancelPush();
    this.conflict = null;
    if (keep === 'theirs') {
      try {
        this.deps.applyRemote(shown);
      } catch {
        // Left unagreed, so the regular pulls neither push nor ask again while this build can't read it.
        this.deps.onStatus({ kind: 'error', message: UNREADABLE_MESSAGE });
        return;
      }
      this.setConfig({ ...cfg, baseUpdatedAt: stamp(shown) });
      this.deps.onStatus({ kind: 'idle', at: this.deps.now() });
      return;
    }
    this.busy = true;
    this.deps.onStatus({ kind: 'syncing' });
    let ok = false;
    try {
      // Background syncs hold off while the prompt is up, so the other device may have pushed again since. Show
      // that copy instead of overwriting it unseen.
      const fresh = await this.deps.readRemote(cfg);
      if (!this.sameGist(cfg)) return;
      if (fresh && fromNewerApp(fresh)) {
        this.waitForNewerApp();
        return;
      }
      if (this.unreadable(fresh)) return;
      if (fresh && stamp(fresh) !== stamp(shown) && !sameData(fresh, shown)) {
        this.conflict = fresh;
        this.deps.onStatus({ kind: 'conflict', remote: fresh });
        return;
      }
      const kept = this.restampToKeep(cfg, fresh);
      await this.deps.writeRemote(cfg, kept);
      if (!this.sameGist(cfg)) return;
      this.setConfig({ ...cfg, baseUpdatedAt: stamp(kept) });
      this.deps.onStatus({ kind: 'idle', at: this.deps.now() });
      ok = true;
    } catch (e) {
      if (this.sameGist(cfg)) this.deps.onStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      this.busy = false;
      if (ok) this.pushLaterEdits();
    }
  }
}
