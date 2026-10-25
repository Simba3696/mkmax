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
  // Value: protects=a catalog download that hangs gives up after 30 seconds, so Find images doesn't wait on it for good
  // and the next attempt downloads again; fails_when=the download has no time limit; why_new=review (Red Team);
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

  // Generated on 2026-10-25 (/ship review, run 18 pass 2, state machines)
  // Value: protects=a fetch-again that hangs (a pull or a return after an hour on a connection that stalls) gives up
  // after 30 seconds, keeping the copy already downloaded and telling no screen to look again, and the next pull or
  // return downloads again; fails_when=the fetch-again has no time limit, so it never ends and every later pull or
  // return shares the hung one and never fetches again, or giving up drops the copy or bumps the version;
  // why_new=review (state machines): only a first download that hangs was tested; seam=fetch held open by hand (it
  // settles on its abort signal, as a browser's does), fake timers; no_claim=how long real browsers wait
  it('gives up on a fetch-again that hangs, keeping the copy it has, and the next one tries again', async () => {
    const { loadCatalog, refreshCatalog, useCatalogVersion } = await fresh();
    const calls = held();
    const first = loadCatalog();
    calls[0].res(new Response(JSON.stringify({ items: [item('Kori Blade')] })));
    const copy = await first;
    const { result } = renderHook(() => useCatalogVersion());
    const before = result.current;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pull = refreshCatalog();
    expect(calls).toHaveLength(2);
    calls[1].init!.signal!.addEventListener('abort', () => calls[1].rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    vi.advanceTimersByTime(30 * 1000);
    await act(() => expect(pull).resolves.toBeUndefined());
    expect([(await loadCatalog()) === copy, result.current, calls.length]).toEqual([true, before, 2]);
    void refreshCatalog();
    expect(calls).toHaveLength(3);
  });

  // Generated on 2026-10-25 (/ship review, run 16 pass 2, testing + state machines); changed by /ship review on
  // 2026-10-25 (run 16 pass 3): a pull during the first download now shares it, so the two only overlap when a lookup
  // starts the first download while a pull's is out
  // Value: protects=when the first download lands after a pull's, the pull's newer copy stays; fails_when=the older first
  // download replaces it, so lookups get the copy from before the daily deploy; why_new=review: only the first download
  // failing was tested; seam=fetch downloads settled by hand; no_claim=none
  it('keeps the pull’s copy when the first download lands after it', async () => {
    const cat = await fresh();
    const calls = held();
    const pull = cat.refreshCatalog();
    const first = cat.loadCatalog();
    calls[0].res(new Response(JSON.stringify({ items: [item('Kori Blade'), item('Kitana Fan')] })));
    await pull;
    calls[1].res(new Response(JSON.stringify({ items: [item('Kori Blade')] })));
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
  // Generated on 2026-10-25 (/ship review, run 16, state machines); changed by /ship review on 2026-10-25 (run 16 pass
  // 3): a pull during the first download now shares it rather than starting a second; changed by /ship review on
  // 2026-10-25 (run 18, Red Team): screens are told only when a first copy follows a failed download
  // Value: protects=a pull while the first download is still out waits on that one (no second download on a slow
  // connection), and if it fails nothing stays cached, so the next lookup downloads again, and screens that gave up
  // then (the art lookup, the Maxed page) are told when it works; fails_when=a pull starts a parallel download, a failed
  // download stays cached so the catalog never loads again, or a card added offline never gets its art; why_new=review
  // (state machines, testing, performance, Red Team); seam=fetch downloads settled by hand; no_claim=none beyond protects
  it('shares the first download with a pull, and tries again after it fails', async () => {
    let cat = await fresh();
    let calls = held();
    const { result } = renderHook(() => cat.useCatalogVersion());
    const before = result.current;
    const first = cat.loadCatalog();
    const pull = cat.refreshCatalog();
    expect(calls).toHaveLength(1);
    calls[0].res(new Response(JSON.stringify({ items: [item('Kori Blade')] })));
    await act(() => pull);
    // Everything waiting on that first download gets it, so there's nothing to tell.
    expect([(await first).map((i) => i.name), result.current !== before]).toEqual([['Kori Blade'], false]);

    cat = await fresh();
    calls = held();
    const later = renderHook(() => cat.useCatalogVersion());
    const failedAt = later.result.current;
    const again = cat.loadCatalog().catch(() => 'failed');
    const pull2 = cat.refreshCatalog();
    calls[0].rej(new Error('timeout'));
    expect(await again).toBe('failed');
    await pull2;
    const retry = cat.loadCatalog();
    expect(calls).toHaveLength(2);
    calls[1].res(new Response(JSON.stringify({ items: [] })));
    await act(async () => void (await expect(retry).resolves.toEqual([])));
    expect(later.result.current).not.toBe(failedAt);
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

  // Generated on 2026-10-25 (/ship review, run 18 pass 2, state machines)
  // Value: protects=after a first download failed, a pull and a lookup each start a download; when the lookup's lands
  // first, screens are told, and the pull's (fetched past the browser's copy) then replaces it and tells them again if
  // it differs, but not if it's the same file; fails_when=the copy the lookup brought in blocks the pull's newer one, so
  // lookups keep the copy from before the daily deploy, or the same file landing twice reruns every screen's catalog
  // work; why_new=review (state machines): the two only overlapped with the pull's landing first; seam=fetch downloads
  // settled by hand; no_claim=none beyond protects
  it('takes a pull’s copy landing after a retried first download, and tells screens only when it differs', async () => {
    for (const same of [false, true]) {
      const cat = await fresh();
      const calls = held();
      const failed = cat.loadCatalog().catch(() => 'failed');
      calls[0].rej(new Error('offline'));
      expect(await failed).toBe('failed');
      const { result } = renderHook(() => cat.useCatalogVersion());
      const before = result.current;
      const pull = cat.refreshCatalog();
      const lookup = cat.loadCatalog();
      expect([calls.length, calls[1].init?.cache, calls[2].init?.cache]).toEqual([3, 'no-cache', undefined]);
      const a = [item('Kori Blade')];
      calls[2].res(new Response(JSON.stringify({ items: a })));
      await act(() => lookup);
      expect(result.current).toBe(before + 1);
      calls[1].res(new Response(JSON.stringify({ items: same ? a : [item('Kori Blade'), item('Kitana Fan')] })));
      await act(() => pull);
      expect([(await cat.loadCatalog()).map((i) => i.name), result.current]).toEqual(same ? [['Kori Blade'], before + 1] : [['Kori Blade', 'Kitana Fan'], before + 2]);
    }
  });
});
