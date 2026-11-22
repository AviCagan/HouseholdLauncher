import { useMemo, useState } from 'react'
import { Icon } from '@/components/primitives/Icon'
import { absOfCivil, civilOf, dayOfMonth, hebrewLabel, monthName, onahSpan, place, statusAt, type Half, type Result, type Settings, type Zmanim } from './engine'
import { today } from './format'
import { cycleRows, stats } from './history'
import { openSheet } from './store'
import { Btn, Card, Dot, Section, Why, type Tone } from './ui'
import { useHer } from './useMikvah'
import { CycleChart } from './CycleChart'

/**
 * Month view, each day split into its night (top) and day (bottom) so an
 * onah can be shaded; a year view; the cycle-length chart.
 */

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface HalfLook {
  tone: Tone
  veset: boolean
}

function halfLook(result: Result, z: Zmanim, s: Settings, abs: number, half: Half): HalfLook {
  const span = onahSpan({ abs, half }, z, s, false)
  const st = statusAt(result, (span.start + span.end) / 2, z, s)
  const veset = result.vestot.some((v) => (v.kind !== 'or_zarua' || s.orZarua) && v.onot.some((o) => o.abs === abs && o.half === half))
  return { tone: st.kind as Tone, veset }
}

/** A rough estimate only, off by default: the next flow by the average cycle, less 14 days. */
function ovulationDays(result: Result): Set<number> {
  const rows = cycleRows(result)
  const last = rows[rows.length - 1]
  if (!last) return new Set()
  const avg = Math.round(stats(rows.map((r) => r.length)).average ?? 29)
  const mid = last.day1 + avg - 14
  return new Set([mid - 2, mid - 1, mid, mid + 1, mid + 2])
}

export function CalendarTab() {
  const c = useHer()
  const { result, zmanim: z, stored: s, now, memos, events } = c
  const [view, setView] = useState<'month' | 'year'>('month')
  const t = today(now, z)
  const [cursor, setCursor] = useState(() => ({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 }))

  const marks = useMemo(() => {
    if (!result || !z) return null
    const mikvah = new Set(result.cycles.filter((x) => x.mikvah && !x.mikvah.withheld).map((x) => x.mikvah!.abs))
    const flows = new Set(events.filter((e) => e.kind === 'flow' && e.voided_at === null).map((e) => place(Date.parse(e.at), z, s).onah.abs))
    const sep = new Set(result.separation.map((x) => x.abs))
    const memo = new Set(memos.map((m) => absOfCivil(m.day)))
    const ovulation = s.showOvulation ? ovulationDays(result) : new Set<number>()
    return { mikvah, flows, sep, memo, ovulation }
  }, [result, z, s, events, memos])

  if (!result || !z || !marks) return null
  const todayAbs = absOfCivil(t)

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center gap-2">
        <button className="mk-why" onClick={() => setCursor(view === 'month' ? prevMonth(cursor) : { ...cursor, y: cursor.y - 1 })} aria-label="Earlier">
          <span className="inline-block rotate-180">
            <Icon name="chevron" size={14} />
          </span>
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[16px] font-bold">{view === 'month' ? `${MONTHS[cursor.m]} ${cursor.y}` : cursor.y}</p>
          {view === 'month' && <p className="mk-dim text-[12px]">{hebrewSpan(cursor)}</p>}
        </div>
        <button className="mk-why" onClick={() => setCursor(view === 'month' ? nextMonth(cursor) : { ...cursor, y: cursor.y + 1 })} aria-label="Later">
          <Icon name="chevron" size={14} />
        </button>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Btn kind={view === 'month' ? 'toned' : 'plain'} tone="mikvah" onClick={() => setView('month')}>
          Month
        </Btn>
        <Btn kind={view === 'year' ? 'toned' : 'plain'} tone="mikvah" onClick={() => setView('year')}>
          Year
        </Btn>
      </div>

      {view === 'month' ? (
        <Month y={cursor.y} m={cursor.m} result={result} z={z} s={s} todayAbs={todayAbs} marks={marks} />
      ) : (
        <Year y={cursor.y} result={result} z={z} s={s} todayAbs={todayAbs} onPick={(m) => (setCursor({ y: cursor.y, m }), setView('month'))} />
      )}

      <Legend ovulation={s.showOvulation} />

      {view === 'year' && (
        <Section title="Cycle length, days">
          <Card>
            <CycleChart rows={cycleRows(result)} />
          </Card>
        </Section>
      )}
    </div>
  )
}

const prevMonth = ({ y, m }: { y: number; m: number }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })
const nextMonth = ({ y, m }: { y: number; m: number }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })
const civil = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

function hebrewSpan({ y, m }: { y: number; m: number }) {
  const a = absOfCivil(civil(y, m, 1))
  const b = absOfCivil(civil(y, m, daysIn(y, m)))
  const first = monthName(a)
  const last = monthName(b)
  const year = hebrewLabel(b).split(' ').pop()
  return first === last ? `${first} ${year}` : `${first} – ${last} ${year}`
}

function Month({
  y,
  m,
  result,
  z,
  s,
  todayAbs,
  marks,
}: {
  y: number
  m: number
  result: Result
  z: Zmanim
  s: Settings
  todayAbs: number
  marks: { mikvah: Set<number>; flows: Set<number>; sep: Set<number>; memo: Set<number>; ovulation: Set<number> }
}) {
  const first = absOfCivil(civil(y, m, 1))
  const lead = new Date(Date.UTC(y, m, 1)).getUTCDay()
  const count = daysIn(y, m)
  const cells = useMemo(() => {
    const out: { abs: number; inMonth: boolean; night: HalfLook; day: HalfLook }[] = []
    const total = Math.ceil((lead + count) / 7) * 7
    for (let i = 0; i < total; i++) {
      const abs = first - lead + i
      out.push({ abs, inMonth: i >= lead && i < lead + count, night: halfLook(result, z, s, abs, 'night'), day: halfLook(result, z, s, abs, 'day') })
    }
    return out
  }, [first, lead, count, result, z, s])

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center">
        {WEEK.map((d, i) => (
          <span key={i} className="mk-faint text-[11px] font-semibold">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const civilDay = Number(civilOf(c.abs).slice(8))
          const hd = dayOfMonth(c.abs)
          return (
            <button
              key={c.abs}
              type="button"
              onClick={() => openSheet({ kind: 'day', abs: c.abs })}
              className={`mk-cell ${c.inMonth ? '' : 'out'} ${c.abs === todayAbs ? 'today' : ''} ${marks.sep.has(c.abs) ? 'sep' : ''}`}
              aria-label={`${civilOf(c.abs)}, ${hd} ${monthName(c.abs)}: night ${c.night.tone}${c.night.veset ? ', onat perishah' : ''}; day ${c.day.tone}${c.day.veset ? ', onat perishah' : ''}`}
            >
              <span className={`mk-half night mk-tone-${c.night.tone} ${c.night.veset ? 'veset' : ''}`} />
              <span className={`mk-half day mk-tone-${c.day.tone} ${c.day.veset ? 'veset' : ''}`} />
              <span className="pointer-events-none absolute inset-0 flex flex-col justify-between p-1 text-left">
                <span className="text-[12.5px] font-bold leading-none">{civilDay}</span>
                <span className="flex items-end justify-between gap-0.5">
                  <span className="mk-dim text-[10px] leading-none">{hd === 1 ? monthName(c.abs).slice(0, 3) : hd}</span>
                  <span className="flex gap-0.5">
                    {marks.flows.has(c.abs) && <Dot tone="waiting" />}
                    {marks.mikvah.has(c.abs) && <Dot tone="mikvah" />}
                    {marks.memo.has(c.abs) && <Dot tone="none" />}
                    {marks.ovulation.has(c.abs) && <span className="mk-faint text-[9px] leading-none">est</span>}
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Year({ y, result, z, s, todayAbs, onPick }: { y: number; result: Result; z: Zmanim; s: Settings; todayAbs: number; onPick: (m: number) => void }) {
  const months = useMemo(
    () =>
      MONTHS.map((_, m) => {
        const first = absOfCivil(civil(y, m, 1))
        const lead = new Date(Date.UTC(y, m, 1)).getUTCDay()
        return { m, lead, days: Array.from({ length: daysIn(y, m) }, (_, i) => ({ abs: first + i, look: halfLook(result, z, s, first + i, 'day') })) }
      }),
    [y, result, z, s],
  )
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {months.map((mo) => (
        <button key={mo.m} type="button" className="mk-card p-2 text-left" onClick={() => onPick(mo.m)}>
          <p className="mb-1 text-[12px] font-semibold">{MONTHS[mo.m].slice(0, 3)}</p>
          <div className="grid grid-cols-7 gap-[2px]">
            {Array.from({ length: mo.lead }, (_, i) => (
              <span key={`l${i}`} />
            ))}
            {mo.days.map((d) => (
              <span
                key={d.abs}
                className={`mk-tone-${d.look.tone} aspect-square rounded-[3px]`}
                style={{
                  background: d.look.veset ? 'var(--mk-onah)' : `color-mix(in oklab, var(--tone) 55%, var(--surface-2))`,
                  outline: d.abs === todayAbs ? '1.5px solid var(--accent)' : undefined,
                }}
              />
            ))}
          </div>
        </button>
      ))}
    </div>
  )
}

function Legend({ ovulation }: { ovulation: boolean }) {
  const items: { tone: Tone; label: string }[] = [
    { tone: 'tehorah', label: 'Tehorah' },
    { tone: 'waiting', label: 'Niddah · waiting' },
    { tone: 'counting', label: 'Niddah · counting' },
    { tone: 'mikvah', label: 'Mikvah night' },
  ]
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-2 px-1 text-[12px]">
        {items.map((i) => (
          <span key={i.tone} className="flex items-center gap-1.5">
            <Dot tone={i.tone} />
            {i.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, var(--mk-onah) 0 2px, transparent 2px 4px)' }} />
          Onat perishah
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ outline: '2px dashed var(--mk-sep)', outlineOffset: -2 }} />
          Separation day
        </span>
      </div>
      <div className="flex items-center gap-2 px-1">
        <p className="mk-faint flex-1 text-[11.5px]">Top half: the night (from shkiah the evening before). Bottom half: the day.</p>
        <Why ruleId="Z1" />
      </div>
      {ovulation && <p className="mk-faint px-1 text-[11.5px]">“est”: estimated ovulation — a rough calendar estimate, not medical or halachic guidance.</p>}
    </div>
  )
}
