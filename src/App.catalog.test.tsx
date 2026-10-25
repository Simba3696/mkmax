// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultState } from './defaults';
import type { useStore } from './store';

type Store = ReturnType<typeof useStore>;

// Its own file, and a fresh copy of the app for each test (renderApp), so catalog.ts starts with no card list downloaded:
// a test that loaded it would leave it cached.
vi.mock('./appUpdate', () => ({ checkForAppUpdate: () => Promise.resolve(), useAppUpdateReady: () => false, applyAppUpdate: () => {} }));

beforeEach(() => {
  history.replaceState(null, '', '#packs');
});
/**
 * A fresh app; `onStore` gets the store as each render sees it, `beforeRender` gets the fresh copy's catalog.ts before
 * App first draws, and the result is that catalog.ts.
 */
async function renderApp(onStore?: (store: Store) => void, beforeRender?: (catalog: typeof import('./catalog')) => void) {
  vi.resetModules();
  const [{ StoreProvider, useStore }, { PlanProvider }, { default: App }, catalog] = await Promise.all([import('./store'), import('./planner'), import('./App'), import('./catalog')]);
  function Grab() {
    onStore?.(useStore());
    return null;
  }
  beforeRender?.(catalog);
  render(
    <StoreProvider>
      <PlanProvider>
        <Grab />
        <App />
      </PlanProvider>
    </StoreProvider>,
  );
  return catalog;
}
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
  await renderApp();
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
  await renderApp();
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

// Generated by /ship review fixes on 2026-10-13; moved here from App.test.tsx by /ship review on 2026-10-25 (run 18), so
// it starts with no download failed by an earlier test
// Value: protects=the automatic art fill keeps an image a sync pasted on a card while the catalog downloaded;
// fails_when=the fill works from the cards as they were when the download started, replacing the pasted image;
// why_new=catalog.test.ts covers catalogImageUpdates, not the cards App hands it; seam=fetch holds the catalog until
// released, the sync stand-in runs just before App hears the catalog is in; no_claim=a real sync
it('keeps an image a sync pasted while the catalog was downloading', async () => {
  let release: (() => void) | undefined;
  const items = [{ kind: 'character', name: 'Liu Kang, Klassic', rarity: 'diamond', slug: 'liu-kang-klassic', image: 'z.png' }];
  vi.stubGlobal('fetch', (url: string) =>
    String(url).endsWith('catalog.json')
      ? new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify({ items })))))
      : Promise.reject(new Error('offline')),
  );
  const s = defaultState();
  s.cards = [{ id: 'liu', name: 'Liu Kang, Klassic', rarityId: 'diamond', fusion: 2, guest: false }];
  localStorage.setItem('mkmax:v1', JSON.stringify(s));
  let update!: Store['update'];
  const pasted = 'https://example.invalid/pasted.png';
  let synced!: Promise<void>;
  // Asked for before App asks, so this runs first once the catalog is in: the sync lands before React draws again,
  // which is when App would otherwise have stopped waiting for a set of cards that changed.
  const { loadCatalog } = await renderApp(
    (store) => (update = store.update),
    (catalog) => void (synced = catalog.loadCatalog().then(() => update((d) => void Object.assign(d.cards[0], { imageUrl: pasted, wikiTitle: undefined })))),
  );
  expect(release).toBeDefined(); // the catalog is still downloading
  await act(async () => {
    release!();
    await synced;
    await loadCatalog();
  });
  const card = JSON.parse(localStorage.getItem('mkmax:v1')!).cards[0];
  expect([card.imageUrl, card.imagePage]).toEqual([pasted, undefined]);
});

// Generated on 2026-10-25 (/ship review, run 18, Red Team)
// Value: protects=a card added while the catalog couldn't load (opened offline) gets its art once a later download
// works, whichever screen downloads it, without a pull or a reload; fails_when=only a fetch-again tells App the catalog
// is in, so the art lookup that failed at start never runs again; why_new=review (Red Team): a first catalog after a
// failed one notified nobody; seam=fetch fails, then answers; Cards' rarity check does the download; no_claim=a real
// connection
it('gives a card its art when the catalog first loads after failing', async () => {
  const art = 'https://mkmobilebase.com/storage/kori-blade.webp';
  localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), cards: [{ id: 'k', name: 'Kori Blade', rarityId: 'epic', fusion: 1, guest: false }] }));
  let online = false;
  vi.stubGlobal('fetch', (url: string) =>
    online && String(url).endsWith('catalog.json')
      ? Promise.resolve(new Response(JSON.stringify({ items: [{ kind: 'equipment', name: 'Kori Blade', rarity: 'epic', slug: 'kori-blade', image: art }] })))
      : Promise.reject(new Error('offline')),
  );
  const { loadCatalog } = await renderApp();
  await act(async () => void (await loadCatalog().catch(() => {})));
  expect(localStorage.getItem('mkmax:v1')).not.toContain(art);
  online = true;
  fireEvent.click(screen.getAllByRole('button', { name: 'Cards' })[0]);
  await waitFor(() => expect(localStorage.getItem('mkmax:v1')).toContain(art));
});
