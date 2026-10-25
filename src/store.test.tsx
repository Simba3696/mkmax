// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { noChange, StoreProvider, useStore } from './store';
import { SyncLoop } from './syncLoop';
import { defaultState } from './defaults';
import { NEWER_SAVE_MESSAGE } from './sync';

type Store = ReturnType<typeof useStore>;
/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: Store) => void }) {
  onRender(useStore());
  return null;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('update undo labels', () => {
  // Value: protects=a function undo label is read after the recipe, and an empty one leaves no Undo; fails_when=the label is
  // called before the recipe (wrong count) or '' still makes an Undo entry; why_new=no store test existed; seam=none;
  // no_claim=the Undo bar's look and timer (App); no sync token is set, so sync stays off
  it('works out a function label after the change and skips Undo when it comes back empty', () => {
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    let added = 0;
    act(() =>
      api().update(
        (d) => {
          d.dismissedShopPacks = ['A', 'B'];
          added = d.dismissedShopPacks.length;
        },
        () => (added ? `Hid ${added} packs` : ''),
      ),
    );
    expect(api().state.dismissedShopPacks).toEqual(['A', 'B']);
    expect(api().lastUndo?.label).toBe('Hid 2 packs');
    act(() => api().dismissUndo());

    // A change with nothing worth undoing still saves, but offers no Undo.
    act(() => api().update((d) => void (d.dismissedShopPacks = []), () => ''));
    expect(api().state.dismissedShopPacks).toEqual([]);
    expect(api().lastUndo).toBeNull();
  });

  // Generated on 2026-10-23 (/ship coverage audit, Tower dropdown)
  // Value: protects=a change carrying on from an Undo that's gone (alsoUndo) drops only its own label: a card it maxes and
  // removes still gets an Undo that brings it back, and one carrying on from the Undo showing names that change, its own
  // and the card maxed, and goes back to where that Undo did; fails_when=a carried
  // change whose Undo is gone also drops the maxed label, so a removed card has no Undo, or a joined label leaves out the
  // card it maxed; why_new=alsoUndo was only reached from Add card, whose adds never remove a card; seam=none;
  // no_claim=Add card's own use of it (CardsView tests)
  it('keeps the maxed label on a change that carries on from an Undo, showing or gone', () => {
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    const levels = () => api().state.cards.map((c) => `${c.name} ${c.fusion}`);
    act(() => void api().update((d) => void d.cards.push({ id: 'r', name: 'Raiden', rarityId: 'diamond', fusion: 0, guest: false }), 'added Raiden'));
    expect(api().lastUndo?.label).toBe('added Raiden');
    act(() => api().dismissUndo());
    act(() => void api().update((d) => void (d.cards[0].fusion = 11), 'Raiden to F10', { alsoUndo: true }));
    expect([levels(), api().lastUndo?.label]).toEqual([[], 'Raiden is maxed and removed']);
    act(() => api().undo());
    expect(levels()).toEqual(['Raiden 0']);

    act(() => void api().update((d) => void d.cards.push({ id: 's', name: 'Scorpion', rarityId: 'diamond', fusion: 0, guest: false }), 'added Scorpion'));
    act(() => void api().update((d) => void (d.cards[0].fusion = 11), 'Raiden to F10', { alsoUndo: true }));
    expect([levels(), api().lastUndo?.label]).toEqual([['Scorpion 0'], 'Raiden to F10 · Raiden is maxed and removed · added Scorpion']);
    act(() => api().undo());
    expect(levels()).toEqual(['Raiden 0']);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3, state machines)
  // Value: protects=an Undo for a card a change maxed and removed, and one for a change whose first steps were saved
  // without Undo (a Tower box's typing, then its re-spell), both leave the data as it is when dismissed or dropped by a
  // replace: the card stays removed (and on the Maxed record), the re-spell stays, and a later Undo does nothing;
  // fails_when=dismissing or a sync puts back the state from before, or an Undo after the replace restores it;
  // why_new=review (state machines): these two kinds were only checked with Undo itself; seam=replace stands in for a
  // sync; no_claim=the Undo bar's look and timer (App)
  it('keeps a maxed removal and a re-spell when their Undo is dismissed or a replace drops it', () => {
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    const cards = () => api().state.cards.map((c) => `${c.name} ${c.sourceNote ?? ''}`.trim());
    const tower = (id: string, name: string, sourceNote: string) => ({ id, name, rarityId: 'epic', fusion: 1, guest: false, source: 'tower' as const, sourceNote });
    const maxRaiden = () => {
      act(() => void api().update((d) => void d.cards.push({ id: 'r', name: 'Raiden', rarityId: 'diamond', fusion: 0, guest: false })));
      act(() => void api().update((d) => void (d.cards.find((c) => c.id === 'r')!.fusion = 11), 'Raiden to F10'));
      expect(api().lastUndo?.label).toBe('Raiden to F10 · Raiden is maxed and removed');
    };
    const respell = () => {
      act(() => void api().update((d) => void d.cards.push(tower('a', 'Kori Blade', 'Lin Kuei Tower'), tower('b', 'Kitana Fan', 'Lin Kuei Tower'))));
      // The box saved its own card as typed, then its finish re-spells the other, with an Undo back to before the typing.
      act(() => void api().update((d) => void (d.cards.find((c) => c.id === 'a')!.sourceNote = 'Lin kuei Tower')));
      act(() =>
        void api().update((d) => void (d.cards.find((c) => c.id === 'b')!.sourceNote = 'Lin kuei Tower'), 'Fixed the spelling', {
          undoFrom: (prev) => void (prev.cards.find((c) => c.id === 'a')!.sourceNote = 'Lin Kuei Tower'),
        }),
      );
      expect(api().lastUndo?.label).toBe('Fixed the spelling');
    };

    maxRaiden();
    act(() => api().dismissUndo());
    expect([cards(), api().state.maxed?.map((m) => m.name), api().lastUndo]).toEqual([[], ['Raiden'], null]);
    respell();
    act(() => api().dismissUndo());
    act(() => api().undo());
    expect(cards()).toEqual(['Kori Blade Lin kuei Tower', 'Kitana Fan Lin kuei Tower']);

    act(() => api().replace(defaultState()));
    maxRaiden();
    const kept = { ...defaultState(), cards: [tower('s', 'Shadow Sash', 'Thunder Tower')] };
    act(() => api().replace(kept));
    act(() => api().undo());
    expect(cards()).toEqual(['Shadow Sash Thunder Tower']);
    respell();
    act(() => api().replace(kept));
    act(() => api().undo());
    expect([cards(), api().lastUndo]).toEqual([['Shadow Sash Thunder Tower'], null]);
  });

  // Generated on 2026-10-25 (/ship review, run 16, state machines)
  // Value: protects=an Undo another change joined (alsoUndo, as Add card's Add does) leaves both changes as they are when
  // dismissed or dropped by a replace, a later Undo does nothing, and the next joining change gets no Undo of its own;
  // fails_when=dismissing or a sync puts back the older state the joined entry goes back to, or a later change joins a
  // gone entry; why_new=review (state machines): joined entries were only checked with Undo itself; seam=replace stands
  // in for a sync; no_claim=the Undo bar's look and timer (App)
  it('keeps both changes when a joined Undo is dismissed or a replace drops it', () => {
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    const names = () => api().state.cards.map((c) => c.name);
    const add = (id: string, name: string, label: string, opts?: { alsoUndo: boolean }) =>
      act(() => void api().update((d) => void d.cards.push({ id, name, rarityId: 'diamond', fusion: 0, guest: false }), label, opts));

    add('r', 'Raiden', 'added Raiden');
    add('s', 'Scorpion', 'added Scorpion', { alsoUndo: true });
    expect(api().lastUndo?.label).toBe('added Scorpion · added Raiden');
    act(() => api().dismissUndo());
    act(() => api().undo());
    add('k', 'Kitana', 'added Kitana', { alsoUndo: true });
    expect([names(), api().lastUndo]).toEqual([['Raiden', 'Scorpion', 'Kitana'], null]);

    add('j', 'Jax', 'added Jax');
    add('l', 'Liu Kang', 'added Liu Kang', { alsoUndo: true });
    const joined = api().lastUndo!;
    act(() => api().replace({ ...defaultState(), cards: [{ id: 'm', name: 'Mileena', rarityId: 'diamond', fusion: 0, guest: false }] }));
    act(() => api().undo(joined));
    act(() => api().undo());
    expect([names(), api().lastUndo]).toEqual([['Mileena'], null]);
  });

  // Generated on 2026-10-23 (/ship review, Red Team, Tower dropdown)
  // Value: protects=once the save is replaced (Import, or a sync bringing in another device's data), the Undo from before
  // can't be used in the same moment, before the screen updates: a change carrying on from it gets no Undo of its own,
  // and Undo of it does nothing; fails_when=the Undo is only dropped at the next render, so Undo or a joined change puts
  // back a copy from before the replace, wiping what it brought in; why_new=review (Red Team); seam=none; no_claim=a
  // real sync pull (replace stands in for it; both clear the Undo the same way)
  it('lets nothing use an Undo from before a replace, even before the screen updates', () => {
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    const names = () => api().state.cards.map((c) => c.name);
    const raiden = { id: 'r', name: 'Raiden', rarityId: 'diamond', fusion: 0, guest: false };
    act(() => void api().update((d) => void d.cards.push(raiden), 'added Raiden'));
    const before = api().lastUndo!;
    const replaced = { ...defaultState(), cards: [{ ...raiden, id: 's', name: 'Scorpion' }] };
    // All in one go, as a tap landing between a sync's data and its render: the store from before the replace is used.
    const { update, undo, replace } = api();
    act(() => {
      replace(replaced);
      update((d) => void d.cards.push({ ...raiden, id: 'k', name: 'Kitana' }), 'added Kitana', { alsoUndo: true });
      undo(before);
      undo();
    });
    expect([names(), api().lastUndo]).toEqual([['Scorpion', 'Kitana'], null]);
  });

  // Generated on 2026-10-23 (/ship coverage audit, Tower dropdown)
  // Value: protects=once a sync brings in another device's changes, the Undo from before can't be used in the same
  // moment, before the screen updates: Undo of it does nothing and a change carrying on from it gets no Undo of its own;
  // fails_when=a sync clears the Undo only at the next render (or not at all), so Undo puts back the copy from before and
  // the next push overwrites the other device's changes; why_new=only replace was driven, and syncLoop tests stub the
  // store's side; seam=fetch answers as the gist (a push, then another device's newer copy for the pull), fake timers
  // run the push; no_claim=GitHub itself
  it("lets nothing use an Undo from before a sync's changes, even before the screen updates", async () => {
    // Sync is on here, so each change schedules a push: fake timers say when it runs.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => void vi.useRealTimers());
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    // The gist's copy: what a pull downloads, and what a push writes.
    let gist = { ...defaultState(), updatedAt: 5000 };
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') gist = JSON.parse(JSON.parse(init.body as string).files['mkmax-data.json'].content);
      return new Response(JSON.stringify({ id: 'g1', description: null, files: { 'mkmax-data.json': { content: JSON.stringify(gist), raw_url: '' } } }));
    });
    onTestFinished(() => void vi.unstubAllGlobals());
    const raiden = { id: 'r', name: 'Raiden', rarityId: 'diamond', fusion: 0, guest: false };
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    const names = () => api().state.cards.map((c) => c.name);
    // Each act lets the download's promises run and the status it sets render.
    const settled = async () => {
      for (let i = 0; i < 20 && api().sync.status.kind !== 'idle'; i++) await act(async () => {});
      expect(api().sync.status.kind).toBe('idle');
    };
    await settled();
    // The change is pushed, as it is a moment after it's made, while its Undo is still up.
    act(() => void api().update((d) => void d.cards.push(raiden), 'added Raiden'));
    const before = api().lastUndo!;
    await act(() => vi.advanceTimersByTimeAsync(1500));
    await settled();
    expect(gist.cards.map((c) => c.name)).toEqual(['Raiden']);
    // Then another device changes the gist, and the next pull brings that in; a tap lands in the same moment.
    gist = { ...gist, cards: [{ ...raiden, id: 's', name: 'Scorpion' }], updatedAt: gist.updatedAt! + 1 };
    const { update, undo, sync } = api();
    await act(async () => {
      await sync.syncNow();
      update((d) => void d.cards.push({ ...raiden, id: 'k', name: 'Kitana' }), 'added Kitana', { alsoUndo: true });
      undo(before);
      undo();
    });
    expect([names(), api().lastUndo]).toEqual([['Scorpion', 'Kitana'], null]);
  });

  // Value: protects=a recipe that finds nothing to change saves, stamps and offers Undo for nothing; fails_when=update
  // ignores the recipe's noChange and stamps updatedAt (making this device's copy look newest to sync); why_new=recipes
  // couldn't call off a change before; seam=none; no_claim=the sync push timer (no sync token is set)
  it('leaves the save untouched when the recipe returns noChange', () => {
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    act(() => api().update((d) => void (d.dismissedShopPacks = ['A'])));
    const before = api().state;
    const saved = localStorage.getItem('mkmax:v1');
    act(() =>
      api().update((d) => {
        d.dismissedShopPacks = ['B'];
        return noChange;
      }, 'Hid B'),
    );
    expect(api().state).toBe(before);
    expect(localStorage.getItem('mkmax:v1')).toBe(saved);
    expect(api().lastUndo).toBeNull();
    // A one-line recipe hands back whatever it assigns. Only noChange calls a change off, so the type refuses a stray
    // value, like a setting switched off with `(d) => (d.on = false)`, instead of it silently dropping the change.
    // @ts-expect-error a recipe returns nothing or noChange
    const stray: Parameters<Store['update']>[0] = (d) => (d.updatedAt = 0);
    void stray;
  });

  // Generated by /ship TODO fix on 2026-10-19
  // Value: protects=with a save from a newer version, taps, imports and the sync buttons change nothing and sync never
  // runs, with the reason shown as the sync status; fails_when=an update saves the older reading, or a pull or push runs
  // and sends it to the gist; why_new=TODOS.md P2 (older copy of the app on the same device); seam=SyncLoop.syncNow and
  // connect spied; no_claim=the banner (App.test.tsx)
  it('changes, saves and syncs nothing while the save is from a newer version', async () => {
    const raw = JSON.stringify({ ...defaultState(), version: 99, maxed: [{ name: 'Kori Blade', rarityId: 'epic' }], updatedAt: 7000 });
    localStorage.setItem('mkmax:v1', raw);
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    const pull = vi.spyOn(SyncLoop.prototype, 'syncNow').mockResolvedValue();
    const connect = vi.spyOn(SyncLoop.prototype, 'connect').mockResolvedValue(true);
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    act(() => api().update((d) => void (d.dismissedShopPacks = ['A']), 'Hid A'));
    act(() => api().replace(defaultState()));
    await act(() => api().sync.syncNow());
    await act(() => api().sync.connect('t2'));
    expect([api().newerSave, api().state.maxed, api().lastUndo, localStorage.getItem('mkmax:v1'), pull.mock.calls.length, connect.mock.calls.length]).toEqual([
      true,
      [{ name: 'Kori Blade', rarityId: 'epic' }],
      null,
      raw,
      0,
      0,
    ]);
    expect(api().sync.status).toEqual({ kind: 'error', message: NEWER_SAVE_MESSAGE });
  });

  // Generated by /ship TODO fix on 2026-10-19
  // Value: protects=a tab already open when another tab saves data from a newer version stops changing, saving and
  // syncing from then on, and drops its Undo; fails_when=only load() holds, so the open tab's next tap saves its older
  // reading over the newer data; why_new=review of the TODOS.md P2 fix; seam=a StorageEvent dispatched by hand stands in
  // for the other tab, SyncLoop.syncNow spied; no_claim=a real second tab
  it('holds once another tab saves data from a newer version', () => {
    // Extended by /ship test coverage audit on 2026-10-19 (fake timers and the push check at the end)
    // Value: protects=a push already scheduled by a tap before the other tab's newer save never runs; fails_when=the
    // listener doesn't cancel the push timer, so 1.5 s later the older reading is sent to the gist; why_new=the test read
    // the store before the push delay ran out; seam=none; no_claim=the push itself (SyncLoop.syncNow spied)
    // Extended by /ship review on 2026-10-25 (run 19, state machines): a replace (Import backup, Load sample data, Erase
    // everything) during the hold changes, saves and pushes nothing either
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    const pull = vi.spyOn(SyncLoop.prototype, 'syncNow').mockResolvedValue();
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    const api = () => latest!;
    act(() => api().update((d) => void (d.dismissedShopPacks = ['A']), 'Hid A'));
    const newer = JSON.stringify({ ...defaultState(), version: 99 });
    localStorage.setItem('mkmax:v1', newer);
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'mkmax:v1', newValue: newer })));
    pull.mockClear();
    act(() => api().update((d) => void (d.dismissedShopPacks = ['A', 'B']), 'Hid B'));
    act(() => api().undo());
    act(() => api().replace(defaultState()));
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(5000));
    expect([api().newerSave, api().lastUndo, api().state.dismissedShopPacks, localStorage.getItem('mkmax:v1'), pull.mock.calls.length]).toEqual([
      true,
      null,
      ['A'],
      newer,
      0,
    ]);
    expect(api().sync.status).toEqual({ kind: 'error', message: NEWER_SAVE_MESSAGE });
  });

  // Generated on 2026-10-25 (/ship review, run 16 pass 3, data migration); changed by /ship review on 2026-10-25
  // (run 17): the loop now stops such a sync, and the test checks GitHub really answered it
  // Value: protects=a sync already out when another tab first saves data from a newer version stops once GitHub
  // answers: it neither applies the gist's copy nor saves an agreed stamp, and the held notice stays; fails_when=the
  // shared sync settings say this browser has the gist's copy while its save doesn't, so the newer version's tab,
  // reopened, never pulls it, or the screen swaps to the gist's copy behind the hold; why_new=review (data migration,
  // Red Team); seam=fetch answers as the gist, held open by hand; no_claim=GitHub itself
  it('stops a sync that lands after another tab saved a newer version', async () => {
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), updatedAt: 5000 }));
    let answer: (() => void) | undefined;
    const theirs = { ...defaultState(), updatedAt: 9000, cards: [{ id: 'r', name: 'Raiden', rarityId: 'diamond', fusion: 1, guest: false }] };
    vi.stubGlobal('fetch', () =>
      new Promise<Response>((r) => (answer = () => r(new Response(JSON.stringify({ id: 'g1', description: null, files: { 'mkmax-data.json': { content: JSON.stringify(theirs), raw_url: '' } } }))))),
    );
    onTestFinished(() => void vi.unstubAllGlobals());
    let latest: Store | undefined;
    render(
      <StoreProvider>
        <Grab onRender={(store) => (latest = store)} />
      </StoreProvider>,
    );
    // The sync on opening is out; the other tab saves a newer version's data meanwhile.
    expect(answer).toBeDefined();
    const newer = JSON.stringify({ ...defaultState(), version: 99 });
    localStorage.setItem('mkmax:v1', newer);
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'mkmax:v1', newValue: newer })));
    await act(async () => {
      answer!();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect([
      JSON.parse(localStorage.getItem('mkmax:sync')!).baseUpdatedAt,
      localStorage.getItem('mkmax:v1'),
      latest!.state.cards.map((c) => c.name),
      latest!.sync.status,
    ]).toEqual([5000, newer, [], { kind: 'error', message: NEWER_SAVE_MESSAGE }]);
  });

  // Value: protects=a page restored from the back-forward cache downloads synced changes, as a return to the app does;
  // fails_when=only visibilitychange starts a pull, or the first load's pageshow pulls again; why_new=review (Red Team);
  // seam=SyncLoop.syncNow spied; no_claim=the download itself (syncLoop tests)
  it('pulls synced changes on a back-forward restore, but not on the first load', () => {
    const sync = vi.spyOn(SyncLoop.prototype, 'syncNow').mockResolvedValue();
    render(
      <StoreProvider>
        <Grab onRender={() => {}} />
      </StoreProvider>,
    );
    sync.mockClear();
    const restore = (persisted: boolean) => act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted })));
    restore(false);
    expect(sync).not.toHaveBeenCalled();
    restore(true);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
