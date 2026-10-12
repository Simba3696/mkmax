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
  // Regression: /ship review of todo-followups — short screen locks never refreshed a clock whose minute tick was missed
  // Found by /ship on 2026-10-12
  // Value: protects=a quick return still reads the time when the last reading is over a minute old (a tick was missed
  // while the phone slept); fails_when=only the time away decides; why_new=review; seam=none; no_claim=real timers
  it('reads the time on a quick return when the last reading has missed a minute tick', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    render(<Clock />);
    vi.setSystemTime(new Date('2026-10-12T12:01:00'));
    show('hidden');
    vi.setSystemTime(new Date('2026-10-12T12:01:10'));
    show('visible');
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T12:01:10').toISOString());
  });

  // Value: protects=the time is read again when the app comes back after half a minute away, and not after a quick
  // switch, however old the last reading; fails_when=the listener goes, the hidden/visible checks flip, or the time
  // away is measured from the last reading; why_new=the check now times the absence; seam=none; no_claim=the
  // once-a-minute interval (timers aren't faked)
  it('reads the time again after half a minute away, but not after a quick switch', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (t: string) => vi.setSystemTime(new Date(`2026-10-12T${t}`));
    const read = () => seen.at(-1)!.toISOString();
    at('12:00:00');
    render(<Clock />);
    const start = read();

    // Away ten seconds, just before the minute timer would fire: the last reading is 55s old, but the app keeps it.
    at('12:00:45');
    show('hidden');
    at('12:00:55');
    show('visible');
    expect(read()).toBe(start);

    // Away three hours: read again on return, not while still hidden.
    at('12:01:00');
    show('hidden');
    at('15:00:00');
    expect(read()).toBe(start);
    show('visible');
    expect(read()).toBe(new Date('2026-10-12T15:00:00').toISOString());
  });

  // Regression: review of todo-followups — the first return after starting in the background kept the old time
  // Found by /review on 2026-10-12
  // Value: protects=an app that starts hidden still reads the time on its first long-awaited return; fails_when=the
  // absence is only timed from a "hidden" event; why_new=review; seam=none; no_claim=the once-a-minute interval
  it('reads the time again on the first return after starting in the background', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<Clock />);
    vi.setSystemTime(new Date('2026-10-12T15:00:00'));
    show('visible');
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T15:00:00').toISOString());
  });

  // Value: protects=with no "hidden" event before a return (a back-forward restore), the last reading's age decides;
  // fails_when=only a seen "hidden" event can read the time again, or a fresh reading is replaced anyway; why_new=every
  // test above sends "hidden" first or starts hidden; seam=none; no_claim=real browsers' event order on a restore
  it('lets the last reading decide when the app comes back with no hidden event first', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (t: string) => vi.setSystemTime(new Date(`2026-10-12T${t}`));
    const read = () => seen.at(-1)!.toISOString();
    at('12:00:00');
    render(<Clock />);
    const start = read();

    // Ten seconds on: the reading is still fresh, so it stays.
    at('12:00:10');
    show('visible');
    expect(read()).toBe(start);

    // Three hours on, still with no hidden event: read again.
    at('15:00:00');
    show('visible');
    expect(read()).toBe(new Date('2026-10-12T15:00:00').toISOString());
  });
});
