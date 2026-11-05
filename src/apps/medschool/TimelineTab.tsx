import { useMemo, useState } from 'react'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import { monthKey, monthLabel, weekdayDay } from './dates'
import { setHidden } from './actions'
import { useMs, useMsUI, type TaskView } from './store'
import { datedSteps, type StepView } from './experiences'
import { StepRow } from './ExperiencesTab'
import { TaskRow } from './TaskRow'
import { Chip, Panel, Switch } from './ui'
import { AREAS } from './labels'

/**
 * Every task by month on one circuit, with a done/total count for each
 * month. Area chips narrow it down; done tasks can be shown or not.
 */
/** A row on the circuit: a task, or a dated onboarding step from an experience. */
type Item = { kind: 'task'; view: TaskView; due: string | null; done: boolean } | { kind: 'step'; view: StepView; due: string | null; done: boolean }

export function TimelineTab() {
  const { visible, views, anchors, today } = useMs()
  const steps = useData((s) => s.ms_experience_steps)
  const experiences = useData((s) => s.ms_experiences)
  const stepViews = useMemo(() => datedSteps(steps, experiences, today), [steps, experiences, today])
  const open = useMsUI((s) => s.open)
  const [areas, setAreas] = useState<string[]>([])
  const [showDone, setShowDone] = useState(true)

  const present = useMemo(() => {
    const seen = new Set(views.map((v) => v.task.area))
    if (stepViews.length) seen.add('Hours')
    return [...AREAS.filter((a) => seen.has(a)), ...[...seen].filter((a) => !AREAS.includes(a)).sort()]
  }, [views, stepViews])

  const months = useMemo(() => {
    const items: Item[] = [
      ...visible.filter((v) => areas.length === 0 || areas.includes(v.task.area)).map((v): Item => ({ kind: 'task', view: v, due: v.due, done: Boolean(v.task.done_at) })),
      ...(areas.length === 0 || areas.includes('Hours') ? stepViews : []).map((v): Item => ({ kind: 'step', view: v, due: v.step.due_on, done: Boolean(v.step.done_at) })),
    ].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    const groups = new Map<string, Item[]>()
    for (const item of items) {
      const key = item.due ? monthKey(item.due) : 'undated'
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'undated' ? 1 : b === 'undated' ? -1 : a.localeCompare(b)))
      .map(([key, all]) => ({
        key,
        label: key === 'undated' ? 'No date yet' : monthLabel(`${key}-01`),
        done: all.filter((i) => i.done).length,
        total: all.length,
        shown: showDone ? all : all.filter((i) => !i.done),
      }))
  }, [visible, stepViews, areas, showDone])

  const hidden = views.filter((v) => v.task.hidden)

  const toggleArea = (a: string) => {
    fire('tap')
    setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]))
  }

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="lg-rez flex flex-col gap-2" style={{ '--rez-i': 0 } as React.CSSProperties}>
        <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1" role="group" aria-label="Areas">
          <button type="button" className="lg-filter" aria-pressed={areas.length === 0} onClick={() => setAreas([])}>
            All
          </button>
          {present.map((a) => (
            <button key={a} type="button" className="lg-filter" aria-pressed={areas.includes(a)} onClick={() => toggleArea(a)}>
              {a}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex flex-1 items-center gap-2.5">
            <Switch on={showDone} onChange={setShowDone} label="Show done" />
            <span className="text-[13.5px]">Show done</span>
          </span>
          <button type="button" className="lg-btn lg-btn--small lg-btn--primary" onClick={() => open({ kind: 'task', taskId: null })}>
            Add task
          </button>
        </div>
      </div>

      {months.length === 0 && (
        <Panel rez={1}>
          <p className="lg-dim text-[13.5px]">Nothing in {areas.join(', ')}.</p>
        </Panel>
      )}

      {months.map((m, i) => (
        <Panel
          key={m.key}
          rez={Math.min(i + 1, 6)}
          title={m.label}
          action={
            <span className="lg-num text-[12px]">
              <span className={m.done === m.total ? 'lg-live' : ''}>{m.done}</span>
              <span className="lg-dim">/{m.total}</span>
            </span>
          }
        >
          {m.shown.length === 0 ? (
            <p className="lg-dim text-[13px]">All done this month.</p>
          ) : (
            <div className="-mx-2">
              {m.shown.map((item, j) =>
                item.kind === 'task' ? (
                  <TaskRow key={item.view.task.id} view={item.view} anchors={anchors} first={j === 0} last={j === m.shown.length - 1} />
                ) : (
                  <StepRow key={`step-${item.view.step.id}`} view={item.view} first={j === 0} last={j === m.shown.length - 1} />
                ),
              )}
            </div>
          )}
        </Panel>
      ))}

      {hidden.length > 0 && (
        <Panel title={`Hidden · ${hidden.length}`} rez={6}>
          <div className="flex flex-col">
            {hidden.map((v) => (
              <div key={v.task.id} className="lg-rule flex min-h-[52px] items-center gap-3 py-1.5 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="lg-dim block text-[13.5px]">{v.task.title}</span>
                  <span className="mt-0.5 flex gap-1.5">
                    <span className="lg-num lg-dim text-[11px]">{v.due ? weekdayDay(v.due) : '—'}</span>
                    <Chip>{v.task.area}</Chip>
                  </span>
                </span>
                <button type="button" className="lg-btn lg-btn--small" onClick={() => void setHidden(v.task, false)}>
                  Show
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
