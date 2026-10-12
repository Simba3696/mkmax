// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StoreProvider } from './store';
import { PlanProvider } from './planner';
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
/** Half a second on, so a tap on the Cards tab counts as deliberate rather than the second half of a double tap. */
const later = () => vi.setSystemTime(Date.now() + 600);

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
    const towers = () => screen.queryByText(/Tower gear is farmed, not bought/);
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
    const towers = () => screen.queryByText(/Tower gear is farmed, not bought/);
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
  // next tap does; fails_when=a double tap flips to Tower gear (dropping a half-typed card) or the description goes or
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
    const towers = () => screen.queryByText(/Tower gear is farmed, not bought/);
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
  });
});
