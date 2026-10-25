import { useSyncExternalStore } from 'react';
import type { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let registerFailed = false;
let ready = false;
let checkedAt = 0;
const listeners = new Set<() => void>();
/** How long an app coming back to the screen goes without looking for a new version. */
const RECHECK_MS = 30 * 60 * 1000;

function markReady() {
  if (ready) return;
  ready = true;
  listeners.forEach((l) => l());
}

/** A newer version installed and waiting while an older one runs this page (not the first install, which runs at once). */
const flagIfWaiting = (r: ServiceWorkerRegistration) => r.waiting && navigator.serviceWorker.controller && markReady();

/**
 * Registers the service worker. A new version found later is installed but never switched to by itself: the app says
 * it's ready and reloads into it when the user taps Reload (or next time it opens with no copy of it already open).
 * Reloading on its own threw away whatever was in progress, such as a half-filled Add card form, a pasted list or a
 * pull being logged, and every rule for waiting on those missed one. main.tsx passes in the plugin's registerSW, so
 * the store and screens can use the rest of this file without loading the plugin. Returns a function that stops
 * looking on return (for tests).
 */
export function startServiceWorker(register: typeof registerSW) {
  updateSW = register({
    immediate: true,
    onRegisteredSW: (_url, r) => {
      if (!r) return;
      registration = r;
      // The library stops reporting new versions after the first one it sees (even one that failed to install), so
      // the app watches for them too.
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        w?.addEventListener('statechange', () => w.state === 'installed' && flagIfWaiting(r));
      });
      flagIfWaiting(r);
    },
    onRegisterError: () => void (registerFailed = true),
    onNeedRefresh: markReady,
    // Only the copy whose Reload was tapped reloads (applyAppUpdate). Without this the library reloads every open copy
    // once any one of them switches; the others keep their bar, and their Reload then just reloads.
    onNeedReload: () => {},
  });
  // A phone app is mostly resumed rather than started again, and the browser only looks for a new version on a start.
  // Some browsers restore a page from the back-forward cache with only pageshow, no visibility change.
  const returned = () => {
    if (document.visibilityState === 'visible' && Date.now() - checkedAt >= RECHECK_MS) void checkForAppUpdate();
  };
  const restored = (e: PageTransitionEvent) => e.persisted && returned();
  document.addEventListener('visibilitychange', returned);
  window.addEventListener('pageshow', restored);
  return () => {
    document.removeEventListener('visibilitychange', returned);
    window.removeEventListener('pageshow', restored);
  };
}

/**
 * Whether this page can find and switch to a new version without a reload. Not in browsers that don't run service
 * workers for the site (a private window, some in-app browsers), where only a reload loads a new version.
 */
export function hasServiceWorker() {
  return 'serviceWorker' in navigator && !registerFailed;
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const isReady = () => ready;

/** Whether a new version is installed and waiting for the user to reload into it. */
export function useAppUpdateReady() {
  return useSyncExternalStore(subscribe, isReady);
}

/** Switches to the waiting version and reloads into it. */
export function applyAppUpdate() {
  const waiting = registration?.waiting;
  // Another open copy already switched to it, so there's nothing left to switch: a reload loads it.
  if (!waiting) return location.reload();
  const sw = navigator.serviceWorker;
  const controlled = !!sw.controller;
  if (controlled) sw.addEventListener('controllerchange', () => location.reload(), { once: true });
  // A page the old version didn't control (a hard reload, or the first visit) isn't told when the new one takes over,
  // and a version that a newer one replaces before it takes over never does: reload on those instead.
  waiting.addEventListener('statechange', () => (waiting.state === 'redundant' || (!controlled && waiting.state === 'activated')) && location.reload());
  void updateSW?.(true);
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so do coming back to the app after a while, sync or another tab finding data
 * from a newer build, and importing a backup from one; if a new build is out, the app says so (see startServiceWorker).
 * Once one is waiting there's nothing to look for until the user takes it.
 */
export function checkForAppUpdate(): Promise<unknown> {
  const r = registration;
  if (ready || !r) return Promise.resolve();
  checkedAt = Date.now();
  return r.update().then(
    () => void flagIfWaiting(r),
    () => {},
  );
}
