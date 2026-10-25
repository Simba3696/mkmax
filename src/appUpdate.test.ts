// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

type Hooks = { onNeedRefresh?: () => void; onNeedReload?: () => void; onRegisteredSW?: (url: string, r: ServiceWorkerRegistration) => void };

// A fresh copy of the module for each test, since it keeps what it found (and whether Reload was tapped) for the page.
let app: typeof import('./appUpdate');
let hooks: Hooks;
let controller: object | null;
let waiting: EventTarget & { state: string };
let reg: { waiting: typeof waiting | null; update: ReturnType<typeof vi.fn> };
const update = vi.fn((_reload?: boolean) => Promise.resolve());
const reload = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  app = await import('./appUpdate');
  reload.mockClear();
  update.mockClear();
  vi.stubGlobal('location', { reload });
  controller = {};
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => ({ controller }) });
  waiting = Object.assign(new EventTarget(), { state: 'installed' });
  reg = { waiting, update: vi.fn(() => Promise.resolve()) };
  // Stands in for the plugin's registerSW, which main.tsx passes in.
  app.startServiceWorker(((o: Hooks) => {
    hooks = o;
    o.onRegisteredSW?.('sw.js', reg as unknown as ServiceWorkerRegistration);
    return update;
  }) as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('app update', () => {
  // Generated on 2026-10-25 (/ship review, update approach)
  // Value: protects=a new build found while the app is open is only flagged as ready (the page's bar shows it) and never
  // reloads by itself, even when a second one is found, and Reload switches to it through the service worker;
  // fails_when=finding a build reloads at once, throwing away whatever is in progress (a half-filled form, a paste, a
  // pull being logged), or Reload doesn't ask the waiting worker to take over; why_new=the app no longer reloads by
  // itself; seam=registerSW passed in by hand; no_claim=a real service worker update
  it('flags a new version as ready without reloading, and Reload switches to it', () => {
    const { result } = renderHook(() => app.useAppUpdateReady());
    expect(result.current).toBe(false);
    act(() => hooks.onNeedRefresh!());
    act(() => hooks.onNeedRefresh!());
    expect([result.current, reload.mock.calls.length, update.mock.calls.length]).toEqual([true, 0, 0]);
    app.applyAppUpdate();
    expect([update.mock.calls, reload.mock.calls.length]).toEqual([[[true]], 0]);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=when one open copy taps Reload and the new version takes over, only that copy reloads; fails_when=
  // every other open copy (another tab, the installed app beside a browser tab) reloads too, losing what's half typed
  // there; why_new=review (state machines); seam=registerSW passed in by hand, its onNeedReload called by hand;
  // no_claim=which pages the browser hands to the new worker
  it('reloads only the copy whose Reload was tapped when the new version takes over', () => {
    hooks.onNeedReload!();
    expect(reload).not.toHaveBeenCalled();
    app.applyAppUpdate();
    hooks.onNeedReload!();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=Reload in a copy whose new version another copy already switched to still loads it; fails_when=
  // Reload does nothing, since no worker is waiting and nothing takes over; why_new=review (state machines);
  // seam=registerSW passed in by hand; no_claim=a real service worker
  it('reloads at once when another copy already switched to the new version', () => {
    reg.waiting = null;
    app.applyAppUpdate();
    expect([reload.mock.calls.length, update.mock.calls.length]).toEqual([1, 0]);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=Reload on a page the old version didn't control (a hard reload, or the first visit) reloads once the
  // new version is active; fails_when=the first tap only switches other copies and this page stays put; why_new=review
  // (Red Team); seam=registerSW passed in by hand, the waiting worker's statechange sent by hand; no_claim=a real worker
  it('reloads a page the old version didn’t control once the new one is active', () => {
    controller = null;
    app.applyAppUpdate();
    expect([update.mock.calls, reload.mock.calls.length]).toEqual([[[true]], 0]);
    waiting.state = 'activated';
    waiting.dispatchEvent(new Event('statechange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=an app coming back to the screen half an hour or more after it last looked for a new version looks
  // again, and not sooner; fails_when=a phone app, resumed rather than started, never finds a new version (sync stays
  // paused on newer data until the user pulls), or every return looks; why_new=review (Red Team); seam=fake Date,
  // document.visibilityState mocked; no_claim=how often a real phone resumes rather than restarts the app
  it('looks for a new version on coming back after half an hour', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let visible = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
    const back = (minutes: number) => {
      vi.setSystemTime(new Date(2026, 9, 25, 12, minutes));
      document.dispatchEvent(new Event('visibilitychange'));
    };
    vi.setSystemTime(new Date(2026, 9, 25, 12, 0));
    void app.checkForAppUpdate();
    back(29);
    expect(reg.update).toHaveBeenCalledTimes(1);
    visible = 'hidden';
    back(31);
    expect(reg.update).toHaveBeenCalledTimes(1);
    visible = 'visible';
    back(31);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });
});
