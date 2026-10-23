import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;

/**
 * Registers the service worker. With autoUpdate, a new version found later installs and reloads the app, but not
 * while a pop-up or the Undo bar is up: the update is usually found a few seconds after launch, just when someone
 * opens a pack to log a purchase, and reloading then would throw away the unsaved pack editor, or the Undo for the
 * save that closed it (Undo only lives in memory). Nor while a Tower name is being typed (`data-editing`): the reload
 * would finish it as leaving it does, and a spelling it fixes on other cards would lose its Undo. It reloads once all
 * of them are gone.
 */
export function startServiceWorker() {
  registerSW({ immediate: true, onRegisteredSW: (_url, r) => void (registration = r), onNeedReload: reloadWhenIdle });
}

function reloadWhenIdle() {
  const busy = () => !!document.querySelector('[data-modal], [data-undo], [data-editing]');
  if (!busy()) return location.reload();
  // Pop-ups are portalled onto <body> but the Undo bar is inside #root, so watch the whole tree. The bar goes by
  // itself once the app has shown for 8 seconds in a row (the time starts over each time the app comes back), so
  // this waits for that once the pop-up is closed.
  const observer = new MutationObserver(() => {
    if (busy()) return;
    observer.disconnect();
    location.reload();
  });
  // A Tower box left can stay in place as a plain box and only drop its mark, so that's watched too.
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-editing'] });
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so does importing a backup from a newer build; if a new build is out, the app
 * reloads into it. Sync doesn't, since a reload would interrupt whatever you're doing.
 */
export function checkForAppUpdate(): Promise<unknown> {
  return registration?.update().catch(() => {}) ?? Promise.resolve();
}
