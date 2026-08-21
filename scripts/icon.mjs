/**
 * The app icon, and every size Android and the web need, from one source.
 *
 * Run: node scripts/icon.mjs
 *
 * The mark is a house whose windows are knocked out to a 2x2 grid — a home,
 * and the app grid the launcher actually is. Both halves have to survive being
 * shrunk to 48px and cropped to a circle, which is why the house is a fat
 * rounded silhouette rather than a thin outline, and why there are four windows
 * rather than a more literal door-and-window arrangement that turns to mush.
 *
 * Rendered through the Chromium that already ships for Playwright rather than
 * a raster library, so there is no new dependency and the SVG is rasterised by
 * the same engine that will draw the rest of the app.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

/** Violet through indigo — the app's own accent, darkened enough to sit under white. */
const GRADIENT = [
  { at: '0%', color: '#9B7BFF' },
  { at: '45%', color: '#6A45E8' },
  { at: '100%', color: '#3A1E9E' },
]

/**
 * The mark itself, on a 512 canvas.
 *
 * `scale` shrinks the glyph about the centre. Android's adaptive icon crops to
 * the inner ~61% of the canvas — anything outside that is fair game for a
 * launcher to mask away — so the foreground layer is drawn small enough to
 * survive the most aggressive shape a manufacturer might apply.
 */
function glyph(scale = 1) {
  return `
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <!-- Knockout, not two shapes: the windows show the gradient behind, so
           the background reads through the mark and the icon keeps depth at
           sizes where a separate coloured square would just blur. -->
      <mask id="windows">
        <rect width="512" height="512" fill="black"/>
        <path d="M256 132 L404 258 L404 420 L108 420 L108 258 Z"
              fill="white" stroke="white" stroke-width="26" stroke-linejoin="round"/>
        <g fill="black">
          <rect x="186" y="272" width="60" height="60" rx="15"/>
          <rect x="266" y="272" width="60" height="60" rx="15"/>
          <rect x="186" y="352" width="60" height="60" rx="15"/>
          <rect x="266" y="352" width="60" height="60" rx="15"/>
        </g>
      </mask>
      <rect width="512" height="512" fill="white" mask="url(#windows)"/>
    </g>`
}

function background(rounded) {
  const stops = GRADIENT.map((s) => `<stop offset="${s.at}" stop-color="${s.color}"/>`).join('')
  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">${stops}</linearGradient>
      <!-- A soft top-left light so the tile isn't a flat wash. Kept very low
           contrast: at 48px anything stronger reads as a smudge. -->
      <radialGradient id="sheen" cx="0.28" cy="0.18" r="0.75">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="512" height="512" rx="${rounded}" fill="url(#bg)"/>
    <rect width="512" height="512" rx="${rounded}" fill="url(#sheen)"/>`
}

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${inner}</svg>`

/** The everyday icon: gradient tile, rounded like an app icon. */
const FULL = svg(background(112) + glyph(1))

/** Square-cornered, for Android's legacy launcher which applies its own shape. */
const FULL_SQUARE = svg(background(0) + glyph(1))

/*
  Safe-zone scaling, which is easy to get wrong in both directions.

  Android hands the launcher a 108dp foreground and guarantees only the central
  66dp circle survives whatever mask the device applies — 61% of the canvas.
  The glyph fills 65.6% of the 512 source, so `scale` converts between the two:
  0.80 puts the house at ~53% of the canvas, comfortably inside that circle
  with room for the roof apex.

  Scaling for the strictly-inscribed square instead (66/√2, about 43%) is the
  common overcorrection — it is technically unimpeachable and produces an icon
  that looks lost on the home screen next to everything else.
*/
const FOREGROUND = svg(glyph(0.8))

/**
 * PWA maskable: background included, glyph inset for the 80%-diameter circle
 * the spec guarantees — a slightly more generous budget than Android's.
 */
const MASKABLE = svg(background(0) + glyph(0.85))

const TARGETS = [
  // Web / PWA
  { source: FULL, size: 512, out: 'public/icons/icon-512.png' },
  { source: FULL, size: 192, out: 'public/icons/icon-192.png' },
  { source: FULL, size: 180, out: 'public/icons/apple-touch-icon-180.png' },
  { source: FULL, size: 64, out: 'public/icons/favicon-64.png' },
  { source: MASKABLE, size: 512, out: 'public/icons/icon-maskable-512.png' },

  // Android legacy raster, per density
  ...[
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
  ].flatMap(([density, px]) => [
    { source: FULL_SQUARE, size: px, out: `android/app/src/main/res/mipmap-${density}/ic_launcher.png` },
    { source: FULL, size: px, out: `android/app/src/main/res/mipmap-${density}/ic_launcher_round.png` },
    // The adaptive foreground is authored at 108/48 of the nominal size, which
    // is the ratio Android expects between the icon and its safe zone.
    {
      source: FOREGROUND,
      size: Math.round(px * 2.25),
      out: `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
      transparent: true,
    },
  ]),
]

/*
  Splash screens.

  Regenerated here rather than left alone because the ones Capacitor scaffolds
  are its own logo on a white field — which, against a dark app and this icon,
  makes the first half-second of every launch look like a different program
  starting. `capacitor.config.ts` paints #0e0e12 behind them, so the artwork
  matches that exactly and the transition to the app is invisible.

  Sized per density and orientation, matching the files Capacitor generated:
  Android picks one by bucket, and a missing size falls back to a scaled
  neighbour that looks soft.
*/
const SPLASH_BG = '#0e0e12'

const splash = (width, height) => {
  // The mark sits at a fixed fraction of the SHORT edge, so it is the same
  // physical size in portrait and landscape rather than stretching with the
  // long one.
  const mark = Math.round(Math.min(width, height) * 0.26)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${SPLASH_BG}"/>
    <svg x="${(width - mark) / 2}" y="${(height - mark) / 2}" width="${mark}" height="${mark}" viewBox="0 0 512 512">
      ${background(96)}${glyph(0.82)}
    </svg>
  </svg>`
}

const SPLASH_TARGETS = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
].map(([dir, w, h]) => ({
  source: splash(w, h),
  width: w,
  height: h,
  out: `android/app/src/main/res/${dir}/splash.png`,
}))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()

for (const { source, size, out, transparent } of TARGETS) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  )
  const buffer = await page.locator('svg').screenshot({ omitBackground: Boolean(transparent) })
  const path = join(ROOT, out)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
  console.log(`${out}  ${size}x${size}`)
}

for (const { source, width, height, out } of SPLASH_TARGETS) {
  await page.setViewportSize({ width, height })
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block}</style>${source}`,
  )
  const buffer = await page.locator('svg').first().screenshot()
  const path = join(ROOT, out)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
  console.log(`${out}  ${width}x${height}`)
}

await browser.close()

// The source, kept so the mark can be looked at full size rather than judged
// from a 48px render.
writeFileSync(join(ROOT, 'scripts/icon-preview.svg'), FULL)
console.log('\nsource written to scripts/icon-preview.svg')
