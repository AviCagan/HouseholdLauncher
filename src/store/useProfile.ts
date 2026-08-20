import { create } from 'zustand'
import { Preferences } from '@capacitor/preferences'
import type { Profile, ProfileSettings, ProfileSlug } from '@/data/types'
import { useData, dataActions } from './useData'
import { configureHaptics } from '@/lib/haptics'
import { setSoundEnabled } from '@/lib/sound'
import { isNative } from '@/lib/platform'
import { nowIso } from '@/data/adapter'

/**
 * Fixed IDs so the two profiles are identical across the local adapter and
 * Supabase, and so `claimed_by` references survive the switch to a backend.
 */
export const AVI_ID = '11111111-1111-4111-8111-111111111111'
export const JACKIE_ID = '22222222-2222-4222-8222-222222222222'

export const SEED_PROFILES: Profile[] = [
  {
    id: AVI_ID,
    slug: 'avi',
    display_name: 'Avi',
    avatar_emoji: '🦊',
    avatar_url: null,
    color_hex: '#7c5cff',
    created_at: nowIso(),
  },
  {
    id: JACKIE_ID,
    slug: 'jackie',
    display_name: 'Jackie',
    avatar_emoji: '🦋',
    avatar_url: null,
    color_hex: '#ff6ea9',
    created_at: nowIso(),
  },
]

export const defaultSettings = (
  profileId: string,
  slug: ProfileSlug,
): ProfileSettings => ({
  profile_id: profileId,
  theme_mode: 'system',
  accent_hex: slug === 'avi' ? '#7c5cff' : '#ff6ea9',
  font_scale: 1,
  haptic_intensity: 'heavy',
  haptic_events: {},
  sound_enabled: false,
  reduce_motion: false,
  // On by default: this is the only way an iPhone gets any haptic at all,
  // and it degrades to nothing on builds where Apple has closed it off.
  ios_native_switch: true,
  // Jackie navigates with Waze, Avi with Google Maps — changeable in Settings.
  nav_app: slug === 'avi' ? 'google' : 'waze',
  notify_events: {},
  recurrence_presets: [],
  phone_e164: null,
  updated_at: nowIso(),
})

const PROFILE_KEY = 'things:profile'

interface ProfileState {
  profileId: string | null
  hydrated: boolean
  selectProfile: (id: string) => Promise<void>
  clearProfile: () => Promise<void>
  hydrate: () => Promise<void>
}

async function storeGet(key: string): Promise<string | null> {
  if (isNative()) return (await Preferences.get({ key })).value
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

async function storeSet(key: string, value: string | null): Promise<void> {
  if (isNative()) {
    if (value === null) await Preferences.remove({ key })
    else await Preferences.set({ key, value })
    return
  }
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

export const useProfile = create<ProfileState>((set) => ({
  profileId: null,
  hydrated: false,

  async hydrate() {
    const saved = await storeGet(PROFILE_KEY)
    set({ profileId: saved, hydrated: true })
  },

  async selectProfile(id) {
    await storeSet(PROFILE_KEY, id)
    set({ profileId: id })
  },

  async clearProfile() {
    await storeSet(PROFILE_KEY, null)
    set({ profileId: null })
  },
}))

/**
 * Ensure both profiles and their settings rows exist (local-mode seeding).
 *
 * Guarded against overlapping runs. StrictMode invokes the boot effect twice
 * on every mount, and tapping "Try again" on the boot-error screen adds more;
 * because this reads the collections once up front and then awaits per insert,
 * two runs both saw an empty list and both inserted. On Supabase the second
 * hit a duplicate-key error that isn't transient, so the retry wrapper gave up
 * and the app showed "Couldn't load your lists"; on the local adapter, which
 * pushes unconditionally, it produced four profile tiles.
 */
let seeding: Promise<void> | null = null

export function ensureSeeded(): Promise<void> {
  seeding ??= seedOnce().finally(() => {
    seeding = null
  })
  return seeding
}

async function seedOnce(): Promise<void> {
  // Read fresh rather than from a snapshot taken before any await.
  await useData.getState().refetchAll()
  const { profiles, profile_settings, adapter } = useData.getState()

  for (const p of SEED_PROFILES) {
    if (!profiles.some((existing) => existing.id === p.id)) {
      await adapter.insert('profiles', p)
      useData.getState().applyChange({ table: 'profiles', type: 'insert', row: p })
    }
  }

  for (const p of SEED_PROFILES) {
    if (!profile_settings.some((s) => s.profile_id === p.id)) {
      const s = defaultSettings(p.id, p.slug)
      await adapter.insert('profile_settings', s)
      useData
        .getState()
        .applyChange({ table: 'profile_settings', type: 'insert', row: s })
    }
  }

  if (useData.getState().household_settings.length === 0) {
    const h = {
      singleton: true as const,
      home_label: 'Home',
      home_address: null,
      home_lat: null,
      home_lng: null,
      auto_clear_days: 7,
      // Calendar sync is opt-in: no token means no feed to leak.
      calendar_token: null,
      calendar_alarm_minutes: 0,
      // Same posture for voice adding — off until someone turns it on.
      voice_token: null,
      updated_at: nowIso(),
    }
    await adapter.insert('household_settings', h)
    useData
      .getState()
      .applyChange({ table: 'household_settings', type: 'insert', row: h })
  }
}

// --- selectors --------------------------------------------------------------

export function useCurrentProfile(): Profile | null {
  const id = useProfile((s) => s.profileId)
  const profiles = useData((s) => s.profiles)
  return profiles.find((p) => p.id === id) ?? null
}

export function useSettings(): ProfileSettings | null {
  const id = useProfile((s) => s.profileId)
  const all = useData((s) => s.profile_settings)
  return all.find((s) => s.profile_id === id) ?? null
}

export function useOtherProfile(): Profile | null {
  const id = useProfile((s) => s.profileId)
  const profiles = useData((s) => s.profiles)
  return profiles.find((p) => p.id !== id) ?? null
}

export async function updateSettings(
  profileId: string,
  patch: Partial<ProfileSettings>,
): Promise<void> {
  await dataActions.patchRow('profile_settings', profileId, patch)
}

/**
 * Push settings into the DOM and the feedback modules.
 *
 * Theme, accent and font scale are CSS custom properties on <html>, so a change
 * is a variable write rather than a React re-render of the tree.
 */
export function applySettings(settings: ProfileSettings | null): void {
  const root = document.documentElement
  if (!settings) {
    root.removeAttribute('data-theme')
    return
  }

  if (settings.theme_mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', settings.theme_mode)

  root.style.setProperty('--accent', settings.accent_hex)
  root.style.setProperty('--font-scale', String(settings.font_scale))
  root.setAttribute('data-reduce-motion', String(settings.reduce_motion))

  configureHaptics({
    intensity: settings.haptic_intensity,
    perEvent: settings.haptic_events,
    iosSwitch: settings.ios_native_switch,
  })
  setSoundEnabled(settings.sound_enabled)
}
