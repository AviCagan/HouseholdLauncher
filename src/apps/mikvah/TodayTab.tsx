import { useState } from 'react'
import { cycleAt, nextThing, place, statusAt, vesetName, type Cycle } from './engine'
import { countdown, dateBoth, hebrew, nightBoth, time, tzAt, when } from './format'
import { openSheet, useMkUI } from './store'
import { S } from './strings'
import { AskBadge, Btn, Card, cap, Dot, Section, Why, type Tone } from './ui'
import { useHer } from './useMikvah'

/**
 * Today: where she is, the next thing to do and when, mikvah night's
 * countdown, and every question still waiting for her rav.
 */
export function TodayTab() {
  const c = useHer()
  const { result, zmanim: z, stored: s, now } = c
  if (!z || !result) {
    return (
      <Card tone="ask">
        <p className="text-[14.5px]">{S.today.noHome}</p>
        <Btn className="mt-3" onClick={() => openSheet({ kind: 'settings' })}>
          {S.more.settings}
        </Btn>
      </Card>
    )
  }

  const st = statusAt(result, now, z, s)
  const next = nextThing(result, now, z, s)
  const cyc = cycleAt(result, now)
  const here = place(now, z, s).onah
  const tz = tzAt(now, z)
  const open = result.flags.filter((f) => f.ruling === null).sort((a, b) => b.at - a.at)
  const niddah = st.kind === 'waiting' || st.kind === 'counting' || st.kind === 'after_seven' || (st.kind === 'mikvah' && cyc?.immersion === null)
  const recent = result.warnings.filter((w) => w.at > now - 10 * 86_400_000 && w.at <= now)
  const upcoming = result.vestot.filter((v) => v.end > now && (v.kind !== 'or_zarua' || s.orZarua)).slice(0, 3)
  const separation = result.separation.filter((x) => x.abs >= here.abs && x.abs <= here.abs + 30)

  return (
    <div className="pb-8">
      {/* Status */}
      <Card tone={st.kind as Tone}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="mk-tone-text text-[12px] font-bold uppercase tracking-wider">{hebrew(here.abs)} · {here.half} onah</p>
            <h2 className="mt-1 text-[24px] font-bold leading-tight">
              {S.today.status[st.kind]}
              {st.day !== undefined && st.of !== undefined && (
                <span className="mk-tone-text">
                  {' '}
                  · day {st.day} of {st.of}
                </span>
              )}
            </h2>
            {!/^(Niddah — (waiting|counting), day \d+ of \d+|Tehorah)$/.test(st.line) && <p className="mk-dim mt-1 text-[13.5px]">{st.line}</p>}
          </div>
          <Why ruleId={st.ruleId} />
        </div>
        {niddah && (
          <div className="mt-3 flex items-center gap-2 border-t pt-3 text-[13px]" style={{ borderColor: 'var(--border)' }}>
            <span className="mk-dim flex-1">The harchakot apply until immersion.</span>
            <Why ruleId="HR" />
          </div>
        )}
        {st.vestot.map((v) => (
          <div key={v.key} className="mk-tone-onah mt-3 flex items-center gap-2 border-t pt-3 text-[13px]" style={{ borderColor: 'var(--border)' }}>
            <Dot tone="onah" />
            <span className="flex-1">
              <b className="mk-tone-text">Onat perishah now</b> · {vesetName(v.kind)} · until {time(v.end, tz)}
            </span>
            <Why ruleId={v.ruleId} />
          </div>
        ))}
      </Card>

      {/* What to do */}
      <Actions kind={st.kind} cycle={cyc} />

      {next && Number.isFinite(next.at) && (
        <Section title={S.today.next}>
          <Card onClick={() => goFor(next.ruleId, cyc)}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold leading-snug">{next.label}</p>
                <p className="mk-dim mt-0.5 text-[13.5px]">
                  {when(next.at, z)} · <b>{countdown(next.at - now)}</b>
                </p>
              </div>
              <Why ruleId={next.ruleId} />
            </div>
          </Card>
        </Section>
      )}

      {cyc?.mikvah && cyc.hefsek && <MikvahCard cycle={cyc} />}

      {open.length > 0 && (
        <Section title={S.today.flags}>
          {open.map((f) => (
            <Card key={f.key} tone="ask" onClick={() => openSheet({ kind: 'flag', key: f.key })}>
              <AskBadge />
              <p className="mt-1 text-[15px] font-semibold leading-snug">{f.title}</p>
              <p className="mk-dim mt-1 text-[13px] leading-snug">{f.holds}</p>
            </Card>
          ))}
        </Section>
      )}

      {(upcoming.length > 0 || separation.length > 0) && (
        <Section title={S.today.upcoming} right={<button className="mk-why" onClick={() => useMkUI.getState().setTab('onot')}>All</button>}>
          {upcoming.map((v) => (
            <Card key={v.key}>
              <div className="flex items-center gap-3">
                <Dot tone="onah" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold">
                    {cap(vesetName(v.kind))}
                    {v.number ? ` · ${v.number}` : ''}
                  </p>
                  <p className="mk-dim text-[12.5px]">
                    {v.onot.map((o) => `${hebrew(o.abs)} ${o.half}`).join(' + ')} · {when(v.start, z)}
                  </p>
                </div>
                <Why ruleId={v.ruleId} note={v.reason} />
              </div>
            </Card>
          ))}
          {separation.map((x) => (
            <Card key={`${x.abs}-${x.label}`} tone="sep">
              <div className="flex items-center gap-3">
                <Dot tone="sep" />
                <p className="min-w-0 flex-1 text-[14px]">
                  <b>{x.label}</b> · {dateBoth(x.abs)}
                </p>
                <Why ruleId={x.ruleId} />
              </div>
            </Card>
          ))}
        </Section>
      )}

      {recent.length > 0 && (
        <Section title={S.today.warnings}>
          <Warnings list={recent} />
        </Section>
      )}
    </div>
  )
}

/** Notes, one card per rule: eight missed bedikot are one note, not eight. */
function Warnings({ list }: { list: { at: number; ruleId: string; text: string }[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const groups = new Map<string, string[]>()
  for (const w of list) groups.set(w.ruleId, [...(groups.get(w.ruleId) ?? []), w.text])
  return (
    <>
      {[...groups].map(([ruleId, texts]) => (
        <Card key={ruleId}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="mk-dim text-[13.5px] leading-snug">{texts[0]}</p>
              {texts.length > 1 &&
                (open === ruleId ? (
                  texts.slice(1).map((t, i) => (
                    <p key={i} className="mk-dim mt-1 text-[13.5px] leading-snug">
                      {t}
                    </p>
                  ))
                ) : (
                  <button className="mk-why mt-2" onClick={() => setOpen(ruleId)}>
                    {texts.length - 1} more like it
                  </button>
                ))}
            </div>
            <Why ruleId={ruleId} />
          </div>
        </Card>
      ))}
    </>
  )
}

function goFor(ruleId: string, cyc: Cycle | null) {
  if (ruleId.startsWith('H') || ruleId === 'D1') return openSheet({ kind: 'hefsek' })
  if (ruleId.startsWith('N') && cyc) return openSheet({ kind: 'bedikot', cycleId: cyc.id })
  if (ruleId.startsWith('M') && cyc) return openSheet({ kind: 'mikvah', cycleId: cyc.id })
  useMkUI.getState().setTab('onot')
}

function Actions({ kind, cycle }: { kind: string; cycle: Cycle | null }) {
  const a = S.today.actions
  const buttons: { label: string; tone: Tone; go: () => void }[] = []
  if (kind === 'none' || kind === 'tehorah') buttons.push({ label: a.flow, tone: 'waiting', go: () => openSheet({ kind: 'flow' }) })
  if (kind === 'waiting' || (cycle?.hefsek && !cycle.mochConfirmed)) buttons.push({ label: a.hefsek, tone: 'waiting', go: () => openSheet({ kind: 'hefsek' }) })
  if (cycle?.hefsek && (kind === 'counting' || kind === 'after_seven' || kind === 'mikvah')) {
    buttons.push({ label: a.bedikot, tone: 'counting', go: () => openSheet({ kind: 'bedikot', cycleId: cycle.id }) })
  }
  if (cycle?.mikvah && !cycle.mikvah.withheld) {
    buttons.push({ label: a.mikvah, tone: 'mikvah', go: () => openSheet({ kind: 'mikvah', cycleId: cycle.id }) })
  }
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {buttons.map((b) => (
        <Btn key={b.label} kind="toned" tone={b.tone} onClick={b.go} className="min-h-[52px]">
          {b.label}
        </Btn>
      ))}
      <Btn onClick={() => openSheet({ kind: 'event' })} className={`min-h-[52px] ${buttons.length % 2 === 0 ? 'col-span-2' : ''}`}>
        {a.other}
      </Btn>
    </div>
  )
}

function MikvahCard({ cycle }: { cycle: Cycle }) {
  const { zmanim: z, now } = useHer()
  const mk = cycle.mikvah!
  if (mk.withheld) {
    return (
      <Section title={S.today.mikvah}>
        <Card tone="ask" onClick={() => openSheet({ kind: 'mikvah', cycleId: cycle.id })}>
          <AskBadge />
          <p className="mt-1 text-[14.5px]">Not shown until your rav answers.</p>
        </Card>
      </Section>
    )
  }
  return (
    <Section title={S.today.mikvah}>
      <Card tone="mikvah" onClick={() => openSheet({ kind: 'mikvah', cycleId: cycle.id })}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold">Night of {nightBoth(mk.abs)}</p>
            <p className="mk-dim mt-0.5 text-[13.5px]">
              After {when(mk.at, z)} · <b className="mk-tone-text">{countdown(mk.at - now)}</b>
            </p>
            {mk.moved.map((m, i) => (
              <p key={i} className="mk-dim mt-1 text-[12.5px]">
                {S.mikvah.moved}: {m.reason}
              </p>
            ))}
            {mk.waitingOn.length > 0 && (
              <p className="mt-1">
                <AskBadge />
              </p>
            )}
          </div>
          <Why ruleId={mk.moved[mk.moved.length - 1]?.ruleId ?? 'M1'} />
        </div>
      </Card>
    </Section>
  )
}
