import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;

/** Registers the service worker. With autoUpdate, a new version found later installs and reloads the app. */
export function startServiceWorker() {
  registerSW({ immediate: true, onRegisteredSW: (_url, r) => void (registration = r) });
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so does importing a backup from a newer build; if a new build is out, the app
 * reloads into it. Sync doesn't, since the reload would throw away an open pack editor.
 */
export function checkForAppUpdate(): Promise<unknown> {
  return registration?.update().catch(() => {}) ?? Promise.resolve();
}
