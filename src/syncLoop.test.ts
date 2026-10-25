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
  /** Which requests to hold open until release(); finds are Connect's lookup. */
  holding: 'reads' | 'writes' | 'finds' | null = null;

  /** A request held open fails if `fail` is set by the time it's released. */
  async gate(kind: 'reads' | 'writes' | 'finds') {
    if (this.holding === kind) await new Promise<void>((r) => this.held.push(r));
    if (this.fail) throw this.fail;
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
    /** How many times it looked for a new version of the app. */
    lookedForUpdate: 0,
    /** Another tab saved data from a newer version (the store holds the save then). */
    held: false,
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
        await gist.gate('finds');
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
      lookForUpdate: () => void d.lookedForUpdate++,
      held: () => d.held,
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

  // Generated on 2026-10-25 (/ship review, run 16 pass 3, state machines)
  // Value: protects=Keep mine on a gist copy this build can't read uploads nothing, leaves both copies as they are, says
  // so and looks for a new version once, and asks again once a build can read it; fails_when=Keep mine uploads this
  // device's copy over data it can't read, or never asks again; why_new=review (state machines): only Keep theirs was
  // tested with an unreadable copy; seam=the device's readable switch stands in for normalize; no_claim=none
  it('keeping this device’s copy uploads nothing and looks for a new version when the gist can’t be read', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    const writes = gist.writes;
    desktop.readable = () => false;
    await desktop.loop.resolve('mine');
    expect([desktop.status.kind, desktop.lookedForUpdate, gist.writes]).toEqual(['error', 1, writes]);
    expect([names(desktop.state), names(gist.data)]).toEqual([['Scorpion', 'Kitana'], ['Scorpion', 'Raiden']]);
    desktop.readable = () => true;
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('conflict');
  });

  // Generated on 2026-10-25 (/ship review, run 17, Red Team)
  // Value: protects=a sync already waiting on GitHub when another tab saves data from a newer version writes, applies
  // and reports nothing once GitHub answers, whether it was about to push or pull; fails_when=it pushes this tab's older
  // reading (dropping fields this build doesn't know) or swaps the screen to the gist's copy behind the hold;
  // why_new=review (Red Team): only syncs started after the hold were stopped; seam=the fake gist holds the read open,
  // the device's held switch stands in for the store's hold; no_claim=GitHub
  it('stops a sync already out when another tab saves data from a newer version', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    const writes = gist.writes;
    const agreed = phone.loop.config?.baseUpdatedAt;
    gist.holding = 'reads';
    const pushing = phone.loop.syncNow();
    await settle();
    phone.held = true;
    await gist.release();
    await pushing;
    expect([gist.writes, names(gist.data), phone.loop.config?.baseUpdatedAt]).toEqual([writes, ['Scorpion'], agreed]);

    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    const before = structuredClone(phone.state);
    phone.held = false;
    gist.holding = 'reads';
    const pulling = phone.loop.syncNow();
    await settle();
    phone.held = true;
    await gist.release();
    await pulling;
    expect(phone.state).toEqual(before);
  });

  // Generated on 2026-10-25 (/ship review, run 17 pass 2, state machines and testing)
  // Value: protects=once another tab saves data from a newer version, an upload already out (a push, an outdated
  // overwrite, a Keep mine) or a Keep mine's read saves no agreed stamp and puts no status over the held notice, and a
  // request that fails reports no error over it; fails_when=any of those checks goes back to only checking for
  // Disconnect, so the held tab marks its older reading agreed or shows "synced" or a network error instead of the
  // notice; why_new=review: only the first read of a sync had a test; seam=the fake gist holds requests open, the
  // device's held switch and a status set by hand stand in for the store's hold; no_claim=GitHub
  it('stops an upload, a Keep mine or a failed request already out when another tab saves data from a newer version', async () => {
    const notice: SyncStatus = { kind: 'error', message: 'held' };
    const holdDuring = async (kind: 'reads' | 'writes', d: ReturnType<typeof device>, gist: FakeGist, run: () => Promise<void>, fail?: Error) => {
      gist.holding = kind;
      const writes = gist.writes;
      const out = run();
      await settle();
      // Still out, so the hold lands while it waits.
      expect([d.status.kind, gist.writes]).toEqual(['syncing', writes]);
      d.held = true;
      d.status = notice;
      if (fail) gist.fail = fail;
      await gist.release();
      await out;
    };
    const conflicted = async () => {
      const p = await pair();
      p.phone.edit((s) => s.cards.push(card('Raiden')));
      await p.phone.loop.syncNow();
      p.desktop.edit((s) => s.cards.push(card('Kitana')));
      await p.desktop.loop.syncNow();
      expect(p.desktop.status.kind).toBe('conflict');
      return p;
    };

    const push = await pair();
    push.phone.edit((s) => s.cards.push(card('Raiden')));
    let agreed = push.phone.loop.config?.baseUpdatedAt;
    await holdDuring('writes', push.phone, push.gist, () => push.phone.loop.syncNow());
    expect([push.phone.loop.config?.baseUpdatedAt, push.phone.status]).toEqual([agreed, notice]);

    const outdated = await pair();
    outdated.gist.data = { ...structuredClone(outdated.desktop.state), version: 2 } as unknown as AppState;
    agreed = outdated.phone.loop.config?.baseUpdatedAt;
    await holdDuring('writes', outdated.phone, outdated.gist, () => outdated.phone.loop.syncNow());
    expect([outdated.phone.loop.config?.baseUpdatedAt, outdated.phone.status]).toEqual([agreed, notice]);

    const failed = await pair();
    await holdDuring('reads', failed.phone, failed.gist, () => failed.phone.loop.syncNow(), new TypeError('Failed to fetch'));
    expect(failed.phone.status).toEqual(notice);

    for (const kind of ['reads', 'writes'] as const) {
      const { gist, desktop } = await conflicted();
      const writes = gist.writes;
      agreed = desktop.loop.config?.baseUpdatedAt;
      await holdDuring(kind, desktop, gist, () => desktop.loop.resolve('mine'));
      expect([gist.writes - writes, desktop.loop.config?.baseUpdatedAt, desktop.status]).toEqual([kind === 'reads' ? 0 : 1, agreed, notice]);
    }
    const keep = await conflicted();
    await holdDuring('reads', keep.desktop, keep.gist, () => keep.desktop.loop.resolve('mine'), new TypeError('Failed to fetch'));
    expect(keep.desktop.status).toEqual(notice);
  });

  // Generated on 2026-10-25 (/ship review, run 17 pass 2, state machines, testing, data migration and maintainability)
  // Value: protects=a Connect still waiting on GitHub when another tab saves data from a newer version saves no sync
  // settings and goes back to off, for a gist found or made; fails_when=it saves the settings (shared with the other
  // tab) and shows synced, or stays on Syncing for good; why_new=review: connect() had no check for the hold;
  // seam=the fake gist holds Connect's lookup open; no_claim=GitHub
  it('a Connect still waiting on GitHub when another tab saves data from a newer version saves nothing', async () => {
    for (const existing of [true, false, 'fails'] as const) {
      const gist = new FakeGist();
      if (existing) await device(gist).loop.connect('token');
      const laptop = device(gist);
      laptop.edit((s) => s.cards.push(card('Raiden')));
      gist.holding = 'finds';
      const connecting = laptop.loop.connect('token');
      await settle();
      expect(laptop.status.kind).toBe('syncing');
      laptop.held = true;
      if (existing === 'fails') gist.fail = new TypeError('Failed to fetch');
      await gist.release();
      expect([await connecting, laptop.loop.config, laptop.status]).toEqual([false, null, { kind: 'off' }]);
      gist.fail = null;
      // Once held, a Connect doesn't start at all: it doesn't wait on GitHub (held open here) or show Syncing.
      gist.holding = 'finds';
      const again = laptop.loop.connect('token');
      await settle();
      expect([await Promise.race([again, Promise.resolve('waiting')]), laptop.status]).toEqual([false, { kind: 'off' }]);
      await gist.release();
      laptop.held = false;
      expect(await laptop.loop.connect('token')).toBe(true);
    }
  });

  // Generated on 2026-10-25 (/ship review, run 18, state machines)
  // Value: protects=a Connect that has found its gist is connected even if another tab saves data from a newer version
  // during its first sync: that sync then pulls, pushes and agrees nothing, and the store shows the held notice;
  // fails_when=the first sync goes ahead behind the hold, or Connect claims it didn't connect after saving the settings
  // (Settings would keep a token that is in use); why_new=review: the hold during Connect's first sync had no test;
  // seam=the fake gist holds the first sync's read; no_claim=the store's notice (store.test.tsx)
  it('a Connect whose first sync is out when another tab saves a newer version is connected, and that sync stops', async () => {
    const gist = new FakeGist();
    const phone = device(gist);
    phone.edit((s) => s.cards.push(card('Scorpion')));
    await phone.loop.connect('token');
    const laptop = device(gist);
    laptop.edit((s) => s.cards.push(card('Raiden')));
    const [before, writes] = [structuredClone(laptop.state), gist.writes];
    gist.holding = 'reads';
    const connecting = laptop.loop.connect('token');
    await settle();
    laptop.held = true;
    await gist.release();
    expect([await connecting, laptop.loop.config?.baseUpdatedAt, laptop.state, gist.writes]).toEqual([true, 0, before, writes]);
  });

  // Generated on 2026-10-25 (/ship review, run 17 pass 2, data migration)
  // Value: protects=a tab held by another tab's newer save starts no sync and no Keep mine or theirs, so it never shows
  // Syncing over the held notice or changes data; fails_when=a regular pull or a prompt button gets past the hold;
  // why_new=review: syncNow and resolve reported Syncing before looking at the hold; seam=the device's held switch;
  // no_claim=the store's own pause of its buttons
  it('a tab held by a newer save starts no sync and no Keep mine or theirs', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    const notice: SyncStatus = { kind: 'error', message: 'held' };
    for (const d of [phone, desktop]) [d.held, d.status] = [true, notice];
    const [reads, writes, before] = [gist.reads, gist.writes, structuredClone(desktop.state)];
    phone.edit((s) => s.cards.push(card('Jax')));
    await phone.loop.syncNow();
    await desktop.loop.syncNow();
    await desktop.loop.resolve('mine');
    await desktop.loop.resolve('theirs');
    expect([gist.reads, gist.writes, desktop.state, desktop.status, phone.status]).toEqual([reads, writes, before, notice, notice]);
    desktop.held = false;
    await desktop.loop.resolve('theirs');
    expect(names(desktop.state)).toEqual(['Scorpion', 'Raiden']);
  });

  // Generated on 2026-10-25 (/ship review, run 17, state machines); extended by /ship review on 2026-10-25 (run 18,
  // state machines) with a gist copy this build can't read
  // Value: protects=Keep theirs takes the copy the prompt showed even if the gist moved on, a newer build pushed or a
  // copy this build can't read arrived since, and the next sync then pulls the later copy without asking, or waits and
  // looks for the update; fails_when=Keep
  // theirs asks again, pushes, or skips the later copy; why_new=review (state machines): only an unchanged gist was tested;
  // seam=none; no_claim=GitHub
  it('keeping the other copy after the gist changed takes the shown copy, then syncs as usual', async () => {
    let { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    phone.edit((s) => s.cards.push(card('Jade')));
    await phone.loop.syncNow();
    await desktop.loop.resolve('theirs');
    expect(names(desktop.state)).toEqual(['Scorpion', 'Raiden']);
    await desktop.loop.syncNow();
    expect([desktop.status.kind, names(desktop.state)]).toEqual(['idle', ['Scorpion', 'Raiden', 'Jade']]);

    ({ gist, phone, desktop } = await pair());
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    gist.data = { ...structuredClone(gist.data!), version: 99, updatedAt: tick() } as unknown as AppState;
    await desktop.loop.resolve('theirs');
    expect(names(desktop.state)).toEqual(['Scorpion', 'Raiden']);
    await desktop.loop.syncNow();
    expect([desktop.status.kind, gist.data!.version, desktop.pushes, desktop.lookedForUpdate]).toEqual(['error', 99, 0, 1]);

    // The gist moved on to a copy this build can't read: Keep theirs still takes the copy shown, and the next sync
    // waits for an update rather than pushing over it or asking again.
    ({ gist, phone, desktop } = await pair());
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    phone.edit((s) => s.cards.push(card('Unreadable')));
    await phone.loop.syncNow();
    desktop.readable = (s) => !names(s).includes('Unreadable');
    await desktop.loop.resolve('theirs');
    const writes = gist.writes;
    expect([names(desktop.state), desktop.loop.config?.baseUpdatedAt]).toEqual([['Scorpion', 'Raiden'], desktop.state.updatedAt]);
    await desktop.loop.syncNow();
    expect([desktop.status.kind, gist.writes - writes, desktop.pushes, desktop.lookedForUpdate]).toEqual(['error', 0, 0, 1]);
  });

  // Generated on 2026-10-25 (/ship review, run 17, state machines)
  // Value: protects=Disconnect with the which-copy prompt up drops the prompt and the connection and changes neither copy,
  // also when the gist moved on meanwhile; fails_when=Disconnect keeps the prompt or writes a copy on the way out;
  // why_new=review (state machines): Disconnect was never tested with the prompt up; seam=none; no_claim=GitHub
  it('Disconnect with the which-copy prompt up drops it and changes no data', async () => {
    const { gist, phone, desktop } = await pair();
    phone.edit((s) => s.cards.push(card('Raiden')));
    await phone.loop.syncNow();
    desktop.edit((s) => s.cards.push(card('Kitana')));
    await desktop.loop.syncNow();
    phone.edit((s) => s.cards.push(card('Jade')));
    await phone.loop.syncNow();
    const writes = gist.writes;
    desktop.loop.disconnect();
    await desktop.loop.resolve('mine');
    expect([desktop.loop.config, desktop.status.kind, names(desktop.state), names(gist.data), gist.writes]).toEqual([
      null,
      'off',
      ['Scorpion', 'Kitana'],
      ['Scorpion', 'Raiden', 'Jade'],
      writes,
    ]);
  });

  it('neither pulls nor pushes data from a newer build, and looks for the new version', async () => {
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
    // Finding it only brings up the new-version bar, so nothing in progress is lost; a sync that found nothing newer
    // doesn't look.
    expect([phone.lookedForUpdate, desktop.lookedForUpdate]).toEqual([1, 0]);
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

  it('neither asks nor pushes while this build can’t read the gist’s copy, and looks for a new version', async () => {
    const { gist } = await pair();
    const laptop = device(gist, defaultState(), { token: 'token', gistId: 'g1', baseUpdatedAt: 0 });
    laptop.readable = () => false;
    await laptop.loop.syncNow();
    expect(laptop.status).toEqual({ kind: 'error', message: expect.stringContaining('can’t read') });
    // Usually a newer build wrote it, and the message says to tap Reload once one is found.
    expect(laptop.lookedForUpdate).toBe(1);
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
    expect([desktop.status.kind, desktop.lookedForUpdate]).toEqual(['error', 1]);
    expect(names(desktop.state)).toEqual(['Scorpion', 'Kitana']);
    expect(names(gist.data)).toEqual(['Scorpion', 'Raiden']);
    // The next sync runs again instead of returning early on a prompt that's gone.
    desktop.readable = () => true;
    await desktop.loop.syncNow();
    expect(desktop.status.kind).toBe('conflict');
  });
});
