// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { CardThumb, useNow } from './ui';
import type { Card } from './types';

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

  // Regression: /ship review of todo-followups — waking the phone read the time twice, so the planner ran twice
  // Found by /ship on 2026-10-12
  // Value: protects=after a return reads the time, the next reading is a full minute later; fails_when=the minute timer
  // keeps its old schedule and fires again moments after the return; why_new=review; seam=none; no_claim=how a real
  // phone orders the overdue tick and the visibility event
  it('waits a full minute after reading the time on a return before reading it again', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    render(<Clock />);
    const readings = () => new Set(seen).size;
    act(() => vi.advanceTimersByTime(40000));
    show('hidden');
    // Asleep three hours with timers paused: the minute tick is still 20s off on the timer's own clock.
    vi.setSystemTime(new Date('2026-10-12T15:00:00'));
    show('visible');
    expect(readings()).toBe(2);
    act(() => vi.advanceTimersByTime(59000));
    expect(readings()).toBe(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(readings()).toBe(3);
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T15:01:00').toISOString());
  });

  // Value: protects=back after half a minute away, the time isn't read again if the minute tick already read it moments
  // ago; fails_when=the tick sets the time without moving the last-read time on, so the return reads again and the plan
  // runs twice; why_new=no test lets a tick fire while away; seam=none; no_claim=real phones pausing timers
  it('keeps the time the minute tick read while away when the app comes back', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    render(<Clock />);
    const readings = () => new Set(seen).size;
    act(() => vi.advanceTimersByTime(10000));
    show('hidden');
    // Away 55 seconds; the tick at 12:01:00 still runs and reads the time.
    act(() => vi.advanceTimersByTime(55000));
    expect(readings()).toBe(2);
    show('visible');
    expect(readings()).toBe(2);
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T12:01:00').toISOString());
  });

  // Regression: review of clock-and-gear-taps — a restore sending both events read the time on the second one
  // Found by /review on 2026-10-13
  // Value: protects=a restore that sends both a visibility change and pageshow is one return, read at most once;
  // fails_when=the second event, finding no hidden time, counts as a long absence and reads a reading under a minute old;
  // why_new=review; seam=none; no_claim=which order real browsers send them in
  it('treats a restore that sends both events as one quick return', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (t: string) => vi.setSystemTime(new Date(`2026-10-12T${t}`));
    at('12:00:00');
    render(<Clock />);
    at('12:00:40');
    show('hidden');
    at('12:00:45');
    show('visible');
    act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })));
    expect(new Set(seen).size).toBe(1);
  });

  // Value: protects=a long absence ended by both a visibility change and pageshow reads the time once; fails_when=a
  // reading doesn't move the last-read time on, so the second event reads again and the planner runs twice; why_new=
  // review (testing); seam=none; no_claim=which order real browsers send them in
  it('reads the time once when a long absence ends with both events', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (t: string) => vi.setSystemTime(new Date(`2026-10-12T${t}`));
    at('12:00:00');
    render(<Clock />);
    at('12:00:40');
    show('hidden');
    at('15:00:00');
    show('visible');
    act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })));
    expect(new Set(seen).size).toBe(2);
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T15:00:00').toISOString());
  });

  // Regression: review of clock-and-gear-taps — after the device clock went back, returns kept the old time
  // Found by /review on 2026-10-13
  // Value: protects=a return reads the time when the last reading is later than now (the clock was set back);
  // fails_when=a negative age counts as fresh, so countdowns wait for the minute tick; why_new=review; seam=none;
  // no_claim=time zone changes
  it('reads the time on return after the device clock went back', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (t: string) => vi.setSystemTime(new Date(`2026-10-12T${t}`));
    at('12:00:00');
    render(<Clock />);
    at('11:00:00');
    show('hidden');
    at('11:05:00');
    show('visible');
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T11:05:00').toISOString());
  });

  // Regression: /ship review of todo-followups — a back-forward restore that sends only pageshow kept the old time
  // Found by /ship on 2026-10-12
  // Value: protects=a page restored from the back-forward cache reads the time when no visibility event comes;
  // fails_when=only visibilitychange is listened for, or the first load's pageshow reads it again; why_new=review;
  // seam=none; no_claim=which browsers skip the visibility event
  it('reads the time on a back-forward restore, but not on the first load', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00'));
    render(<Clock />);
    const restore = (persisted: boolean) =>
      act(() => {
        window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
      });
    vi.setSystemTime(new Date('2026-10-12T15:00:00'));
    restore(false);
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T12:00:00').toISOString());
    restore(true);
    expect(seen.at(-1)!.toISOString()).toBe(new Date('2026-10-12T15:00:00').toISOString());
  });
});

describe('card art that failed to load', () => {
  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=after a card's art fails, a new URL for it (MK Mobile Base art replacing dead wiki art) is shown;
  // fails_when=the thumbnail keeps a plain failed flag, so every later URL for that card shows initials too; why_new=
  // CardsView.test.tsx covers the same URL staying failed after a page switch, not a new URL; seam=none; no_claim=the
  // browser's image loading (the img's error event is fired by hand)
  it("shows a new picture once the card's art changes after a failure", () => {
    const kitana = (imageUrl: string): Card => ({ id: 'kitana', name: 'Kitana', rarityId: 'gold', fusion: 2, guest: false, imageUrl });
    const { container, rerender } = render(<CardThumb card={kitana('https://example.invalid/old.png')} />);
    act(() => void container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    rerender(<CardThumb card={kitana('https://example.invalid/new.png')} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/new.png');
  });
});
