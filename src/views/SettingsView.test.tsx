// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
import { SyncLoop } from '../syncLoop';
import type { Pack } from '../types';
import SettingsView from './SettingsView';

// The service worker module imports vite-plugin-pwa's virtual module, which only exists in a build; it isn't what's tested.
vi.mock('../appUpdate', () => ({ checkForAppUpdate: () => Promise.resolve(), startServiceWorker: () => {} }));

/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: ReturnType<typeof useStore>) => void }) {
  onRender(useStore());
  return null;
}

beforeEach(() => {
  // The event schedule and the catalog aren't needed here; keep the test off the network.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  localStorage.setItem('mkmax:v1', JSON.stringify(defaultState()));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Settings rows on a screen a sync has changed', () => {
  let update!: ReturnType<typeof useStore>['update'];
  function renderSettings() {
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <SettingsView />
        </PlanProvider>
      </StoreProvider>,
    );
  }
  const saved = () => JSON.parse(localStorage.getItem('mkmax:v1')!);

  // Regression: /ship review of clock-and-gear-taps — Settings changed or removed rows by their place on screen
  // Found by /ship on 2026-10-13
  // Value: protects=✕ removes the currency on its row, and renaming a rarity renames that rarity, after a sync reordered
  // them; fails_when=the change goes to whatever row now sits at the old place (removing the wrong currency); why_new=
  // review (Red Team); seam=a grabbed update stands in for the sync; no_claim=a real sync
  it('removes and renames the row tapped, after a sync reordered them', () => {
    renderSettings();
    const krystals = screen.getByDisplayValue('Dragon Krystals').parentElement!.querySelector('button')!;
    act(() => {
      update((d) => void d.currencies.reverse());
      krystals.click();
    });
    expect(saved().currencies.map((c: { id: string }) => c.id)).toEqual(['blood-rubies', 'souls']);

    const diamond = screen.getByDisplayValue('Diamond');
    act(() => {
      update((d) => void d.rarities.reverse());
      fireEvent.change(diamond, { target: { value: 'Diamond characters' } });
    });
    expect(saved().rarities.find((r: { id: string }) => r.id === 'diamond').label).toBe('Diamond characters');
    expect(saved().rarities.filter((r: { label: string }) => r.label === 'Diamond characters')).toHaveLength(1);
  });

  // Value: protects=a row a sync removed is left alone: no save and no Undo; fails_when=the change writes to (or throws on)
  // the missing row, or saves anyway; why_new=review (Red Team; testing: count the saves); seam=a grabbed update stands
  // in for the sync, SyncLoop.nextStamp spied to count saves; no_claim=a real sync
  it('saves nothing for a row a sync removed', () => {
    renderSettings();
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const krystals = screen.getByDisplayValue('Dragon Krystals');
    act(() => {
      update((d) => void (d.currencies = d.currencies.filter((c) => c.id !== 'dragon-krystals')));
      fireEvent.change(krystals, { target: { value: 'Krystals' } });
    });
    expect(saved().currencies.map((c: { name: string }) => c.name)).not.toContain('Krystals');
    expect(stamps).toHaveBeenCalledTimes(1); // the sync stand-in only
  });

  // Value: protects=✕ keeps a currency that a pack a sync brought in now uses; fails_when=the change checks only the
  // button's disabled, drawn before the pack arrived; why_new=review (testing); seam=a grabbed update stands in for the
  // sync, SyncLoop.nextStamp spied; no_claim=a real sync
  it('keeps a currency a pack synced in now uses', () => {
    renderSettings();
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const remove = screen.getByDisplayValue('Dragon Krystals').parentElement!.querySelector('button')!;
    const pack: Pack = { id: 'p', name: 'Pack', currencyId: 'dragon-krystals', cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: null, drops: [] };
    act(() => {
      update((d) => void d.packs.push(pack));
      remove.click();
    });
    expect(saved().currencies.map((c: { id: string }) => c.id)).toContain('dragon-krystals');
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Value: protects=Remove on a rarity a sync already removed saves nothing and offers no Undo; fails_when=the change
  // stamps the save anyway; why_new=review (adversarial sweep); seam=a grabbed update stands in for the sync,
  // SyncLoop.nextStamp spied; no_claim=a real sync
  it('saves nothing for Remove on a rarity a sync already removed', () => {
    renderSettings();
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    const remove = within(panelOf('Uncommon Equip')).getByRole('button', { name: 'Remove' });
    act(() => {
      update((d) => void (d.rarities = d.rarities.filter((r) => r.id !== 'uncommon')));
      remove.click();
    });
    expect(stamps).toHaveBeenCalledTimes(1);
  });
});

/** The rarity editor with this name: the box that holds both its name and its Remove button. */
function panelOf(name: string) {
  let el: HTMLElement | null = screen.getByDisplayValue(name);
  while (el && !within(el).queryByRole('button', { name: 'Remove' })) el = el.parentElement;
  return el!;
}

describe('Settings level steps on a screen a sync has changed', () => {
  let update!: ReturnType<typeof useStore>['update'];
  function renderSettings(cards: ReturnType<typeof defaultState>['cards'] = []) {
    const s = defaultState();
    s.cards = cards;
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <SettingsView />
        </PlanProvider>
      </StoreProvider>,
    );
    return vi.spyOn(SyncLoop.prototype, 'nextStamp');
  }
  const saved = () => JSON.parse(localStorage.getItem('mkmax:v1')!);
  const diamond = () => saved().rarities.find((r: { id: string }) => r.id === 'diamond');

  // Regression: /review of stale-screens-and-schedule — a stale − Level took a rarity to no steps and deleted its cards
  // Found by /review on 2026-10-13
  // Value: protects=− Level after a sync cut the rarity to one step saves nothing, so the owned card stays; fails_when=
  // the change pops by what the screen showed, leaving no steps, and every owned card counts as maxed and is deleted;
  // why_new=review (Red Team, adversarial, QA probe); seam=a grabbed update stands in for the sync, SyncLoop.nextStamp
  // spied; no_claim=a real sync
  it('keeps the last step and the cards when − Level is tapped after a sync cut the steps', () => {
    const stamps = renderSettings([{ id: 'sz', name: 'Sub-Zero, Klassic', rarityId: 'diamond', fusion: 1, guest: false }]);
    const minus = within(panelOf('Diamond')).getByRole('button', { name: '− Level' });
    act(() => {
      update((d) => void (d.rarities.find((r) => r.id === 'diamond')!.dupesPerLevel = [1]));
      minus.click();
    });
    expect(diamond().dupesPerLevel).toEqual([1]);
    expect(saved().cards).toHaveLength(1);
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Value: protects=a step's copies box past the end of a list a sync shortened saves nothing (no holes, no step brought
  // back), and + Level on a rarity a sync made a Kameo adds nothing; fails_when=the box writes by its place on screen, or
  // + Level ignores the kind; why_new=review (adversarial, Codex); seam=a grabbed update stands in for the sync,
  // SyncLoop.nextStamp spied; no_claim=a real sync
  it('saves nothing for a step box past the end, or + Level on a rarity now a Kameo', () => {
    const stamps = renderSettings();
    const panel = within(panelOf('Diamond'));
    const step5 = panel.getAllByText('F4→F5')[0].closest('label')!.querySelector('input')!;
    act(() => {
      update((d) => void (d.rarities.find((r) => r.id === 'diamond')!.dupesPerLevel = [1, 1]));
      fireEvent.change(step5, { target: { value: '3' } });
    });
    expect(diamond().dupesPerLevel).toEqual([1, 1]);

    const plus = within(panelOf('Diamond')).getByRole('button', { name: '+ Level' });
    act(() => {
      update((d) => void Object.assign(d.rarities.find((r) => r.id === 'diamond')!, { kind: 'kameo', dupesPerLevel: [], fusionMax: 0 }));
      plus.click();
    });
    expect(diamond().dupesPerLevel).toEqual([]);
    expect(stamps).toHaveBeenCalledTimes(2); // the two sync stand-ins only
  });
});
