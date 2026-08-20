import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// Capacitor serves from https://localhost/ inside the APK, GitHub Pages serves
// from /Things/. Getting this wrong is a white screen on exactly one target.
const isNative = process.env.BUILD_TARGET === 'native'
const base = isNative ? '/' : '/HouseholdLauncher/'

/*
  Baked into every build so Settings can show exactly what's installed.

  This exists because of a real support dead-end: someone installs an APK,
  reports a feature as missing, and there is no way — for them or for
  whoever's helping — to tell whether the build is actually stale or the
  feature just isn't where they're looking. GITHUB_SHA/GITHUB_RUN_NUMBER are
  set automatically by every GitHub Actions job; a local `npm run build` falls
  back to something that unambiguously reads as "not a CI build".
*/
const BUILD_SHA = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7)
const BUILD_TIME = new Date().toISOString()
const BUILD_RUN = process.env.GITHUB_RUN_NUMBER ?? ''

export default defineConfig({
  base,
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __BUILD_RUN__: JSON.stringify(BUILD_RUN),
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest (not generateSW) because the service worker needs custom
      // `push` / `notificationclick` handlers — those handlers *are* Web Push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // Registration is done by src/lib/serviceWorker.ts instead. The injected
      // script registers unconditionally, including inside the Android APK,
      // where a stale precache survives an APK update and serves the previous
      // build's index.html — a new APK showing the old app with no error.
      injectRegister: null,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false, type: 'module' },
      manifest: {
        name: 'Household',
        short_name: 'Household',
        description: 'Household launcher',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0c',
        theme_color: '#0a0a0c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
