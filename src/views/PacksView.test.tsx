// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
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
