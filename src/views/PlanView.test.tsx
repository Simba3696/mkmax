// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
import PlanView from './PlanView';

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

/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: ReturnType<typeof useStore>) => void }) {
  onRender(useStore());
  return null;
}

describe('Plan: Fusion Up Kards', () => {
  // Regression: review of clock-and-gear-taps — the fuse buttons' "nothing done" check had no screen test
  // Found by /review on 2026-10-13
  // Value: protects=Use N fuses one step, and a tap with too few kards left saves nothing; fails_when=the button's
  // noChange check is flipped (no tap ever fuses) or dropped (a tap that does nothing still stamps the save); why_new=
  // review (only the engine's return value was tested); seam=SyncLoop.nextStamp spied to count saves; no_claim=the
  // same line on Cards
  it('fuses once with Use N, and a second tap with no kards left saves nothing', () => {
    const s = defaultState();
    s.rarities.find((r) => r.id === 'diamond')!.fusionUpKards = 1;
    s.cards = [{ id: 'scorpion', name: 'Scorpion', rarityId: 'diamond', fusion: 4, guest: false }];
    s.packs = [{ id: 'p', name: 'Pack', currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [{ cardId: 'scorpion', chance: 50 }] }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <PlanView goto={() => {}} openPack={() => {}} />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const use = screen.getByRole('button', { name: 'Use 1' });
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

describe('Plan: Bought one', () => {
  // Value: protects=Bought one on a random pack logs one purchase, saves once and opens it in Packs to ask what was
  // pulled; fails_when=the button's noChange check is flipped (nothing is logged) or the pull step no longer opens after
  // a logged buy; why_new=review (testing: the buy now depends on a flag set inside the change); seam=SyncLoop.nextStamp
  // spied, openPack passed in; no_claim=store items, which level their card instead
  it('logs one purchase and opens the pack to ask what was pulled', () => {
    const s = defaultState();
    s.currencies.find((c) => c.id === 'souls')!.balance = 1000;
    s.cards = [{ id: 'scorpion', name: 'Scorpion', rarityId: 'diamond', fusion: 4, guest: false }];
    s.packs = [{ id: 'p', name: 'Pack', currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [{ cardId: 'scorpion', chance: 50 }] }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    const openPack = vi.fn();
    render(
      <StoreProvider>
        <PlanProvider>
          <PlanView goto={() => {}} openPack={openPack} />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    act(() => screen.getAllByRole('button', { name: 'Bought one' })[0].click());
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).packs[0].purchased).toBe(1);
    expect(stamps).toHaveBeenCalledTimes(1);
    expect(openPack).toHaveBeenCalledWith('p', true);
  });

  // Value: protects=Bought one on a pack that went (a sync) after the Plan was drawn saves nothing and doesn't open Packs;
  // fails_when=the buy's noChange is dropped (the save is stamped for nothing) or openPack runs without a logged buy;
  // why_new=only a buy that works was tested here; seam=SyncLoop.nextStamp spied, openPack passed in; no_claim=a real sync
  it('does nothing for Bought one on a pack that has gone since the Plan was drawn', () => {
    const s = defaultState();
    s.currencies.find((c) => c.id === 'souls')!.balance = 1000;
    s.cards = [{ id: 'scorpion', name: 'Scorpion', rarityId: 'diamond', fusion: 4, guest: false }];
    s.packs = [{ id: 'p', name: 'Pack', currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [{ cardId: 'scorpion', chance: 50 }] }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    let update!: ReturnType<typeof useStore>['update'];
    const openPack = vi.fn();
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <PlanView goto={() => {}} openPack={openPack} />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const bought = screen.getAllByRole('button', { name: 'Bought one' })[0];
    // The pack goes before React draws again, so the tap still lands on the old button.
    act(() => {
      update((d) => void (d.packs = []));
      bought.click();
    });
    const saved = JSON.parse(localStorage.getItem('mkmax:v1')!);
    expect(saved.packs).toEqual([]);
    expect(saved.currencies.find((c: { id: string }) => c.id === 'souls').balance).toBe(1000);
    expect(stamps).toHaveBeenCalledTimes(1); // the removal only
    expect(openPack).not.toHaveBeenCalled();
  });
});

describe('Plan: Wallet on a screen a sync has changed', () => {
  // Regression: /ship review of clock-and-gear-taps — Wallet boxes changed a currency by its place on screen
  // Found by /ship on 2026-10-13
  // Value: protects=typing in a currency's box changes that currency even after a sync reordered them; fails_when=the box
  // writes to the currency at its old place; why_new=review (Red Team); seam=a grabbed update stands in for the sync;
  // no_claim=a real sync
  it('changes the currency whose box was typed in, after a sync reordered them', () => {
    localStorage.setItem('mkmax:v1', JSON.stringify(defaultState()));
    let update!: ReturnType<typeof useStore>['update'];
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <PlanView goto={() => {}} openPack={() => {}} />
        </PlanProvider>
      </StoreProvider>,
    );
    const souls = screen.getByLabelText('Souls');
    act(() => {
      update((d) => void d.currencies.reverse());
      fireEvent.change(souls, { target: { value: '123' } });
    });
    const saved = JSON.parse(localStorage.getItem('mkmax:v1')!);
    expect(saved.currencies.find((c: { id: string }) => c.id === 'souls').balance).toBe(123);
    expect(saved.currencies.filter((c: { balance: number }) => c.balance === 123)).toHaveLength(1);
  });
});
