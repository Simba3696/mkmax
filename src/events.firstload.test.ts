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
  // Value: protects=when the first download hangs, a return half a minute later starts another; fails_when=a pending
  // first download counts as fresh, so the schedule stays missing until a reload; why_new=review (Red Team); seam=fetch
  // stubbed; no_claim=the browser's own request timeout
  it('tries again on return when the first download has hung', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    renderHook(() => useEvents());
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-12T12:00:40'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
