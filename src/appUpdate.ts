import { useSyncExternalStore } from 'react';
import type { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
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

/**
 * A worker ran the site before this page did: the page started under one, or one was active when it registered (a hard
 * reload runs no worker but has one). Then a version waiting or taking the page over is a newer one, not the first install.
 */
let hadWorker = false;

/** A newer version installed and waiting (not the first install, which runs at once). */
const flagIfWaiting = (r: ServiceWorkerRegistration) => r.waiting && hadWorker && markReady();

/**
 * Registers the service worker. A new version found later is installed but never switched to by itself: the app says
 * it's ready and reloads into it when the user taps Reload (or next time it opens with no copy of it already open).
 * Reloading on its own threw away whatever was in progress, such as a half-filled Add card form, a pasted list or a
 * pull being logged, and every rule for waiting on those missed one. main.tsx passes in the plugin's registerSW, so
 * the store and screens can use the rest of this file without loading the plugin. Returns a function that stops
 * looking on return (for tests).
 */
export function startServiceWorker(register: typeof registerSW) {
  // A copy frozen in the background while another one took the new version never sees it waiting, only a worker taking
  // it over; so does a page opened with a hard reload, which no worker runs. Either way it's a new version: say it's
  // ready (its Reload just reloads). Not when a first visit's own worker takes it over, as no worker was there before.
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
  hadWorker = !!sw?.controller;
  const takenOver = () => (hadWorker ? markReady() : void (hadWorker = true));
  sw?.addEventListener('controllerchange', takenOver);
  // The browser looks for a new version as the app starts, so a return in the next half hour doesn't look again.
  checkedAt = Date.now();
  updateSW = register({
    immediate: true,
    onRegisteredSW: (_url, r) => {
      if (!r) return;
      registration = r;
      if (r.active) hadWorker = true;
      // The library stops reporting new versions after the first one it sees (even one that failed to install), so
      // the app watches for them too.
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        w?.addEventListener('statechange', () => w.state === 'installed' && flagIfWaiting(r));
      });
      flagIfWaiting(r);
    },
    onNeedRefresh: markReady,
    // Only the copy whose Reload was tapped reloads (applyAppUpdate). Without this the library reloads every open copy
    // once any one of them switches; the others keep their bar, and their Reload then just reloads.
    onNeedReload: () => {},
  });
  // A phone app is mostly resumed rather than started again, and the browser only looks for a new version on a start.
  // Some browsers restore a page from the back-forward cache with only pageshow, no visibility change.
  const returned = () => {
    const age = Date.now() - checkedAt;
    // A last look later than now means the device clock went back: that counts as long enough too.
    if (document.visibilityState === 'visible' && (age < 0 || age >= RECHECK_MS)) void checkForAppUpdate();
  };
  const restored = (e: PageTransitionEvent) => e.persisted && returned();
  document.addEventListener('visibilitychange', returned);
  window.addEventListener('pageshow', restored);
  return () => {
    document.removeEventListener('visibilitychange', returned);
    window.removeEventListener('pageshow', restored);
    sw?.removeEventListener('controllerchange', takenOver);
  };
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
  // A page the old version didn't control (a hard reload) reloads once the new one is active rather than waiting for it
  // to take the page over, and a version that a newer one replaces before it takes over never does: reload then too.
  waiting.addEventListener('statechange', () => (waiting.state === 'redundant' || (!controlled && waiting.state === 'activated')) && location.reload());
  void updateSW?.(true);
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so do coming back to the app after a while, the sync loop finding data from a
 * newer build or a gist copy it can't read, another tab saving data from a newer build, and importing a backup from
 * one; if a new build is out, the app says so (see startServiceWorker). Once one is waiting there's nothing to look for
 * until the user takes it.
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
