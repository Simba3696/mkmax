import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;

/**
 * Registers the service worker. With autoUpdate, a new version found later installs and reloads the app, but not
 * while a pop-up or the Undo bar is up: the update is usually found a few seconds after launch, just when someone
 * opens a pack to log a purchase, and reloading then would throw away the unsaved pack editor, or the Undo for the
 * save that closed it (Undo only lives in memory). Nor while a Tower name is being typed or a tower stepped to with
 * the arrow keys is held, or a list waits in the Paste box (`data-editing`): the reload would finish, save or lose it,
 * and its Undo with it. Nor while any text box has focus, such as Add card's name or a card being renamed: the Undo
 * bar's time only counts while the app shows, so an update found while it was away reloads a few seconds after coming
 * back, often mid-word. It reloads once all of them are gone.
 */
export function startServiceWorker() {
  registerSW({ immediate: true, onRegisteredSW: (_url, r) => void (registration = r), onNeedReload: reloadWhenIdle });
}

/** A box the user may be typing in: a textarea, or an input that takes text. */
function typing() {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', 'number', 'email', 'url', 'tel'].includes(el.type));
}

function reloadWhenIdle() {
  const busy = () => !!document.querySelector('[data-modal], [data-undo], [data-editing]') || typing();
  if (!busy()) return location.reload();
  // Pop-ups are portalled onto <body> but the Undo bar is inside #root, so watch the whole tree. The bar goes by
  // itself once the app has shown for 8 seconds in a row (the time starts over each time the app comes back), so
  // this waits for that once the pop-up is closed.
  let done = false;
  const check = () => {
    if (done || busy()) return;
    done = true;
    observer.disconnect();
    document.removeEventListener('focusout', afterFocus);
    location.reload();
  };
  const observer = new MutationObserver(check);
  // A Tower box left can stay in place as a plain box, and a Tower list stays in place when its held step is settled;
  // either only drops its mark, so that's watched too.
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-editing'] });
  // Leaving a text box changes nothing on the page; checked once focus has moved on (to another box, perhaps).
  const afterFocus = () => setTimeout(check);
  document.addEventListener('focusout', afterFocus);
}

/**
 * The browser only looks for a new version when the app starts, so an app left open would keep running the old
 * build. Pull to refresh calls this, and so does importing a backup from a newer build; if a new build is out, the app
 * reloads into it. Sync doesn't, since a reload would interrupt whatever you're doing.
 */
export function checkForAppUpdate(): Promise<unknown> {
  return registration?.update().catch(() => {}) ?? Promise.resolve();
}
