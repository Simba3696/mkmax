// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { refreshEvents, useEvents } from './events';

// The schedule's download time and in-flight download are shared by the whole module, so these tests run in order
// and each one sets the time it starts from.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const pageshow = (persisted: boolean) => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
const back = () => document.dispatchEvent(new Event('visibilitychange'));
const at = (t: string) => vi.setSystemTime(new Date(`2026-10-12T${t}`));
const schedule = (fetchedAt: string) => new Response(JSON.stringify({ fetchedAt }));
/** A download the test settles by hand. */
function deferred() {
  let settle!: { resolve: (r: Response) => void; reject: (e: Error) => void };
  const promise = new Promise<Response>((resolve, reject) => (settle = { resolve, reject }));
  return { promise, ...settle };
}

describe('event schedule on return', () => {
  // Regression: review of clock-and-gear-taps — after a failed first download, coming back never tried again
  // Found by /review on 2026-10-13
  // Value: protects=a return fetches the schedule when no download has ever worked; fails_when=a never-loaded schedule
  // counts as fresh; why_new=review (adversarial); seam=fetch stubbed; no_claim=pull to refresh
  it('tries again on return when the first download failed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('12:00:00');
    const fetch = vi.fn(async (): Promise<Response> => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetch);
    await refreshEvents();
    fetch.mockClear();
    back();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fetch.mock.settledResults[0]?.type).toBe('rejected'));
  });

  // Regression: review of clock-and-gear-taps — a restore sending pageshow and a visibility change fetched it twice,
  // and after the device clock went back, returns skipped the refresh for an hour
  // Found by /review on 2026-10-13
  // Value: protects=a back-forward restore over an hour on fetches the schedule once, the first load's pageshow doesn't,
  // a return within the hour doesn't, and a download time later than now counts as old; fails_when=the pageshow listener
  // goes, persisted is ignored, two events start two downloads, the hourly limit goes, or a negative age counts as fresh;
  // why_new=review (performance, Red Team, adversarial, testing); seam=fetch stubbed; no_claim=real browsers' event order
  it('fetches the schedule once per return when it is old, including after the clock went back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('12:00:00');
    const fetch = vi.fn(async () => schedule('2026-10-12T00:00:00Z'));
    vi.stubGlobal('fetch', fetch);
    await refreshEvents();
    fetch.mockClear();

    // Half an hour on: still fresh.
    at('12:30:00');
    back();
    pageshow(true);
    expect(fetch).not.toHaveBeenCalled();

    // Two hours on, a restore sends both events: one download.
    at('14:00:00');
    pageshow(false);
    expect(fetch).not.toHaveBeenCalled();
    pageshow(true);
    back();
    expect(fetch).toHaveBeenCalledTimes(1);
    await refreshEvents(); // a pull to refresh, so the download time settles at 14:00
    fetch.mockClear();

    // The device clock goes back an hour: the schedule counts as old, not fresh for another hour.
    at('13:00:00');
    back();
    expect(fetch).toHaveBeenCalledTimes(1);
    await refreshEvents();
  });

  // Regression: review of clock-and-gear-taps — one download that never finished stopped returns refreshing it
  // Found by /review on 2026-10-13
  // Value: protects=a download stuck for half a minute, or started at a time the clock has since gone back past, no longer
  // blocks the next return's; fails_when=the in-flight guard waits for a download that never settles, or a negative wait
  // counts as busy; why_new=review (Red Team, adversarial); seam=fetch stubbed; no_claim=the browser's own request timeout
  it('starts a new download on return once a stuck one has had half a minute', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('16:00:00');
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    back();
    expect(fetch).toHaveBeenCalledTimes(1);
    at('16:00:10');
    back();
    expect(fetch).toHaveBeenCalledTimes(1);
    at('16:00:40');
    back();
    expect(fetch).toHaveBeenCalledTimes(2);

    // The device clock goes back while that one hangs: a download "started" in the future doesn't block the return.
    at('15:00:00');
    back();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  // Value: protects=a failed older download doesn't cancel a newer one still running, and only the newest download's
  // schedule is shown; fails_when=the older one clears the in-flight download (a new screen starts a third) or, finishing
  // last, replaces the newer schedule; why_new=review (testing, Red Team, adversarial); seam=fetch stubbed;
  // no_claim=the schedule's contents
  it('lets the newest download win when two overlap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('18:00:00');
    const older = deferred();
    const newer = deferred();
    const fetch = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    vi.stubGlobal('fetch', fetch);
    const first = refreshEvents();
    const second = refreshEvents();
    older.reject(new Error('offline'));
    await first;
    // A screen opening now shares the newer download instead of starting a third.
    const { result } = renderHook(() => useEvents());
    expect(fetch).toHaveBeenCalledTimes(2);
    newer.resolve(schedule('newer'));
    await second;
    await vi.waitFor(() => expect(result.current?.fetchedAt).toBe('newer'));

    // An older download that succeeds after a newer one doesn't replace it.
    const slow = deferred();
    const fast = deferred();
    fetch.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const a = refreshEvents();
    const b = refreshEvents();
    fast.resolve(schedule('fast'));
    await b;
    slow.resolve(schedule('slow'));
    await a;
    await vi.waitFor(() => expect(result.current?.fetchedAt).not.toBe('newer'));
    expect(result.current?.fetchedAt).toBe('fast');
  });

  // Regression: /ship review of clock-and-gear-taps — a good download was dropped when a newer one then failed
  // Found by /ship on 2026-10-13
  // Value: protects=a download that finishes is shown unless a newer one has already been shown, even if the newer one
  // then fails; fails_when=only the most recently started download may be shown, so a failing newer one leaves the old
  // schedule; why_new=review (Red Team); seam=fetch stubbed; no_claim=the schedule's contents
  it('keeps a download that worked when a newer one then fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('19:00:00');
    const older = deferred();
    const newer = deferred();
    const fetch = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useEvents());
    const a = refreshEvents();
    const b = refreshEvents();
    older.resolve(schedule('kept'));
    await a;
    newer.reject(new Error('offline'));
    await b;
    await vi.waitFor(() => expect(result.current?.fetchedAt).toBe('kept'));
  });

  // Value: protects=hiding the app, or a restore while hidden, never downloads the schedule, and the next return does
  // once; fails_when=the visible check goes, so a download starts on hide and the in-flight guard then swallows the real
  // return's refresh; why_new=review (testing); seam=fetch stubbed; no_claim=real browsers' event order
  it('does not fetch the schedule while the app is hidden', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('20:00:00');
    const fetch = vi.fn(async () => schedule('x'));
    vi.stubGlobal('fetch', fetch);
    await refreshEvents();
    fetch.mockClear();
    at('22:00:00');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    back();
    pageshow(true);
    expect(fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    back();
    expect(fetch).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
    await refreshEvents();
  });

  // Regression: /ship review of clock-and-gear-taps — a screen opened during an older download got the older schedule
  // Found by /ship on 2026-10-13
  // Value: protects=a screen that opened while an older download ran shows the newer schedule once both finish;
  // fails_when=the older download hands its own result to screens waiting on it, after the newer one was shown;
  // why_new=review (Red Team, testing); seam=fetch stubbed; no_claim=the season-end move that reads it (App)
  it('keeps the newer schedule on a screen that opened during an older download', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('21:00:00');
    const older = deferred();
    const newer = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise));
    const a = refreshEvents();
    const { result } = renderHook(() => useEvents());
    const b = refreshEvents();
    newer.resolve(schedule('newer2'));
    await b;
    older.resolve(schedule('older2'));
    await a;
    await vi.waitFor(() => expect(result.current?.fetchedAt).toBe('newer2'));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current?.fetchedAt).toBe('newer2');
  });

  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=a schedule download still running after half a minute is cancelled then, not before; fails_when=the
  // abort timer goes or its delay is wrong, so a hung download is never cancelled (or a slow one is cut short);
  // why_new=events.firstload.test.ts only checks a signal is passed; seam=fetch stubbed; no_claim=a real browser
  // cancelling the request (the stub rejects on abort as fetch does)
  it('cancels a download that is still running after half a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    at('23:00:00');
    let signal!: AbortSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal!;
        return new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }),
    );
    const download = refreshEvents();
    vi.advanceTimersByTime(29_999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    await download;
  });
});
