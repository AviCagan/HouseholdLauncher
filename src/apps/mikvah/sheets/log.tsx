import { useMemo, useState } from 'react'
import { Icon } from '@/components/primitives/Icon'
import type { MkEventRow } from '@/data/types'
import { logEvent, saveSettings, voidEvent } from '../actions'
import { civilOf, cycleAt, hebrewLabel, place, type Cycle, type Slot } from '../engine'
import { countdown, dateBoth, fromLocalInput, hebrew, nightBoth, time, toLocalInput, tzAt, when } from '../format'
import { DEFAULT_PREP, type PrepSection } from '../model'
import { openSheet } from '../store'
import { S } from '../strings'
import { AskBadge, Btn, Card, Choice, Field, Section, Why } from '../ui'
import { useHer } from '../useMikvah'

type Result = NonNullable<MkEventRow['result']>
const RESULTS: { value: Result; label: string }[] = [
  { value: 'clean', label: S.result.clean },
  { value: 'not_clean', label: S.result.not_clean },
  { value: 'question', label: S.result.question },
]

/** A time she can set, defaulting to now, in the zone she was in. */
function useWhen(initial?: number) {
  const { zmanim: z, now } = useHer()
  const tz = tzAt(initial ?? now, z)
  const [value, setValue] = useState(() => toLocalInput(initial ?? now, tz))
  const t = fromLocalInput(value, tz)
  return { t, tz, input: <input type="datetime-local" className="mk-input" value={value} onChange={(e) => setValue(e.target.value)} />, setNow: () => setValue(toLocalInput(Date.now(), tz)) }
}

// --- period started -----------------------------------------------------------------

export function FlowSheet({ onDone }: { onDone: () => void }) {
  const { zmanim: z, stored: s } = useHer()
  const w = useWhen()
  const [confirmed, setConfirmed] = useState(false)
  if (!z) return null
  const at = place(w.t, z, s)
  const near = at.nearShkiah && !confirmed
  const where = z.placeAt(w.t)

  async function save(t: number) {
    if (place(t, z!, s).nearShkiah && !confirmed) return
    if (await logEvent('flow', t)) onDone()
  }

  // One tap for now — unless now is close to shkiah, when the time is put in
  // the box to be confirmed first.
  function tapNow() {
    const t = Date.now()
    if (place(t, z!, s).nearShkiah) w.setNow()
    else void save(t)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="mk-dim text-[13.5px]">When you first saw it, and where you were.</p>
      <Btn kind="toned" tone="waiting" className="min-h-[56px] text-[16px]" onClick={tapNow}>
        <Icon name="clock" size={18} /> {S.now}
      </Btn>
      <Field label="Or the time">{w.input}</Field>
      <Card>
        <p className="text-[14px]">
          <b>{hebrewLabel(at.onah.abs)}</b>, {at.onah.half} onah
        </p>
        <p className="mk-dim mt-0.5 text-[12.5px]">
          {S.flow.where}: {where.name || S.flow.home} ·{' '}
          <button className="underline" onClick={() => openSheet({ kind: 'trips' })}>
            somewhere else?
          </button>
        </p>
        {at.bin && <p className="mk-tone-ask mk-tone-text mt-1 text-[12.5px] font-semibold">Between shkiah and tzeit — this raises a question for your rav.</p>}
      </Card>
      {at.nearShkiah && (
        <Card tone="ask">
          <p className="text-[13.5px]">{S.flow.nearShkiah}</p>
          <p className="mk-dim mt-1 text-[12.5px]">Shkiah: {time(z.times(at.day).shkiah ?? NaN, where.tz)}</p>
          <label className="mt-2 flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {S.flow.confirm}
          </label>
        </Card>
      )}
      <div className="flex items-center gap-2">
        <Btn kind="primary" className="flex-1" disabled={near} onClick={() => void save(w.t)}>
          {S.save}
        </Btn>
        <Why ruleId="F1" />
      </div>
    </div>
  )
}

// --- hefsek and moch ------------------------------------------------------------------

export function HefsekSheet({ onDone }: { onDone: () => void }) {
  const { result, zmanim: z, events, now } = useHer()
  const w = useWhen()
  const m = useWhen()
  const [res, setRes] = useState<Result | null>(null)
  const [mochRes, setMochRes] = useState<Result | null>(null)
  if (!result || !z) return null
  const cyc = cycleAt(result, now) ?? [...result.cycles].reverse().find((c) => c.immersion === null) ?? null
  if (!cyc) return <p className="mk-dim text-[14px]">No period logged yet.</p>
  const since = (e: MkEventRow) => Date.parse(e.at) >= cyc.startAt && e.voided_at === null
  const attempts = events.filter((e) => e.kind === 'hefsek' && since(e))
  const mochs = events.filter((e) => e.kind === 'moch' && since(e))
  const tz = tzAt(now, z)

  return (
    <div className="flex flex-col gap-4">
      {cyc.earliestHefsek !== null ? (
        <Card tone="waiting">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="mk-label">{S.hefsek.earliest}</p>
              <p className="text-[16px] font-semibold">{dateBoth(cyc.earliestHefsek)}</p>
              {cyc.hefsekDeadline !== null && (
                <p className="mk-dim text-[13px]">
                  {S.hefsek.deadline} {time(cyc.hefsekDeadline, tz)} (shkiah, less the margin) · {countdown(cyc.hefsekDeadline - now)}
                </p>
              )}
            </div>
            <Why ruleId="D1" />
          </div>
        </Card>
      ) : (
        <Card tone="ask">
          <AskBadge />
          <p className="mt-1 text-[14px]">The earliest hefsek waits for the date your rav gives.</p>
        </Card>
      )}

      {cyc.hefsek && (
        <Card tone="counting">
          <p className="text-[14.5px]">
            Hefsek on <b>{hebrew(cyc.hefsek.abs)}</b> counts. The seven days start the night after.
          </p>
        </Card>
      )}

      {attempts.length > 0 && (
        <Section title="Attempts" right={<Why ruleId="H1" />}>
          {attempts.map((e) => (
            <EventLine key={e.id} e={e} />
          ))}
        </Section>
      )}

      <Section title={S.hefsek.attempt} right={<Why ruleId="H2" />}>
        <Field label={S.bedikot.when}>{w.input}</Field>
        <Choice value={res} options={RESULTS} onChange={setRes} tone="waiting" />
        <Btn
          kind="primary"
          disabled={!res}
          onClick={async () => {
            if (res && (await logEvent('hefsek', w.t, { result: res }))) setRes(null)
          }}
        >
          {S.save}
        </Btn>
      </Section>

      {cyc.hefsek && (
        <Section title={S.hefsek.moch} right={<Why ruleId="H3" />}>
          <p className="mk-dim px-1 text-[12.5px]">{S.hefsek.mochHint} Tzeit tonight: {time(z.times(civilOf(cyc.hefsek.abs)).tzeit ?? NaN, tz)}</p>
          {mochs.map((e) => (
            <EventLine key={e.id} e={e} />
          ))}
          {!cyc.mochConfirmed && (
            <>
              <Field label={S.bedikot.when}>{m.input}</Field>
              <Choice value={mochRes} options={RESULTS} onChange={setMochRes} tone="waiting" />
              <div className="grid grid-cols-3 gap-2">
                <Btn kind="primary" disabled={!mochRes} onClick={async () => mochRes && (await logEvent('moch', m.t, { result: mochRes })) && onDone()}>
                  {S.save}
                </Btn>
                <Btn onClick={() => void logEvent('moch', m.t, { data: { forgotten: true } })}>{S.hefsek.forgot}</Btn>
                <Btn onClick={() => void logEvent('moch', m.t, { data: { painful: true } })}>{S.hefsek.painful}</Btn>
              </div>
            </>
          )}
        </Section>
      )}
    </div>
  )
}

/** One logged event, with its time, result and a way to void it. */
export function EventLine({ e }: { e: MkEventRow }) {
  const { zmanim: z } = useHer()
  const d = e.data as { forgotten?: boolean; painful?: boolean; slot?: string; note?: string }
  return (
    <div className="mk-card flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">
          {when(Date.parse(e.at), z)}
          {e.result && <span className={`mk-tone-${e.result === 'clean' ? 'tehorah' : 'ask'} mk-tone-text`}> · {S.result[e.result]}</span>}
          {d.forgotten && ' · forgotten'}
          {d.painful && ' · too painful'}
        </p>
        {d.note && <p className="mk-faint text-[12px]">{d.note}</p>}
      </div>
      <button className="mk-why" onClick={() => void voidEvent(e.id)} aria-label={S.void}>
        <Icon name="trash" size={13} />
      </button>
    </div>
  )
}

// --- the seven days: 14 slots ------------------------------------------------------------

export function BedikotSheet({ cycleId }: { cycleId: string }) {
  const { result, zmanim: z, now, events } = useHer()
  const [editing, setEditing] = useState<Slot | null>(null)
  if (!result || !z) return null
  const cyc = result.cycles.find((c) => c.id === cycleId)
  if (!cyc || !cyc.hefsek) return <p className="mk-dim">No hefsek yet.</p>
  const days = [1, 2, 3, 4, 5, 6, 7]
  const tz = tzAt(now, z)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="mk-dim flex-1 text-[13px]">Two each day: one in the morning, one before shkiah. Day 1 and day 7 matter most.</p>
        <Why ruleId="N1" />
      </div>
      {days.map((n) => {
        const slots = cyc.slots.filter((x) => x.day === n)
        return (
          <div key={n} className="mk-card p-3">
            <p className="mb-2 text-[13px] font-semibold">
              Day {n} <span className="mk-dim font-normal">· {dateBoth(cyc.hefsek!.abs + n)}</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {slots.map((x) => (
                <SlotButton key={x.part} slot={x} now={now} tz={tz} onClick={() => setEditing(x)} />
              ))}
            </div>
          </div>
        )
      })}
      {editing && <SlotEditor slot={editing} onClose={() => setEditing(null)} events={events} />}
    </div>
  )
}

function SlotButton({ slot, now, tz, onClick }: { slot: Slot; now: number; tz: string; onClick: () => void }) {
  const tone = slot.result === 'clean' ? 'tehorah' : slot.result ? 'ask' : now > slot.closes ? 'none' : now >= slot.opens ? 'counting' : 'none'
  return (
    <button type="button" onClick={onClick} className={`mk-card mk-tone-${tone} ${slot.result || (now >= slot.opens && now <= slot.closes) ? 'mk-toned' : ''} flex min-h-[56px] flex-col items-start justify-center rounded-xl px-3 text-left`}>
      <span className="text-[13px] font-semibold">
        {slot.part === 'morning' ? S.bedikot.morning : S.bedikot.afternoon}
        {slot.result && <span className="mk-tone-text"> · {S.result[slot.result]}</span>}
        {slot.result === 'clean' && ' ✓'}
      </span>
      <span className="mk-faint text-[11.5px]">
        {slot.result ? '' : now > slot.closes ? 'missed' : `${time(slot.opens, tz)}–${time(slot.closes, tz)}`}
      </span>
    </button>
  )
}

function SlotEditor({ slot, onClose, events }: { slot: Slot; onClose: () => void; events: MkEventRow[] }) {
  const { now } = useHer()
  const inWindow = now >= slot.opens && now <= slot.closes
  const w = useWhen(inWindow ? now : Math.min(slot.closes - 5 * 60_000, Math.max(slot.opens, now)))
  const [res, setRes] = useState<Result | null>(null)
  const logged = slot.eventId ? events.find((e) => e.id === slot.eventId) : undefined
  return (
    <Card tone="counting">
      <p className="text-[14.5px] font-semibold">
        Day {slot.day}, {slot.part}
      </p>
      {logged && (
        <div className="mt-2">
          <EventLine e={logged} />
        </div>
      )}
      <div className="mt-3 flex flex-col gap-3">
        <Field label={S.bedikot.when}>{w.input}</Field>
        <Choice value={res} options={RESULTS} onChange={setRes} tone="counting" />
        <div className="flex gap-2">
          <Btn
            kind="primary"
            className="flex-1"
            disabled={!res}
            onClick={async () => {
              if (res && (await logEvent('bedikah', w.t, { result: res, data: { slot: slot.part } }))) onClose()
            }}
          >
            {S.save}
          </Btn>
          <Btn onClick={onClose}>{S.cancel}</Btn>
        </div>
      </div>
    </Card>
  )
}

// --- mikvah night -----------------------------------------------------------------------------

const PREP_KEY = (cycleId: string) => `mk:prep:${cycleId}`

function readTicks(cycleId: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PREP_KEY(cycleId)) ?? '{}')
  } catch {
    return {}
  }
}

export function MikvahSheet({ cycleId, onDone }: { cycleId: string; onDone: () => void }) {
  const c = useHer()
  const { result, zmanim: z, stored, now } = c
  const [ticks, setTicks] = useState(() => readTicks(cycleId))
  const [editing, setEditing] = useState(false)
  const w = useWhen()
  const cyc: Cycle | undefined = result?.cycles.find((x) => x.id === cycleId)
  const prep = stored.prep ?? DEFAULT_PREP
  const flags = useMemo(() => (result ? result.flags.filter((f) => cyc?.mikvah?.waitingOn.includes(f.key) || f.key === cyc?.mikvah?.withheld) : []), [result, cyc])
  if (!result || !z || !cyc?.mikvah) return <p className="mk-dim">Mikvah night isn't set yet.</p>
  const mk = cyc.mikvah
  const tz = tzAt(mk.at, z)

  function tick(key: string) {
    const next = { ...ticks, [key]: !ticks[key] }
    setTicks(next)
    try {
      localStorage.setItem(PREP_KEY(cycleId), JSON.stringify(next))
    } catch {
      /* a convenience only */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {mk.withheld ? (
        <Card tone="ask">
          <AskBadge />
          <p className="mt-1 text-[14px]">Mikvah night isn't shown until your rav answers.</p>
        </Card>
      ) : (
        <Card tone="mikvah">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[18px] font-bold">Night of {nightBoth(mk.abs)}</p>
              <p className="mk-dim text-[14px]">
                {S.mikvah.after} <b>{time(mk.at, tz)}</b> · {countdown(mk.at - now)}
              </p>
            </div>
            <Why ruleId="M1" />
          </div>
          {mk.moved.map((m, i) => (
            <div key={i} className="mt-2 flex items-center gap-2 border-t pt-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>
              <span className="flex-1">
                {S.mikvah.moved} from {hebrew(m.from)}: {m.reason}
              </span>
              <Why ruleId={m.ruleId} />
            </div>
          ))}
          {mk.candleLighting !== null && (
            <div className="mt-2 flex items-center gap-2 border-t pt-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>
              <span className="flex-1">
                Finish preparing before candle lighting, <b>{time(mk.candleLighting, tz)}</b>.
              </span>
              <Why ruleId="M4" />
            </div>
          )}
        </Card>
      )}

      {flags.map((f) => (
        <Card key={f.key} tone="ask" onClick={() => openSheet({ kind: 'flag', key: f.key })}>
          <AskBadge />
          <p className="mt-1 text-[14.5px] font-semibold">{f.title}</p>
          <p className="mk-dim text-[13px]">{f.holds}</p>
        </Card>
      ))}

      <Section title={S.mikvah.prep} right={<Why ruleId="M8" />}>
        {editing ? (
          <PrepEditor
            prep={prep}
            onSave={async (next) => {
              if (await saveSettings({ ...stored, prep: next })) setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            {prep.map((sec) => (
              <div key={sec.title} className="mk-card p-3">
                <p className="mk-label mb-1">{sec.title}</p>
                {sec.items.map((item) => {
                  const key = `${sec.title}|${item}`
                  return (
                    <label key={key} className="flex min-h-[36px] items-center gap-3 text-[14px]">
                      <input type="checkbox" checked={!!ticks[key]} onChange={() => tick(key)} className="h-5 w-5" />
                      <span className={ticks[key] ? 'mk-faint line-through' : ''}>{item}</span>
                    </label>
                  )
                })}
              </div>
            ))}
            <p className="mk-faint px-1 text-[12px]">{S.mikvah.prepNote}</p>
            <Btn onClick={() => setEditing(true)}>{S.mikvah.editPrep}</Btn>
          </>
        )}
      </Section>

      <Section title={S.mikvah.immersed}>
        <Field label={S.bedikot.when}>{w.input}</Field>
        <Btn kind="toned" tone="mikvah" onClick={async () => (await logEvent('immersion', w.t)) && onDone()}>
          {S.mikvah.immersed}
        </Btn>
      </Section>
    </div>
  )
}

function PrepEditor({ prep, onSave, onCancel }: { prep: PrepSection[]; onSave: (p: PrepSection[]) => void; onCancel: () => void }) {
  const [text, setText] = useState(() => prep.map((s) => `# ${s.title}\n${s.items.join('\n')}`).join('\n\n'))
  const parse = (): PrepSection[] => {
    const out: PrepSection[] = []
    for (const line of text.split('\n').map((l) => l.trim())) {
      if (!line) continue
      if (line.startsWith('#')) out.push({ title: line.replace(/^#+\s*/, ''), items: [] })
      else {
        if (out.length === 0) out.push({ title: S.mikvah.prep, items: [] })
        out[out.length - 1].items.push(line)
      }
    }
    return out
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="mk-faint text-[12px]">One item per line. A line starting with # begins a section.</p>
      <textarea className="mk-input" style={{ minHeight: 320 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <Btn kind="primary" className="flex-1" onClick={() => onSave(parse())}>
          {S.save}
        </Btn>
        <Btn onClick={() => onSave(DEFAULT_PREP)}>Reset</Btn>
        <Btn onClick={onCancel}>{S.cancel}</Btn>
      </div>
    </div>
  )
}

// --- anything else -----------------------------------------------------------------------------

const KINDS: { kind: MkEventRow['kind']; label: string; result?: boolean; hint?: string }[] = [
  { kind: 'stain', label: 'Stain (ketem)', hint: 'Every stain is a question for your rav.' },
  { kind: 'bedikah', label: 'Bedikah', result: true },
  { kind: 'flow', label: 'Period started' },
  { kind: 'hefsek', label: 'Hefsek taharah', result: true },
  { kind: 'moch', label: 'Moch dachuk', result: true },
  { kind: 'immersion', label: 'Immersion' },
  { kind: 'pregnancy', label: 'Pregnancy (from the immersion it followed)' },
  { kind: 'birth', label: 'Birth' },
  { kind: 'miscarriage', label: 'Miscarriage' },
  { kind: 'nursing', label: 'Nursing' },
  { kind: 'kallah', label: 'Before the wedding (kallah)' },
  { kind: 'medication', label: 'Hormonal treatment or contraception' },
  { kind: 'symptom', label: 'A body sign before the period (veset haguf)' },
  { kind: 'menopause', label: 'Menopause (as your rav said)' },
]

export function EventSheet({ preset, onDone }: { preset?: string; onDone: () => void }) {
  const [kind, setKind] = useState<MkEventRow['kind'] | null>((preset as MkEventRow['kind']) ?? null)
  const [res, setRes] = useState<Result | null>(null)
  const [note, setNote] = useState('')
  const [over40, setOver40] = useState(false)
  const [ended, setEnded] = useState(false)
  const w = useWhen()
  const def = KINDS.find((k) => k.kind === kind)

  if (!def) {
    return (
      <div className="flex flex-col gap-2">
        {KINDS.map((k) => (
          <button key={k.kind} className="mk-card px-4 py-3 text-left text-[14.5px] font-medium" onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
        <button className="mk-card px-4 py-3 text-left text-[14.5px] font-medium" onClick={() => openSheet({ kind: 'kavua' })}>
          A kavua your rav set
        </button>
        <button className="mk-card px-4 py-3 text-left text-[14.5px] font-medium" onClick={() => openSheet({ kind: 'events' })}>
          Everything logged…
        </button>
      </div>
    )
  }

  async function save() {
    const data: Record<string, unknown> = {}
    if (note.trim()) data.note = note.trim()
    if (kind === 'miscarriage') data.over40 = over40
    if (kind === 'nursing' && ended) data.ended = true
    const result = kind === 'stain' ? 'question' : def!.result ? res : null
    if (await logEvent(kind!, w.t, { result, data })) onDone()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[16px] font-semibold">{def.label}</p>
      {def.hint && <p className="mk-dim text-[13px]">{def.hint}</p>}
      <Field label={S.bedikot.when}>{w.input}</Field>
      {def.result && <Choice value={res} options={RESULTS} onChange={setRes} />}
      {kind === 'miscarriage' && (
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={over40} onChange={(e) => setOver40(e.target.checked)} /> At 40 days or more
        </label>
      )}
      {kind === 'nursing' && (
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={ended} onChange={(e) => setEnded(e.target.checked)} /> Stopped nursing
        </label>
      )}
      <Field label="Note (only you see this)">
        <textarea className="mk-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Btn kind="primary" disabled={!!def.result && !res} onClick={() => void save()}>
        {S.save}
      </Btn>
    </div>
  )
}
