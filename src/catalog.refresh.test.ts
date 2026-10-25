// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CatalogItem } from './catalog';

// A fresh copy of the module for each test, since it keeps the downloaded catalog and its download time for the page.
async function fresh() {
  vi.resetModules();
  return import('./catalog');
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const item = (name: string): CatalogItem => ({ kind: 'equipment', name, rarity: 'epic', slug: name.toLowerCase().replace(/ /g, '-'), image: `https://mkmobilebase.com/storage/${name}.webp` });
const ok = (items: CatalogItem[]) => Promise.resolve(new Response(JSON.stringify({ items })));
/** A fetch serving the catalog with `items`, recording the cache mode each download asked for. */
function serve(items: () => CatalogItem[]) {
  const fetch = vi.fn((_url: string, _init?: RequestInit) => ok(items()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
/** A fetch whose downloads are each settled by hand, in the order they started. */
function held() {
  const calls: { url: string; init?: RequestInit; res: (r: Response) => void; rej: (e: Error) => void }[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => new Promise<Response>((res, rej) => calls.push({ url, init, res, rej })));
  return calls;
}

describe('card catalog fetched again', () => {
  // Generated on 2026-10-25 (/ship coverage audit, run 16)
  // Value: protects=a fetch-again that fails (a pull while offline) keeps the catalog already downloaded, so Add card's
  // names and art lookups still work, and tells no screen to look again; fails_when=the kept copy is dropped, so the next
  // lookup downloads again and fails offline, or a failed refresh rejects or bumps the version; why_new=only a refresh
  // that worked was tested; seam=fetch stubbed; no_claim=none beyond protects
  it('keeps the catalog it has when fetching it again fails', async () => {
    const { loadCatalog, refreshCatalog, useCatalogVersion } = await fresh();
    serve(() => [item('Kori Blade')]);
    await loadCatalog();
    const { result } = renderHook(() => useCatalogVersion());
    const before = result.current;
    const offline = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', offline);
    await act(() => expect(refreshCatalog()).resolves.toBeUndefined());
    expect(offline).toHaveBeenCalledTimes(1);
    expect([(await loadCatalog()).map((i) => i.name), offline.mock.calls.length, result.current]).toEqual([['Kori Blade'], 1, before]);
  });

  // Generated on 2026-10-25 (/ship review, run 16, performance)
  // Value: protects=fetching again a catalog that hasn't changed (the usual case) tells no screen to look again and keeps
  // the same list; fails_when=every pull and return rebuilds the catalog index and reruns the art lookup and rarity check
  // for nothing; why_new=review (performance); seam=fetch stubbed; no_claim=how browsers answer a no-cache request
  it('tells no screen to look again when the catalog fetched again is the same', async () => {
    const { loadCatalog, refreshCatalog, useCatalogVersion } = await fresh();
    serve(() => [item('Kori Blade')]);
    const first = await loadCatalog();
    const { result } = renderHook(() => useCatalogVersion());
    const before = result.current;
    await act(() => refreshCatalog());
    expect([result.current, (await loadCatalog()) === first]).toEqual([before, true]);
  });

  // Generated on 2026-10-25 (/ship review, run 16, Red Team)
  // Value: protects=while a fetch-again is out, lookups (Find images, an added card's art, the Maxed page) get the copy
  // already downloaded at once; fails_when=every lookup waits on the network, so a hung download after coming back leaves
  // Find images checking for good; why_new=review (Red Team); seam=fetch held open by hand; no_claim=none beyond protects
  it('answers lookups from the copy it has while fetching it again', async () => {
    const { loadCatalog, refreshCatalog } = await fresh();
    const calls = held();
    const first = loadCatalog();
    calls[0].res(new Response(JSON.stringify({ items: [item('Kori Blade')] })));
    await first;
    void refreshCatalog();
    expect(calls).toHaveLength(2);
    expect((await loadCatalog()).map((i) => i.name)).toEqual(['Kori Blade']);
  });

  // Generated on 2026-10-25 (/ship review, run 16, Red Team)
  // Value: protects=a catalog download that hangs gives up after 30 seconds, so a pull or Find images doesn't wait on it
  // for good and the next attempt downloads again; fails_when=the download has no time limit; why_new=review (Red Team);
  // seam=fetch held open by hand (it settles on its abort signal), fake timers; no_claim=how long real browsers wait
  it('gives up on a download that hangs, and the next attempt tries again', async () => {
    const { loadCatalog } = await fresh();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls = held();
    const first = loadCatalog().catch((e: Error) => e.name);
    calls[0].init!.signal!.addEventListener('abort', () => calls[0].rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    vi.advanceTimersByTime(30 * 1000);
    expect(await first).toBe('AbortError');
    void loadCatalog();
    expect(calls).toHaveLength(2);
  });

  // Generated on 2026-10-25 (/ship review, run 16 pass 2, testing + state machines)
  // Value: protects=when the first download lands after a pull's (a slow start), the pull's newer copy stays;
  // fails_when=the older first download replaces it, so lookups get the copy from before the daily deploy;
  // why_new=review: only the first download failing was tested; seam=fetch downloads settled by hand; no_claim=none
  it('keeps the pull’s copy when the first download lands after it', async () => {
    const cat = await fresh();
    const calls = held();
    const first = cat.loadCatalog();
    const pull = cat.refreshCatalog();
    calls[1].res(new Response(JSON.stringify({ items: [item('Kori Blade'), item('Kitana Fan')] })));
    await pull;
    calls[0].res(new Response(JSON.stringify({ items: [item('Kori Blade')] })));
    await first;
    expect((await cat.loadCatalog()).map((i) => i.name)).toEqual(['Kori Blade', 'Kitana Fan']);
  });

  // Generated on 2026-10-25 (/ship review, run 16 pass 2, state machines)
  // Value: protects=two lookups while the first download is out share it (one download), and a pull that fails while
  // there's no copy changes nothing, so the next lookup downloads again; fails_when=each lookup downloads, or a failed
  // pull leaves something cached or tells screens to look again; why_new=review (state machines); seam=fetch stubbed or
  // held; no_claim=none beyond protects
  it('shares the first download, and a failed pull with no copy leaves the next lookup to download', async () => {
    let cat = await fresh();
    const calls = held();
    const a = cat.loadCatalog();
    const b = cat.loadCatalog();
    expect(calls).toHaveLength(1);
    calls[0].res(new Response(JSON.stringify({ items: [item('Kori Blade')] })));
    expect((await a) === (await b)).toBe(true);

    cat = await fresh();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await expect(cat.loadCatalog()).rejects.toThrow('offline');
    const { result } = renderHook(() => cat.useCatalogVersion());
    const before = result.current;
    await act(() => cat.refreshCatalog());
    expect(result.current).toBe(before);
    const fetch = serve(() => [item('Kori Blade')]);
    expect([(await cat.loadCatalog()).map((i) => i.name), fetch.mock.calls.length]).toEqual([['Kori Blade'], 1]);
  });

});

describe('card catalog downloads that overlap', () => {
  // Generated on 2026-10-25 (/ship review, run 16, state machines)
  // Value: protects=a pull while the first download is still out keeps whichever copy arrives, and if both fail the next
  // lookup downloads again; fails_when=the first download's failure drops the pull's copy, or a failed download stays
  // cached so the catalog never loads again (Add card names, Find images, the Maxed page's Try again); why_new=review
  // (state machines, testing); seam=fetch downloads settled by hand in either order; no_claim=none beyond protects
  it('keeps the copy that arrives, and tries again after both fail', async () => {
    let cat = await fresh();
    let calls = held();
    const first = cat.loadCatalog().catch(() => 'failed');
    const pull = cat.refreshCatalog();
    calls[0].rej(new Error('timeout'));
    expect(await first).toBe('failed');
    calls[1].res(new Response(JSON.stringify({ items: [item('Kori Blade')] })));
    await pull;
    expect((await cat.loadCatalog()).map((i) => i.name)).toEqual(['Kori Blade']);
    expect(calls).toHaveLength(2);

    cat = await fresh();
    calls = held();
    const again = cat.loadCatalog().catch(() => 'failed');
    const pull2 = cat.refreshCatalog();
    calls[0].rej(new Error('timeout'));
    await again;
    calls[1].rej(new Error('timeout'));
    await pull2;
    const retry = cat.loadCatalog();
    expect(calls).toHaveLength(3);
    calls[2].res(new Response(JSON.stringify({ items: [] })));
    await expect(retry).resolves.toEqual([]);
  });

  // Generated on 2026-10-25 (/ship review, run 16, state machines)
  // Value: protects=after a first download failed (offline at launch), a pull that works brings the catalog in and tells
  // screens to look again; fails_when=screens keep saying the list didn't load; why_new=review (state machines): every
  // refresh test started with a copy; seam=fetch stubbed; no_claim=none beyond protects
  it('brings the catalog in with a pull after the first download failed', async () => {
    const { loadCatalog, refreshCatalog, useCatalogVersion } = await fresh();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await expect(loadCatalog()).rejects.toThrow('offline');
    const { result } = renderHook(() => useCatalogVersion());
    const before = result.current;
    const fetch = serve(() => [item('Kori Blade')]);
    await act(() => refreshCatalog());
    expect([result.current !== before, (await loadCatalog()).map((i) => i.name), fetch.mock.calls.length]).toEqual([true, ['Kori Blade'], 1]);
  });
});
