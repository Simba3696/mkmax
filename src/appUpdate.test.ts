// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

type Hooks = { onNeedRefresh?: () => void; onNeedReload?: () => void; onRegisterError?: (e: unknown) => void; onRegisteredSW?: (url: string, r: ServiceWorkerRegistration) => void };
type Worker = EventTarget & { state: string };

// A fresh copy of the module for each test, since it keeps what it found for the page.
let app: typeof import('./appUpdate');
let stop: () => void;
let hooks: Hooks;
/** The browser's service worker container: the worker running this page (null on one it doesn't control). */
let sw: EventTarget & { controller: object | null };
let waiting: Worker;
let reg: EventTarget & { waiting: Worker | null; installing: Worker | null; update: ReturnType<typeof vi.fn> };
const update = vi.fn((_reload?: boolean) => Promise.resolve());
const reload = vi.fn();
const worker = (state: string): Worker => Object.assign(new EventTarget(), { state });
const becomes = (w: Worker, state: string) => ((w.state = state), w.dispatchEvent(new Event('statechange')));

beforeEach(async () => {
  vi.resetModules();
  app = await import('./appUpdate');
  reload.mockClear();
  update.mockClear();
  vi.stubGlobal('location', { reload });
  sw = Object.assign(new EventTarget(), { controller: {} as object | null });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => sw });
  waiting = worker('installed');
  reg = Object.assign(new EventTarget(), { waiting: waiting as Worker | null, installing: null as Worker | null, update: vi.fn(() => Promise.resolve()) });
  // Stands in for the plugin's registerSW, which main.tsx passes in. Nothing is waiting yet when it registers.
  stop = app.startServiceWorker(((o: Hooks) => {
    hooks = o;
    const found = reg.waiting;
    reg.waiting = null;
    o.onRegisteredSW?.('sw.js', reg as unknown as ServiceWorkerRegistration);
    reg.waiting = found;
    return update;
  }) as never);
});
afterEach(() => {
  stop();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('app update', () => {
  // Generated on 2026-10-25 (/ship review, update approach)
  // Value: protects=a new build found while the app is open is only flagged as ready (the page's bar shows it) and never
  // reloads by itself, even when a second one is found, and Reload switches to it through the service worker, reloading
  // once it takes over; fails_when=finding a build reloads at once, throwing away whatever is in progress (a half-filled
  // form, a paste, a pull being logged), or Reload doesn't ask the waiting worker to take over or never reloads;
  // why_new=the app no longer reloads by itself; seam=registerSW passed in by hand, controllerchange sent by hand;
  // no_claim=a real service worker update
  it('flags a new version as ready without reloading, and Reload switches to it', () => {
    const { result } = renderHook(() => app.useAppUpdateReady());
    expect(result.current).toBe(false);
    act(() => hooks.onNeedRefresh!());
    act(() => hooks.onNeedRefresh!());
    expect([result.current, reload.mock.calls.length, update.mock.calls.length]).toEqual([true, 0, 0]);
    app.applyAppUpdate();
    expect([update.mock.calls, reload.mock.calls.length]).toEqual([[[true]], 0]);
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=when another open copy taps Reload and the new version takes over, this copy doesn't reload, whether
  // or not a version is waiting for it; fails_when=every open copy (another tab, the installed app beside a browser tab)
  // reloads, losing what's half typed there; why_new=review (state machines); seam=registerSW passed in by hand, its
  // onNeedReload and controllerchange sent by hand; no_claim=which pages the browser hands to the new worker
  it('doesn’t reload when another copy switches to the new version', () => {
    hooks.onNeedReload!();
    sw.dispatchEvent(new Event('controllerchange'));
    reg.waiting = null;
    hooks.onNeedReload!();
    expect(reload).not.toHaveBeenCalled();
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=Reload in a copy whose new version another copy already switched to still loads it, controlled or
  // not; fails_when=Reload does nothing, since no worker is waiting and nothing takes over; why_new=review (state
  // machines); seam=registerSW passed in by hand; no_claim=a real service worker
  it('reloads at once when another copy already switched to the new version', () => {
    reg.waiting = null;
    app.applyAppUpdate();
    sw.controller = null;
    app.applyAppUpdate();
    expect([reload.mock.calls.length, update.mock.calls.length]).toEqual([2, 0]);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=Reload on a page the old version didn't control (a hard reload, or the first visit) reloads once the
  // new version is active; fails_when=the first tap only switches other copies and this page stays put; why_new=review
  // (Red Team); seam=registerSW passed in by hand, the waiting worker's statechange sent by hand; no_claim=a real worker
  it('reloads a page the old version didn’t control once the new one is active', () => {
    sw.controller = null;
    app.applyAppUpdate();
    expect([update.mock.calls, reload.mock.calls.length]).toEqual([[[true]], 0]);
    becomes(waiting, 'activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3)
  // Value: protects=Reload still reloads when the version it asked to take over is replaced by a newer one first;
  // fails_when=the tap seems to do nothing; why_new=review (state machines); seam=the waiting worker's statechange sent
  // by hand; no_claim=a real worker
  it('reloads when the waiting version is replaced before it takes over', () => {
    app.applyAppUpdate();
    becomes(waiting, 'redundant');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3)
  // Value: protects=a new version installed while an older one runs the page brings up the bar even when the library
  // reports nothing (it stops after the first it sees), and a first install doesn't; fails_when=after one failed
  // install the bar never shows again, or a first visit shows a bar for the version it's already running;
  // why_new=review (Red Team); seam=the registration's updatefound and the worker's statechange sent by hand;
  // no_claim=a real service worker
  it('flags a new version the library didn’t report, but not a first install', () => {
    const { result } = renderHook(() => app.useAppUpdateReady());
    const install = (controlled: boolean) => {
      sw.controller = controlled ? {} : null;
      const w = worker('installing');
      reg.installing = w;
      act(() => void reg.dispatchEvent(new Event('updatefound')));
      // A first install passes through waiting too, on its way to running at once.
      reg.waiting = w;
      act(() => void becomes(w, 'installed'));
    };
    install(false);
    expect(result.current).toBe(false);
    install(true);
    expect(result.current).toBe(true);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3)
  // Value: protects=a check that finds a version waiting brings up the bar, and once one is waiting no more checks are
  // made; fails_when=the bar waits on the library's events alone, or every paused sync and every save from a newer tab
  // fetches the service worker again for nothing; why_new=review (Red Team, performance); seam=registration.update
  // mocked; no_claim=a real service worker
  it('flags a version found by a check, and stops checking once one is waiting', async () => {
    const { result } = renderHook(() => app.useAppUpdateReady());
    await act(() => app.checkForAppUpdate());
    expect([result.current, reg.update.mock.calls.length]).toEqual([true, 1]);
    await app.checkForAppUpdate();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship coverage audit, run 16)
  // Value: protects=a check that fails (offline) settles quietly, doesn't bring up the bar even with a version waiting,
  // and a later check still asks; fails_when=the failure handler goes (an unhandled rejection from every pull to refresh,
  // return to the app and paused sync) or a failed check counts as finding a version; why_new=no test made
  // registration.update fail; seam=registration.update mocked; no_claim=a real network failure
  it('a check that fails offline flags nothing and the next check still runs', async () => {
    const { result } = renderHook(() => app.useAppUpdateReady());
    reg.update.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(() => app.checkForAppUpdate());
    expect([result.current, reg.update.mock.calls.length]).toEqual([false, 1]);
    await act(() => app.checkForAppUpdate());
    expect([result.current, reg.update.mock.calls.length]).toEqual([true, 2]);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=an app coming back to the screen half an hour or more after it last looked for a new version looks
  // again (also when restored from the back-forward cache with only pageshow), and not sooner or while hidden;
  // fails_when=a phone app, resumed rather than started, never finds a new version, or every return looks;
  // why_new=review (Red Team); seam=fake Date, document.visibilityState mocked, pageshow sent by hand; no_claim=how often
  // a real phone resumes rather than restarts the app
  it('looks for a new version on coming back after half an hour', async () => {
    reg.waiting = null;
    vi.useFakeTimers({ toFake: ['Date'] });
    let visible = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
    const at = (minutes: number) => vi.setSystemTime(new Date(2026, 9, 25, 12, minutes));
    const back = (minutes: number) => (at(minutes), document.dispatchEvent(new Event('visibilitychange')));
    at(0);
    await app.checkForAppUpdate();
    back(29);
    visible = 'hidden';
    back(31);
    expect(reg.update).toHaveBeenCalledTimes(1);
    visible = 'visible';
    back(30);
    expect(reg.update).toHaveBeenCalledTimes(2);
    at(61);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(reg.update).toHaveBeenCalledTimes(3);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3)
  // Value: protects=a browser where the service worker can't run says so, so pull to refresh reloads there instead;
  // fails_when=pull to refresh never loads a new version in a private window or an in-app browser; why_new=review (Red
  // Team); seam=registerSW's onRegisterError called by hand; no_claim=which browsers block it
  it('says when there’s no service worker to find a new version', () => {
    expect(app.hasServiceWorker()).toBe(true);
    hooks.onRegisterError!(new Error('blocked'));
    expect(app.hasServiceWorker()).toBe(false);
  });

  // Generated on 2026-10-25 (/ship coverage audit, run 16)
  // Value: protects=a browser with no service worker support at all (no navigator.serviceWorker, where the plugin
  // registers nothing and reports no error) says so too; fails_when=only a failed registration counts, so pull to
  // refresh there neither reloads nor finds a new version; why_new=the test above covers only a registration error;
  // seam=navigator.serviceWorker removed by hand; no_claim=which browsers lack it
  it('says there’s no service worker where the browser has none', () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(app.hasServiceWorker()).toBe(false);
  });
});
