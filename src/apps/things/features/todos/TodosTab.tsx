import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Screen, Section, EmptyState } from '@/components/shell/Screen'
import { ListRow } from '@/components/primitives/ListRow'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useUI } from '@/store/useUI'
import { SortBar, compareBy } from '@/components/shell/SortBar'
import { formatDeadline, isOverdue } from '@/lib/deadline'

export function TodosTab() {
  const todos = useData((s) => s.todos)
  const profiles = useData((s) => s.profiles)
  const profileId = useProfile((s) => s.profileId)

  const sortBy = useUI((s) => s.sortBy.todos)
  const desc = useUI((s) => s.sortDesc.todos)

  const { active, done } = useMemo(() => {
    const sorted = [...todos].sort(compareBy(sortBy, desc))
    return {
      active: sorted.filter((t) => !t.is_done),
      done: sorted
        .filter((t) => t.is_done)
        .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
    }
  }, [todos, sortBy, desc])

  const nameOf = (id: string) =>
    profiles.find((p) => p.id === id)?.display_name ?? 'Someone'

  return (
    <Screen title="To-do" count={active.length}>
      <SortBar
        tab="todos"
        options={[
          { key: 'urgency', label: 'Urgency' },
          { key: 'added', label: 'Added' },
        ]}
      />
      {active.length === 0 && done.length === 0 ? (
        <EmptyState
          icon={<Icon name="check" size={44} strokeWidth={1.5} />}
          title="All clear"
          hint="Type below to add the first thing. Swipe a row right to finish it, left to claim it."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {active.map((todo) => (
              <motion.div
                key={todo.id}
                layout
                layoutId={`todo-${todo.id}`}
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              >
                <ListRow
                  table="todos"
                  id={todo.id}
                  title={todo.title}
                  urgency={todo.urgency}
                  claimedBy={todo.claimed_by}
                  profiles={profiles}
                  meta={
                    todo.due_at ? (
                      <span
                        className="flex items-center gap-1"
                        style={{
                          // Only a missed deadline gets the alarm colour;
                          // everything else stays quiet so the list doesn't
                          // read as a wall of warnings.
                          color: isOverdue(todo.due_at)
                            ? 'var(--danger)'
                            : 'var(--text-dim)',
                        }}
                      >
                        <Icon name="clock" size={11} strokeWidth={2.4} />
                        {formatDeadline(todo.due_at)}
                      </span>
                    ) : undefined
                  }
                  onComplete={() => dataActions.toggleTodo(todo, profileId)}
                  onClaim={() =>
                    profileId &&
                    dataActions.toggleClaim(
                      'todos',
                      todo.id,
                      profileId,
                      todo.claimed_by,
                      nameOf,
                    )
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Section label="Done" count={done.length}>
        {done.map((todo) => (
          <ListRow
            key={todo.id}
            table="todos"
            id={todo.id}
            title={todo.title}
            urgency={todo.urgency}
            claimedBy={todo.claimed_by}
            profiles={profiles}
            done
            meta={
              todo.completed_by ? (
                <span>Finished by {nameOf(todo.completed_by)}</span>
              ) : undefined
            }
            trailing={
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void dataActions.remove('todos', todo.id)
                }}
                aria-label="Delete"
                className="grid h-8 w-8 place-items-center rounded-full"
                style={{ color: 'var(--text-faint)' }}
              >
                <Icon name="trash" size={16} />
              </button>
            }
            onComplete={() => dataActions.toggleTodo(todo, profileId)}
            onClaim={() => {}}
          />
        ))}
      </Section>
    </Screen>
  )
}
