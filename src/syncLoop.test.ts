import { describe, expect, it } from 'vitest';
import { defaultState } from './defaults';
import type { SyncConfig } from './sync';
import { SyncLoop, type SyncStatus } from './syncLoop';
import type { AppState } from './types';

/** One gist shared by every device in a test. Requests can be held open to make edits while they're out. */
class FakeGist {
  data: AppState | null = null;
  reads = 0;
  writes = 0;
  fail: Error | null = null;
  private held: (() => void)[] = [];
  /** Which requests to hold open until release(). */
  holding: 'reads' | 'writes' | null = null;

  private async gate(kind: 'reads' | 'writes') {
    if (this.fail) throw this.fail;
    if (this.holding === kind) await new Promise<void>((r) => this.held.push(r));
  }
  async read() {
    this.reads++;
    const snapshot = structuredClone(this.data);
    await this.gate('reads');
    return snapshot;
  }
  async write(s: AppState) {
    await this.gate('writes');
    this.writes++;
    this.data = structuredClone(s);
  }
  /** Let held requests finish, and wait for what they do next. */
  async release() {
    this.holding = null;
    this.held.splice(0).forEach((r) => r());
    await settle();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

let clock = 1000;
const tick = () => (clock += 1000);

/** A device on its own clock, `skew` ms ahead of the shared one (behind if negative). */
function device(gist: FakeGist, state: AppState = defaultState(), cfg: SyncConfig | null = null, skew = 0) {
  const d = {
    state,
    status: { kind: 'off' } as SyncStatus,
    pushes: 0,
    settled: false,
    /** Whether this device's build can load a copy; the store's normalize throws on one it can't. */
    readable: (_s: AppState) => true,
    /** An edit through the store, a moment after the last one. */
    edit(recipe: (s: AppState) => void) {
      tick();
      const next = structuredClone(d.state);
      recipe(next);
      next.updatedAt = d.loop.nextStamp();
      d.state = next;
    },
    loop: null as unknown as SyncLoop,
  };
  d.loop = new SyncLoop(
    {
      readRemote: () => gist.read(),
      writeRemote: (_cfg, s) => gist.write(s),
      findOrCreateGist: async (_token, s) => {
        if (gist.data) return { gistId: 'g1', created: false };
        gist.data = structuredClone(s);
        return { gistId: 'g1', created: true };
      },
      getState: () => d.state,
      applyRemote: (remote) => {
        if (!d.readable(remote)) throw new Error('Cannot read properties of undefined');
        d.state = structuredClone(remote);
      },
      canRead: (remote) => d.readable(remote),
      setLocal: (s) => (d.state = s),
      saveConfig: () => {},
      onStatus: (s) => (d.status = s),
      onSettled: () => (d.settled = true),
      schedulePush: () => d.pushes++,
      cancelPush: () => {},
      now: () => clock + skew,
    },
    cfg,
  );
  return d;
}

const card = (id: string) => ({ id, name: id, rarityId: 'diamond', fusion: 1, guest: false });
const names = (s: AppState | null) => s?.cards.map((c) => c.name) ?? [];

/** Two devices that have synced the same data. */
async function pair(desktopSkew = 0) {
  const gist = new FakeGist();
  const phone = device(gist);
  phone.edit((s) => s.cards.push(card('Scorpion')));
  await phone.loop.connect('token');
  const desktop = device(gist, defaultState(), null, desktopSkew);
  await desktop.loop.connect('token');
  return { gist, phone, desktop };
}

describe('sync loop', () => {
  it('a new device with nothing entered downloads the gist without asking', async () => {
    const { desktop } = await pair();
    expect(desktop.status.kind).toBe('idle');
    expect(names(desktop.state)).toEqual(['Scorpion']);
  });

  it('a fresh device that made the gist pushes its first edits instead of reverting them', async () => {
    const gist = new FakeGist();
    const phone = device(gist);
    await phone.loop.connect('token'); // the gist holds a copy with no stamp
    phone.edit((s) => (s.currencies[0].balance = 500));
    await phone.loop.syncNow();
    expect(phone.state.currencies[0].balance).toBe(500);
    expect(gist.data?.currencies[0].balance).toBe(500);
  });

  it('pushes edits made while connecting', async () => {
    const gist = new FakeGist();
    const phone = device(gist);
    const connecting = phone.loop.connect('token');
    phone.edit((s) => s.cards.push(card('Raiden')));
    await connecting;
    expect(names(gist.data)).toEqual([]); // the gist was made from the copy before the edit
    expect(phone.pushes).toBe(1);
    await phone.loop.syncNow();
    expect(names(gist.data)).toEqual(['Raiden']);
  });

  it('pulls the other device’s change and pushes its own', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    await desktop.loop.syncNow();
    expect(names(desktop.state)).toEqual(['Scorpion', 'Raiden']);
    expect(names(gist.data)).toEqual(['Scorpion', 'Raiden']);
  });

  it('does not ask when both devices made the same change', async () => {
    const { phone, desktop } = await pair();
    phone.edit((s) => (s.realmKlashSeasonEnd = '2026-10-21T16:00'));
    await phone.loop.syncNow();
    desktop.edit((s) => (s.realmKlashSeasonEnd = '2026-10-21T16:00'));
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('idle');
    // And neither sees the other's stamp as a new change afterwards.
    await phone.loop.syncNow();
    expect(phone.status.kind).toBe('idle');
  });

  it('asks when both changed, and holds background syncs while the prompt waits', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('conflict');
    const reads = gist.reads;
    await desktop.loop.syncNow();
    await desktop.loop.syncNow();
    expect(gist.reads).toBe(reads);
    expect(desktop.pushes).toBe(0);
  });

  it('keeping this device’s copy reaches the other device, even when its last edit is newer', async () => {
    const { gist, phone, desktop } = await pair();
    desktop.edit((s) => s.cards.push(card('Kitana'))); // made offline, before the phone's edit
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('conflict');
    await desktop.loop.resolve('mine');
    expect(names(gist.data)).toEqual(['Scorpion', 'Kitana']);
    await phone.loop.syncNow();
    expect(names(phone.state)).toEqual(['Scorpion', 'Kitana']);
  });

  it('keeping this device’s copy shows a newer copy pushed while the prompt was open, instead of overwriting it', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    phone.edit((s) => s.cards.push(card('Jade')));
    await phone.loop.syncNow();
    await desktop.loop.resolve('mine');
    expect(desktop.status).toMatchObject({ kind: 'conflict' });
    expect(names(desktop.status.kind === 'conflict' ? desktop.status.remote : null)).toEqual(['Scorpion', 'Raiden', 'Jade']);
    expect(names(gist.data)).toEqual(['Scorpion', 'Raiden', 'Jade']);
  });

  it('keeping the other device’s copy replaces this one', async () => {
    const { phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    await desktop.loop.resolve('theirs');
    expect(names(desktop.state)).toEqual(['Scorpion', 'Raiden']);
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('idle');
  });

  it('pushes an edit made while the kept copy was uploading', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    gist.holding = 'writes';
    const resolving = desktop.loop.resolve('mine');
    await settle();
    desktop.edit((s) => s.cards.push(card('Jade')));
    await gist.release();
    await resolving;
    expect(desktop.pushes).toBe(1);
    await desktop.loop.syncNow();
    expect(names(gist.data)).toEqual(['Scorpion', 'Kitana', 'Jade']);
  });

  it('pushes an edit made while a push was out', async () => {
    const { gist, phone } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    gist.holding = 'writes';
    const syncing = phone.loop.syncNow();
    await settle();
    phone.edit((s) => s.cards.push(card('Jade')));
    await gist.release();
    await syncing;
    expect(phone.pushes).toBe(1);
    await phone.loop.syncNow();
    expect(names(gist.data)).toEqual(['Scorpion', 'Raiden', 'Jade']);
  });

  it('after an error, waits for the next regular sync instead of retrying straight away', async () => {
    const { gist, phone } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    gist.fail = new TypeError('Failed to fetch');
    await phone.loop.syncNow();
    expect(phone.status).toEqual({ kind: 'error', message: 'Failed to fetch' });
    expect(phone.pushes).toBe(0);
    expect(phone.settled).toBe(true);
    gist.fail = null;
    await phone.loop.syncNow();
    expect(names(gist.data)).toEqual(['Scorpion', 'Raiden']);
  });

  it('ignores a sync that finishes after Disconnect', async () => {
    const { gist, phone } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    gist.holding = 'reads';
    const syncing = phone.loop.syncNow();
    await settle();
    phone.loop.disconnect();
    await gist.release();
    await syncing;
    expect(phone.loop.config).toBeNull();
    expect(phone.status.kind).toBe('off');
    expect(names(gist.data)).toEqual(['Scorpion']);
  });

  it('a conflict found after Disconnect doesn’t block syncing once reconnected', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    gist.holding = 'reads';
    const syncing = desktop.loop.syncNow();
    await settle();
    desktop.loop.disconnect();
    await gist.release();
    await syncing;
    await desktop.loop.connect('token');
    expect(desktop.status.kind).toBe('conflict'); // a fresh comparison, shown once
    await desktop.loop.resolve('theirs');
    expect(names(desktop.state)).toEqual(['Scorpion', 'Raiden']);
  });

  it('uploads edits from a device whose clock is behind the other one’s', async () => {
    const { gist, phone, desktop } = await pair(-5 * 60 * 1000);
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    await desktop.loop.syncNow();
    // By the desktop's clock, this is before the phone's change it just pulled.
    desktop.edit((s) => (s.currencies[0].balance = 777));
    await desktop.loop.syncNow();
    expect(gist.data?.currencies[0].balance).toBe(777);
    // And the phone's next sync takes it rather than keeping its own copy.
    await phone.loop.syncNow();
    expect(phone.state.currencies[0].balance).toBe(777);
    expect(names(phone.state)).toEqual(['Scorpion', 'Raiden']);
  });

  it('undoing or replacing data on a device whose clock is behind still counts as its newest change', async () => {
    const { gist, phone, desktop } = await pair(-5 * 60 * 1000);
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    await desktop.loop.syncNow();
    // What the store's undo, import and erase do: put a copy back with a new stamp.
    desktop.state = { ...defaultState(), updatedAt: desktop.loop.nextStamp() };
    await desktop.loop.syncNow();
    expect(names(gist.data)).toEqual([]);
  });

  it('neither pulls nor pushes data from a newer build', async () => {
    const { gist, phone, desktop } = await pair();
    // The desktop, already on a newer build, pushes data saved in a newer version.
    desktop.edit((s) => s.cards.push(card('Kitana')));
    gist.data = { ...structuredClone(desktop.state), version: 99 } as unknown as AppState;
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    expect(phone.status.kind).toBe('error');
    expect(names(phone.state)).toEqual(['Scorpion', 'Raiden']);
    expect(names(gist.data)).toEqual(['Scorpion', 'Kitana']);
    expect(gist.data!.version).toBe(99);
    expect(phone.pushes).toBe(0);
  });

  it('keeping this device’s copy doesn’t overwrite data a newer build pushed while the prompt was open', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('conflict');
    gist.data = { ...structuredClone(gist.data!), version: 99, updatedAt: tick() } as unknown as AppState;
    await desktop.loop.resolve('mine');
    expect(desktop.status.kind).toBe('error');
    expect(gist.data!.version).toBe(99);
    expect(names(desktop.state)).toEqual(['Scorpion', 'Kitana']);
  });

  it('overwrites data from an outdated build, stamped so the other device takes it once updated', async () => {
    const { gist, phone, desktop } = await pair();
    // The desktop, still on an old build, pushes data saved as version 2.
    desktop.edit((s) => s.cards.push(card('Kitana')));
    gist.data = { ...structuredClone(desktop.state), version: 2 } as unknown as AppState;
    await phone.loop.syncNow();
    expect(phone.status.kind).toBe('error');
    expect(names(gist.data)).toEqual(['Scorpion']);
    expect(gist.data!.updatedAt!).toBeGreaterThan(desktop.state.updatedAt!);
  });

  it('a device whose save couldn’t be read downloads the gist’s copy on its first sync', async () => {
    const { gist } = await pair();
    // What load() leaves behind: fresh data with no stamp, and nothing agreed with the gist.
    const laptop = device(gist, defaultState(), { token: 'token', gistId: 'g1', baseUpdatedAt: 0 });
    const writes = gist.writes;
    await laptop.loop.syncNow();
    expect(laptop.status.kind).toBe('idle');
    expect(names(laptop.state)).toEqual(['Scorpion']);
    expect(gist.writes).toBe(writes);
    expect(laptop.pushes).toBe(0);
  });

  it('neither asks nor pushes while this build can’t read the gist’s copy', async () => {
    const { gist } = await pair();
    const laptop = device(gist, defaultState(), { token: 'token', gistId: 'g1', baseUpdatedAt: 0 });
    laptop.readable = () => false;
    await laptop.loop.syncNow();
    expect(laptop.status).toEqual({ kind: 'error', message: expect.stringContaining('can’t read') });
    // An edit on the fresh data would otherwise make this a conflict, where Keep mine uploads the fresh data.
    laptop.edit((s) => (s.currencies[0].balance = 500));
    const writes = gist.writes;
    await laptop.loop.syncNow();
    expect(laptop.status.kind).toBe('error');
    expect(gist.writes).toBe(writes);
    expect(names(gist.data)).toEqual(['Scorpion']);
    // Once an update can read it, the user is asked as usual.
    laptop.readable = () => true;
    await laptop.loop.syncNow();
    expect(laptop.status.kind).toBe('conflict');
  });

  it('keeping the other copy shows an error rather than getting stuck when it can’t be loaded', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('conflict');
    desktop.readable = () => false;
    await desktop.loop.resolve('theirs');
    expect(desktop.status.kind).toBe('error');
    expect(names(desktop.state)).toEqual(['Scorpion', 'Kitana']);
    expect(names(gist.data)).toEqual(['Scorpion', 'Raiden']);
    // The next sync runs again instead of returning early on a prompt that's gone.
    desktop.readable = () => true;
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('conflict');
  });
});
