// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultState } from '../defaults';
import { StoreProvider, useStore } from '../store';
import { PlanProvider } from '../planner';
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
  // the missing row; why_new=review (Red Team); seam=a grabbed update stands in for the sync; no_claim=a real sync
  it('saves nothing for a row a sync removed', () => {
    renderSettings();
    const krystals = screen.getByDisplayValue('Dragon Krystals');
    act(() => {
      update((d) => void (d.currencies = d.currencies.filter((c) => c.id !== 'dragon-krystals')));
      fireEvent.change(krystals, { target: { value: 'Krystals' } });
    });
    expect(saved().currencies.map((c: { name: string }) => c.name)).not.toContain('Krystals');
  });
});
