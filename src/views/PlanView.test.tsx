// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider } from '../store';
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
});
