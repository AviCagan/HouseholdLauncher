import { useState } from 'react'
import { Icon } from '@/components/primitives/Icon'
import { addMemo, editMemo, enterRuling, saveSourceNote, voidMemo, withdrawRuling } from '../actions'
import { citation, civilOf, GLOSSARY, hebrewLabel, onahSpan, place, rule, RULES, statusAt, vesetName, withNotes, type Half } from '../engine'
import { civilLabel, time, tzAt, when } from '../format'
import { openSheet } from '../store'
import { S } from '../strings'
import { AskBadge, Btn, Card, Dot, Field, Section, Why, type Tone } from '../ui'
import { useCalendar, useHer } from '../useMikvah'
import { describe, keysFor } from '../settingsUi'
import { DEFAULT_STORED } from '../model'
import { EventLine } from './log'

const HANDLING: Record<string, string> = {
  decides: 'The calendar works this out.',
  asks: 'The calendar asks your rav and waits.',
  setting: 'A setting: the Chabad default, changeable to what your rav or kallah teacher taught.',
  reminds: 'A reminder only.',
  feature: 'A feature of the app.',
}
const CONFIDENCE: Record<string, string> = { H: 'High', S: 'Some', U: 'Unclear' }

// --- why? -------------------------------------------------------------------------------

export function WhySheet({ ruleId, note }: { ruleId: string; note?: string }) {
  // His phone reads the registry as shipped: her settings and corrections are hers.
  const c = useCalendar()
  const her = c.role === 'her' ? c : null
  const notes = her?.notes ?? []
  const stored = her?.stored ?? DEFAULT_STORED
  const history = her?.history ?? []
  const r = withNotes(rule(ruleId), notes)
  const keys = r.setting ? keysFor(r.setting.key) : []
  const confirmed = keys.map((k) => stored.confirmed[k]).find(Boolean)
  const since = history[history.length - 1]?.effective_from

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mk-label">Rule {r.id}</p>
        <h3 className="text-[20px] font-bold leading-tight">{r.title}</h3>
      </div>
      {note && (
        <Card tone="mikvah">
          <p className="text-[14px]">{note}</p>
        </Card>
      )}
      <p className="text-[15px] leading-relaxed">{r.text}</p>
      {r.asks && (
        <Card tone="ask">
          <AskBadge />
          <p className="mt-1 text-[13.5px]">It asks your rav when: {r.asks}.</p>
        </Card>
      )}
      {r.setting && her && (
        <Card>
          <p className="mk-label">Setting</p>
          {keys.map((k) => (
            <p key={k} className="mt-1 text-[14px]">
              Now: <b>{describe(k, stored)}</b>
            </p>
          ))}
          <p className="mk-dim text-[13px]">Chabad default: {r.setting.chabadDefault}</p>
          <p className="mk-dim text-[13px]">Options: {r.setting.options}</p>
          {confirmed && <p className="mk-tone-tehorah mk-tone-text mt-1 text-[13px] font-semibold">Confirmed with our rav, {civilLabel(confirmed)}</p>}
          <Btn className="mt-2" onClick={() => openSheet({ kind: 'settings' })}>
            Change it
          </Btn>
        </Card>
      )}
      <Section title="Sources" right={her ? <button className="mk-why" onClick={() => openSheet({ kind: 'sources', ruleId: r.id })}>Correct</button> : undefined}>
        {r.sources.map((s, i) => (
          <div key={i} className="mk-card px-4 py-3">
            <p className="text-[14px] leading-snug">{citation(s)}</p>
            {s.checked && <p className="mk-faint text-[11.5px]">Read directly · {s.via}</p>}
          </div>
        ))}
      </Section>
      <p className="mk-faint text-[12px] leading-snug">
        {HANDLING[r.handling]} Confidence: {CONFIDENCE[r.confidence]}.
        {since && ` Worked out under the settings in force since ${civilLabel(since.slice(0, 10))}.`}
      </p>
    </div>
  )
}

// --- an ask-a-rav flag ----------------------------------------------------------------------

export function FlagSheet({ flagKey, onDone }: { flagKey: string; onDone: () => void }) {
  const { result, contacts } = useHer()
  const f = result?.flags.find((x) => x.key === flagKey)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  if (!f) return <p className="mk-dim">This question is no longer open — the entry it was about may have been voided.</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <AskBadge />
          <h3 className="mt-1 text-[19px] font-bold leading-tight">{f.title}</h3>
        </div>
        <Why ruleId={f.ruleId} />
      </div>
      <Section title="For your rav">
        <div className="mk-card px-4 py-3">
          <ul className="list-disc pl-4 text-[14px] leading-relaxed">
            {f.facts.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      </Section>
      <Card tone="ask">
        <p className="mk-label">While it's open</p>
        <p className="mt-1 text-[14px]">{f.holds}</p>
      </Card>

      {f.ruling ? (
        <Card tone="tehorah">
          <p className="mk-label">Your rav's answer</p>
          <p className="mt-1 text-[15px] font-semibold">{f.options.find((o) => o.value === f.ruling!.outcome)?.label ?? f.ruling.outcome}</p>
          {f.ruling.date && <p className="text-[13px]">Date: {civilLabel(f.ruling.date)}</p>}
          {f.ruling.note && <p className="mk-dim text-[13px]">{f.ruling.note}</p>}
          <Btn className="mt-2" onClick={() => void withdrawRuling(f.key)}>
            Change the answer
          </Btn>
        </Card>
      ) : (
        <Section title="Enter the answer">
          {f.options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOutcome(o.value)}
              className={`mk-card px-4 py-3 text-left text-[14.5px] ${outcome === o.value ? 'mk-tone-tehorah mk-toned font-semibold' : ''}`}
            >
              {o.label}
            </button>
          ))}
          {f.wantsDate && (
            <Field label="The date your rav gave">
              <input type="date" className="mk-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
          <Field label="Note (only you see this)">
            <textarea className="mk-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Btn
            kind="primary"
            disabled={!outcome || (f.wantsDate && !date)}
            onClick={async () => {
              if (!outcome) return
              if (await enterRuling(f.key, outcome, { date: date || undefined, note: note.trim() || undefined })) onDone()
            }}
          >
            {S.save}
          </Btn>
        </Section>
      )}

      <Section title={S.more.contacts}>
        {contacts.map((c) => (
          <a key={c.id} href={c.phone ? `tel:${c.phone}` : undefined} className="mk-card flex items-center gap-3 px-4 py-3">
            <Icon name="people" size={16} />
            <span className="flex-1 text-[14.5px] font-medium">{c.name}</span>
            {c.phone && <span className="mk-dim text-[13px]">{c.phone}</span>}
          </a>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={() => openSheet({ kind: 'contacts' })}>Contacts</Btn>
          <Btn onClick={() => openSheet({ kind: 'share' })}>{S.more.share}</Btn>
        </div>
      </Section>
    </div>
  )
}

// --- one day ------------------------------------------------------------------------------------

export function DaySheet({ abs }: { abs: number }) {
  const { result, zmanim: z, stored: s, events, memos, now } = useHer()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  if (!result || !z) return null
  const civil = civilOf(abs)
  const t = z.times(civil)
  const tz = z.placeOn(civil).tz
  const halves: Half[] = ['night', 'day']
  const dayMemos = memos.filter((m) => m.day === civil)
  const dayEvents = events.filter((e) => e.voided_at === null && e.kind !== 'ruling' && place(Date.parse(e.at), z, s).onah.abs === abs)
  const seps = result.separation.filter((x) => x.abs === abs)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[20px] font-bold">{hebrewLabel(abs)}</h3>
        <p className="mk-dim text-[13.5px]">
          Night begins {civilLabel(civilOf(abs - 1))} at shkiah · day {civilLabel(civil)}
        </p>
      </div>
      {halves.map((half) => {
        const span = onahSpan({ abs, half }, z, s, false)
        const mid = (span.start + span.end) / 2
        const st = statusAt(result, mid, z, s)
        const vs = result.vestot.filter((v) => v.onot.some((o) => o.abs === abs && o.half === half) && (v.kind !== 'or_zarua' || s.orZarua))
        return (
          <Card key={half} tone={st.kind as Tone}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="mk-label capitalize">
                  {half} onah · {when(span.start, z)}
                </p>
                <p className="mt-0.5 text-[15px] font-semibold">{st.line.replace(/ — onat perishah.*$/, '')}</p>
              </div>
              <Why ruleId={st.ruleId} />
            </div>
            {vs.map((v) => (
              <div key={v.key} className="mk-tone-onah mt-2 flex items-center gap-2 text-[13px]">
                <Dot tone="onah" />
                <span className="flex-1">
                  <b className="mk-tone-text">Onat perishah</b> · {vesetName(v.kind)}
                  {v.number ? ` (${v.number})` : ''}
                  {v.bedikahDone ? ' · bedikah done ✓' : ''}
                </span>
                <Why ruleId={v.ruleId} note={v.reason} />
              </div>
            ))}
          </Card>
        )
      })}
      {seps.map((x) => (
        <Card key={x.label} tone="sep">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[14px] font-semibold">{x.label}</span>
            <Why ruleId={x.ruleId} />
          </div>
        </Card>
      ))}
      <p className="mk-faint text-[12.5px]">
        Netz {time(t.netz ?? NaN, tz)} · Shkiah {time(t.shkiah ?? NaN, tz)} · Tzeit {time(t.tzeit ?? NaN, tz)}
      </p>

      {dayEvents.length > 0 && (
        <Section title="Logged">
          {dayEvents.map((e) => (
            <div key={e.id}>
              <p className="mk-label mb-1 px-1 capitalize">{e.kind}</p>
              <EventLine e={e} />
            </div>
          ))}
        </Section>
      )}

      <Section title={S.more.memos}>
        {dayMemos.map((m) =>
          editing === m.id ? (
            <MemoEditor
              key={m.id}
              initial={m.body}
              onSave={async (body) => {
                await editMemo(m.id, body)
                setEditing(null)
              }}
              onVoid={async () => {
                await voidMemo(m.id)
                setEditing(null)
              }}
            />
          ) : (
            <button key={m.id} className="mk-card whitespace-pre-wrap px-4 py-3 text-left text-[14px]" onClick={() => setEditing(m.id)}>
              {m.body}
            </button>
          ),
        )}
        <textarea className="mk-input" placeholder="A note for this day (only you see it)" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Btn
          disabled={!draft.trim()}
          onClick={async () => {
            if (await addMemo(civil, draft.trim())) setDraft('')
          }}
        >
          Add memo
        </Btn>
      </Section>
      {abs < place(now, z, s).onah.abs && <p className="mk-faint text-[12px]">Past days show what the calendar works out now, from everything logged.</p>}
    </div>
  )
}

function MemoEditor({ initial, onSave, onVoid }: { initial: string; onSave: (b: string) => void; onVoid: () => void }) {
  const [body, setBody] = useState(initial)
  return (
    <div className="flex flex-col gap-2">
      <textarea className="mk-input" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex gap-2">
        <Btn kind="primary" className="flex-1" onClick={() => onSave(body)}>
          {S.save}
        </Btn>
        <Btn kind="danger" onClick={onVoid}>
          Remove
        </Btn>
      </div>
    </div>
  )
}

// --- help and glossary -----------------------------------------------------------------------------

const SCREENS: { title: string; text: string; ruleId: string }[] = [
  { title: 'Today', text: 'Where you are now, the next thing to do and its time, mikvah night, and any question waiting for your rav. Tap Why? on anything to see the rule and its sources.', ruleId: 'ASK' },
  { title: 'Calendar', text: 'Each day is split into its night (top) and day (bottom), because an onah is half a day. Striped halves are onot perishah; a dashed outline is a separation day for everyone.', ruleId: 'Z1' },
  { title: 'Onot', text: 'Every upcoming onat perishah with its type, number, times and bedikah window. Tick the bedikah when it is done.', ruleId: 'V10' },
  { title: 'History', text: 'Every cycle, its length, the days to the hefsek and the haflagah numbers, with the average, shortest and longest.', ruleId: 'V5' },
  { title: 'Questions', text: 'The calendar calculates; it never rules. When something needs a rav, it records the facts, holds what the question affects, and waits for you to enter the answer.', ruleId: 'ASK' },
  { title: 'A written calendar', text: 'Keep a written record as well; the printable calendar is for that.', ruleId: 'W1' },
]

export function HelpSheet() {
  const { zmanim: z, now } = useHer()
  return (
    <div className="flex flex-col gap-4">
      <Section title="The screens">
        {SCREENS.map((x) => (
          <Card key={x.title}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{x.title}</p>
                <p className="mk-dim mt-0.5 text-[13.5px] leading-snug">{x.text}</p>
              </div>
              <Why ruleId={x.ruleId} />
            </div>
          </Card>
        ))}
      </Section>
      <Section title="Glossary">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="mk-card px-4 py-3">
            <p className="text-[14.5px] font-semibold">{g.term}</p>
            <p className="mk-dim text-[13.5px] leading-snug">{g.meaning}</p>
          </div>
        ))}
      </Section>
      <Section title="Every rule">
        {RULES.map((r) => (
          <button key={r.id} className="mk-card flex items-center gap-3 px-4 py-2.5 text-left" onClick={() => openSheet({ kind: 'why', ruleId: r.id })}>
            <span className="mk-faint w-10 shrink-0 text-[12px] font-bold">{r.id}</span>
            <span className="flex-1 text-[14px]">{r.title}</span>
          </button>
        ))}
      </Section>
      <p className="mk-faint text-[12px]">Times are shown in {tzAt(now, z)}.</p>
    </div>
  )
}

// --- correcting a source ------------------------------------------------------------------------------

export function SourcesSheet({ ruleId }: { ruleId?: string }) {
  const { notes } = useHer()
  const list = ruleId ? RULES.filter((r) => r.id === ruleId) : RULES
  return (
    <div className="flex flex-col gap-4">
      <p className="mk-dim text-[13.5px] leading-snug">
        A citation marked unchecked reads “as cited by” until someone checks it against the text itself. Tick it once checked, or correct the reference.
      </p>
      {list.map((base) => {
        const r = withNotes(base, notes)
        return (
          <Section key={r.id} title={`${r.id} · ${r.title}`}>
            {r.sources.map((s, i) => (
              <SourceEditor key={i} ruleId={r.id} idx={i} refText={s.ref} checked={s.checked} via={s.via} />
            ))}
          </Section>
        )
      })}
    </div>
  )
}

function SourceEditor({ ruleId, idx, refText, checked, via }: { ruleId: string; idx: number; refText: string; checked: boolean; via: string }) {
  const [ref, setRef] = useState(refText)
  const dirty = ref.trim() !== refText
  return (
    <div className="mk-card flex flex-col gap-2 px-4 py-3">
      <input className="mk-input" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Reference" />
      <p className="mk-faint text-[12px]">Found via {via}</p>
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 text-[14px]">
          <input type="checkbox" checked={checked} onChange={(e) => void saveSourceNote(ruleId, idx, { ref: ref.trim() || null, checked: e.target.checked })} />
          Checked against the text
        </label>
        {dirty && (
          <Btn kind="primary" onClick={() => void saveSourceNote(ruleId, idx, { ref: ref.trim() || null, checked })}>
            {S.save}
          </Btn>
        )}
      </div>
    </div>
  )
}
