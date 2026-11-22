import { useState } from 'react'
import { Icon } from '@/components/primitives/Icon'
import { savePartner } from './actions'
import { segmentAt, type Segment } from './engine'
import { civilLabel, countdown, day, time } from './format'
import { S } from './strings'
import { AskBadge, Btn, Card, cap, Dot, Field, Section, Toggle, Why, type Tone } from './ui'
import { useCalendar } from './useMikvah'

/**
 * His view: exactly what her phone publishes (mk_shared.snapshot) — the
 * status, the onot perishah with their times, mikvah night and the beinonit
 * tick — and his own inputs: away dates, shiva, and which reminders he wants.
 * Nothing else reaches this phone; the database sees to that.
 */

const RULE_FOR: Record<Segment['kind'], string> = {
  waiting: 'D1',
  counting: 'N1',
  mikvah: 'M1',
  after_seven: 'M1',
  tehorah: 'M1',
  none: 'ASK',
}

const LABEL: Record<Segment['kind'], string> = {
  waiting: 'Niddah · waiting',
  counting: 'Niddah · counting',
  mikvah: 'Mikvah night',
  after_seven: 'Niddah · seven days done',
  tehorah: 'Tehorah',
  none: 'Nothing logged yet',
}

export function HisView() {
  const c = useCalendar()
  if (c.role !== 'him') return null
  const { snapshot: snap, now, shared, partnerRow, his } = c
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const owner = shared.id

  if (!snap) {
    return (
      <div className="pb-8">
        <Card>
          <p className="text-[14.5px]">{S.him.noSnapshot}</p>
        </Card>
        <Inputs owner={owner} away={partnerRow?.away ?? []} shiva={partnerRow?.shiva ?? []} vestot={his.vestot} mikvah={his.mikvah} tile={his.tile} />
      </div>
    )
  }

  const seg = segmentAt(snap, now)
  const next = snap.segments.filter((x) => x.from > now).slice(0, 4)
  const onot = snap.onot.filter((o) => o.end > now)
  const niddah = seg && seg.kind !== 'tehorah' && seg.kind !== 'none'

  return (
    <div className="pb-8">
      {seg ? (
        <Card tone={seg.kind as Tone}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[24px] font-bold leading-tight">
                {LABEL[seg.kind]}
                {seg.day !== undefined && seg.of !== undefined && <span className="mk-tone-text"> · day {seg.day} of {seg.of}</span>}
              </h2>
              <p className="mk-dim mt-1 text-[13.5px]">
                Until {day(seg.to, tz)}, {time(seg.to, tz)}
              </p>
            </div>
            <Why ruleId={RULE_FOR[seg.kind]} />
          </div>
          {niddah && (
            <div className="mt-3 flex items-center gap-2 border-t pt-3 text-[13px]" style={{ borderColor: 'var(--border)' }}>
              <span className="mk-dim flex-1">The harchakot apply until she immerses.</span>
              <Why ruleId="HR" />
            </div>
          )}
          {onot
            .filter((o) => o.start <= now)
            .map((o, i) => (
              <div key={i} className="mk-tone-onah mt-3 flex items-center gap-2 border-t pt-3 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                <Dot tone="onah" />
                <span className="flex-1">
                  <b className="mk-tone-text">Onat perishah now</b> · {o.name} · until {time(o.end, tz)}
                </span>
                <Why ruleId={o.ruleId} />
              </div>
            ))}
        </Card>
      ) : (
        <Card>
          <p className="mk-dim text-[14px]">The published dates have run out — they refresh when her phone next opens the calendar.</p>
        </Card>
      )}

      {snap.mikvah && (
        <Section title={S.today.mikvah}>
          <Card tone={snap.mikvah.onHold ? 'ask' : 'mikvah'}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[17px] font-bold">Night of {snap.mikvah.label}</p>
                <p className="mk-dim text-[13.5px]">
                  After {day(snap.mikvah.at, tz)}, {time(snap.mikvah.at, tz)} · <b>{countdown(snap.mikvah.at - now)}</b>
                </p>
                {snap.mikvah.onHold && (
                  <p className="mt-1">
                    <AskBadge /> <span className="mk-dim text-[12.5px]">waiting on a question for her rav</span>
                  </p>
                )}
              </div>
              <Why ruleId="M1" />
            </div>
          </Card>
        </Section>
      )}

      {onot.length > 0 && (
        <Section title={S.onot.title}>
          {onot.map((o, i) => (
            <Card key={i} tone="onah">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{cap(o.name)}</p>
                  <p className="mk-dim text-[13px]">
                    {day(o.start, tz)}, {time(o.start, tz)} – {o.end - o.start > 18 * 3_600_000 ? `${day(o.end, tz)}, ` : ''}
                    {time(o.end, tz)}
                  </p>
                  {o.beinonit && (o.done || o.start <= now + 86_400_000) && (
                    <p className={`mt-1 text-[13px] font-semibold ${o.done ? 'mk-tone-tehorah mk-tone-text' : 'mk-tone-ask mk-tone-text'}`}>
                      {o.done ? `✓ ${S.him.beinonitDone}` : S.him.beinonitPending}
                    </p>
                  )}
                </div>
                <Why ruleId={o.ruleId} />
              </div>
            </Card>
          ))}
        </Section>
      )}

      {next.length > 0 && (
        <Section title={S.today.upcoming}>
          {next.map((x, i) => (
            <div key={i} className="mk-card flex items-center gap-3 px-4 py-3">
              <Dot tone={x.kind as Tone} />
              <p className="min-w-0 flex-1 text-[14px]">{x.line}</p>
              <span className="mk-dim text-[12.5px]">
                {day(x.from, tz)}, {time(x.from, tz)}
              </span>
            </div>
          ))}
        </Section>
      )}

      <p className="mk-faint mt-4 px-1 text-[12px]">
        {S.him.published} {day(snap.publishedAt, tz)}, {time(snap.publishedAt, tz)}.
      </p>

      <Inputs owner={owner} away={partnerRow?.away ?? []} shiva={partnerRow?.shiva ?? []} vestot={his.vestot} mikvah={his.mikvah} tile={his.tile} />
    </div>
  )
}

type Range = { from: string; to: string }

function Inputs({ owner, away, shiva, vestot, mikvah, tile }: { owner: string; away: Range[]; shiva: Range[]; vestot: boolean; mikvah: boolean; tile?: { name: string; icon: string } }) {
  const prefs = { vestot, mikvah, ...(tile ? { tile } : {}) }
  return (
    <>
      <Section title={S.him.reminders}>
        <div className="mk-card px-4 py-1">
          <Toggle on={vestot} onChange={(v) => void savePartner(owner, { prefs: { ...prefs, vestot: v } })} label={S.him.remindVestot} hint="The day before, and when it starts." />
          <Toggle on={mikvah} onChange={(v) => void savePartner(owner, { prefs: { ...prefs, mikvah: v } })} label={S.him.remindMikvah} hint="The morning of." />
        </div>
      </Section>
      <RangeEditor title={S.him.away} ruleId="M6" ranges={away} onChange={(next) => void savePartner(owner, { away: next })} />
      <RangeEditor title={S.him.shiva} ruleId="M6" ranges={shiva} onChange={(next) => void savePartner(owner, { shiva: next })} />
      <Section title="My tile">
        <Field label="Name on my home screen">
          <input
            className="mk-input"
            defaultValue={tile?.name ?? 'Calendar'}
            onBlur={(e) => {
              const name = e.target.value.trim() || 'Calendar'
              if (name !== (tile?.name ?? 'Calendar')) void savePartner(owner, { prefs: { ...prefs, tile: { name, icon: tile?.icon ?? 'calendar' } } })
            }}
          />
        </Field>
      </Section>
    </>
  )
}

function RangeEditor({ title, ruleId, ranges, onChange }: { title: string; ruleId: string; ranges: Range[]; onChange: (r: Range[]) => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  return (
    <Section title={title} right={<Why ruleId={ruleId} />}>
      {ranges.map((r, i) => (
        <div key={i} className="mk-card flex items-center gap-3 px-4 py-2.5">
          <span className="flex-1 text-[14px]">
            {civilLabel(r.from)} – {civilLabel(r.to)}
          </span>
          <button className="mk-why" onClick={() => onChange(ranges.filter((_, j) => j !== i))} aria-label="Remove">
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className="mk-input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={`${title} from`} />
        <input type="date" className="mk-input" value={to} onChange={(e) => setTo(e.target.value)} aria-label={`${title} to`} />
      </div>
      <Btn
        disabled={!from || !to || to < from}
        onClick={() => {
          onChange([...ranges, { from, to }])
          setFrom('')
          setTo('')
        }}
      >
        Add
      </Btn>
    </Section>
  )
}
