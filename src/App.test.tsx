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

// The service worker module imports vite-plugin-pwa's virtual module, which only exists in a build; it isn't what's tested.
vi.mock('./appUpdate', () => ({ checkForAppUpdate: () => Promise.resolve() }));

beforeEach(() => {
  // The catalog and the event schedule are fetched at start; neither matters here, so stay offline.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  history.replaceState(null, '', '#packs');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '#');
});

const tab = (name: string) => screen.getByRole('button', { name });
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
        ? new Promise((resolve) => (release = () => resolve({ ok: true, json: () => Promise.resolve(catalog) })))
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
