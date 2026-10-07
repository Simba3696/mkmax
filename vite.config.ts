import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

/**
 * Short commit id and commit date, shown in Settings so you can tell whether a device has picked up the latest deploy.
 * The commit date rather than the build date: the daily schedule refresh rebuilds the same commit, and a date that
 * changed every day would change the bundle with it, making every device download the app again and reload.
 */
function appVersion() {
  try {
    const id = process.env.GITHUB_SHA?.slice(0, 7) ?? execSync('git rev-parse --short HEAD').toString().trim();
    return `${id} · ${execSync('git log -1 --format=%cs').toString().trim()}`;
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'logo-mark.svg', 'apple-touch-icon.png'],
      workbox: {
        // Card art is hotlinked from MK Mobile Base and the MK Mobile wiki; keep a copy so thumbnails work offline.
        runtimeCaching: [
          // The event schedule changes daily: always try the network, fall back to the last copy offline. On a
          // connection that hangs rather than fails, the last copy is used after 4 seconds instead of leaving the
          // shop list, challenge dates and season end missing until the request gives up.
          {
            urlPattern: /\/events\.json$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'events', networkTimeoutSeconds: 4, expiration: { maxEntries: 1 } },
          },
          {
            urlPattern: /^https:\/\/(static\.wikia\.nocookie\.net|mkmobilebase\.com\/storage)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'card-art',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'MK Max — Pack Planner',
        short_name: 'MK Max',
        description: 'Prioritize Mortal Kombat Mobile packs to max out your cards.',
        theme_color: '#0e0b0b',
        background_color: '#0e0b0b',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { host: true },
});
