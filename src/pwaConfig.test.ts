import { expect, it, vi } from 'vitest';

type Options = { registerType?: string; workbox?: { runtimeCaching?: { urlPattern: RegExp; handler: string }[] } };
// The options vite.config.ts hands the PWA plugin, caught at its documented entry point.
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

// Generated on 2026-10-25 (/ship review, run 16 pass 3, Red Team)
// Value: protects=the service worker keeps the last card catalog it fetched, trying the network first, so the art
// lookup, rarity check and Maxed completion still work offline now that the app skips the browser's own copy;
// fails_when=catalog.json has no runtime cache and opening offline loses them; why_new=review (Red Team); seam=the
// plugin's VitePWA mocked to catch its options; no_claim=the built sw.js
it('keeps the last card catalog for offline use', async () => {
  await import('../vite.config');
  const rule = pwa.options?.workbox?.runtimeCaching?.find((r) => r.urlPattern.test('/mkmax/catalog.json'));
  expect(rule?.handler).toBe('NetworkFirst');
});
