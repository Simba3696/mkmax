// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

type Hooks = { onNeedRefresh?: () => void; onNeedReload?: () => void; onRegisteredSW?: (url: string, r: ServiceWorkerRegistration) => void };
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
  // Value: protects=Reload on a page the old version didn't control (a hard reload) reloads once the new version is
  // active; fails_when=the first tap only switches other copies and this page stays put; why_new=review (Red Team);
  // seam=registerSW passed in by hand, the waiting worker's statechange sent by hand; no_claim=a real worker
  it('reloads a page the old version didn’t control once the new one is active', () => {
    sw.controller = null;
    app.applyAppUpdate();
    expect([update.mock.calls, reload.mock.calls.length]).toEqual([[[true]], 0]);
    becomes(waiting, 'activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3); extended by /ship review on 2026-10-25 (run 19 pass 3, state
  // machines) with a page the old version didn't control
  // Value: protects=Reload still reloads when the version it asked to take over is replaced by a newer one first, on a
  // page the old version controlled or on one it didn't (a hard reload); fails_when=the tap seems to do nothing;
  // why_new=review (state machines); seam=the waiting worker's statechange sent by hand; no_claim=a real worker
  it('reloads when the waiting version is replaced before it takes over', () => {
    app.applyAppUpdate();
    becomes(waiting, 'redundant');
    expect(reload).toHaveBeenCalledTimes(1);
    const next = worker('installed');
    reg.waiting = next;
    sw.controller = null;
    app.applyAppUpdate();
    expect([update.mock.calls.length, reload.mock.calls.length]).toEqual([2, 1]);
    becomes(next, 'redundant');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3); changed by /ship review on 2026-10-25 (run 19 pass 2, state
  // machines and testing): a first install is one no worker ran the site before, and a hard-reloaded page counts as run
  // Value: protects=a new version installed while an older one ran the site brings up the bar even when the library
  // reports nothing (it stops after the first it sees), also on a page opened with a hard reload, and a first install
  // doesn't; fails_when=after one failed install the bar never shows again, a hard-reloaded page never offers a version
  // found later, or a first visit shows a bar for the version it's already running; why_new=review (Red Team, state
  // machines); seam=registerSW passed in by hand, the registration's updatefound and the worker's statechange sent by
  // hand; no_claim=a real service worker
  it('flags a new version the library didn’t report, but not a first install', async () => {
    const opened = async (controller: object | null, active: Worker | null) => {
      stop();
      vi.resetModules();
      app = await import('./appUpdate');
      sw.controller = controller;
      reg.waiting = null;
      stop = app.startServiceWorker(((o: Hooks) => (o.onRegisteredSW?.('sw.js', Object.assign(reg, { active }) as unknown as ServiceWorkerRegistration), update)) as never);
      const { result } = renderHook(() => app.useAppUpdateReady());
      const w = worker('installing');
      reg.installing = w;
      act(() => void reg.dispatchEvent(new Event('updatefound')));
      // A first install passes through waiting too, on its way to running at once.
      reg.waiting = w;
      act(() => void becomes(w, 'installed'));
      return result.current;
    };
    // A first visit, an open copy, and a hard reload (no worker runs the page, but one is active for the site).
    expect([await opened(null, null), await opened({}, worker('activated')), await opened(null, worker('activated'))]).toEqual([false, true, true]);
  });

  // Generated on 2026-10-25 (/ship coverage audit, run 17); changed by /ship review on 2026-10-25 (run 19 pass 2, state
  // machines): a hard-reloaded page counts as one a worker ran, so it's offered the waiting version too
  // Value: protects=a copy opened while a new version is already installed and waiting (another copy found it) shows the
  // bar at once, also after a hard reload, and a page no worker ran before doesn't; fails_when=the check at registration
  // goes, so a copy opened then shows no bar until a pull or its next check half an hour on, or a page with no worker
  // before offers a version; why_new=every other test registers with nothing waiting; seam=registerSW passed in by hand;
  // no_claim=whether the plugin also reports a version waiting from before (its own waiting event)
  it('shows a version already waiting when the app opens, unless no worker ran the site before', async () => {
    const open = async (controlled: boolean, active: Worker | null) => {
      stop();
      vi.resetModules();
      app = await import('./appUpdate');
      sw.controller = controlled ? {} : null;
      reg.waiting = waiting;
      stop = app.startServiceWorker(((o: Hooks) => (o.onRegisteredSW?.('sw.js', Object.assign(reg, { active }) as unknown as ServiceWorkerRegistration), update)) as never);
      return renderHook(() => app.useAppUpdateReady()).result.current;
    };
    // A hard reload already runs the newest files, so the bar it gets is harmless: Reload switches and reloads.
    expect([await open(false, null), await open(true, worker('activated')), await open(false, worker('activated'))]).toEqual([false, true, true]);
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

  // Generated on 2026-10-25 (/ship review, run 18 pass 3, Red Team); extended by /ship review on 2026-10-25 (run 19,
  // state machines) with a hard-reloaded page and a first visit's later version
  // Value: protects=a copy that was frozen in the background while another copy took the new version (so it never saw it
  // waiting), or a page opened with a hard reload that a new version takes over, shows the bar once a worker takes it
  // over, and its Reload just reloads; a first visit doesn't show it when its own worker takes the page over, only when a
  // later version does; fails_when=such a page keeps running the old build with no bar while its notices say to tap
  // Reload, or a first visit shows the bar for the version it just got; why_new=review (Red Team, state machines);
  // seam=controllerchange sent by hand, registerSW passed in by hand; no_claim=a real frozen tab or hard reload
  it('shows the bar when the worker changes under a copy that missed the update waiting, but not on a first visit', async () => {
    reg.waiting = null;
    const { result } = renderHook(() => app.useAppUpdateReady());
    expect(result.current).toBe(false);
    act(() => void sw.dispatchEvent(new Event('controllerchange')));
    expect(result.current).toBe(true);
    app.applyAppUpdate();
    expect(reload).toHaveBeenCalledTimes(1);

    stop();
    vi.resetModules();
    app = await import('./appUpdate');
    sw.controller = null;
    // As the plugin does: registered before its first worker takes the page over, while that one is still installing.
    stop = app.startServiceWorker(((o: Hooks) => (o.onRegisteredSW?.('sw.js', Object.assign(reg, { active: null, installing: worker('installing') }) as unknown as ServiceWorkerRegistration), update)) as never);
    const first = renderHook(() => app.useAppUpdateReady());
    act(() => void sw.dispatchEvent(new Event('controllerchange')));
    expect(first.result.current).toBe(false);
    act(() => void sw.dispatchEvent(new Event('controllerchange')));
    expect(first.result.current).toBe(true);

    // A hard reload: no worker runs the page, but one is already active for the site.
    stop();
    vi.resetModules();
    app = await import('./appUpdate');
    sw.controller = null;
    stop = app.startServiceWorker(((o: Hooks) => (o.onRegisteredSW?.('sw.js', Object.assign(reg, { active: worker('activated') }) as unknown as ServiceWorkerRegistration), update)) as never);
    const reloaded = renderHook(() => app.useAppUpdateReady());
    act(() => void sw.dispatchEvent(new Event('controllerchange')));
    expect(reloaded.result.current).toBe(true);
  });

  // Generated on 2026-10-25 (/ship review, run 19, maintainability)
  // Value: protects=the browser's own look for a new version as the app starts counts, so coming back within half an
  // hour of starting doesn't look again, and coming back later, or after the device clock went back, does;
  // fails_when=every first return after a start looks again, or a clock set back stops the looks for hours; why_new=review: the half-hour wait only counted from the app's own checks; seam=fake Date,
  // document.visibilityState mocked; no_claim=how often a browser looks on its own
  it('counts the start as a look for a new version', async () => {
    stop();
    vi.resetModules();
    app = await import('./appUpdate');
    vi.useFakeTimers({ toFake: ['Date'] });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    const back = (minutes: number) => (vi.setSystemTime(new Date(2026, 9, 25, 12, minutes)), document.dispatchEvent(new Event('visibilitychange')));
    vi.setSystemTime(new Date(2026, 9, 25, 12, 0));
    reg.waiting = null;
    stop = app.startServiceWorker(((o: Hooks) => (o.onRegisteredSW?.('sw.js', reg as unknown as ServiceWorkerRegistration), update)) as never);
    back(10);
    expect(reg.update).toHaveBeenCalledTimes(0);
    back(31);
    expect(reg.update).toHaveBeenCalledTimes(1);
    // The device clock went back: a last look later than now counts as long ago.
    back(-29);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });
});
