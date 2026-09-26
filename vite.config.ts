import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        // Card art is hotlinked from the MK Mobile wiki; keep a copy so thumbnails work offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/static\.wikia\.nocookie\.net\//,
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
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { host: true },
});
