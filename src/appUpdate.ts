import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
let ready = false;
const listeners = new Set<() => void>();

/**
 * Registers the service worker. A new version found later is installed but never switched to by itself: the app says
 * it's ready and reloads into it when the user taps Reload (or next time it opens with no copy of it already open).
 * Reloading on its own threw away whatever was in progress, such as a half-filled Add card form, a pasted list or a
 * pull being logged, and every rule for waiting on those missed one.
 */
export function startServiceWorker() {
  updateSW = registerSW({
    immediate: true,
    onRegisteredSW: (_url, r) => void (registration = r),
    onNeedRefresh: () => {
      ready = true;
      listeners.forEach((l) => l());
    },
  });
}

/** Whether a new version is installed and waiting for the user to reload into it. */
export function useAppUpdateReady() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => ready,
  );
}

/** Switches to the waiting version and reloads into it. */
export function applyAppUpdate() {
  void updateSW?.(true);
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so does importing a backup from a newer build; if a new build is out, the app
 * says so (see startServiceWorker).
 */
export function checkForAppUpdate(): Promise<unknown> {
  return registration?.update().catch(() => {}) ?? Promise.resolve();
}
