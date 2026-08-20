import { create } from 'zustand'

/**
 * Where you are in the launcher.
 *
 * A store rather than a router. The app is a single Capacitor WebView with no
 * URL bar and no deep-link surface to honour, so the only thing a router would
 * add is history entries — and those actively hurt here: the Android back
 * button should step home from an app, not unwind twenty tab switches inside
 * Things one at a time. `back()` below is that behaviour, and it is one
 * function instead of a history stack to reason about.
 */

export type Screen = { kind: 'home' } | { kind: 'app'; appId: string }

export type SettingsSection = 'general' | 'apps' | 'people' | 'notifications' | 'about'

interface LauncherState {
  screen: Screen
  /** Notification centre, which overlays whatever screen you are on. */
  inboxOpen: boolean
  settings: SettingsSection | null
  /**
   * Set when a notification is tapped, and consumed by the app it belongs to.
   * The launcher never interprets it — see `notifications.deep_link`.
   */
  pendingDeepLink: Record<string, unknown> | null

  openApp: (appId: string, deepLink?: Record<string, unknown> | null) => void
  goHome: () => void
  back: () => boolean
  setInbox: (open: boolean) => void
  openSettings: (section: SettingsSection) => void
  closeSettings: () => void
  consumeDeepLink: () => Record<string, unknown> | null
}

export const useLauncher = create<LauncherState>((set, get) => ({
  screen: { kind: 'home' },
  inboxOpen: false,
  settings: null,
  pendingDeepLink: null,

  openApp(appId, deepLink = null) {
    // Closing the overlays is part of opening an app: the usual way in is a
    // tap in the notification centre, and leaving it up means landing on the
    // right screen with a sheet still covering it.
    set({
      screen: { kind: 'app', appId },
      inboxOpen: false,
      settings: null,
      pendingDeepLink: deepLink,
    })
  },

  goHome() {
    set({ screen: { kind: 'home' }, pendingDeepLink: null })
  },

  /**
   * One step back. Returns false when there is nowhere left to go, which is
   * what tells the Android hardware button to let the OS have the press and
   * background the app rather than trapping it on the home screen.
   */
  back() {
    const { settings, inboxOpen, screen } = get()
    if (settings) {
      set({ settings: null })
      return true
    }
    if (inboxOpen) {
      set({ inboxOpen: false })
      return true
    }
    if (screen.kind === 'app') {
      set({ screen: { kind: 'home' }, pendingDeepLink: null })
      return true
    }
    return false
  },

  setInbox(open) {
    set({ inboxOpen: open })
  },

  openSettings(section) {
    set({ settings: section, inboxOpen: false })
  },

  closeSettings() {
    set({ settings: null })
  },

  consumeDeepLink() {
    const link = get().pendingDeepLink
    if (link) set({ pendingDeepLink: null })
    return link
  },
}))
