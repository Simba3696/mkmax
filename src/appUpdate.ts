import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;

/**
 * Registers the service worker. With autoUpdate, a new version found later installs and reloads the app, but not
 * while a pop-up or the Undo bar is up: the update is usually found a few seconds after launch, just when someone
 * opens a pack to log a purchase, and reloading then would throw away the unsaved pack editor, or the Undo for the
 * save that closed it (Undo only lives in memory). It reloads once both are gone, or while the app is hidden with no
 * pop-up open.
 */
export function startServiceWorker() {
  registerSW({ immediate: true, onRegisteredSW: (_url, r) => void (registration = r), onNeedReload: reloadWhenIdle });
}

function reloadWhenIdle() {
  // The Undo bar's time only counts while the app shows, so waiting for it while the app is hidden would put the reload
  // just after the user comes back, over whatever they start typing (Add card, Paste a list). While hidden, the reload
  // is unseen and only that Undo is lost, as when a phone ran the bar's timer on return; a pop-up's unsaved work still
  // holds it.
  const busy = () => !!document.querySelector(document.visibilityState === 'hidden' ? '[data-modal]' : '[data-modal], [data-undo]');
  if (!busy()) return location.reload();
  // Pop-ups are portalled onto <body> but the Undo bar is inside #root, so watch the whole tree. The bar goes by
  // itself after 8 seconds of the app showing, so this waits that long at most once the pop-up is closed.
  const check = () => {
    if (busy()) return;
    observer.disconnect();
    document.removeEventListener('visibilitychange', check);
    location.reload();
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', check);
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so does importing a backup from a newer build; if a new build is out, the app
 * reloads into it. Sync doesn't, since a reload would interrupt whatever you're doing.
 */
export function checkForAppUpdate(): Promise<unknown> {
  return registration?.update().catch(() => {}) ?? Promise.resolve();
}
