import { App } from '@capacitor/app'
import { isNative } from './platform'

/**
 * What's actually installed, in one place — see vite.config.ts for why.
 */
export const BUILD_SHA = __BUILD_SHA__
export const BUILD_TIME = __BUILD_TIME__
export const BUILD_RUN = __BUILD_RUN__

/** "54c61f0 · run 42 · Aug 16, 3:41 PM" — short enough for a settings footer. */
export function buildLabel(): string {
  const date = new Date(BUILD_TIME)
  const when = Number.isNaN(date.getTime())
    ? BUILD_TIME
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
  const run = BUILD_RUN ? ` · run ${BUILD_RUN}` : ''
  return `${BUILD_SHA}${run} · ${when}`
}

/**
 * The Android package's own versionCode, straight from the OS.
 *
 * This is the field the whole "old APK" confusion turned out to hinge on:
 * every build used to report versionCode 1, so several install flows treated
 * a fresh APK as nothing to update and silently kept the old app running —
 * the JS bundle inside would then report whatever build it actually was, but
 * there was no way to see that the OS still thought it was running build 1.
 * Comparing this against BUILD_RUN is how a repeat of that becomes a glance
 * instead of a debugging session: if they don't match, the install didn't
 * take, full stop — no need to reason about caches or stale downloads.
 */
export async function nativeVersion(): Promise<string | null> {
  if (!isNative()) return null
  try {
    const info = await App.getInfo()
    return `${info.version} (versionCode ${info.build})`
  } catch {
    return null
  }
}
