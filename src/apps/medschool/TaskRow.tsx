import { useState } from 'react'
import { SwipeRow } from '@/components/primitives/SwipeRow'
import { useMembers } from '@/store/useMember'
import { renderNote, shortDay, todayDay, weekdayDay, type Anchors } from './dates'
import { toggleTask } from './actions'
import { useMsUI, type TaskView } from './store'
import { Chip, Node, StatusChip } from './ui'

/**
 * One task on the circuit. Tap the node to check it off; swipe right to do
 * the same, swipe left to edit. Tapping the row opens its note in place (on
 * the timeline) or the task itself (in Next up).
 */
export function TaskRow({
  view,
  anchors,
  first,
  last,
  expandable = true,
}: {
  view: TaskView
  anchors: Anchors | null
  first?: boolean
  last?: boolean
  expandable?: boolean
}) {
  const { task, due, status } = view
  const open = useMsUI((s) => s.open)
  const [expanded, setExpanded] = useState(false)
  const members = useMembers()
  const done = Boolean(task.done_at)
  const late = status.kind === 'late'
  const by = task.done_by ? members.find((m) => m.id === task.done_by)?.display_name : null
  const edit = () => open({ kind: 'task', taskId: task.id })

  return (
    <SwipeRow
      onComplete={() => void toggleTask(task)}
      onClaim={edit}
      claimLabel={<span className="lg-label !text-[var(--lg-cyan)]">Edit</span>}
      completeColor="var(--lg-blue)"
      onTap={() => (expandable ? setExpanded((e) => !e) : edit())}
    >
      <div className="lg-step" data-done={done} data-first={first} data-last={last}>
        <div className="lg-step-col">
          <span className="lg-step-lit" aria-hidden />
          <Node done={done} hard={task.hard} late={late} label={task.title} onToggle={() => void toggleTask(task)} />
        </div>
        <div className="lg-rule min-w-0 flex-1 py-2.5 pr-3" style={first ? { borderTop: 0 } : undefined}>
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[14.5px] leading-snug" style={done ? { color: 'var(--lg-dim)', textDecoration: 'line-through', textDecorationColor: 'var(--lg-trace)' } : undefined}>
              {task.title}
            </p>
            <StatusChip status={status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`lg-num text-[11.5px] ${late && !done ? 'lg-warn-text' : 'lg-dim'}`}>{due ? weekdayDay(due) : 'No date yet'}</span>
            <Chip>{task.area}</Chip>
            {task.estimated && <Chip title="An estimated date">est.</Chip>}
            {task.hard && <Chip tone={late && !done ? 'warn' : 'live'}>hard deadline</Chip>}
          </div>
          {expanded && (
            <div className="mt-2.5 flex flex-col gap-2.5">
              {task.note && <p className="lg-dim text-[13.5px] leading-relaxed">{renderNote(task.note, anchors)}</p>}
              {done && task.done_at && (
                <p className="lg-num lg-dim text-[11.5px]">
                  Done {shortDay(todayDay(new Date(task.done_at)))}
                  {by ? ` by ${by}` : ''}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="lg-btn lg-btn--small lg-btn--primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleTask(task)
                  }}
                >
                  {done ? 'Mark not done' : 'Mark done'}
                </button>
                <button
                  type="button"
                  className="lg-btn lg-btn--small"
                  onClick={(e) => {
                    e.stopPropagation()
                    edit()
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </SwipeRow>
  )
}
