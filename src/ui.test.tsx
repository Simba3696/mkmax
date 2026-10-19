// @vitest-environment jsdom
import { Activity } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CardThumb, ConfirmButton, useNow, dayLabel, onMaxedNote } from './ui';
import { defaultRarities } from './defaults';
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

describe('a confirm button', () => {
  // Regression: /ship review of stale-screens-and-schedule — a confirm button still on screen acted again on a third tap
  // Found by /ship on 2026-10-14
  // Value: protects=a confirm button acts once per arm: a quick third tap arms it again instead of acting twice;
  // fails_when=it stays armed after acting, so Ended early (still on screen) ends the new season too; why_new=review
  // (Red Team); seam=none; no_claim=the screens that use it
  it('acts once per arm, so a quick third tap arms it again', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Ended early" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ended early' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ended early' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Tap again to confirm' })).not.toBeNull();
  });

  // Generated by /ship review fixes on 2026-10-14
  // Value: protects=a second tap more than 3 seconds after the first arms the button again instead of acting, even while
  // it still reads "Tap again to confirm"; fails_when=the tap trusts the armed label, so a late tap (timer held back by a
  // busy or hidden page) acts; why_new=review (testing): the page-switch test disarms before its tap; seam=Date.now
  // spied; no_claim=the timer itself
  it('arms again rather than acting on a tap more than 3 seconds after the first', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 4000);
    // The 3-second timer hasn't run, so it still reads armed.
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Tap again to confirm' })).not.toBeNull();
  });

  // Regression: /ship review of stale-screens-and-schedule — a clock set back after the first tap let a late tap confirm
  // Found by /ship on 2026-10-14
  // Value: protects=a tap after the device clock went back since the first tap arms the button again instead of acting;
  // fails_when=a negative elapsed time counts as within the 3 seconds, so the tap confirms; why_new=review (adversarial);
  // seam=Date.now spied; no_claim=the effect that disarms on a re-render
  it('arms again rather than acting when the clock went back after the first tap', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 3600_000);
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Tap again to confirm' })).not.toBeNull();
  });

  // Regression: /ship review of stale-screens-and-schedule — a button shown again after the clock went back stayed armed
  // Found by /ship on 2026-10-14
  // Value: protects=a confirm button armed before the device clock went back reads its label again when its page is
  // shown again; fails_when=only an elapsed time past 3 seconds disarms it, so it reads armed until the clock catches
  // up; why_new=review (testing): the test above covers the tap, not the re-show; seam=Date.now spied, Activity hides it;
  // no_claim=a real clock change
  it('reads its label again when shown after the clock went back', () => {
    const page = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <ConfirmButton label="Delete" onConfirm={() => {}} />
      </Activity>
    );
    const { rerender } = render(page('visible'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    rerender(page('hidden'));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 3600_000);
    act(() => rerender(page('visible')));
    expect(screen.queryByRole('button', { name: 'Tap again to confirm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeNull();
  });

  // Generated by /ship review fixes on 2026-10-14
  // Value: protects=a confirm button hidden and shown again within its 3 seconds (a quick Cards and Tower gear switch)
  // stays armed, and the next tap acts once, as the user guide says; fails_when=hiding the page disarms it, so the
  // second tap only arms it again; why_new=review (testing): the tests above hide it past 3 seconds or across a clock
  // change; seam=Date.now spied, Activity hides it; no_claim=a real page switch
  it('stays armed when shown again within its 3 seconds', () => {
    const onConfirm = vi.fn();
    const page = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <ConfirmButton label="Delete" onConfirm={onConfirm} />
      </Activity>
    );
    const { rerender } = render(page('visible'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    rerender(page('hidden'));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    act(() => rerender(page('visible')));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // Generated by /ship test coverage audit on 2026-10-14
  // Value: protects=a confirm button left alone reads "Tap again to confirm" for 3 seconds, then its label again;
  // fails_when=the timer's delay from armedAt is miscounted, so it reverts early or stays armed-looking; why_new=the tests
  // above spy Date.now or tap, none lets the timer run; seam=none; no_claim=a page hidden mid-countdown
  it('goes back to its label 3 seconds after the first tap', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    render(<ConfirmButton label="Delete" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.queryByRole('button', { name: 'Tap again to confirm' })).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeNull();
  });
});

describe('dayLabel', () => {
  // Generated by /ship review fixes on 2026-10-18
  // Value: protects=a Maxed day shows as the app's other dates do, with the year only in another year, and text that isn't
  // a day (a hand-edited file) shows as typed; fails_when="Invalid Date" shows, or the year is always or never added;
  // why_new=the Maxed page tests use this year's days only; seam=none; no_claim=the locale's own format
  it('shows a saved day like other dates, with the year only when it differs, and odd text as typed', () => {
    const now = new Date(2026, 9, 18);
    expect(dayLabel('2026-10-05', now)).toBe(new Date(2026, 9, 5).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    expect(dayLabel('2025-02-06', now)).toBe(new Date(2025, 1, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    expect(dayLabel('yesterday', now)).toBe('yesterday');
  });
});

describe('onMaxedNote', () => {
  // Generated by /ship review fixes on 2026-10-18
  // Value: protects=the note for a card on the Maxed record points a rarity that ascends (Gold) to Paste a list with its
  // Stage, leaves that out for Diamond and gear, and tells a Kameo it's owned already; fails_when=the Stage hint goes
  // for Gold or shows for a rarity that can't take a Stage; why_new=the screen tests only match the note's opening;
  // seam=none; no_claim=where the note shows (CardsView and PacksView tests)
  it('mentions a Stage only for rarities that ascend', () => {
    const rule = (id: string) => defaultRarities().find((r) => r.id === id)!;
    const stage = /paste it in Cards → Paste a list with its Stage/;
    expect([stage.test(onMaxedNote(rule('gold'))), stage.test(onMaxedNote(rule('diamond'))), stage.test(onMaxedNote(rule('epic')))]).toEqual([true, false, false]);
    expect(onMaxedNote(rule('kameo-gold'))).toMatch(/^That Kameo is on your Maxed record, so you own it already/);
  });
});
