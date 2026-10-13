// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
import CardsView from './CardsView';

/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: ReturnType<typeof useStore>) => void }) {
  onRender(useStore());
  return null;
}

beforeEach(() => {
  // The event schedule isn't needed here; keep the test off the network.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Cards: Fusion Up Kards', () => {
  // Value: protects=Use N kards fuses one step, and a tap with too few kards left saves nothing; fails_when=the button's
  // noChange check is flipped (no tap ever fuses) or dropped (a tap that does nothing still stamps the save); why_new=
  // review (testing: only the Plan's copy of this line was tested); seam=SyncLoop.nextStamp spied to count saves;
  // no_claim=the Plan's button (PlanView.test.tsx)
  it('fuses once with Use N kards, and a second tap with no kards left saves nothing', () => {
    const s = defaultState();
    s.rarities.find((r) => r.id === 'diamond')!.fusionUpKards = 1;
    s.cards = [{ id: 'scorpion', name: 'Scorpion', rarityId: 'diamond', fusion: 4, guest: false }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <CardsView sub="cards" onSub={() => {}} />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const use = screen.getByRole('button', { name: 'Use 1 kard' });
    // Both taps land before React draws again, so the second still shows the kard the first used.
    act(() => {
      use.click();
      use.click();
    });
    const saved = JSON.parse(localStorage.getItem('mkmax:v1')!);
    expect(saved.cards[0].fusion).toBe(5);
    expect(saved.rarities.find((r: { id: string }) => r.id === 'diamond').fusionUpKards).toBe(0);
    expect(stamps).toHaveBeenCalledTimes(1);
  });
});

describe('Cards: taps on a screen a sync has changed', () => {
  let update!: ReturnType<typeof useStore>['update'];
  function renderCards(fusion: number, kards: number) {
    const s = defaultState();
    s.rarities.find((r) => r.id === 'diamond')!.fusionUpKards = kards;
    s.cards = [{ id: 'scorpion', name: 'Scorpion', rarityId: 'diamond', fusion, guest: false }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <CardsView sub="cards" onSub={() => {}} />
        </PlanProvider>
      </StoreProvider>,
    );
    return vi.spyOn(SyncLoop.prototype, 'nextStamp');
  }
  const saved = () => JSON.parse(localStorage.getItem('mkmax:v1')!);

  // Regression: /ship review of clock-and-gear-taps — a fuse tap after a sync used a different step than the button showed
  // Found by /ship on 2026-10-13
  // Value: protects=Use N kards fuses nothing when a sync moved the card to a step that costs more; fails_when=the button
  // doesn't pass the cost it showed, so a dearer step is fused and the Undo label gives the wrong count; why_new=review
  // (Red Team); seam=SyncLoop.nextStamp spied, a grabbed update stands in for the sync; no_claim=a real sync
  it('fuses nothing when a sync moved the card to a dearer step', () => {
    const stamps = renderCards(4, 1);
    const use = screen.getByRole('button', { name: 'Use 1 kard' });
    act(() => {
      update((d) => {
        d.cards[0].fusion = 5;
        d.rarities.find((r) => r.id === 'diamond')!.fusionUpKards = 5;
      });
      use.click();
    });
    expect([saved().cards[0].fusion, saved().rarities.find((r: { id: string }) => r.id === 'diamond').fusionUpKards]).toEqual([5, 5]);
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Value: protects=Delete on a card a sync removed saves nothing and offers no Undo; fails_when=the filter that finds
  // nothing still stamps the save; why_new=review (Red Team); seam=SyncLoop.nextStamp spied, a grabbed update stands in
  // for the sync; no_claim=the other edits on the card, which use the same check
  it('saves nothing for Delete on a card a sync removed', () => {
    const stamps = renderCards(4, 0);
    act(() => screen.getByRole('button', { name: 'Delete' }).click());
    stamps.mockClear();
    const confirm = screen.getByRole('button', { name: 'Tap again to confirm' });
    act(() => {
      update((d) => void (d.cards = []));
      confirm.click();
    });
    expect(stamps).toHaveBeenCalledTimes(1);
  });
});
