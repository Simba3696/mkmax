// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { loadCatalog } from './catalog';
import { defaultState } from './defaults';
import { toLocalInput } from './engine';
import { refreshEvents } from './events';
import { StoreProvider, useStore } from './store';
import { PlanProvider } from './planner';
import { SyncLoop } from './syncLoop';
import App from './App';

// Mocked so a test can say whether a new version is waiting or a service worker runs, catch Reload and count update
// checks; appUpdate.test.ts tests the real module.
const appUpdate = vi.hoisted(() => ({ ready: false, apply: vi.fn(), checks: 0, sw: true, check: null as Promise<unknown> | null }));
vi.mock('./appUpdate', () => ({ hasServiceWorker: () => appUpdate.sw, checkForAppUpdate: () => (appUpdate.checks++, appUpdate.check ?? Promise.resolve()), useAppUpdateReady: () => appUpdate.ready, applyAppUpdate: appUpdate.apply }));

beforeEach(() => {
  // The catalog and the event schedule are fetched at start; neither matters here, so stay offline.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  history.replaceState(null, '', '#packs');
  // jsdom says the page has focus only while an element holds it; a real window has focus whatever holds it, and a Tower
  // box ignores a blur that comes with the window losing focus.
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  appUpdate.ready = false;
  appUpdate.apply.mockClear();
  appUpdate.checks = 0;
  appUpdate.sw = true;
  appUpdate.check = null;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '#');
});

const tab = (name: string) => screen.getByRole('button', { name });
/** The Tower list's name box option, picked by its label rather than the hidden value behind it. */
const nameBoxValue = (select: HTMLElement) => [...(select as HTMLSelectElement).options].find((o) => o.textContent === 'Add a tower or fix its spelling…')!.value;
const renderApp = () =>
  render(
    <StoreProvider>
      <PlanProvider>
        <App />
      </PlanProvider>
    </StoreProvider>,
  );
/** A pull down from the top of the page, as a finger does it. */
async function pull() {
  const touch = (y: number) => ({ touches: [{ clientX: 0, clientY: y }] });
  fireEvent.touchStart(window, touch(0));
  fireEvent.touchMove(window, touch(200));
  await act(async () => void fireEvent.touchEnd(window));
}
/** Hands the store, as each render sees it, to the test, as any view would use it. */
function Grab({ onRender }: { onRender: (store: ReturnType<typeof useStore>) => void }) {
  onRender(useStore());
  return null;
}
/** Past App's half-second double-tap window (DOUBLE_TAP_MS, 500), so a tap on the Cards tab counts as deliberate. */
const later = () => vi.setSystemTime(Date.now() + 600);
/** Tower gear's page when it's the one showing; both Cards pages keep their state, and Activity hides the other. */
const towers = () => {
  const intro = screen.queryByText(/Tower gear is farmed, not bought/);
  return intro && !intro.closest('[style*="display: none"]') ? intro : null;
};

describe('a new version', () => {
  // Spies on SyncLoop.syncNow end with each test, even one that fails partway.
  afterEach(() => vi.restoreAllMocks());

  // Generated on 2026-10-25 (/ship review, update approach)
  // Value: protects=a new version waiting is shown as a bar on the page with Reload, which switches to it, and nothing
  // shows while none is waiting; fails_when=the bar is missing so a new version is never taken up, or Reload does
  // nothing; why_new=the app no longer reloads by itself; seam=appUpdate mocked (its ready flag and apply); no_claim=a
  // real service worker update (appUpdate.test.ts)
  it('says a new version is ready and reloads into it when Reload is tapped', () => {
    appUpdate.ready = false;
    const { unmount } = render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    expect(screen.queryByText('A new version of MK Max is ready.')).toBeNull();
    unmount();
    appUpdate.ready = true;
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect([screen.queryByText('A new version of MK Max is ready.') != null, appUpdate.apply.mock.calls.length]).toEqual([true, 1]);
    // Extended on 2026-10-25 (/ship coverage audit, Tower dropdown)
    // Value: protects=the bar shows on every page, as the user guide says, not only on the Plan; fails_when=the bar is
    // moved into one page, so someone on Cards or Settings never sees the update; why_new=the bar was only checked on
    // the Plan; seam=appUpdate mocked (its ready flag); no_claim=a real service worker update (appUpdate.test.ts)
    const shown = ['Packs', 'Cards', 'Settings'].map((name) => (fireEvent.click(tab(name)), screen.queryByText('A new version of MK Max is ready.') != null));
    expect(shown).toEqual([true, true, true]);
    // Extended on 2026-10-25 (/ship review, run 15 pass 2, design)
    // Value: protects=the bar sits outside the scrolling page, so it's seen wherever the page is scrolled to;
    // fails_when=it's put back in the page and scrolls away down a long list; why_new=review (design); seam=none;
    // no_claim=how it looks (checked in the browser)
    expect(screen.getByText('A new version of MK Max is ready.').closest('[data-scroll-root]')).toBeNull();
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=pull to refresh without sync looks for a new version instead of reloading the page; fails_when=it
  // reloads, which loses whatever is half typed and, with the new version only switched to by Reload, never loads it;
  // why_new=review (Red Team); seam=appUpdate mocked (counting its checks), touches sent by hand; no_claim=real touch
  // timing
  it('is looked for by pull to refresh, which no longer reloads', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    renderApp();
    await pull();
    expect([appUpdate.checks, reload.mock.calls.length]).toEqual([1, 0]);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3)
  // Value: protects=with sync on, pull to refresh still syncs, and looks for a new version without reloading;
  // fails_when=the sync or the version check is dropped from a pull with sync on, or it reloads; why_new=review
  // (testing): the pull test only ran with sync off; seam=appUpdate mocked (counting its checks), SyncLoop.syncNow spied,
  // touches sent by hand; no_claim=real touch timing
  it('is looked for by pull to refresh with sync on too, which also syncs', async () => {
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    const syncNow = vi.spyOn(SyncLoop.prototype, 'syncNow').mockResolvedValue();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    renderApp();
    const before = syncNow.mock.calls.length;
    await pull();
    expect([syncNow.mock.calls.length - before, appUpdate.checks, reload.mock.calls.length]).toEqual([1, 1, 0]);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 3)
  // Value: protects=where no service worker runs (a private window, some in-app browsers), pull to refresh reloads, the
  // only way a new version loads there; fails_when=a pull there never updates the app; why_new=review (Red Team);
  // seam=appUpdate mocked (no service worker), touches sent by hand; no_claim=which browsers block service workers
  it('reloads on pull to refresh where there’s no service worker', async () => {
    appUpdate.sw = false;
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    renderApp();
    await pull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 16, Red Team)
  // Value: protects=where pull to refresh reloads, with sync on it syncs first, so a change waiting to be pushed goes up
  // before the reload; fails_when=the reload cancels the waiting push and the edit reaches the gist only on a later start,
  // maybe as a which-copy question; why_new=review (Red Team); seam=appUpdate mocked (no service worker), SyncLoop.syncNow
  // spied, touches sent by hand; no_claim=GitHub itself
  it('syncs before that reload when sync is on', async () => {
    appUpdate.sw = false;
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    const order: string[] = [];
    vi.spyOn(SyncLoop.prototype, 'syncNow').mockImplementation(async () => void order.push('sync'));
    vi.stubGlobal('location', { ...location, reload: () => order.push('reload') });
    renderApp();
    order.length = 0;
    await pull();
    expect(order).toEqual(['sync', 'reload']);
  });

  // Generated on 2026-10-25 (/ship review, run 16 pass 3, Red Team)
  // Value: protects=where a service worker runs, a pull's spinner waits for sync at most 5 seconds too, so a sync stuck
  // on a hanging connection doesn't keep it up and ignore later pulls; fails_when=the pull waits on the sync for good;
  // why_new=review (Red Team): syncNow now waits for a sync already out, and GitHub's requests have no time limit;
  // seam=appUpdate mocked, SyncLoop.syncNow spied to never answer, fake timers, touches sent by hand; no_claim=GitHub
  it('lets a pull finish after 5 seconds when its sync hangs', async () => {
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    const syncNow = vi.spyOn(SyncLoop.prototype, 'syncNow').mockImplementation(() => new Promise(() => {}));
    renderApp();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = syncNow.mock.calls.length;
    await pull();
    await act(() => vi.advanceTimersByTimeAsync(5600));
    await pull();
    expect(syncNow.mock.calls.length - before).toBe(2);
  });

  // Generated on 2026-10-25 (/ship review, run 16, testing)
  // Value: protects=that sync is waited for at most 5 seconds, so a sync that hangs on a weak connection still lets the
  // reload happen; fails_when=the time limit goes and the pull waits on the sync for good; why_new=review (testing): the
  // sync in the test above answers at once; seam=appUpdate mocked (no service worker), SyncLoop.syncNow spied to never
  // answer, fake timers; no_claim=GitHub itself
  it('reloads after 5 seconds when that sync hangs', async () => {
    appUpdate.sw = false;
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    vi.spyOn(SyncLoop.prototype, 'syncNow').mockImplementation(() => new Promise(() => {}));
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    renderApp();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await pull();
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(reload).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Generated on 2026-10-25 (/ship review, run 16, Red Team)
  // Value: protects=data that sync pulled in is saved in this browser before that reload; fails_when=the reload beats
  // the save (it waits for the screen to draw), so the page comes back with the old data while the agreed stamp, saved at
  // once, says this device has the gist's copy, and its next edit pushes the old data over the other device's changes;
  // why_new=review (Red Team); seam=appUpdate mocked (no service worker), fetch answers as the gist, the reload stubbed to
  // read the save; no_claim=GitHub itself
  it('saves what that sync pulled in before reloading', async () => {
    appUpdate.sw = false;
    localStorage.setItem('mkmax:sync', JSON.stringify({ token: 't', gistId: 'g1', baseUpdatedAt: 5000 }));
    localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), updatedAt: 5000 }));
    // The gist's copy: the one both devices agreed on, until the other device pushes a newer one.
    let gist = { ...defaultState(), updatedAt: 5000 };
    vi.stubGlobal('fetch', (url: string) =>
      String(url).includes('api.github.com')
        ? Promise.resolve(new Response(JSON.stringify({ id: 'g1', description: null, files: { 'mkmax-data.json': { content: JSON.stringify(gist), raw_url: '' } } })))
        : Promise.reject(new Error('offline')),
    );
    renderApp();
    // The sync on opening finds nothing new.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    gist = { ...defaultState(), updatedAt: 9000, cards: [{ id: 'r', name: 'Raiden', rarityId: 'diamond', fusion: 1, guest: false }] };
    let saved: string | null = null;
    vi.stubGlobal('location', { ...location, reload: () => void (saved = localStorage.getItem('mkmax:v1')) });
    await pull();
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toContain('Raiden');
  });

  // Generated on 2026-10-25 (/ship review, run 16, state machines)
  // Value: protects=a tab that opened on data from a newer version ignores the newer tab's later saves (no second look
  // for the update, the notice stays); fails_when=each save from the newer tab looks for the update again or changes this
  // tab's state; why_new=review (state machines): only a hold that started from a save was tested; seam=appUpdate mocked
  // (counting its checks), a StorageEvent dispatched by hand stands in for the other tab; no_claim=a real service worker
  it('is not looked for again by a tab that opened on a newer save', () => {
    localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), version: 99 }));
    renderApp();
    const newer = JSON.stringify({ ...defaultState(), version: 99, updatedAt: 1 });
    act(() => {
      localStorage.setItem('mkmax:v1', newer);
      window.dispatchEvent(new StorageEvent('storage', { key: 'mkmax:v1', newValue: newer }));
    });
    expect([appUpdate.checks, screen.queryAllByText(/^The data saved in this browser is from a newer version/).length]).toEqual([0, 1]);
  });

  // Generated on 2026-10-25 (/ship review, run 16, testing)
  // Value: protects=a pull finishes, and the next one runs, while the version check is still out (it has no time limit
  // of its own); fails_when=the check is awaited again, so a stalled check on a weak connection keeps the spinner up and
  // ignores every later pull; why_new=review (testing): the mocked check always answered at once; seam=appUpdate mocked
  // (its check never answers), touches sent by hand; no_claim=real network timing
  it('lets a pull finish while the version check is still out', async () => {
    appUpdate.check = new Promise(() => {});
    renderApp();
    await pull();
    await act(() => new Promise((r) => setTimeout(r, 600)));
    await pull();
    expect(appUpdate.checks).toBe(2);
  });

  // Generated on 2026-10-25 (/ship review, run 15 pass 2)
  // Value: protects=once another tab saves data from a newer version, this tab looks for that version, and its bar shows
  // beside the notice that nothing is saved; fails_when=nothing looks, so the tab stays on the old build with every tap
  // ignored until the user happens to pull, or the notice hides the bar; why_new=review (data migration); seam=appUpdate
  // mocked (counting its checks, its ready flag), a StorageEvent dispatched by hand stands in for the other tab;
  // no_claim=a real service worker update
  it('is looked for when another tab saves data from a newer version, and its bar shows with the notice', () => {
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const newer = JSON.stringify({ ...defaultState(), version: 99 });
    act(() => {
      localStorage.setItem('mkmax:v1', newer);
      window.dispatchEvent(new StorageEvent('storage', { key: 'mkmax:v1', newValue: newer }));
    });
    expect(appUpdate.checks).toBe(1);
    // Extended on 2026-10-25 (/ship coverage audit, run 16)
    // Value: protects=once this tab is held, later saves from the newer tab (one per keystroke there) don't look for the
    // update again; fails_when=the held check before holdIfNewer goes, so every keystroke in the other tab fetches the
    // service worker again; why_new=the test sent only one save; seam=appUpdate mocked (counting its checks), a
    // StorageEvent stands in for the other tab; no_claim=a real service worker update
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'mkmax:v1', newValue: newer })));
    expect(appUpdate.checks).toBe(1);
    appUpdate.ready = true;
    fireEvent.click(tab('Cards'));
    expect([screen.queryByText(/^The data saved in this browser is from a newer version/) != null, screen.queryByRole('button', { name: 'Reload' }) != null]).toEqual([true, true]);
  });
});

describe('the MK MAX logo', () => {
  // Value: protects=the logo goes to the Plan from another tab and scrolls the Plan to the top; fails_when=home() goes
  // nowhere, scrolls instead of switching, or scrolls the window not the content; why_new=no App test existed; seam=none;
  // no_claim=smooth scrolling or the rail's hover look (jsdom has no layout; scrollTo is a spy)
  it('opens the Plan from another tab, and on the Plan scrolls back to the top', () => {
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    expect(tab('Packs').getAttribute('aria-current')).toBe('page');
    const root = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    const scrollTo = vi.fn();
    root.scrollTo = scrollTo;
    // The phone header and the tablet rail each have a logo; both do the same.
    const [logo] = screen.getAllByRole('button', { name: 'MK MAX, go to the Plan' });

    fireEvent.click(logo);
    expect(tab('Plan').getAttribute('aria-current')).toBe('page');
    expect(tab('Packs').getAttribute('aria-current')).toBeNull();
    expect(location.hash).toBe('#plan');
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(logo);
    expect(tab('Plan').getAttribute('aria-current')).toBe('page');
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0 });
  });
});

describe('a save from a newer version', () => {
  // Generated by /ship TODO fix on 2026-10-19
  // Value: protects=a save from a newer version shows a notice on every tab saying changes aren't saved and how to update,
  // and none without one; fails_when=the store holds the save but the screen says nothing, so taps seem to do nothing;
  // why_new=TODOS.md P2; seam=none; no_claim=the store refusing changes (store.test.tsx)
  it('says on every tab that changes aren’t saved until MK Max updates', () => {
    localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), version: 99 }));
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const notice = () => screen.queryByRole('alert')?.textContent ?? null;
    expect(notice()).toMatch(/newer version of MK Max\. This version only shows it: changes aren’t saved/);
    // Sync is off here, so nothing is paused: no sync error beside the notice.
    expect(screen.queryAllByText(/Sync error/)).toEqual([]);
    fireEvent.click(tab('Cards'));
    expect(notice()).toMatch(/newer version of MK Max/);
    cleanup();
    localStorage.setItem('mkmax:v1', JSON.stringify(defaultState()));
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    expect(notice()).toBeNull();
    // Extended by /ship test coverage audit on 2026-10-19
    // Value: protects=a tab already open shows the notice once another tab saves data from a newer version, still with no
    // sync error while sync is off; fails_when=the storage listener's hold isn't shown, or it sets a sync error with sync
    // off; why_new=the store test holds with sync on and reads the store only; seam=a StorageEvent dispatched by hand
    // stands in for the other tab; no_claim=a real second tab
    const newer = JSON.stringify({ ...defaultState(), version: 99 });
    localStorage.setItem('mkmax:v1', newer);
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'mkmax:v1', newValue: newer })));
    expect([notice(), screen.queryAllByText(/Sync error/)]).toEqual([expect.stringMatching(/newer version of MK Max/), []]);
  });
});

describe('the Cards tab', () => {
  // Value: protects=tapping Cards while on Cards switches between the card list and Tower gear, scrolled to the top,
  // and Cards opened from another tab starts on the card list; fails_when=a second tap does nothing, the switch and the
  // tab disagree, or Tower gear stays picked after leaving; why_new=new behaviour; seam=none; no_claim=the slide
  // animation (jsdom has no layout; scrollTo is a spy)
  it('switches between Cards and Tower gear when tapped again, and opens on Cards', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const nav = within(screen.getByRole('navigation', { name: 'Tabs' }));
    const cardsTab = () => nav.getByRole('button', { name: 'Cards' });
    const pressed = (name: string) => screen.getByRole('button', { name, pressed: true });

    fireEvent.click(cardsTab());
    expect(cardsTab().getAttribute('aria-current')).toBe('page');
    expect(pressed('Cards')).toBeTruthy();
    expect(towers()).toBeNull();
    const root = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    const scrollTo = vi.fn();
    root.scrollTo = scrollTo;

    later();
    fireEvent.click(cardsTab());
    expect(pressed('Tower gear')).toBeTruthy();
    expect(towers()).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0 });

    fireEvent.click(cardsTab());
    expect(pressed('Cards')).toBeTruthy();
    expect(towers()).toBeNull();

    // Left on Tower gear, Cards opens on the card list again.
    fireEvent.click(cardsTab());
    fireEvent.click(nav.getByRole('button', { name: 'Packs' }));
    later();
    fireEvent.click(cardsTab());
    expect(pressed('Cards')).toBeTruthy();
    expect(towers()).toBeNull();
  });

  // Value: protects=the page's Cards/Tower gear switch and a second tap on the tab change the same setting; fails_when=App
  // hands CardsView a stale or no-op onSub, or the tab flips its own copy; why_new=the tab test never taps the page switch;
  // seam=none; no_claim=the switch's look
  it('switches back from Tower gear picked on the page when the tab is tapped again', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const nav = within(screen.getByRole('navigation', { name: 'Tabs' }));
    const cardsTab = () => nav.getByRole('button', { name: 'Cards' });
    const pressed = (name: string) => screen.getByRole('button', { name, pressed: true });

    fireEvent.click(cardsTab());
    // jsdom has no scrolling; the tab's second tap scrolls to the top.
    document.querySelector<HTMLElement>('[data-scroll-root]')!.scrollTo = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Tower gear' }));
    expect(pressed('Tower gear')).toBeTruthy();
    expect(towers()).toBeTruthy();

    later();
    fireEvent.click(cardsTab());
    expect(pressed('Cards')).toBeTruthy();
    expect(towers()).toBeNull();
  });

  // Regression: /ship review of clock-and-gear-taps — a quick double tap on Cards from another tab landed on Tower gear
  // Found by /ship on 2026-10-13
  // Value: protects=a second tap within half a second of opening Cards is ignored, and the active tab says what its
  // next tap does; fails_when=a double tap lands on Tower gear instead of the card list, a clock gone back blocks the tab, or the description goes or
  // names the wrong page; why_new=review (Red Team, design); seam=none; no_claim=real touch timing
  it('ignores a tap that comes straight after opening Cards, and says what the next tap does', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const nav = within(screen.getByRole('navigation', { name: 'Tabs' }));
    const cardsTab = () => nav.getByRole('button', { name: 'Cards' });
    document.querySelector<HTMLElement>('[data-scroll-root]')!.scrollTo = vi.fn();
    expect(cardsTab().getAttribute('aria-description')).toBeNull();

    fireEvent.click(cardsTab());
    fireEvent.click(cardsTab());
    expect(towers()).toBeNull();
    expect(cardsTab().getAttribute('aria-description')).toBe('Tap again for Tower gear');

    later();
    fireEvent.click(cardsTab());
    expect(towers()).toBeTruthy();
    expect(cardsTab().getAttribute('aria-description')).toBe('Tap again for Cards');

    // Opened again, then the device clock goes back an hour: the next tap still switches, rather than waiting an hour.
    fireEvent.click(nav.getByRole('button', { name: 'Packs' }));
    fireEvent.click(cardsTab());
    vi.setSystemTime(Date.now() - 60 * 60 * 1000);
    fireEvent.click(cardsTab());
    expect(towers()).toBeTruthy();
  });

  // Generated by /ship review fixes on 2026-10-18
  // Value: protects=from the Maxed page, tapping the Cards tab again goes back to the card list and says so;
  // fails_when=the toggle sends Maxed on to Tower gear, or the description names the wrong page; why_new=review
  // (testing); seam=none; no_claim=real touch timing
  it('goes back to the card list from Maxed when the Cards tab is tapped again', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const nav = within(screen.getByRole('navigation', { name: 'Tabs' }));
    const cardsTab = () => nav.getByRole('button', { name: 'Cards' });
    document.querySelector<HTMLElement>('[data-scroll-root]')!.scrollTo = vi.fn();
    fireEvent.click(cardsTab());
    fireEvent.click(screen.getByRole('button', { name: 'Maxed', pressed: false }));
    expect(cardsTab().getAttribute('aria-description')).toBe('Tap again for Cards');
    later();
    fireEvent.click(cardsTab());
    expect([screen.getByRole('button', { name: 'Cards', pressed: true }) != null, towers()]).toEqual([true, null]);
  });
});

describe('the Cards tab keeping what was typed', () => {
  // Regression: /ship review of clock-and-gear-taps — switching to Tower gear dropped a half-typed card
  // Found by /ship on 2026-10-13
  // Value: protects=a name typed in Add card is still there after the tab switches to Tower gear and back; fails_when=the
  // switch unmounts the card list, dropping its typing; why_new=review (design, adversarial); seam=none; no_claim=what is
  // kept when leaving the Cards tab altogether
  it('keeps a half-typed card when switching to Tower gear and back', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const nav = within(screen.getByRole('navigation', { name: 'Tabs' }));
    const cardsTab = () => nav.getByRole('button', { name: 'Cards' });
    document.querySelector<HTMLElement>('[data-scroll-root]')!.scrollTo = vi.fn();
    fireEvent.click(cardsTab());
    fireEvent.change(screen.getByPlaceholderText('e.g. Sub-Zero, Klassic (name, variant)'), { target: { value: 'Raiden, Dark' } });
    later();
    fireEvent.click(cardsTab());
    expect(screen.getByRole('button', { name: 'Tower gear', pressed: true })).toBeTruthy();
    fireEvent.click(cardsTab());
    expect((screen.getByPlaceholderText('e.g. Sub-Zero, Klassic (name, variant)') as HTMLInputElement).value).toBe('Raiden, Dark');
  });
});

describe('card art from the catalog', () => {
  // Generated by /ship review fixes on 2026-10-13
  // Value: protects=the automatic art fill keeps an image a sync pasted on a card while the catalog downloaded;
  // fails_when=the fill works from the cards as they were when the download started, replacing the pasted image;
  // why_new=catalog.test.ts covers catalogImageUpdates, not the cards App hands it; seam=fetch holds the catalog until
  // released, the sync stand-in runs just before App hears the catalog is in; no_claim=a real sync
  it('keeps an image a sync pasted while the catalog was downloading', async () => {
    let release: (() => void) | undefined;
    const catalog = { items: [{ kind: 'character', name: 'Liu Kang, Klassic', rarity: 'diamond', slug: 'liu-kang-klassic', image: 'z.png' }] };
    vi.stubGlobal('fetch', (url: string) =>
      String(url).endsWith('catalog.json')
        ? new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify(catalog)))))
        : Promise.reject(new Error('offline')),
    );
    const s = defaultState();
    s.cards = [{ id: 'liu', name: 'Liu Kang, Klassic', rarityId: 'diamond', fusion: 2, guest: false }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    let update!: ReturnType<typeof useStore>['update'];
    const pasted = 'https://example.invalid/pasted.png';
    // Asked for before App asks, so this runs first once the catalog is in: the sync lands before React draws again,
    // which is when App would otherwise have stopped waiting for a set of cards that changed.
    const synced = loadCatalog().then(() => update((d) => void Object.assign(d.cards[0], { imageUrl: pasted, wikiTitle: undefined })));
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    expect(release).toBeDefined(); // the catalog was still downloading
    await act(async () => {
      release!();
      await synced;
      await loadCatalog(); // App's own wait, asked for after the sync's, has run by now
    });
    const card = JSON.parse(localStorage.getItem('mkmax:v1')!).cards[0];
    expect([card.imageUrl, card.imagePage]).toEqual([pasted, undefined]);
  });
});

// Last in the file: the schedule this downloads stays loaded for the rest of it.
describe('the Realm Klash season from the schedule', () => {
  afterEach(() => vi.restoreAllMocks());

  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=when the schedule stretches the season by exactly 2 weeks, the app moves items still ending on the
  // saved week end to the new end, once; fails_when=the App effect skips because the saved end rolled forward already
  // matches (extendedEnd dropped from its guard); why_new=engine.test.ts covers moveSeasonEnd, not the App effect
  // that decides to call it; seam=none; no_claim=a real sync (none set up, so the first sync counts as settled); the
  // schedule is a stubbed events.json
  it('moves items on the saved end when the schedule stretched the season by exactly 2 weeks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-12T12:00:00Z'));
    const local = (iso: string) => toLocalInput(new Date(iso));
    // Week by week, as the site lists it: the season that was saved as ending Jan 10 now runs to Jan 24.
    const week = (name: string, start: string, end: string) => ({ name, start: `2026-01-${start}T11:00:00Z`, end: `2026-01-${end}T11:00:00Z` });
    const events = { fetchedAt: '2026-01-12T00:00:00Z', capturedAt: null, packs: [], challenges: [], seasons: [week('Kold', '03', '10'), week('Kold 2', '10', '17'), week('Kold 3', '17', '24')] };
    vi.stubGlobal('fetch', (url: string) =>
      String(url).endsWith('events.json') ? Promise.resolve(new Response(JSON.stringify(events))) : Promise.reject(new Error('offline')),
    );
    const s = defaultState();
    s.realmKlashSeasonEnd = local('2026-01-10T11:00:00Z');
    s.packs = [{ id: 'item', name: 'Season item', currencyId: 'blood-rubies', season: true, cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: local('2026-01-10T11:00:00Z'), drops: [] }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const saved = () => JSON.parse(localStorage.getItem('mkmax:v1')!);
    await waitFor(() => expect(saved().packs[0].endsAt).toBe(local('2026-01-24T11:00:00Z')));
    expect(saved().realmKlashSeasonEnd).toBe(local('2026-01-24T11:00:00Z'));
    expect(stamps).toHaveBeenCalledTimes(1);
  });

  // Generated by /ship test coverage audit on 2026-10-13
  // Value: protects=a 2-week stretch moves items on an earlier week end when the saved end is a season back and rolls
  // through it; fails_when=App checks only the saved end itself as a week end, so it skips and the item stays expired;
  // why_new=the test above saves the week end itself; engine.test.ts covers moveSeasonEnd, not App's guard;
  // seam=none; no_claim=a real sync (none set up); the schedule is a stubbed events.json
  it('moves items on a week end the saved end rolled through when the schedule stretched the season by 2 weeks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-12T12:00:00Z'));
    const local = (iso: string) => toLocalInput(new Date(iso));
    // Saved as the end of the season before (Dec 27): this season was due to end Jan 10, then the site added 2 weeks.
    const week = (name: string, start: string, end: string) => ({ name, start: `${start}T11:00:00Z`, end: `${end}T11:00:00Z` });
    const seasons = [week('Kold', '2025-12-27', '2026-01-03'), week('Kold 2', '2026-01-03', '2026-01-10'), week('Kold 3', '2026-01-10', '2026-01-17'), week('Kold 4', '2026-01-17', '2026-01-24')];
    const events = { fetchedAt: '2026-01-12T00:00:00Z', capturedAt: null, packs: [], challenges: [], seasons };
    vi.stubGlobal('fetch', (url: string) =>
      String(url).endsWith('events.json') ? Promise.resolve(new Response(JSON.stringify(events))) : Promise.reject(new Error('offline')),
    );
    const s = defaultState();
    s.realmKlashSeasonEnd = local('2025-12-27T11:00:00Z');
    s.packs = [{ id: 'item', name: 'Season item', currencyId: 'blood-rubies', season: true, cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: null, endsAt: local('2026-01-10T11:00:00Z'), drops: [] }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    // The schedule is fetched once and shared, so the test before this one left its own: load this one first.
    await refreshEvents();
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    const saved = () => JSON.parse(localStorage.getItem('mkmax:v1')!);
    await waitFor(() => expect(saved().packs[0].endsAt).toBe(local('2026-01-24T11:00:00Z')));
    expect(saved().realmKlashSeasonEnd).toBe(local('2026-01-24T11:00:00Z'));
  });

  // Generated by /ship test coverage audit on 2026-10-14
  // Value: protects=a 2-week stretch with no item on the passed week end makes App save and sync nothing; fails_when=App
  // ignores moveSeasonEnd's false, so every launch stamps a no-op that syncs and asks which copy to keep; why_new=engine
  // test has no_claim=the App effect; seam=none; no_claim=a real sync (none set up); the schedule is a stubbed events.json
  it('saves nothing when the schedule stretched the season by 2 weeks and no item ends on the passed week end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-12T12:00:00Z'));
    const local = (iso: string) => toLocalInput(new Date(iso));
    const week = (name: string, start: string, end: string) => ({ name, start: `2026-01-${start}T11:00:00Z`, end: `2026-01-${end}T11:00:00Z` });
    const events = { fetchedAt: '2026-01-12T00:00:00Z', capturedAt: null, packs: [], challenges: [], seasons: [week('Kold', '03', '10'), week('Kold 2', '10', '17'), week('Kold 3', '17', '24')] };
    vi.stubGlobal('fetch', (url: string) =>
      String(url).endsWith('events.json') ? Promise.resolve(new Response(JSON.stringify(events))) : Promise.reject(new Error('offline')),
    );
    const s = defaultState();
    s.realmKlashSeasonEnd = local('2026-01-10T11:00:00Z');
    // Next season's item, already dated by the schedule: nothing ends on the passed Jan 10 week end.
    s.packs = [{ id: 'next', name: 'Next season item', currencyId: 'blood-rubies', season: true, cost: 100, rolls: 1, maxPurchases: null, purchased: 0, startsAt: local('2026-01-24T11:00:00Z'), endsAt: local('2026-01-31T11:00:00Z'), drops: [] }];
    localStorage.setItem('mkmax:v1', JSON.stringify(s));
    await refreshEvents();
    const stamps = vi.spyOn(SyncLoop.prototype, 'nextStamp');
    render(
      <StoreProvider>
        <PlanProvider>
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
    await act(async () => {});
    expect(stamps).not.toHaveBeenCalled();
    const saved = JSON.parse(localStorage.getItem('mkmax:v1')!);
    expect([saved.realmKlashSeasonEnd, saved.updatedAt, saved.packs[0].endsAt]).toEqual([local('2026-01-10T11:00:00Z'), undefined, local('2026-01-31T11:00:00Z')]);
  });
});

describe('the Undo bar', () => {
  let update!: ReturnType<typeof useStore>['update'];
  const renderApp = () =>
    render(
      <StoreProvider>
        <PlanProvider>
          <Grab onRender={(store) => (update = store.update)} />
          <App />
        </PlanProvider>
      </StoreProvider>,
    );
  const add = (id: string, label: string) => act(() => update((d) => void d.cards.push({ id, name: id, rarityId: 'epic', fusion: 1, guest: false }), label));
  const ids = () => (JSON.parse(localStorage.getItem('mkmax:v1')!).cards as { id: string }[]).map((c) => c.id);
  /** Sets what the page reports for document.visibilityState, then sends the event the app listens for. */
  const appShows = (state: 'visible' | 'hidden') => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
  };
  afterEach(() => vi.restoreAllMocks());

  // Generated on 2026-10-22 (/ship review, Red Team, Tower dropdown)
  // Value: protects=the Undo bar's 8 seconds only count while the app is showing, and it gets them in full on coming
  // back, so a change made as the app went away (a Tower name finished on hiding) keeps its Undo; fails_when=the bar's
  // timer runs while the app is away and a phone fires it on return; why_new=review (Red Team); seam=fake timers,
  // document.visibilityState mocked; no_claim=how long a real phone keeps the app
  it('keeps its time while the app is away, and shows for the full time on return', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    renderApp();
    add('a', 'Added a');
    appShows('hidden');
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.queryByText('Added a')).toBeTruthy();
    appShows('visible');
    act(() => void vi.advanceTimersByTime(7_000));
    expect(screen.queryByText('Added a')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.queryByText('Added a')).toBeNull();

    // Extended on 2026-10-22 (/ship test coverage audit, Tower dropdown)
    // Value: protects=a change made while the app is already away (a Tower name finished as the app is hidden) gets its
    // full 8 seconds once the app shows; fails_when=the bar only pauses on a hide that comes after it shows, so a change
    // made while hidden starts counting at once and is gone on return; why_new=the steps above make the change before
    // hiding; seam=fake timers, document.visibilityState mocked; no_claim=a real phone's event order on hiding
    appShows('hidden');
    add('b', 'Added b');
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.queryByText('Added b')).toBeTruthy();
    appShows('visible');
    act(() => void vi.advanceTimersByTime(7_000));
    expect(screen.queryByText('Added b')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.queryByText('Added b')).toBeNull();
  });

  // Generated on 2026-10-22 (/ship review, Red Team, Tower dropdown)
  // Value: protects=Undo and ✕ act only on the change the bar showed when pressed: a change made between the press and
  // the click (a Tower box the press finished) is shown, not undone or dropped unseen; Undo from the keyboard acts on the
  // change showing; fails_when=the click undoes or dismisses whatever came in after the press; why_new=review (Red Team);
  // seam=the in-between change made with the store's update, a pointer click sent with detail 1; no_claim=a real tap's
  // event order
  it('undoes or dismisses only the change it showed when pressed', () => {
    renderApp();
    add('a', 'Added a');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Undo' }));
    add('b', 'Added b');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }), { detail: 1 });
    expect([ids(), screen.queryByText('Added b') !== null]).toEqual([['a', 'b'], true]);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Dismiss' }));
    add('c', 'Added c');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }), { detail: 1 });
    expect(screen.queryByText('Added c')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect([ids(), screen.queryByText('Added c')]).toEqual([['a', 'b'], null]);
  });

  // Generated on 2026-10-23 (/ship review, state matrix, Tower dropdown)
  // Value: protects=a press on Undo or ✕ acts only on the change it showed, whatever kind came in before the click: an
  // Add carried on from the Undo the press showed, a level change that removed a maxed card, a re-spell from Add card's Tower box,
  // and a re-spell the press itself makes by finishing a card's Tower box; that change stays showing and nothing is
  // undone or closed; fails_when=a kind of change gets its own way to Undo (its base, or the label of the Undo it carried
  // on from) that the press check misses, so a stale press undoes or closes it unseen; why_new=review (state machines):
  // only plain changes were pressed stale; seam=the store's update makes the carried Add and the level change as Add
  // card and a level tap do, the press's blur is sent by hand between pointerdown and click; no_claim=a real tap's
  // event order
  it('acts only on the change a press showed, for each kind of change', () => {
    const gear = (id: string, name: string, sourceNote: string) => ({ id, name, rarityId: 'epic', fusion: 1, guest: false, source: 'tower', sourceNote });
    localStorage.setItem('mkmax:v1', JSON.stringify({ ...defaultState(), cards: [gear('kori', 'Kori Blade', 'lin kuei tower'), gear('fan', 'Frost Fan', 'lin kuei tower')] }));
    renderApp();
    const towerOf = (id: string) => (JSON.parse(localStorage.getItem('mkmax:v1')!).cards as { id: string; sourceNote?: string }[]).find((c) => c.id === id)?.sourceNote;
    const stalePress = (name: 'Undo' | 'Dismiss', newer: () => void) => {
      fireEvent.pointerDown(screen.getByRole('button', { name }));
      newer();
      fireEvent.click(screen.getByRole('button', { name }), { detail: 1 });
    };

    // An Add that carries on from the Undo the press showed.
    add('a', 'Added a');
    stalePress('Undo', () => act(() => update((d) => void d.cards.push({ id: 'b', name: 'b', rarityId: 'epic', fusion: 1, guest: false }), 'Added b', { alsoUndo: true })));
    expect([ids(), screen.queryByText('Added b · Added a') !== null]).toEqual([['kori', 'fan', 'a', 'b'], true]);

    // A level change that removed a card as maxed.
    act(() => update((d) => void d.cards.push({ id: 'm', name: 'Mileena', rarityId: 'diamond', fusion: 1, guest: false }), 'Added Mileena'));
    act(() => update((d) => void (d.cards.find((c) => c.id === 'm')!.fusion = 11), 'Mileena to F10'));
    expect(screen.queryByText('Mileena to F10 · Mileena is maxed and removed')).toBeTruthy();
    stalePress('Undo', () => add('d', 'Added d'));
    expect([ids().includes('m'), screen.queryByText('Added d') !== null]).toEqual([false, true]);

    // A re-spell from Add card's Tower box.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Tabs' })).getByRole('button', { name: 'Cards' }));
    const form = within(screen.getByRole('heading', { name: 'Add card' }).closest('section')!);
    fireEvent.change(form.getByLabelText('Rarity'), { target: { value: 'epic' } });
    fireEvent.change(form.getByLabelText('Source'), { target: { value: 'tower' } });
    stalePress('Dismiss', () => {
      fireEvent.change(form.getByLabelText('Tower'), { target: { value: nameBoxValue(form.getByLabelText('Tower')) } });
      fireEvent.change(form.getByPlaceholderText('Tower name'), { target: { value: 'Lin Kuei Tower' } });
      fireEvent.blur(form.getByPlaceholderText('Tower name'));
    });
    expect([towerOf('kori'), towerOf('fan'), screen.queryByText('Fixed the spelling on 2 other cards: Lin Kuei Tower') !== null]).toEqual(['Lin Kuei Tower', 'Lin Kuei Tower', true]);

    // A re-spell the press makes itself, by finishing a card's Tower box as focus leaves it.
    const box = () => {
      let r: HTMLElement | null = screen.getAllByTitle('Tap to rename').find((t) => t.textContent === 'Kori Blade')!;
      while (r && !r.querySelector('[aria-label=Tower]')) r = r.parentElement;
      return r!.querySelector<HTMLElement>('[aria-label=Tower]')!;
    };
    fireEvent.change(box(), { target: { value: nameBoxValue(box()) } });
    fireEvent.change(box(), { target: { value: 'Lin Kuei tower' } });
    stalePress('Undo', () => fireEvent.blur(box()));
    expect([towerOf('kori'), towerOf('fan'), screen.queryByText('Fixed the spelling on 1 other card: Lin Kuei tower') !== null]).toEqual(['Lin Kuei tower', 'Lin Kuei tower', true]);
  });

  // Generated on 2026-10-22 (/ship review, state matrix, Tower dropdown)
  // Value: protects=a plain tap or a key press on Undo undoes the change showing, and on ✕ closes the bar keeping it,
  // also a key press on ✕ after an earlier press that a new change replaced; fails_when=the pressed-entry match fails, so
  // a real tap does nothing, or a stale press blocks the keyboard; why_new=review (state machines, testing); seam=pointer
  // clicks sent with detail 1, key clicks with detail 0; no_claim=a real tap's event order
  it('undoes or closes the change showing on a plain tap or a key press', () => {
    renderApp();
    const press = (name: string, detail: number) => {
      if (detail) fireEvent.pointerDown(screen.getByRole('button', { name }));
      fireEvent.click(screen.getByRole('button', { name }), { detail });
    };
    add('a', 'Added a');
    press('Undo', 1);
    expect([ids(), screen.queryByText('Added a')]).toEqual([[], null]);
    add('b', 'Added b');
    press('Undo', 0);
    expect([ids(), screen.queryByText('Added b')]).toEqual([[], null]);
    add('c', 'Added c');
    press('Dismiss', 1);
    expect([ids(), screen.queryByText('Added c')]).toEqual([['c'], null]);
    add('d', 'Added d');
    press('Dismiss', 0);
    expect([ids(), screen.queryByText('Added d')]).toEqual([['c', 'd'], null]);
    add('e', 'Added e');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Dismiss' }));
    add('f', 'Added f');
    press('Dismiss', 0);
    expect([ids(), screen.queryByText('Added f')]).toEqual([['c', 'd', 'e', 'f'], null]);

    // A press is used once: after one that a new change made stale, a click with no press before it (as some
    // accessibility tools send) acts on the change showing.
    add('g', 'Added g');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Undo' }));
    add('h', 'Added h');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }), { detail: 1 });
    expect(screen.queryByText('Added h')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }), { detail: 1 });
    expect([ids(), screen.queryByText('Added h')]).toEqual([['c', 'd', 'e', 'f', 'g'], null]);
  });

  // Generated on 2026-10-22 (/ship review, state matrix, Tower dropdown)
  // Value: protects=the bar goes after 8 seconds, and a change that replaces the one showing gets its own full 8 seconds,
  // even one made in the same millisecond, and after time away; fails_when=the timer is keyed on the change's time, so a
  // change made in the same millisecond keeps the old timer, which closes nothing, and the bar never goes; why_new=review
  // (state machines); seam=fake timers (Date frozen, so two changes share a millisecond), document.visibilityState
  // mocked; no_claim=none beyond protects
  it('gives each change its own 8 seconds, even two made in the same millisecond', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    renderApp();
    const showing = (label: string) => screen.queryByText(label) !== null;
    add('a', 'Added a');
    act(() => void vi.advanceTimersByTime(7_900));
    expect(showing('Added a')).toBe(true);
    act(() => void vi.advanceTimersByTime(200));
    expect([showing('Added a'), ids()]).toEqual([false, ['a']]);

    add('b', 'Added b');
    act(() => void vi.advanceTimersByTime(5_000));
    add('c', 'Added c');
    act(() => void vi.advanceTimersByTime(5_000));
    expect(showing('Added c')).toBe(true);
    act(() => void vi.advanceTimersByTime(3_100));
    expect(showing('Added c')).toBe(false);

    add('d', 'Added d');
    add('e', 'Added e');
    act(() => void vi.advanceTimersByTime(8_100));
    expect(showing('Added e')).toBe(false);

    add('f', 'Added f');
    add('g', 'Added g');
    appShows('hidden');
    act(() => void vi.advanceTimersByTime(20_000));
    appShows('visible');
    act(() => void vi.advanceTimersByTime(7_000));
    expect(showing('Added g')).toBe(true);
    act(() => void vi.advanceTimersByTime(1_500));
    expect(showing('Added g')).toBe(false);

    // Extended on 2026-10-22 (/ship review, testing): changes saved without Undo while the bar is up (as typing a tower
    // name makes) leave its 8 seconds alone; fails_when=the timer restarts on every render, so typing keeps the bar up.
    add('h', 'Added h');
    for (let i = 0; i < 3; i++) {
      act(() => void vi.advanceTimersByTime(2_500));
      act(() => update((d) => void (d.cards[0].name = `a${i}`)));
    }
    expect(showing('Added h')).toBe(true);
    act(() => void vi.advanceTimersByTime(600));
    expect(showing('Added h')).toBe(false);

    // Extended on 2026-10-22 (/ship review, testing): a change with the same label as the one showing (the same tower
    // spelling fixed twice) still gets its own 8 seconds; fails_when=the timer is keyed on the label, so the old timer
    // closes nothing and the bar stays up for good.
    add('i', 'Added x');
    act(() => void vi.advanceTimersByTime(5_000));
    add('j', 'Added x');
    act(() => void vi.advanceTimersByTime(7_900));
    expect(showing('Added x')).toBe(true);
    act(() => void vi.advanceTimersByTime(200));
    expect(showing('Added x')).toBe(false);
  });

  // Generated on 2026-10-22 (/ship review, Red Team, Tower dropdown)
  // Value: protects=a page restored from the back-forward cache with only pageshow (no visibility change) gives the bar
  // its 8 seconds again, so it doesn't stay up for good; fails_when=only a visibility
  // change restarts the time paused on hiding; why_new=review (Red Team); seam=fake timers, document.visibilityState
  // mocked, a pageshow with persisted sent by hand; no_claim=which browsers skip the visibility change
  it('restarts its time when the page is restored with only pageshow', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    renderApp();
    add('a', 'Added a');
    appShows('hidden');
    act(() => void vi.advanceTimersByTime(20_000));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })));
    act(() => void vi.advanceTimersByTime(7_000));
    expect(screen.queryByText('Added a')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.queryByText('Added a')).toBeNull();
  });
});
