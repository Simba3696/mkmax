// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import App from '../App';
import TowerView from './TowerView';
import type { AppState } from '../types';

// A small catalog: 3 Diamond and 3 Gold fighters with stats, a Kameo of each rarity and one weapon.
const fighter = (name: string, rarity: string, attack: number) => ({ kind: 'character', name, rarity, slug: name, attack, health: 0, tags: [] });
const items = [
  fighter('Diamond One', 'diamond', 90),
  fighter('Diamond Two', 'diamond', 80),
  fighter('Diamond Three', 'diamond', 70),
  fighter('Gold One', 'gold', 30),
  fighter('Gold Two', 'gold', 20),
  fighter('Gold Three', 'gold', 10),
  { kind: 'kameo', name: 'Diamond Kameo', rarity: 'diamond', slug: 'dk', class: ['Outworld'], tags: [] },
  { kind: 'equipment', name: 'Rare Blade', rarity: 'rare', slug: 'rb', slot: 'weapon', tags: [] },
];

/** What App's Undo bar would say, and the saved planner. */
function Probe() {
  const { lastUndo } = useStore();
  return <output data-testid="undo">{lastUndo?.label ?? ''}</output>;
}
const saved = () => (JSON.parse(localStorage.getItem('mkmax:v1')!) as AppState).klashTower!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-12T12:00:00'));
  vi.stubGlobal('fetch', (url: string) =>
    String(url).endsWith('catalog.json') ? Promise.resolve(new Response(JSON.stringify({ items }))) : Promise.reject(new Error('offline')),
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '#');
});

function renderTower(k: AppState['klashTower']) {
  const s = defaultState();
  s.realmKlashSeasonEnd = '2026-01-24T11:00';
  s.klashTower = k;
  localStorage.setItem('mkmax:v1', JSON.stringify(s));
  render(
    <StoreProvider>
      <PlanProvider>
        <TowerView />
        <Probe />
      </PlanProvider>
    </StoreProvider>,
  );
}

describe('Klash Tower: the Settings switch and the tab', () => {
  // Value: protects=the Klash tab shows only while Settings → Klash Tower is on, and turning it off while it's open
  // goes back to the Plan and keeps the pool; fails_when=the tab shows by default, the switch doesn't add it, or a hidden
  // tab stays open; why_new=new tab; seam=none; no_claim=swipes between tabs
  it('shows the tab only while the switch is on, and leaves it for the Plan when turned off', async () => {
    const s = defaultState();
    s.klashTower = { enabled: false, pool: ['character:diamond one'], pins: {}, season: null };
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    history.replaceState(null, '', '#tower');
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const nav = within(screen.getByRole('navigation', { name: 'Tabs' }));
    // A link to the hidden tab opens the Plan.
    expect(nav.queryByRole('button', { name: 'Klash' })).toBeNull();
    expect(nav.getByRole('button', { name: 'Plan' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(nav.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByLabelText('Show the Klash tab'));
    fireEvent.click(nav.getByRole('button', { name: 'Klash' }));
    expect(await screen.findByRole('heading', { name: 'Klash Tower' })).toBeTruthy();
    // Turned off from elsewhere (another device's sync, say) while it's open.
    fireEvent.click(nav.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByLabelText('Show the Klash tab'));
    expect(nav.queryByRole('button', { name: 'Klash' })).toBeNull();
    expect(saved()).toEqual({ enabled: false, pool: ['character:diamond one'], pins: {}, season: null });
  });
});

describe('Klash Tower: the pool and the floors', () => {
  // Value: protects=ticking cards fills the floors, the first tick stamps the season the pool is for, and an emptied pool
  // forgets it; fails_when=the floors don't follow the pool or the season is never set (a new season couldn't clear it);
  // why_new=new screen; seam=fetch serves a small catalog; no_claim=the builder's choices (klash.test.ts)
  it('fills the floors from the ticked pool and stamps the season on the first tick', async () => {
    renderTower({ enabled: true, pool: [], pins: {}, season: null });
    fireEvent.click(await screen.findByText(/^Diamond characters/));
    for (const name of ['Diamond One', 'Diamond Two', 'Diamond Three']) fireEvent.click(screen.getByLabelText(name));
    expect(saved().season).toBe('2026-01-24T11:00');
    const floor5 = within(screen.getByRole('region', { name: 'Floor 5' }));
    expect(['Diamond One', 'Diamond Two', 'Diamond Three'].every((n) => floor5.queryByText(n))).toBe(true);
    expect(floor5.getByText('Needs a Diamond Kameo.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Season pool' })).getByText('Clear pool'));
    fireEvent.click(screen.getByText('Tap again to confirm'));
    expect(saved()).toEqual({ enabled: true, pool: [], pins: {}, season: null });
    expect(screen.getByTestId('undo').textContent).toBe('Cleared the Klash pool');
  });

  // Value: protects=a card can be pinned only to floors its rarity may go on, a full floor is refused, and unticking a
  // pinned card drops its pin with Undo; fails_when=an illegal or 4th pin is offered, or a pin outlives its card;
  // why_new=new screen; seam=none; no_claim=how the builder honours pins (klash.test.ts)
  it('pins to legal floors only, refuses a full floor, and drops the pin when the card is unticked', async () => {
    const pool = ['character:diamond one', 'character:diamond two', 'character:diamond three', 'character:gold one', 'kameo:diamond kameo'];
    renderTower({ enabled: true, pool, pins: { 'character:diamond one': 4, 'character:diamond two': 4, 'character:diamond three': 4 }, season: '2026-01-24T11:00' });
    const goldPin = (await screen.findByLabelText('Floor for Gold One')) as HTMLSelectElement;
    expect([...goldPin.options].map((o) => [o.textContent, o.disabled])).toEqual([
      ['Pin to…', false],
      ['Floor 1', false],
      ['Floor 2', false],
      ['Floor 3', false],
      ['Floor 4 (full)', true],
    ]);
    fireEvent.change(goldPin, { target: { value: '2' } });
    expect(saved().pins['character:gold one']).toBe(2);
    expect(screen.getByTestId('undo').textContent).toBe('Pinned Gold One to floor 2');
    fireEvent.click(screen.getByText(/^Gold characters/));
    fireEvent.click(screen.getByLabelText('Gold One'));
    expect([saved().pool.includes('character:gold one'), saved().pins['character:gold one']]).toEqual([false, undefined]);
    expect(screen.getByTestId('undo').textContent).toBe('Removed Gold One from the Klash pool');
  });

  // Value: protects=a ticked card the catalog no longer lists is reported and can be removed, never silently dropped;
  // fails_when=it vanishes from view but stays in the save; why_new=pool keys outlive catalog renames; seam=none
  it('reports ticked cards the card list no longer has, and removes them', async () => {
    renderTower({ enabled: true, pool: ['character:diamond one', 'character:gone fighter'], pins: { 'character:gone fighter': 2 }, season: null });
    expect(await screen.findByText(/1 ticked card isn’t in MK Mobile Base's card list any more/)).toBeTruthy();
    fireEvent.click(screen.getByText('Remove it'));
    expect(saved()).toEqual({ enabled: true, pool: ['character:diamond one'], pins: {}, season: null });
  });
});

describe('Klash Tower: no card list', () => {
  // Value: protects=with no card list the tab says so and Try again loads it once it's back; fails_when=Loading… stays
  // forever or Try again doesn't fetch; why_new=new screen; seam=fetch fails, then serves the list; no_claim=the
  // service worker's offline copy (pwaConfig.test.ts)
  it('says it can’t load card data and tries again', async () => {
    // The catalog loaded by earlier tests in this file is cached, so this checks the message in its own module.
    vi.resetModules();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { StoreProvider: Store } = await import('../store');
    const { PlanProvider: Plan } = await import('../planner');
    const { default: Tower } = await import('./TowerView');
    localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), klashTower: { enabled: true, pool: [], pins: {}, season: null } }));
    render(
      <Store>
        <Plan>
          <Tower />
        </Plan>
      </Store>,
    );
    expect(await screen.findByText("Can't load card data. Check your connection.")).toBeTruthy();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ items }))));
    await act(async () => fireEvent.click(screen.getByText('Try again')));
    expect(await screen.findByRole('region', { name: 'Season pool' })).toBeTruthy();
  });
});
