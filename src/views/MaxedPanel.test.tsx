// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
import type { CatalogItem } from '../catalog';
import CardsView from './CardsView';

/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: ReturnType<typeof useStore>) => void }) {
  onRender(useStore());
  return null;
}

const item = (kind: CatalogItem['kind'], name: string, rarity: string): CatalogItem => ({ kind, name, rarity, slug: name, image: `${name}.webp` });
const ITEMS = [item('character', 'Scorpion MK2 Movie', 'diamond'), item('character', 'Sub-Zero MK1', 'diamond'), item('equipment', 'Kori Blade', 'epic')];

beforeEach(() => {
  // The catalog loads from the app's own catalog.json; the event schedule isn't needed here.
  vi.stubGlobal('fetch', (url: string) =>
    String(url).includes('catalog.json') ? Promise.resolve(new Response(JSON.stringify({ items: ITEMS }))) : Promise.reject(new Error('offline')),
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Cards: the Maxed page', () => {
  let update!: ReturnType<typeof useStore>['update'];
  let lastUndo: ReturnType<typeof useStore>['lastUndo'] = null;
  function renderMaxed(tweak: (s: ReturnType<typeof defaultState>) => void) {
    const s = defaultState();
    tweak(s);
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => ((update = store.update), (lastUndo = store.lastUndo))} />
          <CardsView sub="maxed" onSub={() => {}} />
        </PlanProvider>
      </StoreProvider>,
    );
    return vi.spyOn(SyncLoop.prototype, 'nextStamp');
  }
  const saved = () => JSON.parse(localStorage.getItem('mkmax:v1')!);

  // Value: protects=the Maxed page shows completion per rarity against MK Mobile Base's list, overall, and the record
  // with its dates; fails_when=a figure counts cards the catalog doesn't list under that rarity, or the list or dates
  // don't show; why_new=the Maxed page is new; seam=fetch stubbed with a small catalog; no_claim=the counting rules
  // (catalog.test.ts)
  it('shows completion and the maxed cards', async () => {
    renderMaxed((s) => (s.maxed = [{ name: 'Scorpion, MKII Movie', rarityId: 'diamond', at: '2026-10-18' }]));
    expect(await screen.findByText(/of every card MK Mobile Base lists: 1 of 3 maxed/)).not.toBeNull();
    expect(screen.getByText('50%')).not.toBeNull(); // Diamond: 1 of 2
    expect([screen.getByText('Scorpion, MKII Movie') != null, screen.queryByText('maxed 2026-10-18') != null]).toEqual([true, true]);
  });

  // Value: protects=Remove takes one card off the record with an Undo, and a tap on an entry a sync removed saves
  // nothing; fails_when=Remove takes the wrong entry or stamps a save for nothing; why_new=the Maxed page is new;
  // seam=the button's handler as the screen had it before the sync, a grabbed update stands in for the sync,
  // SyncLoop.nextStamp spied; no_claim=a real sync
  it('removes a card with Undo, and saves nothing for one a sync already removed', () => {
    const stamps = renderMaxed((s) => (s.maxed = [{ name: 'Kori Blade', rarityId: 'epic' }, { name: 'Sub-Zero, MK1', rarityId: 'diamond' }]));
    // Listed by rarity: Sub-Zero (Diamond) first, then Kori Blade (Epic).
    const [, kori] = screen.getAllByRole('button', { name: 'Remove' });
    const onClick = (kori as unknown as Record<string, { onClick: () => void }>)[Object.keys(kori).find((k) => k.startsWith('__reactProps$'))!].onClick;
    fireEvent.click(kori);
    expect([saved().maxed.map((m: { name: string }) => m.name), lastUndo?.label]).toEqual([['Sub-Zero, MK1'], 'Removed Kori Blade from Maxed']);
    stamps.mockClear();
    act(() => update((d) => void (d.maxed = [])));
    act(() => onClick());
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
  });

  // Value: protects=Paste maxed cards adds new ones once, skips cards still in the card list (not maxed) and ones already
  // on the record, with an Undo; fails_when=a card still being maxed is recorded as maxed, or one is doubled;
  // why_new=the Maxed page is new; seam=none; no_claim=the list format (cardList.test.ts)
  it('adds pasted maxed cards, skipping ones still in the list or already recorded', () => {
    renderMaxed((s) => {
      s.cards = [{ id: 'sz', name: 'Sub-Zero, MK1', rarityId: 'diamond', fusion: 4, guest: false }];
      s.maxed = [{ name: 'Scorpion, MKII Movie', rarityId: 'diamond' }];
    });
    fireEvent.click(screen.getByRole('button', { name: 'Paste maxed cards…' }));
    fireEvent.change(screen.getByLabelText('Maxed cards'), { target: { value: 'Sub-Zero MK1\nScorpion MK2 Movie\nKori Blade - Epic' } });
    expect([screen.queryByText('1 is already on Maxed.') != null, screen.queryByText(/Skipped 1 card that’s still in your card list/) != null]).toEqual([true, true]);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1' }));
    expect([saved().maxed.map((m: { name: string }) => m.name), lastUndo?.label]).toEqual([['Scorpion, MKII Movie', 'Kori Blade'], 'Added 1 to Maxed']);
  });
});
