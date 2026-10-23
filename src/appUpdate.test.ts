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
});
