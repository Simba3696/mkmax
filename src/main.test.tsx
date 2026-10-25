// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

const pwa = vi.hoisted(() => ({ options: [] as { immediate?: boolean }[] }));
vi.mock('virtual:pwa-register', () => ({ registerSW: (o: { immediate?: boolean }) => (pwa.options.push(o), () => Promise.resolve()) }));

// Generated on 2026-10-25 (/ship pre-gate, run 16)
// Value: protects=starting the app registers the service worker once, at once, through the plugin's registerSW (the
// only place it's handed to appUpdate.ts), asks the browser to keep its storage, and draws the app; fails_when=main.tsx
// stops passing registerSW in (no new version is ever found or offered), registers twice, or the app doesn't draw;
// why_new=main.tsx had no test, and now wires registerSW in; seam=the plugin's virtual module mocked, fetch offline,
// navigator.storage stubbed; no_claim=a real service worker
it('registers the service worker, asks to keep storage and draws the app', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const persist = vi.fn(() => Promise.resolve(true));
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false), persist } });
  await act(async () => void (await import('./main')));
  expect(pwa.options.map((o) => o.immediate)).toEqual([true]);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('button', { name: 'MK MAX, go to the Plan' }).length).toBeGreaterThan(0);
  // Importing the whole app cold took over the default 5 s in 1 of 2 full parallel runs (5.2 s, 2026-10-25), so it gets
  // longer; the assertions don't depend on time.
}, 20000);
