// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { noChange, StoreProvider, useStore } from './store';
import { SyncLoop } from './syncLoop';

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
