// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useNow } from './ui';

const seen: Date[] = [];
function Clock() {
  seen.push(useNow());
  return null;
}

/** Sets what the page reports for document.visibilityState, then sends the event the app listens for. */
function show(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

afterEach(() => {
  cleanup();
  seen.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the shared clock', () => {
  // Value: protects=the time is read again when the app comes back after a while, and not on a quick switch or while
  // hidden; fails_when=the visibilitychange listener goes, the visible check flips, or the 30s threshold goes; why_new=
  // useNow had no test; seam=none; no_claim=the once-a-minute interval (timers aren't faked)
  it('reads the time again when the app comes back after a while, but not after a quick switch', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    render(<Clock />);
    const at = () => seen.at(-1)!.toISOString();
    const start = at();

    vi.setSystemTime(new Date('2026-10-12T12:00:10'));
    show('visible');
    expect(at()).toBe(start); // back after ten seconds: same time, so the plan isn't worked out again

    vi.setSystemTime(new Date('2026-10-12T15:00:00'));
    show('hidden');
    expect(at()).toBe(start);
    show('visible');
    expect(at()).toBe(new Date('2026-10-12T15:00:00').toISOString());
  });
});
