// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
import CardsView from './CardsView';

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
