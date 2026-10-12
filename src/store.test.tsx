// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { StoreProvider, useStore } from './store';

type Store = ReturnType<typeof useStore>;
/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: Store) => void }) {
  onRender(useStore());
  return null;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
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
});
