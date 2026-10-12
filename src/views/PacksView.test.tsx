// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
import PacksView from './PacksView';
import type { Pack } from '../types';

const pack = (id: string, extra: Partial<Pack>): Pack => ({
  id, name: id, currencyId: 'souls', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [{ cardId: 'scorpion', chance: 50 }], ...extra,
});

/** What App's Undo bar would say. */
function UndoLabel() {
  const { lastUndo, state } = useStore();
  return (
    <output data-testid="undo" data-packs={state.packs.map((p) => p.id).join(',')}>
      {lastUndo?.label ?? ''}
    </output>
  );
}

beforeEach(() => {
  // Only Date is faked, so React and Testing Library keep their real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T12:00:00'));
  // In the shop and the season bar ask for the event schedule; keep the test off the network.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const s = defaultState();
  s.cards = [
    { id: 'scorpion', name: 'Scorpion', rarityId: 'diamond', fusion: 3, guest: false },
    { id: 'sash', name: 'Shadow Sash', rarityId: 'epic', fusion: 3, guest: false },
  ];
  s.packs = [
    pack('Old Pack', { endsAt: '2026-10-01T12:00' }),
    pack('Older Pack', { endsAt: '2026-09-20T12:00' }),
    pack('Live Pack', { endsAt: '2026-10-20T12:00' }),
    pack('Shadow Sash item', { currencyId: 'blood-rubies', store: true, cost: 500, endsAt: '2026-10-05T12:00', drops: [{ cardId: 'sash', chance: 100 }] }),
  ];
  localStorage.setItem('mkmax:v1', JSON.stringify(s));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Packs: Clear expired', () => {
  // Value: protects=Clear expired removes expired packs but keeps a Realm Klash store item, says why, and the Undo label counts
  // what went; fails_when=the count, plural, or kept note is wrong, or the item is cleared; why_new=engine tests cover
  // keepWhenExpired, not the screen; seam=none; no_claim=the Undo bar itself (App) and Rerun
  it('clears expired packs after a second tap, keeps the Realm Klash item with its note, and offers Undo', () => {
    render(
      <StoreProvider>
        <PlanProvider>
          <PacksView />
          <UndoLabel />
        </PlanProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '▸ Expired (3)' }));
    expect(screen.getByText(/Kept for next season:/).closest('[id]')?.id).toBe('pack-Shadow Sash item');
    expect(screen.getAllByText(/Kept for next season:/)).toHaveLength(1);

    // One tap only arms it.
    fireEvent.click(screen.getByRole('button', { name: 'Clear expired' }));
    expect(screen.getByTestId('undo').dataset.packs).toBe('Old Pack,Older Pack,Live Pack,Shadow Sash item');
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));

    expect(screen.getByTestId('undo').dataset.packs).toBe('Live Pack,Shadow Sash item');
    expect(screen.getByTestId('undo').textContent).toBe('Cleared 2 expired packs');
    // Only the kept item is left, so there's nothing more to clear.
    expect(screen.getByRole('button', { name: '▾ Expired (1)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear expired' })).toBeNull();
    expect(screen.getByText(/Kept for next season:/)).toBeTruthy();
  });
});

describe('Packs: logging a purchase', () => {
  // Regression: review of clock-and-gear-taps — a tap with nothing to take back still saved and synced
  // Found by /review on 2026-10-13
  // Value: protects=a −1 with no purchase left to take back (the screen was drawn before the last one) saves nothing;
  // fails_when=the button drops recordPurchase's "nothing done" and stamps the save anyway; why_new=review (Red Team);
  // seam=SyncLoop.nextStamp spied to count saves; no_claim=the Plan's Bought one (PlanView.test.tsx)
  it('saves nothing for a −1 that has no purchase left to take back', () => {
    const s = JSON.parse(localStorage.getItem('mkmax:v1')!);
    s.packs.find((p: Pack) => p.id === 'Live Pack').purchased = 1;
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const takeBack = screen.getByRole('button', { name: 'Remove one purchase' });
    // Both taps land before React draws again, so the second still sees the purchase the first took back.
    act(() => {
      takeBack.click();
      takeBack.click();
    });
    const saved = JSON.parse(localStorage.getItem('mkmax:v1')!);
    expect(saved.packs.find((p: Pack) => p.id === 'Live Pack').purchased).toBe(0);
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Value: protects=logging a buy of a random pack still opens "What did you pull?", and taking it back closes it;
  // fails_when=the pull step opens only for a buy the change didn't record (the flag is read wrong), or a logged −1 no
  // longer closes it; why_new=review (testing); seam=none; no_claim=store items
  it('opens "What did you pull?" after logging a random pack, and closes it when the purchase is taken back', () => {
    render(
      <StoreProvider>
        <PlanProvider>
          <PacksView />
        </PlanProvider>
      </StoreProvider>,
    );
    expect(screen.queryByText('What did you pull?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I bought one' }));
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).packs.find((p: Pack) => p.id === 'Live Pack').purchased).toBe(1);
    expect(screen.getByText('What did you pull?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove one purchase' }));
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).packs.find((p: Pack) => p.id === 'Live Pack').purchased).toBe(0);
    expect(screen.queryByText('What did you pull?')).toBeNull();
  });
});
