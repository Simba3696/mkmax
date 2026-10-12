// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider } from '../store';
import { PlanProvider } from '../planner';
import GearOrder, { GearSummary } from './GearOrder';
import type { Card, Pack } from '../types';

const gear = (id: string, name: string): Card => ({ id, name, rarityId: 'epic', fusion: 3, guest: false });
/** A Blood Ruby store item on sale now for one piece. */
const item = (cardId: string): Pack => ({
  id: `item-${cardId}`,
  name: `${cardId} item`,
  currencyId: 'blood-rubies',
  cost: 800,
  rolls: 1,
  maxPurchases: null,
  purchased: 0,
  startsAt: null,
  endsAt: null,
  store: true,
  drops: [{ cardId, chance: 100 }],
});

/** Settings' gear order and the Plan's gear lines, on a save holding these cards and packs. */
function renderWith(cards: Card[], packs: Pack[] = []) {
  const s = defaultState();
  s.cards = cards;
  s.packs = packs;
  localStorage.setItem('mkmax:v1', JSON.stringify(s));
  return render(
    <StoreProvider>
      <PlanProvider>
        <div data-testid="settings">
          <GearOrder />
        </div>
        <div data-testid="plan">
          <GearSummary />
        </div>
      </PlanProvider>
    </StoreProvider>,
  );
}

beforeEach(() => {
  // The event schedule isn't needed here; keep the test off the network.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Realm Klash gear with no store item on sale', () => {
  // Value: protects=pieces with no store item on sale are named in Settings and on the Plan, with no buying-order intro or
  // date line; fails_when=GearOrder hides itself with an empty queue, shows the intro, or it/them goes wrong; why_new=engine
  // tests cover gearWaiting, not the screens; seam=none; no_claim=layout and the queued-gear rows (browser QA)
  it('shows only the Not on sale line, with it for one piece and them for two', () => {
    const two = renderWith([gear('sash', 'Shadow Sash'), gear('dev', 'Devastator')]);
    const settings = two.getByTestId('settings');
    expect(settings.textContent).toContain('Blood Ruby gear order');
    expect(settings.textContent).toContain('Not on sale now: Devastator, Shadow Sash.');
    expect(settings.textContent).toContain("Nothing plans them until they're back in the shop; then add them from In the shop on Packs.");
    expect(settings.textContent).not.toContain('Blood Rubies max these one at a time');
    // Nothing queued, so the Plan has no "all maxed" or "takes N Blood Rubies" line, only the waiting one.
    const plan = two.getByTestId('plan');
    expect(plan.querySelectorAll('p')).toHaveLength(1);
    expect(plan.textContent).toContain('Not on sale now: Devastator, Shadow Sash.');
    expect(plan.textContent).not.toMatch(/all maxed|in all/);
    cleanup();
    localStorage.clear();

    renderWith([gear('sash', 'Shadow Sash')]);
    expect(screen.getByTestId('settings').textContent).toContain("Not on sale now: Shadow Sash. Nothing plans it until it's back in the shop; then add it from In the shop on Packs.");
  });

  // Value: protects=the waiting piece is named beside the queued ones, and nothing is said when every piece is on sale;
  // fails_when=the Plan's queued branch drops the line, or an empty list prints "Not on sale now: ."; why_new=the test
  // above only has an empty queue; seam=none; no_claim=the queued rows' dates
  it('names the waiting piece next to the queued ones, and says nothing when every piece is on sale', () => {
    const mixed = renderWith([gear('sash', 'Shadow Sash'), gear('dev', 'Devastator')], [item('sash')]);
    const settings = mixed.getByTestId('settings');
    expect(settings.textContent).toContain('Blood Rubies max these one at a time');
    expect(settings.textContent).toContain('1. Shadow Sash');
    expect(settings.textContent).toContain('Not on sale now: Devastator.');
    const plan = mixed.getByTestId('plan');
    expect(plan.querySelectorAll('p')).toHaveLength(2); // when it's all maxed, then the waiting piece
    expect(plan.textContent).toContain('Not on sale now: Devastator.');
    cleanup();
    localStorage.clear();

    const none = renderWith([gear('sash', 'Shadow Sash')], [item('sash')]);
    expect(none.getByTestId('settings').textContent).toContain('1. Shadow Sash');
    expect(none.container.textContent).not.toContain('Not on sale now');
  });
});
