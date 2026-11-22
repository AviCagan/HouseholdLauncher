import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/primitives/Icon'
import type { MkEventRow } from '@/data/types'
import { addContact, addMemo, addTrip, editContact, logEvent, voidContact, voidEvent, voidTrip } from '../actions'
import { absOfCivil, crossesDateLine, hebrewLabel, place, vesetName, type KavuaRuling } from '../engine'
import { civilLabel, dateBoth, nightBoth, time, today, tzAt, when } from '../format'
import { cycleRows, stats } from '../history'
import { openSheet } from '../store'
import { S } from '../strings'
import { AskBadge, Btn, Card, Choice, Field, Section, Why } from '../ui'
import { useHer } from '../useMikvah'
import { TzSelect } from './settings'
import { validPlace } from '../model'

// --- trips ----------------------------------------------------------------------------

export function TripsSheet() {
  const { trips, stored, zmanim: z, now } = useHer()
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [tz, setTz] = useState(stored.home?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [from, setFrom] = useState(today(now, z))
  const [to, setTo] = useState(today(now, z))
  const place = { name, lat: Number(lat), lng: Number(lng), tz }
  const ok = validPlace(place) && lat !== '' && lng !== '' && from <= to
  const crosses = ok && stored.home && crossesDateLine(stored.home.lng, place.lng)

  function here() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setLat(String(Math.round(pos.coords.latitude * 1000) / 1000))
        setLng(String(Math.round(pos.coords.longitude * 1000) / 1000))
        setTz(Intl.DateTimeFormat().resolvedOptions().timeZone)
      },
      () => toast.error('Couldn’t get the location — enter it by hand.'),
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <p className="mk-dim flex-1 text-[13px]">While you're away, the zmanim — and so the onot and every deadline — follow where you are.</p>
        <Why ruleId="T1" />
      </div>
      {trips.map((t) => (
        <div key={t.id} className="mk-card flex items-center gap-3 px-4 py-3">
          <Icon name="globe" size={16} />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold">{t.name || 'A trip'}</p>
            <p className="mk-dim text-[12.5px]">
              {civilLabel(t.from_day)} – {civilLabel(t.to_day)} · {t.tz}
            </p>
          </div>
          <button className="mk-why" onClick={() => void voidTrip(t.id)} aria-label="Remove trip">
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
      <Section title="Add a trip">
        <Field label="Name (only you see it)">
          <input className="mk-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Btn onClick={here}>
          <Icon name="pin" size={15} /> Use this phone’s location
        </Btn>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude">
            <input className="mk-input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </Field>
          <Field label="Longitude">
            <input className="mk-input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
          </Field>
        </div>
        <Field label="Time zone">
          <TzSelect value={tz} onChange={setTz} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <input type="date" className="mk-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className="mk-input" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {crosses && (
          <Card tone="ask">
            <AskBadge />
            <p className="mt-1 text-[13.5px]">This trip crosses the date line. Mikvah night near it will wait for your rav's answer.</p>
          </Card>
        )}
        <Btn
          kind="primary"
          disabled={!ok}
          onClick={async () => {
            if (await addTrip({ name: name.trim(), lat: Number(lat), lng: Number(lng), tz, from_day: from, to_day: to })) {
              setName('')
              setLat('')
              setLng('')
            }
          }}
        >
          {S.save}
        </Btn>
      </Section>
    </div>
  )
}

// --- memos ----------------------------------------------------------------------------------

export function MemosSheet() {
  const { memos, zmanim: z, now } = useHer()
  const [day, setDay] = useState(today(now, z))
  const [body, setBody] = useState('')
  return (
    <div className="flex flex-col gap-2">
      <Field label="Day">
        <input type="date" className="mk-input" value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      <textarea className="mk-input" placeholder="A note (only you see it)" value={body} onChange={(e) => setBody(e.target.value)} />
      <Btn
        kind="primary"
        disabled={!body.trim() || !day}
        onClick={async () => {
          if (await addMemo(day, body.trim())) setBody('')
        }}
      >
        Add memo
      </Btn>
      <Section title="All memos">
        {memos.length === 0 && <p className="mk-dim px-1 text-[13px]">None yet.</p>}
        {[...memos].reverse().map((m) => (
          <button key={m.id} className="mk-card px-4 py-3 text-left" onClick={() => openSheet({ kind: 'day', abs: absOfCivil(m.day) })}>
            <p className="mk-label">
              {civilLabel(m.day)} · {hebrewLabel(absOfCivil(m.day), false)}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[14px]">{m.body}</p>
          </button>
        ))}
      </Section>
    </div>
  )
}

// --- everything logged --------------------------------------------------------------------------

const KIND_LABEL: Record<MkEventRow['kind'], string> = {
  flow: 'Period started',
  hefsek: 'Hefsek taharah',
  moch: 'Moch dachuk',
  bedikah: 'Bedikah',
  stain: 'Stain',
  immersion: 'Immersion',
  pregnancy: 'Pregnancy',
  birth: 'Birth',
  miscarriage: 'Miscarriage',
  kallah: 'Kallah',
  medication: 'Hormonal treatment',
  symptom: 'Body sign',
  menopause: 'Menopause',
  seed: 'Starting haflagah numbers',
  kavua: 'Kavua set by your rav',
  ruling: 'Rav’s answer',
  nursing: 'Nursing',
}

export function EventsSheet() {
  const { events, zmanim: z, stored: s } = useHer()
  const [showVoided, setShowVoided] = useState(false)
  const list = [...events].reverse().filter((e) => showVoided || e.voided_at === null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="mk-dim flex-1 text-[13px]">Newest first. Voiding keeps the entry and leaves it out of the calendar.</p>
        <button className="mk-why" onClick={() => setShowVoided(!showVoided)}>
          {showVoided ? 'Hide voided' : 'Show voided'}
        </button>
      </div>
      <Btn kind="primary" onClick={() => openSheet({ kind: 'event' })}>
        Log something
      </Btn>
      {list.map((e) => {
        const t = Date.parse(e.at)
        const d = e.data as { note?: string; short?: boolean; haflagah?: number[]; flag?: string; outcome?: string; ended?: boolean }
        const onah = z ? place(t, z, s).onah : null
        return (
          <div key={e.id} className={`mk-card px-4 py-3 ${e.voided_at ? 'opacity-50' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">
                  {KIND_LABEL[e.kind]}
                  {e.result && ` · ${S.result[e.result]}`}
                  {e.voided_at && ' · voided'}
                </p>
                <p className="mk-dim text-[12.5px]">
                  {when(t, z)}
                  {onah && ` · ${hebrewLabel(onah.abs, false)} ${onah.half}`}
                </p>
                {d.haflagah && <p className="mk-dim text-[12.5px]">{d.haflagah.join(', ')}</p>}
                {d.ended && <p className="mk-dim text-[12.5px]">Stopped</p>}
                {d.note && <p className="mk-faint text-[12.5px]">{d.note}</p>}
              </div>
              {!e.voided_at && (
                <button className="mk-why" onClick={() => void voidEvent(e.id)} aria-label={S.void}>
                  <Icon name="trash" size={13} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- rav contacts -------------------------------------------------------------------------------------

export function ContactsSheet() {
  const { contacts } = useHer()
  const [editing, setEditing] = useState<string | 'new' | null>(contacts.length === 0 ? 'new' : null)
  return (
    <div className="flex flex-col gap-2">
      {contacts.map((c) =>
        editing === c.id ? (
          <ContactEditor
            key={c.id}
            initial={c}
            onSave={async (v) => {
              await editContact(c.id, v)
              setEditing(null)
            }}
            onRemove={async () => {
              await voidContact(c.id)
              setEditing(null)
            }}
          />
        ) : (
          <div key={c.id} className="mk-card flex items-center gap-3 px-4 py-3">
            <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(c.id)}>
              <p className="text-[14.5px] font-semibold">{c.name}</p>
              {c.note && <p className="mk-dim text-[12.5px]">{c.note}</p>}
            </button>
            {c.phone && (
              <>
                <a className="mk-btn" href={`tel:${c.phone}`} aria-label={`Call ${c.name}`}>
                  <Icon name="bell" size={15} /> Call
                </a>
                <a className="mk-btn" href={`sms:${c.phone}`} aria-label={`Message ${c.name}`}>
                  Text
                </a>
              </>
            )}
          </div>
        ),
      )}
      {editing === 'new' ? (
        <ContactEditor
          onSave={async (v) => {
            if (await addContact(v)) setEditing(null)
          }}
          onRemove={contacts.length ? () => setEditing(null) : undefined}
        />
      ) : (
        <Btn onClick={() => setEditing('new')}>Add a contact</Btn>
      )}
    </div>
  )
}

function ContactEditor({
  initial,
  onSave,
  onRemove,
}: {
  initial?: { name: string; phone: string | null; note: string | null }
  onSave: (v: { name: string; phone: string | null; note: string | null }) => void
  onRemove?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  return (
    <div className="mk-card flex flex-col gap-2 p-3">
      <Field label="Name">
        <input className="mk-input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Phone">
        <input className="mk-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="Note">
        <input className="mk-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Btn kind="primary" className="flex-1" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), phone: phone.trim() || null, note: note.trim() || null })}>
          {S.save}
        </Btn>
        {onRemove && (
          <Btn kind={initial ? 'danger' : 'plain'} onClick={onRemove}>
            {initial ? 'Remove' : S.cancel}
          </Btn>
        )}
      </div>
    </div>
  )
}

// --- patterns and kavua -----------------------------------------------------------------------------------

export function KavuaSheet() {
  const { result, events } = useHer()
  const [type, setType] = useState<KavuaRuling['type']>('chodesh')
  const [n, setN] = useState('')
  const [half, setHalf] = useState<'night' | 'day'>('day')
  const [keep, setKeep] = useState<'keep' | 'drop'>('keep')
  const notices = result?.flags.filter((f) => f.ruleId === 'K1' || f.ruleId === 'K2') ?? []
  const set = events.filter((e) => e.kind === 'kavua' && e.voided_at === null)
  const value = Number(n)
  const valid = Number.isInteger(value) && value > 0 && (type === 'chodesh' ? value <= 30 : value < 200)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <p className="mk-dim flex-1 text-[13px]">The calendar notices a possible pattern and tells you. Only your rav decides there is one; then enter it here.</p>
        <Why ruleId="K1" />
      </div>
      {notices.map((f) => (
        <Card key={f.key} tone="ask" onClick={() => openSheet({ kind: 'flag', key: f.key })}>
          <AskBadge />
          <p className="mt-1 text-[14.5px] font-semibold">{f.title}</p>
          {f.ruling && <p className="mk-dim text-[12.5px]">Answered</p>}
        </Card>
      ))}
      {set.map((e) => {
        const k = (e.data as { kavua?: KavuaRuling }).kavua
        if (!k) return null
        return (
          <div key={e.id} className="mk-card flex items-center gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 text-[14px]">
              <b>Kavua {k.type}</b> · {k.type === 'chodesh' ? `day ${k.day}` : `every ${k.interval} days`}, {k.half} onah
              {k.keepOthers ? ' · other vestot kept' : ''}
            </p>
            <button className="mk-why" onClick={() => void voidEvent(e.id)} aria-label="Remove">
              <Icon name="trash" size={13} />
            </button>
          </div>
        )
      })}
      <Section title="Enter the kavua your rav set">
        <Choice
          value={type}
          options={[
            { value: 'chodesh', label: 'Same day of the month' },
            { value: 'haflagah', label: 'Same interval' },
            { value: 'shavua', label: 'Same weekday interval' },
          ]}
          onChange={setType}
        />
        <Field label={type === 'chodesh' ? 'Day of the Hebrew month' : 'Days from one flow to the next (both counted)'}>
          <input className="mk-input" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        <Choice
          value={half}
          options={[
            { value: 'night', label: 'Night onah' },
            { value: 'day', label: 'Day onah' },
          ]}
          onChange={setHalf}
        />
        <Choice
          value={keep}
          options={[
            { value: 'keep', label: 'Keep the other vestot too' },
            { value: 'drop', label: 'Only the kavua' },
          ]}
          onChange={setKeep}
        />
        <Btn
          kind="primary"
          disabled={!valid}
          onClick={async () => {
            const kavua: KavuaRuling = { type, half, keepOthers: keep === 'keep', ...(type === 'chodesh' ? { day: value } : { interval: value }) }
            if (await logEvent('kavua', Date.now(), { data: { kavua } })) setN('')
          }}
        >
          {S.save}
        </Btn>
      </Section>
    </div>
  )
}

// --- printable pages: the summary for a rav, and the written calendar -------------------------------------

export function PrintSheet({ mode }: { mode: 'rav' | 'calendar' }) {
  const { result, zmanim: z, stored: s, now } = useHer()
  const doc = useRef<HTMLDivElement>(null)
  if (!result || !z) return null
  const tz = tzAt(now, z)
  const rows = cycleRows(result).slice(-10)
  const st = stats(rows.map((r) => r.length))
  const open = result.flags.filter((f) => f.ruling === null)
  const upcoming = result.vestot.filter((v) => v.end > now && (v.kind !== 'or_zarua' || s.orZarua))
  const nights = result.cycles.filter((c) => c.mikvah && !c.mikvah.withheld && c.immersion === null)

  function html() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Calendar</title><style>body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}h1{font-size:20px}h2{font-size:16px;margin-top:20px}</style></head><body>${doc.current?.innerHTML ?? ''}</body></html>`
  }

  async function share() {
    const file = new File([html()], mode === 'rav' ? 'summary.html' : 'calendar.html', { type: 'text/html' })
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
    try {
      if (nav.canShare?.({ files: [file] })) return await navigator.share({ files: [file] })
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch {
      /* she closed the share sheet */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="mk-dim text-[13px]">
        {mode === 'rav'
          ? 'A clean summary of the last 10 cycles and any open question. Nothing is sent unless you share it.'
          : 'Upcoming onot and mikvah nights, laid out for a written record.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Btn kind="primary" onClick={() => void share()}>
          Share
        </Btn>
        <Btn onClick={() => window.print()}>Print</Btn>
      </div>
      {mode === 'calendar' && <Why ruleId="W1" label="Why keep a written calendar?" />}
      <div ref={doc} className="mk-print-doc mk-card overflow-x-auto p-4 text-[13px]" style={{ background: 'white', color: '#111' }}>
        {mode === 'rav' ? (
          <>
            <h1>Cycle summary</h1>
            <p>Prepared {when(now, z)}. Custom: Chabad defaults unless noted.</p>
            <table>
              <thead>
                <tr>
                  <th>Flow</th>
                  <th>Onah</th>
                  <th>Cycle (days)</th>
                  <th>Hefsek on day</th>
                  <th>Haflagah</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateBoth(r.day1)}</td>
                    <td>{r.half}</td>
                    <td>{r.length ?? '—'}</td>
                    <td>{r.toHefsek ?? '—'}</td>
                    <td>{r.haflagah ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Average {st.average ?? '—'} · shortest {st.shortest ?? '—'} · longest {st.longest ?? '—'} days. Haflagah numbers in force: {result.haflagahList.join(', ') || 'none'}.
            </p>
            {open.map((f) => (
              <div key={f.key}>
                <h2>Open question: {f.title}</h2>
                <ul>
                  {f.facts.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        ) : (
          <>
            <h1>Calendar</h1>
            <p>Printed {when(now, z)}. Times for {tz}.</p>
            <h2>Mikvah night</h2>
            {nights.length === 0 && <p>None set.</p>}
            {nights.map((c) => (
              <p key={c.id}>
                Night of {nightBoth(c.mikvah!.abs)}, after {time(c.mikvah!.at, tz)}
              </p>
            ))}
            <h2>Onot perishah</h2>
            <table>
              <thead>
                <tr>
                  <th>Hebrew date</th>
                  <th>Onah</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>Until</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((v) => (
                  <tr key={v.key}>
                    <td>{v.onot.map((o) => hebrewLabel(o.abs)).filter((x, i, a) => a.indexOf(x) === i).join(', ')}</td>
                    <td>{v.onot.map((o) => o.half).join(' + ')}</td>
                    <td>
                      {vesetName(v.kind)}
                      {v.number ? ` (${v.number})` : ''}
                    </td>
                    <td>{when(v.start, z)}</td>
                    <td>{when(v.end, z)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.separation.length > 0 && (
              <>
                <h2>Separation for everyone</h2>
                {result.separation.slice(0, 6).map((x) => (
                  <p key={`${x.abs}${x.label}`}>
                    {x.label}: {dateBoth(x.abs)}
                  </p>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
