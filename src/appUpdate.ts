import { useSyncExternalStore } from 'react';
import type { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let ready = false;
/** Set when this copy's Reload was tapped, so another open copy switching versions doesn't reload this one. */
let applying = false;
let checkedAt = 0;
const listeners = new Set<() => void>();
/** How long an app coming back to the screen goes without looking for a new version. */
const RECHECK_MS = 30 * 60 * 1000;

/**
 * Registers the service worker. A new version found later is installed but never switched to by itself: the app says
 * it's ready and reloads into it when the user taps Reload (or next time it opens with no copy of it already open).
 * Reloading on its own threw away whatever was in progress, such as a half-filled Add card form, a pasted list or a
 * pull being logged, and every rule for waiting on those missed one. main.tsx passes in the plugin's registerSW, so
 * the store and screens can use the rest of this file without loading the plugin.
 */
export function startServiceWorker(register: typeof registerSW) {
  updateSW = register({
    immediate: true,
    onRegisteredSW: (_url, r) => void (registration = r),
    onNeedRefresh: () => {
      ready = true;
      listeners.forEach((l) => l());
    },
    // The new version took over this page. Without this the library reloads every open copy when any one of them taps
    // Reload; the others keep their bar, and their Reload then just reloads.
    onNeedReload: () => applying && location.reload(),
  });
  // A phone app is mostly resumed rather than started again, and the browser only looks for a new version on a start.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - checkedAt > RECHECK_MS) void checkForAppUpdate();
  });
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const isReady = () => ready;

/** Whether a new version is installed and waiting for the user to reload into it. */
export function useAppUpdateReady() {
  return useSyncExternalStore(subscribe, isReady);
}

/** Switches to the waiting version and reloads into it. */
export function applyAppUpdate() {
  applying = true;
  const waiting = registration?.waiting;
  // Another open copy already switched to it, so there's nothing left to switch: a reload loads it.
  if (!waiting) return location.reload();
  // A page the old version didn't control (a hard reload, or the first visit) isn't told when the new one takes over.
  if (!navigator.serviceWorker.controller) {
    waiting.addEventListener('statechange', () => waiting.state === 'activated' && location.reload());
  }
  void updateSW?.(true);
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so do coming back to the app after a while, sync or another tab finding data
 * from a newer build, and importing a backup from one; if a new build is out, the app says so (see startServiceWorker).
 */
export function checkForAppUpdate(): Promise<unknown> {
  checkedAt = Date.now();
  return registration?.update().catch(() => {}) ?? Promise.resolve();
}
