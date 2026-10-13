// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEvents } from './events';

// Its own file, so events.ts starts with no schedule downloaded, as the app does when it opens.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('event schedule that never loaded', () => {
  // Regression: /ship review of clock-and-gear-taps — a first download that hung was never tried again on return
  // Found by /ship on 2026-10-13
  // Value: protects=a return leaves a first download under half a minute old to finish, starts another once it has hung
  // that long, and the download carries a timeout; fails_when=a pending first download counts as fresh (never retried) or
  // any return starts a second one at once; why_new=review (Red Team, testing, performance); seam=fetch stubbed;
  // no_claim=the browser's own abort timing
  it('tries again on return when the first download has hung', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    renderHook(() => useEvents());
    expect(fetch).toHaveBeenCalledTimes(1);
    // A fetch timeout lets the browser give up on a hung download.
    expect((fetch.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    // Five seconds on, the first download is still on its way: a return leaves it to finish.
    vi.setSystemTime(new Date('2026-10-12T12:00:05'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-12T12:00:40'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
