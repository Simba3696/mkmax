// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  history.replaceState(null, '', '#');
});

const tab = (name: string) => screen.getByRole('button', { name });

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
