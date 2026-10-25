// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { loadCatalog, refreshCatalog, useCatalogVersion, type CatalogItem } from './catalog';

// Its own file with one test: catalog.ts listens for the app coming back from the moment it loads, so a second copy of
// the module in the same file would answer the same events.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const item = (name: string): CatalogItem => ({ kind: 'equipment', name, rarity: 'epic', slug: name.toLowerCase().replace(/ /g, '-'), image: `https://mkmobilebase.com/storage/${name}.webp` });
/** A fetch serving the catalog with `items`, recording the cache mode each download asked for. */
function serve(items: () => CatalogItem[]) {
  const fetch = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({ items: items() }))));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

// Generated on 2026-10-25 (/ship coverage audit, run 16); changed by /ship review on 2026-10-25 (run 16 pass 2)
// Value: protects=coming back to the app fetches the catalog again past the browser's copy once it's over an hour old,
// once per return, also on a back-forward restore and after the clock went back, but not sooner or while hidden; it
// also tries again after any download that failed (offline at launch, or a wifi sign-in page served instead, which
// keeps the copy here and tells no screen to look), but never downloads a catalog the app hasn't needed yet;
// fails_when=an app left open never sees the daily deploy's new cards, a failed download counts as fresh for an hour,
// or every return downloads; why_new=pull to refresh's fetch was the only one tested (App.catalog.test.tsx), and the
// retries are new in this review; seam=fetch stubbed, fake Date, document.visibilityState mocked, pageshow sent by
// hand; no_claim=real browsers' event order
it('fetches the catalog again on coming back when it is an hour old or a download failed', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let visible = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
  const at = (t: string) => vi.setSystemTime(new Date(`2026-10-25T${t}`));
  const back = () => document.dispatchEvent(new Event('visibilitychange'));
  const pageshow = (persisted: boolean) => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
  // refreshCatalog() waits for a fetch-again already out, so it settles what coming back started. Each step checks the
  // download started before settling: with none out, settling would start one itself.
  const settled = () => act(() => refreshCatalog());
  const { result } = renderHook(() => useCatalogVersion());

  // Not needed yet (no card wanted art, Cards not opened): coming back downloads nothing.
  at('11:00:00');
  let fetch = serve(() => [item('Kori Blade')]);
  back();
  expect(fetch).not.toHaveBeenCalled();

  // Needed, but offline: coming back tries again.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  await expect(loadCatalog()).rejects.toThrow('offline');
  let n = 0;
  // Each download serves a catalog that has changed since, as after a daily deploy.
  fetch = serve(() => [item(`Kori Blade ${++n}`)]);
  back();
  expect(fetch.mock.calls.map(([, init]) => init?.cache)).toEqual(['no-cache']);
  await settled();
  const first = result.current;

  // Under an hour, or hidden: nothing.
  at('11:59:00');
  back();
  visible = 'hidden';
  at('12:30:00');
  back();
  expect(fetch).toHaveBeenCalledTimes(1);

  // A restore can send a visibility change and pageshow together: one download.
  visible = 'visible';
  back();
  pageshow(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  await settled();
  expect(result.current).not.toBe(first);

  // The first load's pageshow isn't a return; a back-forward restore an hour on is.
  at('13:31:00');
  pageshow(false);
  expect(fetch).toHaveBeenCalledTimes(2);
  pageshow(true);
  expect(fetch).toHaveBeenCalledTimes(3);
  await settled();

  // The device clock went back past the download time: that counts as old.
  at('10:00:00');
  back();
  expect(fetch).toHaveBeenCalledTimes(4);
  await settled();

  // An hour on, a wifi sign-in page comes back instead of the catalog: the copy stays and no screen is told to look.
  const before = result.current;
  const kept = await loadCatalog();
  at('11:01:00');
  const signIn = vi.fn(() => Promise.resolve(new Response('<html>Sign in to the wifi</html>')));
  vi.stubGlobal('fetch', signIn);
  back();
  expect(signIn).toHaveBeenCalledTimes(1);
  await settled();
  expect([result.current, (await loadCatalog()) === kept]).toEqual([before, true]);
  // It didn't count as a fresh copy, so coming back a minute later tries again.
  at('11:02:00');
  fetch = serve(() => [item('Kitana Fan')]);
  back();
  expect(fetch).toHaveBeenCalledTimes(1);
  await settled();
  expect([result.current !== before, (await loadCatalog()).map((i) => i.name)]).toEqual([true, ['Kitana Fan']]);
});
