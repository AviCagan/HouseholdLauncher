import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { logEvent, saveSettings, setPartner, setShareDetails, startCalendar } from '../actions'
import { SETUP_ORDER, type Place } from '../engine'
import { civilLabel, fromLocalInput } from '../format'
import { DEFAULT_STORED, REMINDER_KINDS, validPlace, type ReminderKind, type Stored } from '../model'
import { describe, parse, SETTINGS_UI, type SettingUi } from '../settingsUi'
import { S } from '../strings'
import { Btn, Card, Choice, Field, Section, Toggle, Why } from '../ui'
import { useCalendar, useHer } from '../useMikvah'
import type { MkNano } from '@/data/types'

const REMINDER_LABEL: Record<ReminderKind, string> = {
  hefsek: 'Hefsek day',
  moch: 'Moch dachuk at tzeit',
  bedikah: 'The seven days’ bedikot',
  mikvah: 'Day 7 and mikvah night',
  vestot: 'Onot perishah',
  flags: 'A question still open after a day',
}

const TILE_ICONS: IconName[] = ['calendar', 'clock', 'star', 'book', 'sparkle', 'bell', 'check', 'grid']

// --- location -------------------------------------------------------------------

function LocationFields({ value, onChange }: { value: Place | null; onChange: (p: Place) => void }) {
  const [busy, setBusy] = useState(false)
  const p = value ?? { name: '', lat: NaN, lng: NaN, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
  const num = (v: number) => (Number.isFinite(v) ? String(v) : '')

  function here() {
    if (!navigator.geolocation) return toast.error('This phone can’t share its location here — enter it by hand.')
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false)
        // Three decimals is ~100 m: plenty for zmanim, and no more precise than needed.
        const round = (x: number) => Math.round(x * 1000) / 1000
        onChange({ ...p, name: p.name || 'Home', lat: round(pos.coords.latitude), lng: round(pos.coords.longitude), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
      },
      () => {
        setBusy(false)
        toast.error('Couldn’t get the location — enter it by hand.')
      },
      { enableHighAccuracy: false, timeout: 15_000 },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Btn onClick={here} disabled={busy}>
        <Icon name="pin" size={16} /> {busy ? 'Finding…' : S.setup.useHere}
      </Btn>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Latitude">
          <input className="mk-input" inputMode="decimal" value={num(p.lat)} onChange={(e) => onChange({ ...p, lat: Number(e.target.value) })} />
        </Field>
        <Field label="Longitude">
          <input className="mk-input" inputMode="decimal" value={num(p.lng)} onChange={(e) => onChange({ ...p, lng: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Time zone">
        <TzSelect value={p.tz} onChange={(tz) => onChange({ ...p, tz })} />
      </Field>
      <Field label="Name (only you see it)">
        <input className="mk-input" value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} />
      </Field>
      <p className="mk-faint text-[12px]">{S.setup.locationHint}</p>
    </div>
  )
}

export function TzSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
    } catch {
      return [value]
    }
  }, [value])
  return (
    <select className="mk-input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!zones.includes(value) && <option value={value}>{value}</option>}
      {zones.map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      ))}
    </select>
  )
}


// --- one setting ------------------------------------------------------------------------

function SettingRow({ ui, s, onChange, required }: { ui: SettingUi; s: Stored; onChange: (s: Stored) => void; required?: boolean }) {
  const value = s[ui.key]
  const confirmed = s.confirmed[ui.key]
  return (
    <div className={`mk-card px-4 py-3 ${required && value === null ? 'mk-tone-ask mk-toned' : ''}`}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold">{ui.label}</p>
          {required && value === null && <p className="mk-tone-ask mk-tone-text text-[12px] font-semibold">{S.setup.v2}</p>}
        </div>
        <Why ruleId={ui.ruleId} />
      </div>
      {ui.numeric ? (
        <input
          className="mk-input"
          inputMode="decimal"
          value={String(value ?? '')}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange({ ...s, [ui.key]: n })
          }}
        />
      ) : (
        <Choice value={value === null ? null : String(value)} options={ui.options} onChange={(v) => onChange({ ...s, [ui.key]: parse(ui.key, v) })} />
      )}
      <label className="mk-dim mt-2 flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={!!confirmed}
          onChange={(e) => {
            const next = { ...s.confirmed }
            if (e.target.checked) next[ui.key] = new Date().toISOString().slice(0, 10)
            else delete next[ui.key]
            onChange({ ...s, confirmed: next })
          }}
        />
        {S.setup.confirmed}
        {confirmed ? `, ${civilLabel(confirmed)}` : ''}
      </label>
    </div>
  )
}

// --- settings --------------------------------------------------------------------------

export function SettingsSheet({ onDone }: { onDone: () => void }) {
  const { stored, history } = useHer()
  const [s, setS] = useState<Stored>(stored)
  const dirty = JSON.stringify(s) !== JSON.stringify(stored)

  return (
    <div className="flex flex-col gap-2">
      <Section title={S.setup.location}>
        <LocationFields value={s.home} onChange={(home) => setS({ ...s, home })} />
      </Section>

      <Section title="The rules" right={<span className="mk-faint text-[11.5px]">Chabad defaults</span>}>
        {SETTINGS_UI.map((ui) => (
          <SettingRow key={ui.key} ui={ui} s={s} onChange={setS} required={ui.key === 'chodeshInPeriod'} />
        ))}
      </Section>

      <Section title="Notifications">
        <div className="mk-card px-4 py-1">
          <Toggle
            on={s.detailInNotifications}
            onChange={(v) => setS({ ...s, detailInNotifications: v })}
            label="Say what each reminder is about"
            hint="Off: every notification just says “Calendar reminder”, on both phones. The detail is always inside the app."
          />
          {REMINDER_KINDS.map((k) => (
            <Toggle key={k} on={s.remind[k]} onChange={(v) => setS({ ...s, remind: { ...s.remind, [k]: v } })} label={REMINDER_LABEL[k]} />
          ))}
        </div>
      </Section>

      <Section title="The tile">
        <Field label="Name on the home screen">
          <input className="mk-input" value={s.tile.name} onChange={(e) => setS({ ...s, tile: { ...s.tile, name: e.target.value } })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {TILE_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              aria-label={i}
              onClick={() => setS({ ...s, tile: { ...s.tile, icon: i } })}
              className="mk-card grid h-11 w-11 place-items-center"
              style={s.tile.icon === i ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : undefined}
            >
              <Icon name={i} size={18} />
            </button>
          ))}
        </div>
      </Section>

      <NanoSwitch />

      <Section title="Other">
        <div className="mk-card px-4 py-1">
          <Toggle
            on={s.showOvulation}
            onChange={(v) => setS({ ...s, showOvulation: v })}
            label="Estimated ovulation"
            hint="A rough calendar estimate. Not medical or halachic guidance."
          />
        </div>
      </Section>

      <div className="sticky bottom-0 mt-4 flex gap-2 pb-2 pt-2" style={{ background: 'var(--bg-elevated)' }}>
        <Btn
          kind="primary"
          className="flex-1"
          disabled={!dirty || !validPlace(s.home) || s.chodeshInPeriod === null}
          onClick={async () => {
            if (await saveSettings(s)) {
              toast.success('Saved — the calendar is recalculated')
              onDone()
            }
          }}
        >
          {S.save}
        </Btn>
        <Btn onClick={() => setS(stored)} disabled={!dirty}>
          Undo
        </Btn>
      </div>
      <p className="mk-faint px-1 text-[12px]">
        Each save is kept as a new version, so a past date can be explained under the settings then. {history.length} version{history.length === 1 ? '' : 's'} so far.
      </p>
    </div>
  )
}

// --- Nano ------------------------------------------------------------------------------------

/**
 * Her switch for Nano reading this calendar. Off until she turns it on, and
 * enforced by the database next to the sharing switch, so turning it off
 * cuts Nano off at once. Saved straight away, not as a settings version: it
 * says who may look, not how the calendar is worked out.
 */
function NanoSwitch() {
  const c = useCalendar()
  const nano = useData((st) => st.nano)
  const row = useData((st) => st.mk_nano.find((r) => r.id === c.me))
  if (!nano || !c.me) return null
  const me = c.me
  const on = row?.can_read === true

  async function set(next: boolean) {
    const adapter = useData.getState().adapter
    const nextRow: MkNano = { id: me, can_read: next, updated_at: new Date().toISOString() }
    useData.getState().applyChange({ table: 'mk_nano', type: row ? 'update' : 'insert', row: nextRow })
    try {
      if (row) await adapter.update('mk_nano', me, { can_read: next })
      else await adapter.insert('mk_nano', nextRow)
    } catch {
      if (row) useData.getState().applyChange({ table: 'mk_nano', type: 'update', row })
      else useData.getState().applyChange({ table: 'mk_nano', type: 'delete', id: me })
      toast.error("Couldn't save that")
    }
  }

  return (
    <Section title="Nano">
      <div className="mk-card px-4 py-1">
        <Toggle
          on={on}
          onChange={(v) => void set(v)}
          label="Let Nano read this calendar"
          hint="She talks about it only with you and your partner, privately on WhatsApp, and never writes here on her own. Nothing from it goes in her logs. Turn it off and she can't see it any more."
        />
      </div>
    </Section>
  )
}

// --- partner and sharing -------------------------------------------------------------------

/** Members who can be named: granted the app explicitly, and not her. */
function usePartnerChoices(me: string | null) {
  const access = useData((s) => s.app_access)
  const profiles = useData((s) => s.profiles)
  return useMemo(() => {
    const granted = new Set(access.filter((a) => a.app_id === 'mikvah' && a.granted).map((a) => a.profile_id))
    return profiles.filter((p) => p.id !== me && granted.has(p.id))
  }, [access, profiles, me])
}

export function PartnerSheet() {
  const { me, shared } = useHer()
  const choices = usePartnerChoices(me)
  return (
    <div className="flex flex-col gap-4">
      <Section title={S.setup.partner}>
        <p className="mk-dim px-1 text-[13px]">{S.setup.partnerHint}</p>
        <Choice
          value={shared.partner_id ?? 'none'}
          options={[{ value: 'none', label: S.setup.nobody }, ...choices.map((p) => ({ value: p.id, label: p.display_name }))]}
          onChange={(v) => void setPartner(v === 'none' ? null : v)}
        />
        {choices.length === 0 && <p className="mk-faint px-1 text-[12px]">Nobody else has the app yet. Turn it on for him in Settings → People.</p>}
      </Section>
      <Section title="Sharing">
        <div className="mk-card px-4 py-1">
          <Toggle
            on={shared.share_details}
            onChange={(v) => void setShareDetails(v)}
            label="Let him read the details"
            hint="Your checks, stains, notes and questions to a rav. Off by default; he can never change them."
          />
        </div>
      </Section>
    </div>
  )
}

// --- first run ---------------------------------------------------------------------------------

export function Setup() {
  const c = useCalendar()
  const me = c.me
  const her = c.role === 'her' ? c : null
  const choices = usePartnerChoices(me)
  const [s, setS] = useState<Stored>(her?.stored ?? DEFAULT_STORED)
  const [partner, setP] = useState<string>(her?.shared.partner_id ?? 'none')
  const [lastFlow, setLastFlow] = useState('')
  const [lastHefsek, setLastHefsek] = useState('')
  const [lastImmersion, setLastImmersion] = useState('')
  const [numbers, setNumbers] = useState('')
  const [busy, setBusy] = useState(false)
  const order = SETUP_ORDER.map((o) => SETTINGS_UI.find((u) => u.key === o.key)!).filter(Boolean)
  const ready = validPlace(s.home) && s.chodeshInPeriod !== null

  async function start() {
    if (!ready || !validPlace(s.home)) return
    setBusy(true)
    const tz = s.home.tz
    const ok = (await startCalendar(partner === 'none' ? null : partner)) && (await saveSettings(s))
    if (ok) {
      if (lastFlow) await logEvent('flow', fromLocalInput(lastFlow, tz), { data: { note: 'Starting history' } })
      if (lastHefsek) {
        const t = fromLocalInput(lastHefsek, tz)
        await logEvent('hefsek', t, { result: 'clean', data: { note: 'Starting history' } })
        await logEvent('moch', t + 90 * 60_000, { result: 'clean', data: { note: 'Starting history' } })
      }
      if (lastImmersion) await logEvent('immersion', fromLocalInput(lastImmersion, tz), { data: { note: 'Starting history' } })
      const list = numbers.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      if (list.length) await logEvent('seed', Date.now(), { data: { haflagah: list } })
    }
    setBusy(false)
  }

  if (!me) return null
  return (
    <div className="flex flex-col gap-2 pb-10">
      <h2 className="text-[22px] font-bold">{S.setup.title}</h2>
      <p className="mk-dim text-[14px] leading-snug">{S.setup.intro}</p>

      <Section title={S.setup.location}>
        <LocationFields value={s.home} onChange={(home) => setS({ ...s, home })} />
      </Section>

      <Section title={S.setup.partner}>
        <p className="mk-dim px-1 text-[13px]">{S.setup.partnerHint}</p>
        <Choice value={partner} options={[{ value: 'none', label: S.setup.nobody }, ...choices.map((p) => ({ value: p.id, label: p.display_name }))]} onChange={setP} />
      </Section>

      <Section title="The rules">
        {order.map((ui) => (
          <SettingRow key={ui.key} ui={ui} s={s} onChange={setS} required={ui.key === 'chodeshInPeriod'} />
        ))}
        <p className="mk-faint px-1 text-[12px]">Everything else keeps the Chabad default and can be changed later in Settings.</p>
      </Section>

      <Section title={S.setup.history}>
        <p className="mk-dim px-1 text-[13px]">{S.setup.historyHint}</p>
        <Field label="Last period started">
          <input type="datetime-local" className="mk-input" value={lastFlow} onChange={(e) => setLastFlow(e.target.value)} />
        </Field>
        <Field label="Last hefsek taharah (clean)">
          <input type="datetime-local" className="mk-input" value={lastHefsek} onChange={(e) => setLastHefsek(e.target.value)} />
        </Field>
        <Field label="Last immersion">
          <input type="datetime-local" className="mk-input" value={lastImmersion} onChange={(e) => setLastImmersion(e.target.value)} />
        </Field>
        <Field label="Haflagah numbers still active" hint="Counted in onot, as My Mikvah Calendar counts them. Separate with commas.">
          <input className="mk-input" inputMode="numeric" value={numbers} onChange={(e) => setNumbers(e.target.value)} />
        </Field>
        <p className="mk-faint px-1 text-[12px]">In the middle of the seven days? Log the bedikot you've done in the checklist afterwards.</p>
      </Section>

      <Card>
        <Btn kind="primary" className="w-full" disabled={!ready || busy} onClick={() => void start()}>
          {busy ? 'Starting…' : S.setup.start}
        </Btn>
        {!ready && <p className="mk-faint mt-2 text-[12px]">Needs your location and an answer for {describe('chodeshInPeriod', s) === 'Not chosen yet' ? 'the veset hachodesh question' : 'everything above'}.</p>}
      </Card>
    </div>
  )
}

// --- export ------------------------------------------------------------------------------------------

export function ExportSheet() {
  const c = useHer()
  const data = useData.getState()
  function payload() {
    const own = <T extends { owner_id: string }>(rows: T[]) => rows.filter((r) => r.owner_id === c.me)
    return {
      exported_at: new Date().toISOString(),
      events: own(data.mk_events),
      settings: own(data.mk_settings),
      trips: own(data.mk_trips),
      memos: own(data.mk_memos),
      contacts: own(data.mk_contacts),
      source_notes: own(data.mk_source_notes),
    }
  }
  async function save() {
    const text = JSON.stringify(payload(), null, 2)
    const name = `calendar-export-${new Date().toISOString().slice(0, 10)}.json`
    const file = new File([text], name, { type: 'application/json' })
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return
      } catch {
        /* fall through to a download */
      }
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-snug">Everything you've entered, as one file: every event (voided ones too), every settings version, trips, memos, contacts and source corrections.</p>
      <Btn kind="primary" onClick={() => void save()}>
        Export
      </Btn>
      <Card tone="ask">
        <p className="text-[13.5px] leading-snug">
          Nothing here is ever deleted from the app — a mistake is voided instead. Deleting your records for good can't be undone, so export first, then ask an owner of the household to do it.
        </p>
      </Card>
    </div>
  )
}
