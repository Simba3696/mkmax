// Cross-device sync through a secret GitHub Gist. Each device keeps its own token and the gist id
// in localStorage (never in the synced data); the gist holds one JSON file with the app state.
import type { AppState } from './types';

const CONFIG_KEY = 'mkmax:sync';
const API = 'https://api.github.com';
const FILE = 'mkmax-data.json';
const DESCRIPTION = 'MK Max sync data';

export interface SyncConfig {
  token: string;
  gistId: string;
  /** updatedAt of the data this device last pushed or pulled; tells us whether the other side moved on. */
  baseUpdatedAt: number;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg: SyncConfig | null) {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage blocked: sync just won't persist across reloads */
  }
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token. Check it has the gist scope and hasn’t expired.');
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

interface Gist {
  id: string;
  description: string | null;
  files: Record<string, { content?: string; truncated?: boolean; raw_url: string } | undefined>;
}

/** Reuse this account's MK Max gist if one exists, otherwise create a secret one seeded with `state`. */
export async function findOrCreateGist(token: string, state: AppState): Promise<{ gistId: string; created: boolean }> {
  for (let page = 1; page <= 10; page++) {
    const gists = await gh<Gist[]>(token, `/gists?per_page=100&page=${page}`);
    const hit = gists.find((g) => g.description === DESCRIPTION && g.files[FILE]);
    if (hit) return { gistId: hit.id, created: false };
    if (gists.length < 100) break;
  }
  const created = await gh<Gist>(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: DESCRIPTION, public: false, files: { [FILE]: { content: JSON.stringify(state) } } }),
  });
  return { gistId: created.id, created: true };
}

/** The synced state, or null if the gist has no data file yet. */
export async function readRemote(cfg: SyncConfig): Promise<AppState | null> {
  const gist = await gh<Gist>(cfg.token, `/gists/${cfg.gistId}`);
  const file = gist.files[FILE];
  if (!file) return null;
  const text = file.truncated || file.content == null ? await (await fetch(file.raw_url)).text() : file.content;
  return JSON.parse(text) as AppState;
}

export async function writeRemote(cfg: SyncConfig, state: AppState) {
  await gh(cfg.token, `/gists/${cfg.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(state) } } }) });
}

export const stamp = (s: AppState | null | undefined) => s?.updatedAt ?? 0;

/**
 * Builds up to 19ef952 (2026-09-28) wrote version 2 and treated any other version as the old F1-based format,
 * so a copy of one still open on another device raised every level by one when it pulled newer data, then
 * synced that back as version 2. Data saved as version 2 or lower is from one of those builds and never pulled.
 */
export const fromOutdatedApp = (s: AppState) => ((s.version as number | undefined) ?? 1) <= 2;

export const OUTDATED_MESSAGE =
  'Another device synced data from an old version of MK Max, which raises every level by one. This device’s copy was kept and uploaded over it. Close MK Max on your other devices and open it again to update them.';

/**
 * What a sync should do, given the gist's copy, this device's copy, and the version both last agreed on.
 * Only one side changed → that side wins; both changed → the user decides. Data from an outdated app is
 * replaced with this device's copy. A device that has never synced and has no cards or packs takes the gist's
 * copy without asking, since keeping its own would wipe the gist with an empty one.
 */
export function decideSync(remote: AppState | null, local: AppState, base: number): 'pull' | 'push' | 'conflict' | 'none' | 'outdated' {
  if (!remote) return 'push';
  if (fromOutdatedApp(remote)) return 'outdated';
  if (base === 0 && local.cards.length === 0 && local.packs.length === 0) return 'pull';
  const remoteMoved = stamp(remote) > base;
  const localMoved = stamp(local) > base;
  if (remoteMoved && localMoved) return stamp(remote) === stamp(local) ? 'none' : 'conflict';
  if (remoteMoved) return 'pull';
  if (localMoved) return 'push';
  return 'none';
}
