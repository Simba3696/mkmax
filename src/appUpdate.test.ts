// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServiceWorker } from './appUpdate';

// The service worker's hook for a new build, caught here so a test can say one was found.
const sw = vi.hoisted(() => ({ needReload: () => {} }));
vi.mock('virtual:pwa-register', () => ({ registerSW: (o: { onNeedReload: () => void }) => void (sw.needReload = o.onNeedReload) }));

const reload = vi.fn();
let visibility: DocumentVisibilityState = 'visible';
const appShows = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
};
/** Puts an element with this attribute on the page, as the Undo bar ([data-undo]) or a pop-up ([data-modal]) does. */
const show = (attr: string) => {
  const el = document.createElement('div');
  el.setAttribute(attr, '');
  document.body.append(el);
  return el;
};

beforeEach(() => {
  reload.mockClear();
  visibility = 'visible';
  vi.stubGlobal('location', { reload });
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  startServiceWorker();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('app update reload', () => {
  // Generated on 2026-10-25 (/ship review, Red Team, Tower dropdown)
  // Value: protects=the reload waits while a text box has focus (Add card's name, a rename), since the Undo bar's paused
  // time can put it seconds after coming back, mid-word, and reloads once, after focus leaves the box; a checkbox
  // with focus holds nothing; fails_when=only marked controls hold the reload, so a half-typed card name is lost, or
  // leaving the box never reloads, or a second check reloads twice; why_new=review (Red Team); seam=none;
  // no_claim=a real service worker update (registerSW mocked, location.reload stubbed)
  it('waits while a text box has focus, and reloads once after it is left', async () => {
    const box = document.createElement('input');
    document.body.append(box);
    box.focus();
    sw.needReload();
    expect(reload).not.toHaveBeenCalled();
    box.blur();
    document.dispatchEvent(new FocusEvent('focusout'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).toHaveBeenCalledTimes(1);

    reload.mockClear();
    const check = document.createElement('input');
    check.type = 'checkbox';
    document.body.append(check);
    check.focus();
    sw.needReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-23 (/ship coverage audit, Tower dropdown)
  // Value: protects=a new build found with no pop-up and no Undo bar up reloads straight away; fails_when=the at-once
  // branch stops reloading, so the app keeps running the old build until something on the page changes or it's next
  // opened; why_new=no test called needReload with nothing up; seam=none; no_claim=a real service worker update
  // (registerSW mocked, location.reload stubbed)
  it('reloads at once with nothing open', () => {
    sw.needReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-23 (/ship review, Red Team, Tower dropdown)
  // Value: protects=the reload waits for the Undo bar even while the app is hidden (where its time doesn't count), so a
  // change saved just before switching away is pushed to the gist before the reload; fails_when=the hidden app reloads
  // at once and cancels that pending sync push, which the reloaded page, still hidden, doesn't retry until it's shown;
  // why_new=review (Red Team) of a reload-while-hidden change, since undone; seam=none; no_claim=a real service worker
  // update or sync push (registerSW mocked, location.reload stubbed)
  it('waits for the Undo bar, even while the app is hidden, and reloads once it goes', async () => {
    const bar = show('data-undo');
    sw.needReload();
    appShows('hidden');
    appShows('visible');
    expect(reload).not.toHaveBeenCalled();
    bar.remove();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  // Generated on 2026-10-23 (/ship review, Red Team, Tower dropdown)
  // Value: protects=a pop-up's unsaved work (the pack editor) and the Undo for saving it both hold the reload, which
  // comes once neither is up; fails_when=the reload goes ahead as soon as one of them is gone, throwing away the other;
  // why_new=reloadWhenIdle had no test; seam=none; no_claim=a real service worker update (registerSW mocked,
  // location.reload stubbed)
  it('waits for both an open pop-up and the Undo bar', async () => {
    const modal = show('data-modal');
    sw.needReload();
    const bar = show('data-undo');
    modal.remove();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    bar.remove();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  // Generated on 2026-10-23 (/ship coverage audit, Tower dropdown)
  // Value: protects=the reload notices the Undo bar going when it sits inside #root, as it does in the real app, not
  // only when it's a direct child of <body>, and reloads just once; fails_when=the watch stops looking below <body>'s
  // own children, so the update never loads until the app is next opened; why_new=the other tests put the bar straight
  // on <body>, where a shallow watch also sees it go; seam=none; no_claim=a real service worker update or React's
  // own Undo bar (registerSW mocked, location.reload stubbed)
  it('notices the Undo bar going from inside #root, and reloads once', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const bar = document.createElement('div');
    bar.setAttribute('data-undo', '');
    root.append(bar);
    sw.needReload();
    expect(reload).not.toHaveBeenCalled();
    bar.remove();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    root.append(document.createElement('p'));
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-23 (/ship coverage audit, Tower dropdown)
  // Value: protects=a new build found while the app is already in the background with the Undo bar up still waits for
  // the bar, so the change's sync push goes first; fails_when=an update found while hidden reloads at once and cancels
  // that pending push; why_new=the other hidden test finds the update while the app is showing, then hides it;
  // seam=none; no_claim=a real service worker update or sync push (registerSW mocked, location.reload stubbed)
  it('waits for the Undo bar when the update is found with the app already hidden', async () => {
    appShows('hidden');
    const bar = show('data-undo');
    sw.needReload();
    expect(reload).not.toHaveBeenCalled();
    appShows('visible');
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    bar.remove();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  // Generated on 2026-10-23 (/ship review, Red Team, Tower dropdown)
  // Value: protects=a Tower name being typed (data-editing) holds the reload, which comes once the box drops its mark,
  // even when the box itself stays on the page; fails_when=the reload goes ahead mid-typing and finishes the name unseen,
  // re-spelling other cards with an Undo it throws away, or never comes because only added or removed elements are
  // watched; why_new=review (Red Team); seam=none; no_claim=a real service worker update (registerSW mocked,
  // location.reload stubbed)
  it('waits while a Tower name is being typed, and reloads once the box drops its mark', async () => {
    const box = show('data-editing');
    sw.needReload();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    box.removeAttribute('data-editing');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
