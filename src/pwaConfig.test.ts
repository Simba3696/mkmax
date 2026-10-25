import { expect, it, vi } from 'vitest';

// The options vite.config.ts hands the PWA plugin, caught at its documented entry point.
const pwa = vi.hoisted(() => ({ options: undefined as undefined | { registerType?: string } }));
vi.mock('vite-plugin-pwa', () => ({ VitePWA: (o: { registerType?: string }) => ((pwa.options = o), []) }));

// Generated on 2026-10-25 (/ship coverage audit, run 15)
// Value: protects=the built service worker waits for the user's Reload instead of taking over and reloading by itself;
// fails_when=registerType goes back to autoUpdate, so a deploy reloads every open copy over whatever is half typed;
// why_new=the app stopped reloading by itself, and appUpdate.test.ts passes registerSW in by hand, so nothing else
// checks the mode the build uses; seam=the plugin's VitePWA mocked to catch its options; no_claim=the built sw.js
it('builds a service worker that waits for Reload', async () => {
  await import('../vite.config');
  expect(pwa.options?.registerType).toBe('prompt');
});
