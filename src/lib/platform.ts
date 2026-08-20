import { Capacitor } from '@capacitor/core'

/** True inside the Android APK (Capacitor WebView), false in any browser. */
export const isNative = (): boolean => Capacitor.isNativePlatform()

export const nativePlatform = (): string => Capacitor.getPlatform()

export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports as Macintosh; the touch-point check disambiguates.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
}

export const isAndroid = (): boolean =>
  typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

/**
 * Running from the Home Screen rather than a browser tab.
 * This is a hard requirement for Web Push on iOS — in a Safari tab, permission
 * requests silently do nothing.
 */
export const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS Safari predates display-mode and uses a non-standard flag.
  return (navigator as { standalone?: boolean }).standalone === true
}

/** Web Push needs a service worker + PushManager + Notification. */
export const supportsWebPush = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

/**
 * iOS can only deliver Web Push to an installed PWA, so "supported" alone is
 * misleading — the UI needs to know whether to show a permission button or
 * Add-to-Home-Screen instructions.
 */
export const webPushBlockedByInstall = (): boolean =>
  isIOS() && !isNative() && !isStandalone()
