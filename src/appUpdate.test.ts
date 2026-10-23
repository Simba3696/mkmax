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
  // Generated on 2026-10-23 (/ship review, Red Team, Tower dropdown)
  // Value: protects=a new build found with the Undo bar up reloads once the bar goes, or as soon as the app is hidden
  // (unseen) with no pop-up open, rather than 8 seconds into the user's return; fails_when=the hidden app still waits
  // for the bar, whose time only counts while the app shows, so the reload lands over Add card typing after return;
  // why_new=review (Red Team); seam=registerSW mocked, location.reload stubbed; no_claim=a real service worker update
  it('waits for the Undo bar while the app shows, and reloads unseen once it is hidden', async () => {
    const bar = show('data-undo');
    sw.needReload();
    expect(reload).not.toHaveBeenCalled();
    appShows('hidden');
    expect(reload).toHaveBeenCalledTimes(1);

    // Found while the app shows: the bar going reloads.
    reload.mockClear();
    appShows('visible');
    sw.needReload();
    expect(reload).not.toHaveBeenCalled();
    bar.remove();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  // Generated on 2026-10-23 (/ship review, Red Team, Tower dropdown)
  // Value: protects=a pop-up's unsaved work (the pack editor) holds the reload even while the app is hidden;
  // fails_when=the hidden-app shortcut skips pop-ups too and reloads over an open pack editor; why_new=the hidden case is
  // new; seam=registerSW mocked, location.reload stubbed; no_claim=a real service worker update
  it('never reloads over an open pop-up, hidden or not', async () => {
    const modal = show('data-modal');
    show('data-undo');
    appShows('hidden');
    sw.needReload();
    appShows('visible');
    appShows('hidden');
    expect(reload).not.toHaveBeenCalled();
    modal.remove();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
