import { expect, it, vi } from 'vitest';

// The options vite.config.ts hands the PWA plugin, caught at its documented entry point.
type Rule = { urlPattern: RegExp; handler: string; options: { cacheName: string; networkTimeoutSeconds?: number; expiration?: { maxEntries?: number } } };
type Options = { registerType?: string; workbox?: { clientsClaim?: boolean; skipWaiting?: boolean; runtimeCaching?: Rule[] } };
const pwa = vi.hoisted(() => ({ options: undefined as undefined | Options }));
vi.mock('vite-plugin-pwa', () => ({ VitePWA: (o: Options) => ((pwa.options = o), []) }));

// Generated on 2026-10-25 (/ship coverage audit, run 15)
// Value: protects=the built service worker waits for the user's Reload instead of taking over and reloading by itself;
// fails_when=registerType goes back to autoUpdate, so a deploy reloads every open copy over whatever is half typed;
// why_new=the app stopped reloading by itself, and appUpdate.test.ts passes registerSW in by hand, so nothing else
// checks the mode the build uses; seam=the plugin's VitePWA mocked to catch its options; no_claim=the built sw.js
it('builds a service worker that waits for Reload', async () => {
  await import('../vite.config');
  expect(pwa.options?.registerType).toBe('prompt');
});

// Generated on 2026-10-25 (/ship review, run 17 pass 3, Red Team)
// Value: protects=the service worker takes over a first visit at once, so card art and the event schedule are kept
// for offline use from the start, while an update still waits for Reload; fails_when=clientsClaim goes (prompt mode
// leaves it off) or skipWaiting is turned on (an update would take over by itself); why_new=review: moving to prompt
// mode turned clientsClaim off unseen; seam=the plugin's VitePWA mocked to catch its options; no_claim=the built sw.js
it('takes over a first visit at once without skipping the wait for Reload', async () => {
  await import('../vite.config');
  expect([pwa.options?.workbox?.clientsClaim, pwa.options?.workbox?.skipWaiting]).toEqual([true, undefined]);
});

// Value: protects=the card catalog is kept offline, network first with a 4 s fallback like the event schedule, so the
// Klash Tower tab works with no signal after one online visit; fails_when=the rule is dropped (the tower shows only
// an error offline) or becomes cache-first (a day-old catalog wins over a fresh one); why_new=new in the Klash Tower
// planner; seam=the plugin's VitePWA mocked to catch its options; no_claim=the built sw.js
it('keeps the card catalog for offline use, network first', async () => {
  await import('../vite.config');
  const rule = pwa.options?.workbox?.runtimeCaching?.find((r) => r.urlPattern.test('/mkmax/catalog.json'));
  expect([rule?.handler, rule?.options.networkTimeoutSeconds, rule?.options.expiration?.maxEntries]).toEqual(['NetworkFirst', 4, 1]);
});
