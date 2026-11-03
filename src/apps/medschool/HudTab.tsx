import { useMemo } from 'react'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import { addDays, isDay, nextCountdown, weekdayDay, type CountdownStep } from './dates'
import { loggedFor } from './actions'
import { useCounters, useMs, useMsUI, type MsModel } from './store'
import { TaskRow } from './TaskRow'
import { Chip, Gauge, Lines, Panel, Trail } from './ui'
import { amount } from './labels'

/**
 * The heads-up display: three countdowns over the grid floor, the dates
 * everything hangs off, the next six things to do, and the hours.
 */
export function HudTab() {
  const model = useMs()
  const { settings, anchors, today } = model
  const ref = settings?.reference ?? {}
  const rings = useRings(model)
  const next = model.visible.filter((v) => !v.task.done_at && v.due).slice(0, 6)

  return (
    <div className="flex flex-col gap-3 pb-6">
      <section className="lg-rez relative -mx-4 overflow-hidden px-4 pb-[72px] pt-1" aria-label="Countdowns" style={{ '--rez-i': 0 } as React.CSSProperties}>
        <div className="lg-floor" aria-hidden>
          <div className="lg-plane-wrap">
            <div className="lg-plane" />
          </div>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-1 pt-2">
          {rings.map((r) => (
            <Gauge key={r.key} countdown={r.countdown} sub={!r.countdown.finished ? weekdayDay(r.countdown.date) : undefined} />
          ))}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Key dates" rez={1}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
            <KeyDate label="Test date" value={settings?.test_date ?? null}>
              <Chip tone={settings?.booked ? 'ok' : 'warn'}>{settings?.booked ? 'Booked' : 'Not booked'}</Chip>
            </KeyDate>
            <KeyDate label="Score release" value={anchors?.score ?? null} />
            <KeyDate label="Earliest interview" value={anchors?.csiInterview ?? null} />
            <KeyDate label="Committee letter out" value={anchors?.csiLetter ?? null} />
          </dl>
          {settings?.test_date && !anchors && (
            <p className="lg-warn-text mt-3 text-[12.5px]">The test date isn't in the MCAT calendar, so the dates that hang off it are blank. Pick one in the MCAT tab.</p>
          )}
        </Panel>

        <HoursPanel />
      </div>

      <Panel title="Next up" rez={3} edge={next.some((v) => v.status.kind === 'late') ? 'warn' : 'live'}>
        {next.length === 0 ? (
          <p className="lg-dim py-2 text-[13.5px]">Nothing open. Everything with a date is done.</p>
        ) : (
          <div className="-mx-2">
            {next.map((v, i) => (
              <TaskRow key={v.task.id} view={v} anchors={anchors} first={i === 0} last={i === next.length - 1} expandable={false} />
            ))}
          </div>
        )}
      </Panel>

      {(ref.decisions?.length ?? 0) > 0 && (
        <Panel rez={4}>
          <details>
            <summary className="lg-label flex min-h-[36px] cursor-pointer items-center">Decisions · {ref.decisions!.length}</summary>
            <div className="pt-2">
              <Lines items={ref.decisions!} />
            </div>
          </details>
        </Panel>
      )}
      <p className="lg-num lg-dim text-center text-[11px]">Today {weekdayDay(today)}</p>
    </div>
  )
}

function KeyDate({ label, value, children }: { label: string; value: string | null; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="lg-label !text-[10.5px]">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span className="lg-num text-[14px]">{value ? weekdayDay(value) : '—'}</span>
        {children}
      </dd>
    </div>
  )
}

function HoursPanel() {
  const counters = useCounters()
  const logs = useData((s) => s.ms_counter_logs)
  const setTab = useMsUI((s) => s.setTab)
  return (
    <Panel
      title="Committee file"
      rez={2}
      action={
        <button
          type="button"
          className="lg-btn lg-btn--small lg-btn--ghost"
          onClick={() => {
            fire('snap')
            setTab('file')
          }}
        >
          Open
        </button>
      }
    >
      {counters.length === 0 ? (
        <p className="lg-dim text-[13.5px]">No counters yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {counters.map((c) => {
            const total = c.undated + loggedFor(c.id, logs)
            return (
              <button
                type="button"
                key={c.id}
                className="block text-left"
                onClick={() => {
                  fire('snap')
                  setTab('file')
                }}
              >
                <span className="flex items-baseline gap-2 pb-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.label}</span>
                  <span className="lg-num text-[12.5px]">
                    <span className="lg-live">{Math.round(total * 100) / 100}</span>
                    <span className="lg-dim"> / {amount(c.target, c.unit)}</span>
                  </span>
                </span>
                <Trail value={total} max={c.target} cap={c.cap} label={`${c.label}: ${total} of ${c.target}`} />
              </button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/**
 * The three countdowns. Each is a chain: when one milestone passes — or its
 * task is done — the ring moves on to the next, so it never counts below
 * zero.
 */
function useRings(model: MsModel) {
  const { views, anchors, today, settings } = model
  return useMemo(() => {
    const ref = settings?.reference ?? {}
    const spanStart = isDay(ref.snapshotDate) ? ref.snapshotDate : addDays(today, -90)
    const task = (label: string, id: string): CountdownStep => {
      const v = views.find((x) => x.task.id === id)
      return { label, date: v?.due ?? null, doneEarly: Boolean(v?.task.done_at) }
    }
    const at = (label: string, date: string | undefined): CountdownStep => ({ label, date: date ?? null })
    return [
      {
        key: 'mcat',
        countdown: nextCountdown([at('Days to MCAT', anchors?.T), at('Days to scores', anchors?.score)], today, spanStart, 'Scores are out'),
      },
      {
        key: 'committee',
        countdown: nextCountdown(
          [
            task('Days to request the interview', 't-request'),
            at('Days to file complete', anchors?.csiFile),
            at('Days to committee interview', anchors?.csiInterview),
            at('Days to committee letter', anchors?.csiLetter),
          ],
          today,
          spanStart,
          'Committee letter out',
        ),
      },
      {
        key: 'apply',
        countdown: nextCountdown(
          [
            task('Days to AMCAS submissions', 'a-amcas-submit'),
            task('Days to submit AACOMAS', 'a-aacomas-submit'),
            task('Days to MD acceptances', 'a-acceptances'),
            task('Days to commit', 'a-commit'),
            task('Days to med school', 'a-start'),
          ],
          today,
          spanStart,
          'Med school',
        ),
      },
    ]
  }, [views, anchors, today, settings])
}
