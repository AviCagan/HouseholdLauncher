import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { useCurrentMember, useTiles } from '@/store/useMember'
import { dataActions, useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useLauncher } from '@/store/useLauncher'
import { appById } from './registry'
import { fire } from '@/lib/haptics'
import { greeting } from '@/lib/time'
import { useNow } from '@/lib/ticker'
import { formatDeadline, isOverdue } from '@/lib/deadline'
import { describeRecurrence } from '@/lib/time'
import { formatPrice } from '@/lib/money'
import { outstandingTotal, summarise } from '@/apps/owe/summary'
import { POS_ABBR, wordOfTheDay } from '@/apps/encyclopedia/lexicon'
import { occasionEmoji } from '@/apps/meals/ui'
import type { Chore, ShoppingItem, Todo, Urgency } from '@/data/types'
import {
  activeChores,
  activeShopping,
  activeTodos,
  longDate,
  restingChores,
  shoppingByStore,
  weekAhead,
} from './dashboard'

/**
 * The laptop home screen.
 *
 * On a phone, home is a grid of tiles: the apps are what you open. On a
 * laptop the apps are already in the sidebar, so home can be the thing a
 * phone never has room for — the week's meals, the to-dos, what's left to
 * buy, who owes what, today's word — all at once, with the quick things
 * doable right here. Each panel reads the same rows its app does and goes
 * through the same actions, so ticking a to-do here is ticking it there.
 *
 * Only the apps this member can see get a panel. Someone with Things alone
 * sees Things alone, same as the grid.
 */

const URGENCY_COLORS: Record<Urgency, string> = {
  0: 'var(--u-low)',
  1: 'var(--u-med)',
  2: 'var(--u-urgent)',
}

export function Dashboard() {
  const member = useCurrentMember()
  const tiles = useTiles()
  const usable = new Set(tiles.filter((t) => !t.hidden && t.supported).map((t) => t.app.id))
  const has = (id: string) => usable.has(id)
  // Keyed on the calendar day, so a window left open overnight moves on at
  // midnight rather than showing yesterday's board until it is reloaded.
  const dayKey = new Date(useNow()).toDateString()
  const today = useMemo(() => new Date(dayKey), [dayKey])

  const panels: ReactNode[] = []
  if (has('meals')) panels.push(<MealsPanel key="meals" today={today} />)
  if (has('things')) panels.push(<TodoPanel key="todos" />, <ChoresPanel key="chores" />, <ShoppingPanel key="shopping" />)
  if (has('owe')) panels.push(<OwePanel key="owe" />)
  if (has('encyclopedia')) panels.push(<WordPanel key="word" today={today} />)

  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-[1240px] px-8 pb-14 pt-8">
        <header className="flex items-end justify-between gap-6 pb-6">
          <div className="min-w-0">
            <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {greeting()}
            </p>
            <h1 className="truncate text-[32px] font-bold tracking-tight">{member?.display_name ?? 'Household'}</h1>
          </div>
          <p className="shrink-0 pb-1.5 text-[14px] font-medium" style={{ color: 'var(--text-dim)' }}>
            {longDate(today)}
          </p>
        </header>

        {panels.length === 0 ? (
          <div className="grid place-items-center gap-3 rounded-3xl px-8 py-20 text-center" style={{ border: '1px dashed var(--border-strong)' }}>
            <span style={{ color: 'var(--text-faint)', opacity: 0.5 }}>
              <Icon name="grid" size={34} />
            </span>
            <span className="text-[16px] font-semibold">Nothing to show yet</span>
            <span className="max-w-[300px] text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {tiles.length > 0
                ? 'The apps you have are hidden or need the Android app. Pick one from the sidebar, or turn one on in Settings → Apps.'
                : 'Ask Avi or Jackie to give you access to an app.'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4">{panels}</div>
        )}
      </div>
    </div>
  )
}

// --- the frame every panel sits in ---------------------------------------------

function Panel({
  appId,
  title,
  icon,
  span,
  deepLink,
  action,
  children,
}: {
  appId: string
  title: string
  icon: IconName
  /** Tailwind column classes on the 12-column grid. */
  span: string
  deepLink?: Record<string, unknown>
  action?: ReactNode
  children: ReactNode
}) {
  const openApp = useLauncher((s) => s.openApp)
  const app = appById(appId)
  const color = app?.color ?? 'var(--accent)'
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex min-w-0 flex-col rounded-3xl ${span}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]"
          style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}
        >
          <Icon name={icon} size={16} />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold">{title}</h2>
        {action}
        <button
          onClick={() => {
            fire('tap')
            openApp(appId, deepLink ?? null)
          }}
          className="desk-nav flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
          style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
        >
          Open {app?.name ?? ''}
          <Icon name="arrowRight" size={12} strokeWidth={2.6} />
        </button>
      </div>
      <div className="min-h-0 flex-1 px-4 pb-4">{children}</div>
    </motion.section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="py-5 text-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
      {children}
    </p>
  )
}

/** The done circle shared by the to-do, chore and shopping rows. */
function Tick({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full"
      style={{ border: `2px solid ${color}` }}
    />
  )
}

/** One-line add field: Enter commits and keeps focus, same as the apps' own bars. */
function QuickLine({ placeholder, onSubmit }: { placeholder: string; onSubmit: (title: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div
      className="mt-3 flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <Icon name="plus" size={14} strokeWidth={2.6} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !value.trim()) return
          e.preventDefault()
          fire('snap')
          onSubmit(value.trim())
          setValue('')
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--text-faint)]"
      />
    </div>
  )
}

// --- panels ----------------------------------------------------------------------

function MealsPanel({ today }: { today: Date }) {
  const meals = useData((s) => s.meals)
  const openApp = useLauncher((s) => s.openApp)
  const days = useMemo(() => weekAhead(meals, today), [meals, today])
  const planned = days.reduce((n, d) => n + d.meals.length, 0)

  return (
    <Panel appId="meals" title="This week's meals" icon="chef" span="col-span-12" deepLink={{ tab: 'plan' }}>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const isToday = day.label === 'Today'
          return (
            <div
              key={day.date}
              className="flex min-h-[112px] min-w-0 flex-col gap-1.5 rounded-2xl p-2.5"
              style={{
                background: day.shabbat ? 'color-mix(in oklab, #ffd166 22%, var(--surface-2))' : 'var(--surface-2)',
                border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className="truncate text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: isToday ? 'var(--accent-text)' : 'var(--text-dim)' }}
                >
                  {day.label}
                </span>
                <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {day.short}
                  {day.shabbat === 'dinner' ? ' 🕯️' : day.shabbat === 'lunch' ? ' ☀️' : ''}
                </span>
              </div>
              {day.meals.map((meal) => (
                <button
                  key={meal.id}
                  onClick={() => {
                    fire('tap')
                    openApp('meals', { tab: 'plan', id: meal.id })
                  }}
                  className="desk-nav flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[12.5px] font-semibold"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <span className="shrink-0">{meal.emoji || occasionEmoji(meal.occasion)}</span>
                  <span className="min-w-0 truncate">{meal.name}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  fire('tap')
                  openApp('meals', { tab: 'plan' })
                }}
                className="desk-nav mt-auto self-start rounded-lg px-1.5 py-0.5 text-[11.5px] font-semibold"
                style={{ color: 'var(--text-faint)' }}
              >
                {day.meals.length ? '+ Another' : '+ Plan'}
              </button>
            </div>
          )
        })}
      </div>
      {planned === 0 && <Quiet>Nothing planned yet — the Plep tab in Meals fills the week in a few taps.</Quiet>}
    </Panel>
  )
}

function TodoPanel() {
  const todos = useData((s) => s.todos)
  const profileId = useProfile((s) => s.profileId)
  const active = useMemo(() => activeTodos(todos), [todos])
  const shown = active.slice(0, 7)

  return (
    <Panel appId="things" title="To-do" icon="check" span="col-span-6 xl:col-span-4" deepLink={{ tab: 'todos' }}>
      {active.length === 0 ? (
        <Quiet>All clear.</Quiet>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((todo) => (
            <TodoLine key={todo.id} todo={todo} onDone={() => void dataActions.toggleTodo(todo, profileId)} />
          ))}
          {active.length > shown.length && <More n={active.length - shown.length} />}
        </ul>
      )}
      <QuickLine placeholder="Add a to-do…" onSubmit={(title) => void dataActions.addTodo(title, 1, profileId)} />
    </Panel>
  )
}

function TodoLine({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <Tick label={`Finish ${todo.title}`} color={URGENCY_COLORS[todo.urgency]} onClick={onDone} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{todo.title}</span>
      {todo.due_at && (
        <span
          className="flex shrink-0 items-center gap-1 text-[11.5px]"
          style={{ color: isOverdue(todo.due_at) ? 'var(--danger)' : 'var(--text-faint)' }}
        >
          <Icon name="clock" size={11} strokeWidth={2.4} />
          {formatDeadline(todo.due_at)}
        </span>
      )}
    </li>
  )
}

function ChoresPanel() {
  const chores = useData((s) => s.chores)
  const profileId = useProfile((s) => s.profileId)
  const now = useNow()
  const active = useMemo(() => activeChores(chores, now), [chores, now])
  const resting = useMemo(() => restingChores(chores, now), [chores, now])
  const shown = active.slice(0, 7)

  return (
    <Panel appId="things" title="Chores" icon="repeat" span="col-span-6 xl:col-span-4" deepLink={{ tab: 'chores' }}>
      {active.length === 0 ? (
        <Quiet>{resting.length ? 'Everything is resting.' : 'Nothing to do.'}</Quiet>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((chore) => (
            <ChoreLine key={chore.id} chore={chore} onDone={() => void dataActions.completeChore(chore, profileId)} />
          ))}
          {active.length > shown.length && <More n={active.length - shown.length} />}
        </ul>
      )}
      {resting.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          <Icon name="clock" size={12} strokeWidth={2.4} />
          {resting.length} resting
        </p>
      )}
    </Panel>
  )
}

function ChoreLine({ chore, onDone }: { chore: Chore; onDone: () => void }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <Tick label={`Finish ${chore.title}`} color={URGENCY_COLORS[chore.urgency]} onClick={onDone} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{chore.title}</span>
      {chore.is_recurring && (
        <span className="flex shrink-0 items-center gap-1 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          <Icon name="repeat" size={11} strokeWidth={2.4} />
          {describeRecurrence(chore.recurrence_count, chore.recurrence_unit, chore.recurrence_days)}
        </span>
      )}
    </li>
  )
}

function ShoppingPanel() {
  const items = useData((s) => s.shopping_items)
  const stores = useData((s) => s.stores)
  const profileId = useProfile((s) => s.profileId)
  const groups = useMemo(() => shoppingByStore(items, stores), [items, stores])
  const active = useMemo(() => activeShopping(items), [items])
  const shown = active.slice(0, 6)
  const storeName = (item: ShoppingItem) => stores.find((s) => s.id === item.store_id)?.name

  return (
    <Panel appId="things" title="Shopping" icon="cart" span="col-span-12 xl:col-span-4" deepLink={{ tab: 'shopping' }}>
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {groups.map((g) => (
            <span
              key={g.store?.id ?? 'none'}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: g.store?.color_hex ?? 'var(--text-faint)' }} />
              {g.store?.name ?? 'No store'}
              <span style={{ color: 'var(--text-faint)' }}>{g.count}</span>
            </span>
          ))}
        </div>
      )}
      {active.length === 0 ? (
        <Quiet>Nothing to buy.</Quiet>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((item) => (
            <li key={item.id} className="flex items-center gap-2.5 py-1">
              <Tick label={`Bought ${item.title}`} color={URGENCY_COLORS[item.urgency]} onClick={() => void dataActions.toggleShoppingItem(item)} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{item.title}</span>
              <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                {item.quantity ? `${item.quantity} · ` : ''}
                {storeName(item) ?? ''}
              </span>
            </li>
          ))}
          {active.length > shown.length && <More n={active.length - shown.length} />}
        </ul>
      )}
      <QuickLine placeholder="Add an item…" onSubmit={(title) => void dataActions.addShoppingItem(title, 1, null, profileId)} />
    </Panel>
  )
}

function More({ n }: { n: number }) {
  return (
    <li className="pt-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
      and {n} more
    </li>
  )
}

function OwePanel() {
  const debts = useData((s) => s.debts)
  const sides = useMemo(
    () =>
      (['owed_to_us', 'we_owe'] as const).map((direction) => ({
        direction,
        label: direction === 'owed_to_us' ? 'Owed to us' : 'We owe',
        tone: direction === 'owed_to_us' ? 'var(--ok)' : 'var(--warn)',
        total: outstandingTotal(debts, direction),
        people: summarise(debts, direction).slice(0, 3),
      })),
    [debts],
  )

  return (
    <Panel appId="owe" title="Owe & Owed" icon="wallet" span="col-span-6 xl:col-span-6">
      <div className="grid grid-cols-2 gap-3">
        {sides.map((side) => (
          <div key={side.direction} className="rounded-2xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              {side.label}
            </p>
            <p className="text-[22px] font-bold tabular-nums" style={{ color: side.total > 0 ? side.tone : 'var(--text-faint)' }}>
              {formatPrice(side.total) || '$0'}
            </p>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {side.people.map((p) => (
                <li key={p.key} className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-dim)' }}>
                    {formatPrice(p.total)}
                  </span>
                </li>
              ))}
              {side.people.length === 0 && (
                <li className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  Nobody
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function WordPanel({ today }: { today: Date }) {
  const entries = useData((s) => s.lexicon_entries)
  const openApp = useLauncher((s) => s.openApp)
  const word = useMemo(() => wordOfTheDay(entries, today), [entries, today])

  return (
    <Panel appId="encyclopedia" title="Word of the day" icon="book" span="col-span-6 xl:col-span-6" deepLink={word ? { id: word.id } : undefined}>
      {word ? (
        <button
          onClick={() => {
            fire('tap')
            openApp('encyclopedia', { id: word.id })
          }}
          className="block w-full rounded-2xl px-4 py-3 text-left"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
          }}
        >
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[22px] font-bold">{word.term}</span>
            <span className="text-[14px] italic" style={{ color: '#7c2f3a' }}>
              {POS_ABBR[word.part_of_speech]}
            </span>
          </span>
          <span className="mt-1 block text-[14.5px] leading-snug" style={{ color: 'var(--text-dim)' }}>
            {word.definition}
          </span>
          {word.example && (
            <span className="mt-1 block text-[13px] italic leading-snug" style={{ color: 'var(--text-faint)' }}>
              “{word.example}”
            </span>
          )}
        </button>
      ) : (
        <Quiet>The volume is empty — the first word is waiting to be defined.</Quiet>
      )}
    </Panel>
  )
}
