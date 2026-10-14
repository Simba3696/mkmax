// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
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

describe('Realm Klash gear with no store item on sale', () => {
  // Value: protects=pieces with no store item on sale are named in Settings and on the Plan, with no buying-order intro or
  // date line; fails_when=GearOrder hides itself with an empty queue, shows the intro, or it/them goes wrong; why_new=engine
  // tests cover gearWaiting, not the screens; seam=none; no_claim=layout and the queued-gear rows (browser QA)
  it('shows only the Not on sale line, with it for one piece and them for two', () => {
    const two = renderWith([gear('sash', 'Shadow Sash'), gear('dev', 'Devastator')]);
    const settings = two.getByTestId('settings');
    expect(settings.textContent).toContain('Blood Ruby gear order');
    expect(settings.textContent).toContain('Not on sale now: Shadow Sash, Devastator.');
    expect(settings.textContent).toContain("Nothing plans them until they're back in the shop; then add them from In the shop on Packs.");
    expect(settings.textContent).not.toContain('Blood Rubies max these one at a time');
    // Nothing queued, so the Plan has no "all maxed" or "takes N Blood Rubies" line, only the waiting one.
    const plan = two.getByTestId('plan');
    expect(plan.querySelectorAll('p')).toHaveLength(1);
    expect(plan.textContent).toContain('Not on sale now: Shadow Sash, Devastator.');
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

  // Value: protects=↓ moves the piece past its neighbour on screen and saves an order that keeps the off-sale piece in
  // its place; fails_when=the arrows pass the wrong pieces, move off by one, or save only the pieces on sale; why_new=
  // only moveInGearOrder itself was tested; seam=none; no_claim=sync of the saved order
  it('moves a piece down with the arrow and keeps a piece that is off sale first', () => {
    renderWith([gear('sash', 'Shadow Sash'), gear('mol', "Moloch's Ball and Chain"), gear('dev', 'Devastator')], [item('mol'), item('dev')]);
    const order = () => screen.getByTestId('settings').textContent;
    expect(order()).toMatch(/1\. Moloch.*2\. Devastator.*Not on sale now: Shadow Sash\./);
    fireEvent.click(screen.getAllByLabelText('Move down')[0]);
    expect(order()).toMatch(/1\. Devastator.*2\. Moloch/);
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).gearOrder).toEqual(['sash', 'dev', 'mol']);
    // Value: protects=↑ moves the tapped piece above the one before it; fails_when=the ↑ button passes the wrong
    // neighbour or direction; why_new=only ↓ was clicked; seam=none; no_claim=none beyond protects
    fireEvent.click(screen.getAllByLabelText('Move up')[1]);
    expect(order()).toMatch(/1\. Moloch.*2\. Devastator/);
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).gearOrder).toEqual(['sash', 'mol', 'dev']);
  });

  // Regression: /ship review of todo-followups — a tap on a screen one move behind moved the piece back
  // Found by /ship on 2026-10-12
  // Value: protects=the arrow passes its direction and saves nothing when the move is already done; fails_when=the button
  // drops the direction, saves `order ?? []` (wiping the order) or saves null; why_new=review (only the engine and store
  // halves were tested); seam=SyncLoop.nextStamp spied to count saves; no_claim=a sync landing between render and tap
  it('saves nothing for a second tap made on the screen from before the first', () => {
    renderWith([gear('sash', 'Shadow Sash'), gear('mol', "Moloch's Ball and Chain"), gear('dev', 'Devastator')], [item('mol'), item('dev')]);
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const down = screen.getAllByLabelText('Move down')[0];
    // Both taps land before React draws again, so the second still sees Moloch's first.
    act(() => {
      down.click();
      down.click();
    });
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).gearOrder).toEqual(['sash', 'dev', 'mol']);
    expect(screen.getByTestId('settings').textContent).toMatch(/1\. Devastator.*2\. Moloch/);
    expect(stamps).toHaveBeenCalledTimes(1);
  });
});

describe('Realm Klash gear order on a screen a sync has changed', () => {
  // Regression: /ship review of clock-and-gear-taps — a stale tap moved a piece past one a sync had put on sale
  // Found by /ship on 2026-10-13
  // Value: protects=↓ moves nothing when a sync put another piece on sale between the two on screen; fails_when=the
  // arrow doesn't pass the pieces on sale now, so the piece jumps one the screen never showed; why_new=review (Codex,
  // adversarial); seam=SyncLoop.nextStamp spied, a grabbed update stands in for the sync; no_claim=a real sync
  it('moves nothing when a sync put a piece on sale between the two', () => {
    const s = defaultState();
    s.cards = [gear('sash', 'Shadow Sash'), gear('mol', "Moloch's Ball and Chain"), gear('dev', 'Devastator')];
    s.packs = [item('sash'), item('dev')];
    s.gearOrder = ['sash', 'mol', 'dev'];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    let update!: ReturnType<typeof useStore>['update'];
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <GearOrder />
        </PlanProvider>
      </StoreProvider>,
    );
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const down = screen.getAllByLabelText('Move down')[0];
    act(() => {
      update((d) => void d.packs.push(item('mol')));
      down.click();
    });
    expect(JSON.parse(localStorage.getItem('mkmax:v1')!).gearOrder).toEqual(['sash', 'mol', 'dev']);
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
  });
});
