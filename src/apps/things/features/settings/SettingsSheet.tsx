import { useEffect, useState, type ReactNode } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useUI } from '@/store/useUI'
import { useCurrentProfile, useSettings, updateSettings } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { newVoiceToken, voiceUrl, VOICE_LISTS } from '@/lib/voice'
import { AddressInput } from '@/components/primitives/AddressInput'
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
import { toast } from 'sonner'
import type { HouseholdSettings, NavApp, NotifyEvent } from '@/data/types'

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
  const [showPresets, setShowPresets] = useState(false)

  if (!profile || !settings) return null
  const id = profile.id

  const set = (patch: Parameters<typeof updateSettings>[1]) =>
    void updateSettings(id, patch)

  return (
    <Sheet open={sheet.kind === 'settings'} onClose={closeSheet} title="Things settings">
      <div className="flex flex-col gap-7 pb-6">
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

        <NotificationsGroup settings={settings} onSet={set} />

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

/**
 * Which Things events are worth a notification.
 *
 * Only the choices — not the switch that registers this device for push, and
 * not the "why am I not getting notifications" diagnostics, both of which used
 * to be here. Those are one per phone, not one per app: registering from
 * Things registered you for Owe and everything else too, so having the control
 * inside one app made it look like an app-level setting and left every other
 * app with no way to ask. They live in launcher Settings → Alerts now, which
 * is also where the same two switches exist for every other app.
 */
function NotificationsGroup({
  settings,
  onSet,
}: {
  settings: import('@/data/types').ProfileSettings
  onSet: (patch: Partial<import('@/data/types').ProfileSettings>) => void
}) {
  return (
    <Group label="Notify me about">
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

      <p className="px-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Whether any of these reach your phone at all is set once for the whole
        launcher, in Settings → Alerts.
      </p>
    </Group>
  )
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
