import { useEffect, useState, type ReactNode } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useUI } from '@/store/useUI'
import { useCurrentProfile, useProfile, useSettings, updateSettings } from '@/store/useProfile'
import { fire, ALL_HAPTIC_EVENTS, hasRealHaptics } from '@/lib/haptics'
import { unlockAudio } from '@/lib/sound'
import { isIOS, isNative } from '@/lib/platform'
import { enablePush, pushState, type PushState } from '@/lib/notifications'
import { runPushDiagnostics, sendTestPush, type Check } from '@/lib/pushDiagnostics'
import { newVoiceToken, voiceUrl, VOICE_LISTS } from '@/lib/voice'
import { buildLabel, nativeVersion } from '@/lib/build'
import { fileToAvatarDataUrl, dataUrlBytes } from '@/lib/image'
import { AddressInput } from '@/components/primitives/AddressInput'
import { ColorPicker } from '@/components/primitives/ColorPicker'
import { ColorSwatchButton } from '@/components/primitives/ColorSwatchButton'
import { AUTO_CLEAR_OPTIONS } from '@/lib/cleanup'
import { RECURRENCE_PRESETS } from '@/lib/time'
import {
  ALARM_OPTIONS,
  feedUrl,
  googleSubscribeUrl,
  newCalendarToken,
  webcalUrl,
} from '@/lib/calendar'
import { openExternal, copyToClipboard } from '@/apps/things/routing/deeplink'
import { isConfigured } from '@/lib/env'
import { Avatar } from '@/components/primitives/ClaimChip'
import { toast } from 'sonner'
import type { HouseholdSettings, Profile } from '@/data/types'
import type {
  HapticIntensity,
  NavApp,
  ThemeMode,
  HapticEventName,
  NotifyEvent,
} from '@/data/types'

const ACCENTS = [
  '#7c5cff', '#ff6ea9', '#3aa0ff', '#2bb673',
  '#f5a524', '#e0563c', '#00c2b8', '#b06cff',
]

const THEMES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'oled', label: 'OLED' },
]

const INTENSITIES: { key: HapticIntensity; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'subtle', label: 'Subtle' },
  { key: 'normal', label: 'Normal' },
  { key: 'heavy', label: 'Heavy' },
]

const NAV_APPS: { key: NavApp; label: string }[] = [
  { key: 'google', label: 'Google Maps' },
  { key: 'waze', label: 'Waze' },
  { key: 'apple', label: 'Apple Maps' },
]

export function SettingsSheet() {
  const sheet = useUI((s) => s.sheet)
  const closeSheet = useUI((s) => s.closeSheet)
  const profile = useCurrentProfile()
  const settings = useSettings()
  const household = useData((s) => s.household_settings)[0]

  const [home, setHome] = useState(household?.home_address ?? '')
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lng: number } | null>(null)

  /*
    Re-seed when the shared row changes underneath us.

    This sheet is mounted for the whole session (App.tsx), so useState's
    initialiser ran once at boot and never again. If the other phone changed
    the home address, this field still held the old string — and because Save
    writes `home_address` and both coordinates unconditionally, opening
    Settings for any unrelated reason and tapping Save silently reverted their
    edit and nulled the coordinates for both of you.

    Keyed on the stored value rather than the object: the row's identity
    changes on every realtime echo, which would stomp on what you're typing.
  */
  const storedHome = household?.home_address ?? ''
  useEffect(() => {
    setHome(storedHome)
    setHomeCoords(null)
  }, [storedHome])
  const [showHaptics, setShowHaptics] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [accentWheel, setAccentWheel] = useState(false)
  const [nativeVer, setNativeVer] = useState<string | null>(null)
  useEffect(() => {
    void nativeVersion().then(setNativeVer)
  }, [])

  if (!profile || !settings) return null
  const id = profile.id

  const set = (patch: Parameters<typeof updateSettings>[1]) =>
    void updateSettings(id, patch)

  return (
    <Sheet open={sheet.kind === 'settings'} onClose={closeSheet} title="Settings">
      <div className="flex flex-col gap-7 pb-6">
        {/* First thing in the sheet, on purpose: "is this the build I think it
            is" needs to be answerable without scrolling, especially right
            after installing a new APK. */}
        <p
          className="-mt-2 text-center text-[11px]"
          style={{ color: 'var(--text-faint)' }}
        >
          Build {buildLabel()}
          {/* Android's own version, not the JS bundle's — if this run number
              doesn't match the one above, the install didn't actually take. */}
          {nativeVer && <> · {nativeVer}</>}
        </p>

        <Group label={`${profile.display_name}'s look`}>
          <AvatarRow profile={profile} />

          <Row label="Theme" stacked>
            <div className="pt-2">
              <Segmented
                options={THEMES.map((t) => ({ key: t.key, label: t.label }))}
                value={settings.theme_mode}
                onChange={(v) => set({ theme_mode: v as ThemeMode })}
              />
            </div>
          </Row>

          <Row label="Accent" stacked>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <ColorSwatchButton
                value={settings.accent_hex}
                open={accentWheel}
                onClick={() => {
                  fire('tap')
                  setAccentWheel((v) => !v)
                }}
              />
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    fire('snap')
                    set({ accent_hex: c })
                  }}
                  aria-label={`Accent ${c}`}
                  className="h-[34px] w-[34px] shrink-0 rounded-full"
                  style={{
                    background: c,
                    outline: settings.accent_hex === c ? '2px solid var(--text)' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
            {accentWheel && (
              <div className="pt-3">
                <ColorPicker
                  value={settings.accent_hex}
                  onChange={(hex) => set({ accent_hex: hex })}
                />
              </div>
            )}
          </Row>

          <Row label="Text size" stacked>
            <div className="flex items-center gap-3 pt-1">
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>A</span>
              <input
                type="range"
                min={0.8}
                max={1.4}
                step={0.05}
                value={settings.font_scale}
                onChange={(e) => set({ font_scale: parseFloat(e.target.value) })}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="text-[19px]" style={{ color: 'var(--text-faint)' }}>A</span>
            </div>
          </Row>

          <Toggle
            label="Reduce motion"
            hint="Fades instead of springs"
            value={settings.reduce_motion}
            onChange={(v) => set({ reduce_motion: v })}
          />
        </Group>

        <Group label="Feel">
          {!hasRealHaptics() && (
            <p
              className="rounded-2xl p-3.5 text-[13px] leading-relaxed"
              style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
            >
              {isIOS()
                ? "iOS doesn't let web apps trigger haptics, so this device uses a visual pulse (and sound, if on) instead."
                : "This device doesn't report haptic support — you'll get the visual pulse instead."}
            </p>
          )}

          <Row label="Haptic strength" stacked>
            <div className="pt-2">
              <Segmented
                options={INTENSITIES.map((i) => ({ key: i.key, label: i.label }))}
                value={settings.haptic_intensity}
                onChange={(v) => {
                  set({ haptic_intensity: v as HapticIntensity })
                  // Fire a sample so the new strength is felt straight away.
                  setTimeout(() => fire('claim'), 60)
                }}
              />
            </div>
          </Row>

          <Toggle
            label="Sounds"
            hint="Short synthesised ticks on actions"
            value={settings.sound_enabled}
            onChange={(v) => {
              unlockAudio()
              set({ sound_enabled: v })
            }}
          />

          {isIOS() && !isNative() && (
            <Toggle
              label="iOS haptics"
              hint="iPhones have no vibration API, so this borrows Apple's switch control to produce a real haptic. Works on iOS 17.4 and later; Apple changed it in 26.5, where it may do nothing. Turn off if it feels wrong."
              value={settings.ios_native_switch}
              onChange={(v) => set({ ios_native_switch: v })}
            />
          )}

          <button
            onClick={() => {
              fire('tap')
              setShowHaptics((s) => !s)
            }}
            className="flex items-center justify-between rounded-2xl px-4 py-3.5"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-[14px]">Test & fine-tune each buzz</span>
            <Icon name="chevron" size={15} />
          </button>

          {showHaptics && (
            <div className="flex flex-col gap-1.5 pt-1">
              {ALL_HAPTIC_EVENTS.map((event) => {
                const on = settings.haptic_events[event] !== false
                return (
                  <div
                    key={event}
                    className="flex items-center gap-2.5 rounded-2xl px-4 py-3"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <span className="flex-1 text-[13px]">{labelFor(event)}</span>
                    <button
                      onClick={() => fire(event)}
                      className="rounded-full px-3 py-1.5 text-[12px] font-medium"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
                    >
                      Test
                    </button>
                    <Switch
                      value={on}
                      onChange={(v) =>
                        set({
                          haptic_events: { ...settings.haptic_events, [event]: v },
                        })
                      }
                    />
                  </div>
                )
              })}
            </div>
          )}
        </Group>

        <Group label="Getting around">
          <Row label="Navigate with" stacked>
            <div className="pt-1">
              <Segmented
                options={NAV_APPS.map((n) => ({ key: n.key, label: n.label }))}
                value={settings.nav_app}
                onChange={(v) => set({ nav_app: v as NavApp })}
              />
              {settings.nav_app === 'waze' && (
                <p className="pt-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  Waze can only navigate to one place at a time, so trips are handed
                  over stop by stop. The other apps stay available on every trip.
                </p>
              )}
            </div>
          </Row>

          <Row label="Home address" stacked>
            <div className="flex gap-2 pt-1">
              <div className="min-w-0 flex-1">
                <AddressInput
                  value={home}
                  onChange={(v) => {
                    setHome(v)
                    setHomeCoords(null)
                  }}
                  onPick={(place) => setHomeCoords({ lat: place.lat, lng: place.lng })}
                  placeholder="Start typing your address…"
                  className="w-full rounded-xl px-3.5 py-3 text-[14px] outline-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                />
              </div>
              <button
                onClick={() => {
                  fire('success')
                  // Keep coordinates from a picked suggestion; otherwise clear
                  // them so the typed text is resolved on the next trip.
                  void dataActions.patchRow('household_settings', 'singleton', {
                    home_address: home.trim() || null,
                    home_lat: homeCoords?.lat ?? null,
                    home_lng: homeCoords?.lng ?? null,
                  })
                }}
                className="shrink-0 rounded-xl px-4 text-[14px] font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                Save
              </button>
            </div>
            <p className="pt-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              Shared by both of you. Every trip starts and ends here.
            </p>
          </Row>
        </Group>

        <Group label="Lists">
          <Row label="Clear finished items after" stacked>
            <div className="flex flex-wrap gap-1.5 pt-2">
              {AUTO_CLEAR_OPTIONS.map((o) => {
                const on = (household?.auto_clear_days ?? 7) === o.days
                return (
                  <button
                    key={o.days}
                    onClick={() => {
                      fire('snap')
                      void dataActions.patchRow('household_settings', 'singleton', {
                        auto_clear_days: o.days,
                      })
                    }}
                    className="rounded-full px-3 py-2 text-[13px] font-medium"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--surface-3)',
                      color: on ? '#fff' : 'var(--text-dim)',
                    }}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            <p className="pt-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              Applies to finished to-dos and bought shopping items. Shared by both
              of you, and only runs while the app is open.
            </p>
          </Row>

          <button
            onClick={() => {
              fire('tap')
              setShowPresets((v) => !v)
            }}
            className="flex items-center justify-between rounded-2xl px-4 py-3.5"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-[14px]">Recurring chore quick picks</span>
            <Icon name="chevron" size={15} />
          </button>

          {showPresets && (
            <div className="flex flex-wrap gap-1.5 px-1 pt-1">
              {RECURRENCE_PRESETS.map((p) => {
                const chosen = settings.recurrence_presets ?? []
                // Empty means "all of them", so nothing looks switched off
                // before you have made a choice.
                const on = chosen.length === 0 || chosen.includes(p.label)
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      fire('snap')
                      const base = chosen.length ? chosen : RECURRENCE_PRESETS.map((x) => x.label)
                      const next = on
                        ? base.filter((l) => l !== p.label)
                        : [...base, p.label]
                      // Never leave zero picks — that would empty the chore bar.
                      set({ recurrence_presets: next.length ? next : [p.label] })
                    }}
                    className="rounded-full px-3 py-2 text-[13px] font-medium"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--surface-3)',
                      color: on ? '#fff' : 'var(--text-dim)',
                    }}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}
        </Group>

        <CalendarGroup household={household} />

        <VoiceGroup household={household} profileSlug={profile.slug} />

        <NotificationsGroup profileId={id} settings={settings} onSet={set} />

        <Group label="Help">
          <button
            onClick={() => {
              fire('tap')
              closeSheet()
              useUI.getState().startTour()
            }}
            className="flex items-center justify-between rounded-2xl px-4 py-4"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="flex items-center gap-2.5 text-[14px]">
              <Icon name="sparkle" size={16} />
              Show me around again
            </span>
            <Icon name="chevron" size={15} />
          </button>
        </Group>

        <Group label="Account">
          <button
            onClick={() => {
              fire('tap')
              closeSheet()
              void useProfile.getState().clearProfile()
            }}
            className="flex items-center justify-between rounded-2xl px-4 py-4"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-[14px]">
              Switch from {profile.display_name}
            </span>
            <Icon name="chevron" size={15} />
          </button>
        </Group>
      </div>
    </Sheet>
  )
}

/**
 * Google Calendar sync.
 *
 * Two mechanisms, because neither alone is good enough. The feed keeps every
 * recurring chore in step forever but refreshes on Google's schedule, which is
 * slow. The per-chore link on the Chores tab lands instantly but is one event
 * at a time. Both are surfaced rather than pretending the feed is live.
 */
function CalendarGroup({ household }: { household: HouseholdSettings | undefined }) {
  const [copied, setCopied] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)

  const token = household?.calendar_token ?? null
  const alarm = household?.calendar_alarm_minutes ?? 0
  const url = feedUrl(token)

  const patch = (p: Partial<HouseholdSettings>) =>
    void dataActions.patchRow('household_settings', 'singleton', p)

  if (!isConfigured()) {
    return (
      <Group label="Calendar">
        <div className="rounded-2xl px-4 py-3.5" style={{ background: 'var(--surface-2)' }}>
          <div className="text-[14px]">Google Calendar sync</div>
          <p className="pt-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Needs the Supabase connection — the calendar feed is served from
            there. Everything else in the app works without it.
          </p>
        </div>
      </Group>
    )
  }

  return (
    <Group label="Calendar">
      <Toggle
        label="Sync recurring chores"
        hint="Publishes a private calendar Google can subscribe to"
        value={token != null}
        onChange={(on) => patch({ calendar_token: on ? newCalendarToken() : null })}
      />

      {token && (
        <>
          <button
            onClick={() => {
              fire('success')
              openExternal(googleSubscribeUrl(token))
            }}
            className="flex items-center justify-between rounded-2xl px-4 py-4"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <span className="flex items-center gap-2.5 text-[14px] font-semibold">
              <Icon name="calendar" size={17} />
              Add to Google Calendar
            </span>
            <Icon name="chevron" size={15} />
          </button>

          <div
            className="flex flex-col gap-2 rounded-2xl px-4 py-3.5"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-[14px]">Calendar link</span>
            <p
              className="break-all rounded-xl px-3 py-2 text-[11px]"
              style={{ background: 'var(--surface)', color: 'var(--text-faint)' }}
            >
              {url}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  fire('success')
                  void copyToClipboard(url)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                }}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium"
                style={{ background: 'var(--surface-3)' }}
              >
                <Icon name="copy" size={14} />
                {copied ? 'Copied' : 'Copy link'}
              </button>
              {/* webcal: hands straight to the phone's calendar app, which is
                  the one-tap path on iOS where Google's web flow is awkward. */}
              <button
                onClick={() => {
                  fire('tap')
                  openExternal(webcalUrl(token))
                }}
                className="rounded-full px-3.5 py-2 text-[13px] font-medium"
                style={{ background: 'var(--surface-3)' }}
              >
                Open on this phone
              </button>
            </div>
            <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              Anyone with this link can see your chores. Nothing else — it can't
              change anything.
            </p>
          </div>

          <Row label="Remind me before it's due" stacked>
            <div className="flex flex-wrap gap-1.5 pt-2">
              {ALARM_OPTIONS.map((o) => {
                const on = alarm === o.minutes
                return (
                  <button
                    key={o.minutes}
                    onClick={() => {
                      fire('snap')
                      patch({ calendar_alarm_minutes: o.minutes })
                    }}
                    className="rounded-full px-3 py-2 text-[13px] font-medium"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--surface-3)',
                      color: on ? '#fff' : 'var(--text-dim)',
                    }}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            <p className="pt-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              Google refreshes a subscribed calendar on its own schedule —
              usually a few hours, sometimes a day. For something you want on
              the calendar right now, use the calendar button on a chore.
            </p>
          </Row>

          {confirmNew ? (
            <div
              className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5"
              style={{ background: 'var(--surface-2)' }}
            >
              <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
                The old link stops working and you'd re-subscribe.
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => {
                    fire('warning')
                    patch({ calendar_token: newCalendarToken() })
                    setConfirmNew(false)
                    toast.success('New calendar link created')
                  }}
                  className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
                  style={{ background: 'var(--danger)' }}
                >
                  Do it
                </button>
                <button
                  onClick={() => setConfirmNew(false)}
                  className="rounded-full px-3 py-1.5 text-[12px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                fire('tap')
                setConfirmNew(true)
              }}
              className="px-1 text-left text-[12px]"
              style={{ color: 'var(--text-faint)' }}
            >
              Regenerate the link
            </button>
          )}
        </>
      )}
    </Group>
  )
}

const NOTIFY_EVENTS: { key: NotifyEvent; label: string; hint: string }[] = [
  {
    key: 'claim_complete',
    label: 'Claims & completions',
    hint: 'When something you added gets taken or finished',
  },
  {
    key: 'cooldown_ready',
    label: 'Chore ready again',
    hint: 'When a recurring chore comes off cooldown',
  },
  { key: 'urgent_added', label: 'Urgent items', hint: 'Only the top urgency level' },
  { key: 'any_added', label: 'Anything added', hint: 'Every new item on any list' },
  { key: 'item_edited', label: 'Edits', hint: 'When someone changes an item you can see' },
]

/**
 * "Hey Siri, add milk" — and the Google equivalent.
 *
 * Neither assistant can talk to an app like this directly. Apple's App Intents
 * need a native App Store app, and Google Home routines can't make arbitrary
 * HTTP calls; what both *can* do is fetch a URL, so that's the integration
 * point. One tap copies a per-list URL to paste into Shortcuts or IFTTT.
 */
function VoiceGroup({
  household,
  profileSlug,
}: {
  household: HouseholdSettings | undefined
  profileSlug: string
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const [showShared, setShowShared] = useState(false)
  const token = household?.voice_token ?? null
  const stores = useData((s) => s.stores)

  const patch = (p: Partial<HouseholdSettings>) =>
    void dataActions.patchRow('household_settings', 'singleton', p)

  /*
    One link per list, then one per physical shop. A per-store shortcut is the
    shortest thing to say — "Add to Costco", then just the item — and it can't
    be misheard. Saying "milk at Costco" into the plain Shopping shortcut works
    too, since the endpoint matches spoken store names against the real ones,
    but that depends on speech-to-text getting the shop's name right.

    Online stores are left out: they're excluded from trip planning and an item
    filed under one is really a link to paste, not something to dictate.
  */
  const links = [
    ...VOICE_LISTS.map((l) => ({
      key: l.list,
      label: l.label,
      url: voiceUrl(token, l.list, profileSlug),
    })),
    ...stores
      .filter((st) => !st.is_online)
      .map((st) => ({
        key: `store:${st.id}`,
        label: st.name,
        url: voiceUrl(token, 'shopping_items', profileSlug, st.name),
      })),
  ]

  /*
    Same links, minus the `who` param — for a shortcut or IFTTT applet neither
    of you owns personally, like one shared Google Home device. Nothing in the
    URL says whose it is, so the endpoint falls back to whatever name is
    spoken: end the phrase with "...this is Avi" or "...this is Jackie" and
    it's credited correctly either way, from either phone or a shared device.
  */
  const sharedLinks = VOICE_LISTS.map((l) => ({
    key: `shared:${l.list}`,
    label: l.label,
    url: voiceUrl(token, l.list),
  }))

  if (!isConfigured()) return null

  const copyLink = (key: string) => {
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
  }

  return (
    <Group label="Voice">
      <Toggle
        label="Add things by voice"
        hint="Works with Siri Shortcuts and Google Assistant"
        value={token != null}
        onChange={(on) => patch({ voice_token: on ? newVoiceToken() : null })}
      />

      {token && (
        <>
          <div className="flex flex-col gap-1.5">
            {links.map((l) => (
              <VoiceLinkRow
                key={l.key}
                link={l}
                copied={copied === l.key}
                onCopy={() => copyLink(l.key)}
              />
            ))}
          </div>

          <div
            className="flex flex-col gap-2 rounded-2xl px-4 py-3.5 text-[12px] leading-relaxed"
            style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
          >
            <p>
              <strong style={{ color: 'var(--text)' }}>iPhone (Siri).</strong> Shortcuts
              app → new shortcut. Add <em>“Ask for Input”</em> first, then
              <em> “Get Contents of URL”</em> — that order matters, because the
              first action is what creates the variable the second one needs.
              Paste a link into the URL field, delete the trailing{' '}
              <code>TEXT</code>, and insert the <em>Provided&nbsp;Input</em>{' '}
              variable in its place. Whatever you name the shortcut is the
              phrase Siri listens for. Make it a Shortcut, not an Automation.
            </p>
            <p>
              <strong style={{ color: 'var(--text)' }}>Google / Gemini.</strong> Google
              Home routines can't call a URL, so route it through an IFTTT applet:
              trigger “Say a phrase with a text ingredient”, action “Webhooks — make a
              web request”, paste a link and put <code>{'{{TextField}}'}</code> where{' '}
              <code>TEXT</code> is.
            </p>
            <p>
              Anything added this way is credited to you. Turning this off revokes
              every shortcut immediately.
            </p>
          </div>

          <button
            onClick={() => {
              fire('tap')
              setShowShared((v) => !v)
            }}
            className="flex items-center justify-between rounded-2xl px-4 py-3.5"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-[14px]">Shared link, for a device you both use</span>
            <Icon name="chevron" size={15} />
          </button>

          {showShared && (
            <>
              <div className="flex flex-col gap-1.5">
                {sharedLinks.map((l) => (
                  <VoiceLinkRow
                    key={l.key}
                    link={l}
                    copied={copied === l.key}
                    onCopy={() => setCopied(l.key)}
                  />
                ))}
              </div>
              <p
                className="rounded-2xl px-4 py-3.5 text-[12px] leading-relaxed"
                style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
              >
                These leave out whose they are, so a Google Home device or an
                IFTTT applet you both trigger — say, a shared Gemini — still
                credits the right person. End the phrase with your name:
                “add milk to shopping, this is Avi” or “...this is Jackie.”
                Set them up the same way as above, just pasting one of these
                links instead.
              </p>
            </>
          )}

          <button
            onClick={() => {
              fire('warning')
              patch({ voice_token: newVoiceToken() })
              toast.success('New links generated', {
                description: 'Re-copy them into your shortcuts.',
              })
            }}
            className="rounded-2xl px-4 py-3 text-left text-[13px]"
            style={{ background: 'var(--surface-2)', color: 'var(--danger)' }}
          >
            Regenerate links
          </button>
        </>
      )}
    </Group>
  )
}

function VoiceLinkRow({
  link,
  copied,
  onCopy,
}: {
  link: { key: string; label: string; url: string }
  copied: boolean
  onCopy: () => void
}) {
  return (
    <button
      onClick={async () => {
        try {
          await copyToClipboard(link.url)
          fire('success')
          onCopy()
        } catch {
          fire('warning')
          toast.error("Couldn't copy")
        }
      }}
      className="flex items-center justify-between rounded-2xl px-4 py-3"
      style={{ background: 'var(--surface-2)' }}
    >
      <span className="text-[14px]">Copy “{link.label}” link</span>
      <span
        className="text-[12px] font-semibold"
        style={{ color: copied ? 'var(--ok)' : 'var(--accent-text)' }}
      >
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  )
}

function NotificationsGroup({
  profileId,
  settings,
  onSet,
}: {
  profileId: string
  settings: import('@/data/types').ProfileSettings
  onSet: (patch: Partial<import('@/data/types').ProfileSettings>) => void
}) {
  const [state, setState] = useState<PushState>(() => pushState())
  const [busy, setBusy] = useState(false)

  async function turnOn() {
    // Tapping while already "on" re-runs registration rather than doing
    // nothing — the button used to be disabled in this state, which is
    // exactly how a permission-granted-but-never-actually-saved subscription
    // stayed invisible with no way to retry.
    const reverifying = state === 'granted'
    setBusy(true)
    try {
      // Must run inside this click — a permission prompt outside a user
      // gesture is refused, and on iOS a refusal sticks until the icon is
      // reinstalled. When already granted this resolves instantly with no
      // prompt shown, so re-tapping never surprises anyone with a dialog.
      const next = await enablePush(profileId)
      setState(next)
      fire(next === 'granted' ? 'success' : 'warning')
      if (reverifying) {
        toast[next === 'granted' ? 'success' : 'error'](
          next === 'granted' ? "Confirmed — you're registered" : "Couldn't confirm — try again",
        )
      }
    } catch (err) {
      // Belt and braces: enablePush is written to resolve to 'error' rather
      // than throw, but a stuck "Asking…" button forever is a worse failure
      // mode than a slightly generic message, if something upstream ever
      // does throw.
      console.error('[push] turnOn failed unexpectedly', err)
      setState('error')
      fire('warning')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Group label="Notifications">
      {state === 'needs-install' && (
        <p
          className="rounded-2xl p-3.5 text-[13px] leading-relaxed"
          style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
        >
          Add Things to your Home Screen first, then open it from that icon.
          iOS only delivers notifications to installed web apps — not Safari tabs.
        </p>
      )}

      {state === 'unsupported' && (
        <p
          className="rounded-2xl p-3.5 text-[13px] leading-relaxed"
          style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
        >
          This browser can't receive notifications.
        </p>
      )}

      {state === 'denied' && (
        <p
          className="rounded-2xl p-3.5 text-[13px] leading-relaxed"
          style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
        >
          Notifications are blocked. Turn them back on in your device settings
          for Things.
        </p>
      )}

      {state === 'error' && (
        <p
          className="rounded-2xl p-3.5 text-[13px] leading-relaxed"
          style={{ background: 'var(--surface-3)', color: 'var(--warn)' }}
        >
          Permission was granted, but saving didn't go through — check your
          connection and try again below.
        </p>
      )}

      {(state === 'default' || state === 'granted' || state === 'error') && (
        <button
          onClick={turnOn}
          disabled={busy}
          className="flex items-center justify-between rounded-2xl px-4 py-4 disabled:opacity-70"
          style={{
            background: state === 'granted' ? 'var(--surface-2)' : 'var(--accent)',
            color: state === 'granted' ? 'var(--text)' : '#fff',
          }}
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Icon name="bell" size={16} />
            {busy
              ? state === 'granted'
                ? 'Verifying…'
                : 'Asking…'
              : state === 'granted'
                ? 'Notifications are on'
                : state === 'error'
                  ? 'Try again'
                  : 'Turn on notifications'}
          </span>
          {state === 'granted' && !busy && <Icon name="check" size={16} strokeWidth={2.6} />}
        </button>
      )}
      {state === 'granted' && (
        <p className="px-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Tap to re-check if you're not sure it's actually registered.
        </p>
      )}

      {NOTIFY_EVENTS.map((e) => (
        <Toggle
          key={e.key}
          label={e.label}
          hint={e.hint}
          value={settings.notify_events[e.key] !== false}
          onChange={(v) =>
            onSet({ notify_events: { ...settings.notify_events, [e.key]: v } })
          }
        />
      ))}

      {settings.notify_events.any_added !== false && (
        <p className="px-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          "Anything added" already covers urgent items, so you'll still only get
          one notification per item.
        </p>
      )}

      <PushDiagnostics profileId={profileId} />
    </Group>
  )
}

/**
 * Reads the actual state of this device rather than inferring it from the
 * other end. Every notification bug in this app so far has been invisible
 * from the sending side and obvious from here.
 */
function PushDiagnostics({ profileId }: { profileId: string }) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  async function run() {
    setBusy(true)
    fire('tap')
    try {
      setChecks(await runPushDiagnostics(profileId))
    } catch (err) {
      console.error('[push] diagnostics failed', err)
      toast.error("Couldn't run the check")
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setTesting(true)
    fire('tap')
    try {
      const { sent } = await sendTestPush(profileId)
      if (sent > 0) {
        fire('success')
        toast.success(`Sent to ${sent} device${sent === 1 ? '' : 's'}`, {
          description: 'It should arrive in a few seconds.',
        })
      } else {
        fire('warning')
        toast.error('Nothing to send to', {
          description: 'No device is registered for you. Run the check above.',
        })
      }
    } catch (err) {
      fire('warning')
      toast.error("Couldn't send", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setTesting(false)
    }
  }

  const COLOR: Record<Check['status'], string> = {
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    bad: 'var(--danger)',
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex gap-2">
        <button
          onClick={() => void run()}
          disabled={busy}
          className="flex-1 rounded-xl py-2.5 text-[13px] font-semibold"
          style={{ background: 'var(--surface-3)', color: 'var(--text)' }}
        >
          {busy ? 'Checking…' : 'Why am I not getting notifications?'}
        </button>
        <button
          onClick={() => void test()}
          disabled={testing}
          className="rounded-xl px-3 py-2.5 text-[13px] font-semibold"
          style={{ background: 'var(--surface-3)', color: 'var(--text)' }}
        >
          {testing ? 'Sending…' : 'Test'}
        </button>
      </div>

      {checks && (
        <div
          className="flex flex-col gap-2.5 rounded-2xl p-3.5"
          style={{ background: 'var(--surface-3)' }}
        >
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2.5">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: COLOR[c.status] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold">{c.label}</span>
                  <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
                    {c.detail}
                  </span>
                </div>
                {c.fix && (
                  <p
                    className="mt-0.5 text-[12px] leading-relaxed"
                    style={{ color: COLOR[c.status] }}
                  >
                    {c.fix}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Profile photo: pick, downscale, store. Emoji stays as the fallback. */
function AvatarRow({ profile }: { profile: Profile }) {
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      if (dataUrlBytes(dataUrl) > 400_000) {
        throw new Error('That image is too large even after resizing')
      }
      await dataActions.patchRow('profiles', profile.id, { avatar_url: dataUrl })
      fire('success')
      setChoosing(false)
    } catch (err) {
      fire('error')
      toast.error(err instanceof Error ? err.message : "Couldn't use that photo")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex items-center gap-4 rounded-2xl px-4 py-3.5"
      style={{ background: 'var(--surface-2)' }}
    >
      <span
        className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full text-[26px]"
        style={{
          background: `color-mix(in oklab, ${profile.color_hex} 24%, transparent)`,
          border: `2px solid ${profile.color_hex}`,
        }}
      >
        <Avatar profile={profile} size={56} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">Your photo</div>
        <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {profile.avatar_url ? 'Shown wherever you appear' : 'Using your emoji for now'}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {!choosing ? (
          <button
            onClick={() => {
              fire('tap')
              setChoosing(true)
            }}
            className="rounded-full px-3 py-2 text-[12px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            {profile.avatar_url ? 'Change' : 'Add photo'}
          </button>
        ) : (
        <div className="flex items-center gap-1.5">
          {/* Two inputs rather than one: `capture` opens the camera straight
              away, and without it the picker offers the photo library. There
              is no single control that offers both. */}
          <label
            className="cursor-pointer rounded-full px-3 py-2 text-[12px] font-semibold text-white"
            style={{ background: 'var(--accent)', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Saving…' : 'Camera'}
            <input
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>

          <label
            className="cursor-pointer rounded-full px-3 py-2 text-[12px] font-semibold"
            style={{
              background: 'var(--surface-3)',
              color: 'var(--text)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Library
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>

          <button
            onClick={() => {
              fire('tap')
              setChoosing(false)
            }}
            aria-label="Cancel"
            className="px-1 text-[12px]"
            style={{ color: 'var(--text-faint)' }}
          >
            Cancel
          </button>
        </div>
        )}

        {profile.avatar_url && !choosing && (
          <button
            onClick={() => {
              fire('delete')
              void dataActions.patchRow('profiles', profile.id, { avatar_url: null })
            }}
            className="px-1 text-[12px]"
            style={{ color: 'var(--text-faint)' }}
          >
            Remove photo
          </button>
        )}
      </div>
    </div>
  )
}

function labelFor(event: HapticEventName): string {
  const map: Record<HapticEventName, string> = {
    tap: 'Tap',
    toggleOn: 'Switch on',
    toggleOff: 'Switch off',
    claim: 'Claiming something',
    complete: 'Completing something',
    delete: 'Deleting',
    swipeThreshold: 'Swipe hits the line',
    longPress: 'Long press',
    dragStart: 'Starting a drag',
    snap: 'Small ticks',
    zipperTick: 'Swipe-to-pay teeth',
    zipperDone: 'Swipe-to-pay lands',
    success: 'Success',
    warning: 'Warning',
    error: 'Error',
  }
  return map[event]
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3
        className="px-1 pb-0.5 text-[12px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </h3>
      {children}
    </section>
  )
}

function Row({
  label,
  children,
  stacked = false,
}: {
  label: string
  children: ReactNode
  stacked?: boolean
}) {
  return (
    <div
      className={`rounded-2xl px-4 py-3.5 ${stacked ? '' : 'flex items-center justify-between gap-3'}`}
      style={{ background: 'var(--surface-2)' }}
    >
      <span className="text-[14px]">{label}</span>
      {children}
    </div>
  )
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-2xl px-4 py-3.5"
      style={{ background: 'var(--surface-2)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[14px]">{label}</div>
        {hint && (
          <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {hint}
          </div>
        )}
      </div>
      <Switch value={value} onChange={onChange} />
    </div>
  )
}

function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => {
        fire(value ? 'toggleOff' : 'toggleOn')
        onChange(!value)
      }}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
      style={{ background: value ? 'var(--accent)' : 'var(--surface-3)' }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
        style={{ left: 2, transform: `translateX(${value ? 20 : 0}px)` }}
      />
    </button>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div
      className="flex gap-1 rounded-full p-1.5"
      style={{ background: 'var(--surface-3)' }}
    >
      {options.map((o) => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            onClick={() => {
              fire('snap')
              onChange(o.key)
            }}
            className="flex-1 whitespace-nowrap rounded-full px-3 py-2.5 text-[13px] font-medium transition-colors"
            style={{
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? '#fff' : 'var(--text-dim)',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
