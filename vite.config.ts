import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { existsSync } from 'node:fs'

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

/*
  Whether this build can talk to Firebase Cloud Messaging.

  Not a nicety — asking without it is a hard crash. `PushNotifications.register()`
  calls `FirebaseMessaging.getInstance()`, which throws
  "Default FirebaseApp is not initialized in this process" when the app was
  built without google-services.json, and Capacitor's bridge rethrows any
  exception out of a plugin method as an uncaught RuntimeException. So the app
  did not fail to register: it died, on the tap, with no message.

  Android's build wires Firebase in only if this file is present at compile
  time (see android/app/build.gradle), so its presence at *bundle* time is the
  same fact — provided CI writes it before building the bundle, which is why
  that step moved ahead of the build in release-apk.yml.

  The file is never committed: it identifies the household's Firebase project.
*/
const FCM_CONFIGURED = existsSync(
  path.resolve(import.meta.dirname, 'android/app/google-services.json'),
)

/*
  Two pages, one bundle graph.

  `index.html` is the phone launcher. `desktop/index.html` is the laptop one
  (see src/lib/surface.ts): the same stores, sign-in and edit forms, laid out
  for a keyboard and a wide screen. Rollup splits what they share into common
  chunks, so the second page costs its own layouts and nothing else.

  The APK gets only the phone page — nothing inside a phone's WebView can
  navigate to the other one, so building it there would be dead weight.
*/
const pages = {
  main: path.resolve(import.meta.dirname, 'index.html'),
  ...(isNative ? {} : { desktop: path.resolve(import.meta.dirname, 'desktop/index.html') }),
}

export default defineConfig({
  base,
  build: {
    rollupOptions: { input: pages },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __BUILD_RUN__: JSON.stringify(BUILD_RUN),
    __FCM_CONFIGURED__: JSON.stringify(FCM_CONFIGURED),
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
    {
      // The PWA plugin links the phone's manifest into every page it builds.
      // The laptop page has its own (desktop/manifest.webmanifest), and two
      // manifests on one page is one too many — so drop the injected one
      // there. Listed after VitePWA so it runs after the injection.
      name: 'desktop-own-manifest',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.path.includes('/desktop/')) return html
          return html.replace(`<link rel="manifest" href="${base}manifest.webmanifest">`, '')
        },
      },
    },
  ],
})
