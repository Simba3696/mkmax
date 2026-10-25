// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultState } from './defaults';
import { StoreProvider } from './store';
import { PlanProvider } from './planner';
import App from './App';

// Its own file, so catalog.ts starts with no card list downloaded: a test that loaded it would leave it cached.
vi.mock('./appUpdate', () => ({ hasServiceWorker: () => true, checkForAppUpdate: () => Promise.resolve(), useAppUpdateReady: () => false, applyAppUpdate: () => {} }));

beforeEach(() => {
  history.replaceState(null, '', '#packs');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '#');
});

// Generated on 2026-10-25 (/ship review, run 15 pass 3)
// Value: protects=pull to refresh fetches the card catalog again (skipping the browser's copy) and a card it now has art
// for gets it, as a reload used to; fails_when=an app kept open never sees the daily deploy's new cards and art;
// why_new=review (Red Team): pull to refresh stopped reloading; seam=fetch stubbed (the catalog gains the card on the
// second download), appUpdate mocked, touches sent by hand; no_claim=the catalog on the live site
it('fetches the card catalog again on pull to refresh, and gives cards the art it now has', async () => {
  localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), cards: [{ id: 'k', name: 'Kori Blade', rarityId: 'epic', fusion: 1, guest: false }] }));
  const art = 'https://mkmobilebase.com/storage/kori-blade.webp';
  const item = { kind: 'equipment', name: 'Kori Blade', rarity: 'epic', slug: 'kori-blade', image: art };
  const asked: (RequestCache | undefined)[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!String(url).endsWith('catalog.json')) return Promise.reject(new Error('offline'));
    asked.push(init?.cache);
    return Promise.resolve(new Response(JSON.stringify({ items: asked.length > 1 ? [item] : [] })));
  });
  render(
    <StoreProvider>
      <PlanProvider>
        <App />
      </PlanProvider>
    </StoreProvider>,
  );
  await waitFor(() => expect(asked.length).toBe(1));
  const touch = (y: number) => ({ touches: [{ clientX: 0, clientY: y }] });
  fireEvent.touchStart(window, touch(0));
  fireEvent.touchMove(window, touch(200));
  await act(async () => void fireEvent.touchEnd(window));
  await waitFor(() => expect(localStorage.getItem('mkmax:v1')).toContain(art));
  expect(asked).toEqual([undefined, 'no-cache']);
});

// Generated on 2026-10-25 (/ship coverage audit, run 16)
// Value: protects=Cards, open while pull to refresh fetches the catalog again, reads the new copy, so a rarity the site
// now lists differently shows in its rarity check; fails_when=Cards keeps the catalog it read when it opened (its effect
// no longer runs again on a fetched-again catalog) until the app restarts; why_new=the pull test above checks only the
// art App gives on the Packs page; seam=fetch stubbed (the site's rarity changes before the pull), appUpdate mocked,
// touches sent by hand; no_claim=the catalog on the live site
it('shows a rarity the fetched-again catalog lists differently on Cards while it is open', async () => {
  history.replaceState(null, '', '#cards');
  localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), cards: [{ id: 'k', name: 'Kori Blade', rarityId: 'epic', fusion: 1, guest: false }] }));
  const art = 'https://mkmobilebase.com/storage/kori-blade.webp';
  let rarity = 'epic';
  vi.stubGlobal('fetch', (url: string) =>
    String(url).endsWith('catalog.json')
      ? Promise.resolve(new Response(JSON.stringify({ items: [{ kind: 'equipment', name: 'Kori Blade', rarity, slug: 'kori-blade', image: art }] })))
      : Promise.reject(new Error('offline')),
  );
  render(
    <StoreProvider>
      <PlanProvider>
        <App />
      </PlanProvider>
    </StoreProvider>,
  );
  // The card gets its art once the catalog is in, so Cards has read it too.
  await waitFor(() => expect(localStorage.getItem('mkmax:v1')).toContain(art));
  expect(screen.queryByText(/MK Mobile Base lists a different rarity/)).toBeNull();
  rarity = 'rare';
  const touch = (y: number) => ({ touches: [{ clientX: 0, clientY: y }] });
  fireEvent.touchStart(window, touch(0));
  fireEvent.touchMove(window, touch(200));
  await act(async () => void fireEvent.touchEnd(window));
  expect(await screen.findByText(/MK Mobile Base lists a different rarity/)).toBeTruthy();
  expect(screen.getByText(/on the site/).textContent).toContain('Rare Equip');
});
