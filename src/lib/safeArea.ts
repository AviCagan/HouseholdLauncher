import { StatusBar, Style } from '@capacitor/status-bar'
import { isAndroid, isIOS, isNative, isStandalone } from './platform'

/**
 * Safe-area insets that are actually correct on an installed iPhone web app.
 *
 * The CSS `env(safe-area-inset-*)` values are the right mechanism and are what
 * everything here prefers. The problem is that iOS reports them as 0 in a
 * home-screen web app more often than it should — the combination of
 * `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style=black-translucent`
 * puts the page *under* the status bar either way, so a zero inset does not
 * mean "nothing is covering you", it means "iOS declined to say". The result is
 * a header sitting behind the clock and the Dynamic Island, which is exactly
 * what happened here.
 *
 * So: measure what the browser reports, and substitute a device-shaped guess
 * only when the answer is 0 while something is demonstrably covering the top of
 * the screen. Everywhere else — Android, desktop, a Safari tab, an iPhone that
 * reports properly — the measured value is used untouched and this module is a
 * no-op that writes back the same number.
 *
 * The values land on `:root` as `--safe-top` / `--safe-bottom`, which is what
 * the CSS utilities and every inset-aware layout read.
 */

const TOP = '--safe-top'
const BOTTOM = '--safe-bottom'

/**
 * Read what the browser actually resolves `env()` to, in pixels.
 *
 * Measured off a real element rather than read from a custom property:
 * `getComputedStyle(root).getPropertyValue('--safe-top')` returns the
 * *unresolved* token `env(safe-area-inset-top, 0px)` as a string, because
 * custom properties are substituted at use time, not at computation time.
 * Giving a probe element that value as its padding forces the resolution and
 * makes the number readable.
 */
function measure(): { top: number; bottom: number } | null {
  if (typeof document === 'undefined') return null

  const probe = document.createElement('div')
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top, 0px)',
    'padding-bottom:env(safe-area-inset-bottom, 0px)',
  ].join(';')

  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const top = Number.parseFloat(style.paddingTop) || 0
  const bottom = Number.parseFloat(style.paddingBottom) || 0
  probe.remove()

  return { top, bottom }
}

/**
 * What the top inset should be when iOS refuses to report one.
 *
 * Keyed on screen height, which is the only thing available that distinguishes
 * the hardware. The table is deliberately coarse and biased high: guessing 59
 * on a 47pt notch leaves a slightly generous gap that nobody will notice, while
 * guessing 47 on a Dynamic Island puts the title under the pill — so where a
 * height is ambiguous, the larger value wins.
 *
 * Exported for its own tests: this is a lookup table about physical devices,
 * and the failure mode it guards against is invisible until someone is holding
 * the wrong phone.
 */
export function fallbackTopInset(screenHeight: number): number {
  // Dynamic Island: iPhone 14 Pro (852), 16 Pro (874), 15/16 Plus and Pro Max
  // (932, 956). Listed exactly, because 896 and 926 are taller than some of
  // these and are notch devices.
  if ([852, 874, 932, 956].includes(screenHeight)) return 59

  // Notched, home-button-less: X through 14 Plus. 812, 844, 896, 926.
  if (screenHeight >= 812) return 47

  // Home button, or an iPad: a plain status bar.
  return 20
}

/** The bottom inset when iOS won't report one: the home indicator's strip. */
export function fallbackBottomInset(screenHeight: number): number {
  return screenHeight >= 812 ? 34 : 0
}

/**
 * Whether a reported zero should be overridden.
 *
 * Narrow on purpose. In a Safari *tab* the browser chrome already sits above
 * the page, so a zero top inset is correct and padding it would leave a band of
 * dead space under the address bar. Only an installed iOS web app — where the
 * page really does extend under the status bar — gets the substitution.
 */
export const needsFallback = (opts: {
  ios: boolean
  standalone: boolean
  measuredTop: number
}): boolean => opts.ios && opts.standalone && opts.measuredTop === 0

/**
 * Resolve both insets and write them to `:root`.
 *
 * Returns what it wrote, which is what the tests assert on and what makes a
 * misbehaving device debuggable from the console.
 */
export function applySafeArea(): { top: number; bottom: number } {
  const measured = measure() ?? { top: 0, bottom: 0 }
  const screenHeight = typeof window !== 'undefined' ? window.screen?.height ?? 0 : 0

  const substitute = needsFallback({
    ios: isIOS(),
    standalone: isStandalone(),
    measuredTop: measured.top,
  })

  const resolved = substitute
    ? {
        top: fallbackTopInset(screenHeight),
        // The bottom is only substituted alongside the top: a device that
        // reports one correctly reports both, so a zero bottom on its own is
        // a genuine "there is no home indicator".
        bottom: measured.bottom || fallbackBottomInset(screenHeight),
      }
    : measured

  const root = document.documentElement
  root.style.setProperty(TOP, `${resolved.top}px`)
  root.style.setProperty(BOTTOM, `${resolved.bottom}px`)
  return resolved
}

/**
 * Hand the status bar back to Android.
 *
 * Capacitor 8 draws the WebView edge-to-edge on Android by default, so the app
 * starts underneath the status bar — and the Android WebView reports
 * `env(safe-area-inset-top)` as 0 regardless, which leaves headers sitting
 * behind the clock with nothing in CSS able to detect it.
 *
 * Rather than guess an inset the way iOS forces us to, this simply switches
 * overlaying off: Android then insets the WebView itself, a zero inset becomes
 * the truthful answer, and the bar is painted the app's own background colour
 * so the seam is invisible.
 *
 * iOS has no equivalent call and does not need one — there the translucent bar
 * is wanted, and the measured/substituted inset above is what keeps content
 * clear of it.
 */
async function settleNativeStatusBar(): Promise<void> {
  if (!isNative()) return
  try {
    if (isAndroid()) {
      await StatusBar.setOverlaysWebView({ overlay: false })
      await StatusBar.setBackgroundColor({ color: '#0e0e12' })
    }
    // Light glyphs on a dark bar. Capacitor's naming is the opposite of what it
    // reads like: Style.Dark means content styled FOR a dark background.
    await StatusBar.setStyle({ style: Style.Dark })
  } catch (err) {
    // A device or platform without the plugin. The layout still works from the
    // measured insets; only the seam colour is lost.
    console.warn('[safe-area] status bar not adjustable', err)
  }
}

/**
 * Keep the insets current.
 *
 * Rotating the phone changes both, and on iOS the values can arrive a beat
 * after the orientation event — hence the settling re-read rather than a single
 * measurement. `visibilitychange` covers returning from the app switcher, where
 * iOS has been known to report stale insets for the first frame.
 */
export function installSafeArea(): () => void {
  applySafeArea()

  // Fires and forget: it resolves a frame or two later, and the resize it
  // provokes re-runs applySafeArea through the listener below.
  void settleNativeStatusBar().then(() => applySafeArea())

  const refresh = () => {
    applySafeArea()
    setTimeout(applySafeArea, 250)
  }

  window.addEventListener('resize', refresh)
  window.addEventListener('orientationchange', refresh)
  document.addEventListener('visibilitychange', refresh)

  return () => {
    window.removeEventListener('resize', refresh)
    window.removeEventListener('orientationchange', refresh)
    document.removeEventListener('visibilitychange', refresh)
  }
}
