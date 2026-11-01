import { useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useLauncher } from '@/store/useLauncher'
import { markRead, useCurrentMember, useInbox, useTiles } from '@/store/useMember'
import { appById, appName } from '@/launcher/registry'
import { greeting, isResting, describeRecurrence } from '@/lib/time'
import { formatDeadline, isOverdue } from '@/lib/deadline'
import { formatPrice } from '@/lib/money'
import { useNow } from '@/lib/ticker'
import { normalizeUrgency, type Todo, type Urgency } from '@/data/types'
import { openDebts, outstandingTotal, summarise } from '@/apps/owe/summary'
import { wordOfTheDay, POS_ABBR } from '@/apps/encyclopedia/lexicon'
import { mealsOn, isoDate, addDays } from '@/apps/meals/plan'
import { Kbd } from './ui'

/**
 * Home, on a laptop: what's going on across every app, on one screen.
 *
 * The phone's home is a grid of doors. With the sidebar always showing the
 * doors, this page can be the room behind all of them at once — what's
 * urgent, what chore is ready, what's on the shopping list, what's for dinner
 * this week, where the lineup is, who owes what. Each card opens its app, and
 * the common action is right on the card: a to-do can be ticked off from
 * here, and the box at the top adds to any list without opening anything.
 */
export function Overview({ onOpenPalette }: { onOpenPalette: () => void }) {
  const member = useCurrentMember()
  const tiles = useTiles().filter((t) => !t.hidden && t.supported)
  const can = (id: string) => tiles.some((t) => t.app.id === id)
  const today = new Date()

  return (
    <div className="desk-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] px-8 pb-12 pt-8">
        <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
          <div>
            <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {greeting()} · {today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-[30px] font-bold tracking-tight">{member?.display_name ?? 'Household'}</h1>
          </div>
          <button
            onClick={onOpenPalette}
            className="desk-hover flex items-center gap-2 rounded-xl px-3 py-2 text-[13px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
          >
            <Icon name="search" size={15} /> Find anything <Kbd combo="mod+k" />
          </button>
        </header>

        {can('things') && <QuickAddAnywhere />}

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {can('things') && <TodoCard />}
          {can('things') && <ChoreCard />}
          {can('things') && <ShoppingCard />}
          {can('meals') && <MealsCard />}
          {can('watched') && <WatchedCard />}
          {can('owe') && <OweCard />}
          {can('encyclopedia') && <WordCard />}
          <InboxCard />
        </div>

        {tiles.length === 0 && (
          <p className="py-16 text-center text-[14px]" style={{ color: 'var(--text-faint)' }}>
            No apps yet. Ask Avi or Jackie to give you access to one.
          </p>
        )}
      </div>
    </div>
  )
}

// --- the add box ------------------------------------------------------------

type Target = 'todo' | 'shopping' | 'chore'
const TARGETS: { id: Target; label: string; icon: IconName }[] = [
  { id: 'todo', label: 'To-do', icon: 'check' },
  { id: 'shopping', label: 'Shopping', icon: 'cart' },
  { id: 'chore', label: 'Chore', icon: 'repeat' },
]

/** Type, Enter. Tab cycles where it goes. Keeps focus for the next one. */
function QuickAddAnywhere() {
  const profileId = useProfile((s) => s.profileId)
  const [value, setValue] = useState('')
  const [target, setTarget] = useState<Target>('todo')
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    const title = value.trim()
    if (!title) return
    if (target === 'todo') void dataActions.addTodo(title, 1, profileId)
    if (target === 'shopping') void dataActions.addShoppingItem(title, 1, null, profileId)
    if (target === 'chore') void dataActions.addChore(title, 1, profileId, null)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div
      className="mb-6 flex items-center gap-2 rounded-2xl p-2"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <span className="pl-2" style={{ color: 'var(--text-faint)' }}>
        <Icon name="plus" size={18} />
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Tab' && !e.shiftKey && value) {
            // Tab picks the list while there's something typed; with an empty
            // box it moves focus on as usual.
            e.preventDefault()
            setTarget((t) => TARGETS[(TARGETS.findIndex((x) => x.id === t) + 1) % TARGETS.length].id)
          }
        }}
        placeholder={`Add to ${TARGETS.find((t) => t.id === target)!.label.toLowerCase()}…`}
        aria-label="Add something"
        className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[15px] outline-none placeholder:text-[var(--text-faint)]"
      />
      <div className="flex shrink-0 gap-1 rounded-xl p-1" style={{ background: 'var(--surface-2)' }} role="radiogroup" aria-label="Add to">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={target === t.id}
            onClick={() => {
              setTarget(t.id)
              inputRef.current?.focus()
            }}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold"
            style={{
              background: target === t.id ? 'var(--surface)' : 'transparent',
              color: target === t.id ? 'var(--text)' : 'var(--text-faint)',
              boxShadow: target === t.id ? '0 1px 2px rgb(0 0 0 / 0.12)' : undefined,
            }}
          >
            <Icon name={t.icon} size={13} strokeWidth={2.4} />
            {t.label}
          </button>
        ))}
      </div>
      <span className="hidden pr-1 text-[11.5px] lg:block" style={{ color: 'var(--text-faint)' }}>
        <Kbd combo="tab" /> switch
      </span>
    </div>
  )
}

// --- cards ------------------------------------------------------------------

function Card({
  appId,
  title,
  count,
  children,
  footer,
  deepLink,
}: {
  appId: string
  title: string
  count?: ReactNode
  children: ReactNode
  footer?: ReactNode
  deepLink?: Record<string, unknown>
}) {
  const openApp = useLauncher((s) => s.openApp)
  const app = appById(appId)
  const color = app?.color ?? 'var(--accent)'
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[220px] flex-col rounded-2xl"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => openApp(appId, deepLink ?? null)}
        className="desk-hover flex items-center gap-2.5 rounded-t-2xl px-4 pb-2.5 pt-3.5 text-left"
        title={`Open ${app?.name ?? appId}`}
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          style={{ background: `color-mix(in oklab, ${color} 20%, transparent)`, color }}
        >
          {app?.logo ? <app.logo size={20} /> : <Icon name={app?.icon ?? 'grid'} size={15} strokeWidth={2.2} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{title}</span>
        {count !== undefined && (
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-faint)' }}>
            {count}
          </span>
        )}
        <span style={{ color: 'var(--text-faint)' }}>
          <Icon name="chevron" size={14} />
        </span>
      </button>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">{children}</div>
      {footer && (
        <div className="px-4 pb-3.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {footer}
        </div>
      )}
    </motion.section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="grid flex-1 place-items-center py-6 text-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
      {children}
    </p>
  )
}

const URGENCY_COLOR: Record<Urgency, string> = { 0: 'var(--u-low)', 1: 'var(--u-med)', 2: 'var(--u-urgent)' }

function Dot({ urgency }: { urgency: Urgency }) {
  const u = normalizeUrgency(urgency)
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: URGENCY_COLOR[u] }} aria-label={['Low', 'Medium', 'Urgent'][u]} />
}

/** Overdue first, then urgent, then soonest deadline, then newest. */
function todoRank(a: Todo, b: Todo): number {
  const ao = a.due_at && isOverdue(a.due_at) ? 1 : 0
  const bo = b.due_at && isOverdue(b.due_at) ? 1 : 0
  if (ao !== bo) return bo - ao
  if (a.urgency !== b.urgency) return b.urgency - a.urgency
  if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at)
  if (a.due_at || b.due_at) return a.due_at ? -1 : 1
  return b.sort_order - a.sort_order
}

function TodoCard() {
  const todos = useData((s) => s.todos)
  const profileId = useProfile((s) => s.profileId)
  const open = useMemo(() => todos.filter((t) => !t.is_done).sort(todoRank), [todos])
  const overdue = open.filter((t) => t.due_at && isOverdue(t.due_at)).length

  return (
    <Card appId="things" title="To-do" count={open.length} deepLink={{ tab: 'todos' }} footer={overdue > 0 ? `${overdue} overdue` : undefined}>
      {open.length === 0 ? (
        <Quiet>All clear.</Quiet>
      ) : (
        <ul className="flex flex-col">
          {open.slice(0, 6).map((t) => (
            <li key={t.id} className="flex items-center gap-2.5 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <button
                onClick={() => void dataActions.toggleTodo(t, profileId)}
                aria-label={`Finish ${t.title}`}
                title="Mark done"
                className="desk-hover grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full"
                style={{ border: '2px solid var(--border-strong)' }}
              />
              <Dot urgency={t.urgency} />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{t.title}</span>
              {t.due_at && (
                <span
                  className="shrink-0 text-[11.5px]"
                  style={{ color: isOverdue(t.due_at) ? 'var(--danger)' : 'var(--text-faint)' }}
                >
                  {formatDeadline(t.due_at)}
                </span>
              )}
            </li>
          ))}
          {open.length > 6 && (
            <li className="pt-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              and {open.length - 6} more
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}

function ChoreCard() {
  const chores = useData((s) => s.chores)
  const now = useNow()
  const ready = useMemo(
    () => chores.filter((c) => !c.is_done && !isResting(c, now)).sort((a, b) => b.urgency - a.urgency),
    [chores, now],
  )
  const resting = chores.filter((c) => isResting(c, now)).length

  return (
    <Card appId="things" title="Chores ready" count={ready.length} deepLink={{ tab: 'chores' }} footer={resting > 0 ? `${resting} resting until they're due again` : undefined}>
      {ready.length === 0 ? (
        <Quiet>Nothing needs doing.</Quiet>
      ) : (
        <ul className="flex flex-col">
          {ready.slice(0, 6).map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <Dot urgency={c.urgency} />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.title}</span>
              {c.is_recurring && (
                <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                  {describeRecurrence(c.recurrence_count, c.recurrence_unit, c.recurrence_days)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ShoppingCard() {
  const items = useData((s) => s.shopping_items)
  const stores = useData((s) => s.stores)
  const groups = useMemo(() => {
    const active = items.filter((i) => !i.is_done)
    const byStore = new Map<string | null, number>()
    for (const i of active) byStore.set(i.store_id, (byStore.get(i.store_id) ?? 0) + 1)
    const rows = [...byStore.entries()].map(([id, n]) => {
      const store = stores.find((s) => s.id === id)
      return { id, name: store?.name ?? 'No store yet', color: store?.color_hex ?? '#8e8e9c', n }
    })
    return { total: active.length, rows: rows.sort((a, b) => b.n - a.n), latest: active.slice(-4).reverse() }
  }, [items, stores])

  return (
    <Card appId="things" title="Shopping" count={groups.total} deepLink={{ tab: 'shopping' }}>
      {groups.total === 0 ? (
        <Quiet>Nothing to buy.</Quiet>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 pb-2">
            {groups.rows.map((r) => (
              <span
                key={r.id ?? 'none'}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={{ background: `color-mix(in oklab, ${r.color} 16%, transparent)` }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.name}
                <span style={{ color: 'var(--text-faint)' }}>{r.n}</span>
              </span>
            ))}
          </div>
          <ul className="flex flex-col">
            {groups.latest.map((i) => (
              <li key={i.id} className="flex items-center gap-2.5 py-1.5 text-[13.5px]" style={{ borderBottom: '1px solid var(--border)' }}>
                <Dot urgency={i.urgency} />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                {i.quantity && (
                  <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                    {i.quantity}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function MealsCard() {
  const meals = useData((s) => s.meals)
  const days = useMemo(() => {
    const start = isoDate(new Date())
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i)
      return { date, meals: mealsOn(meals, date) }
    })
  }, [meals])
  const planned = days.filter((d) => d.meals.length > 0).length

  return (
    <Card appId="meals" title="This week's food" count={`${planned}/7 days`} deepLink={{ tab: 'plan' }}>
      <ul className="flex flex-col">
        {days.map((d, i) => {
          const when = new Date(`${d.date}T12:00:00`)
          return (
            <li key={d.date} className="flex items-center gap-3 py-1.5 text-[13.5px]" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="w-[74px] shrink-0 text-[12px] font-semibold" style={{ color: i === 0 ? 'var(--accent-text)' : 'var(--text-faint)' }}>
                {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: d.meals.length ? 'var(--text)' : 'var(--text-faint)' }}>
                {d.meals.length ? d.meals.map((m) => `${m.emoji} ${m.name}`).join(' · ') : '—'}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function WatchedCard() {
  const shows = useData((s) => s.watch_shows)
  const playing = useMemo(() => shows.filter((s) => s.stage === 'watching').sort((a, b) => a.lineup_order - b.lineup_order), [shows])
  const lineup = shows.filter((s) => s.stage === 'lineup').length
  const shelf = shows.filter((s) => s.stage === 'shelf').length

  return (
    <Card appId="watched" title="On air" count={playing.length || undefined} deepLink={{ tab: 'onair' }} footer={`${lineup} in the lineup · ${shelf} waiting on a shelf`}>
      {playing.length === 0 ? (
        <Quiet>Nothing playing right now.</Quiet>
      ) : (
        <ul className="flex flex-col gap-2">
          {playing.slice(0, 4).map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              {s.poster_url ? (
                <img src={s.poster_url} alt="" className="h-12 w-8 shrink-0 rounded object-cover" loading="lazy" />
              ) : (
                <span className="grid h-12 w-8 shrink-0 place-items-center rounded" style={{ background: 'var(--surface-3)' }}>
                  <Icon name="tv" size={14} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{s.title}</span>
                <span className="block text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  {s.current_season ? `Season ${s.current_season} · ${s.current_episode} watched` : 'Just started'}
                  {s.live ? ' · weekly' : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function OweCard() {
  const debts = useData((s) => s.debts)
  const inbound = outstandingTotal(debts, 'owed_to_us')
  const outbound = outstandingTotal(debts, 'we_owe')
  const people = useMemo(
    () =>
      [...summarise(debts, 'owed_to_us').map((p) => ({ ...p, dir: 'in' as const })), ...summarise(debts, 'we_owe').map((p) => ({ ...p, dir: 'out' as const }))]
        .sort((a, b) => b.total - a.total)
        .slice(0, 4),
    [debts],
  )
  const open = openDebts(debts, 'owed_to_us').length + openDebts(debts, 'we_owe').length

  return (
    <Card appId="owe" title="Owe & Owed" count={open || undefined}>
      <div className="grid grid-cols-2 gap-2 pb-2">
        <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
          <span className="block text-[11.5px] font-semibold" style={{ color: 'var(--text-faint)' }}>
            Owed to us
          </span>
          <span className="block text-[19px] font-bold tabular-nums" style={{ color: inbound ? 'var(--ok)' : 'var(--text-faint)' }}>
            {formatPrice(inbound) || '$0'}
          </span>
        </div>
        <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
          <span className="block text-[11.5px] font-semibold" style={{ color: 'var(--text-faint)' }}>
            We owe
          </span>
          <span className="block text-[19px] font-bold tabular-nums" style={{ color: outbound ? 'var(--warn)' : 'var(--text-faint)' }}>
            {formatPrice(outbound) || '$0'}
          </span>
        </div>
      </div>
      {people.length === 0 ? (
        <Quiet>All square.</Quiet>
      ) : (
        <ul className="flex flex-col">
          {people.map((p) => (
            <li key={`${p.dir}:${p.key}`} className="flex items-center gap-2 py-1.5 text-[13.5px]" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                {p.dir === 'in' ? 'owes us' : 'we owe'}
              </span>
              <span className="w-[76px] text-right font-semibold tabular-nums" style={{ color: p.dir === 'in' ? 'var(--ok)' : 'var(--warn)' }}>
                {formatPrice(p.total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function WordCard() {
  const entries = useData((s) => s.lexicon_entries)
  const word = useMemo(() => wordOfTheDay(entries, new Date()), [entries])
  return (
    <Card appId="encyclopedia" title="Word of the day" count={entries.length ? `${entries.length} ${entries.length === 1 ? 'word' : 'words'}` : undefined} deepLink={word ? { id: word.id } : undefined}>
      {!word ? (
        <Quiet>The dictionary is empty. The first word is waiting.</Quiet>
      ) : (
        <div className="lex flex-1 rounded-xl px-4 py-3" style={{ backgroundImage: 'none' }}>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="lex-headword text-[22px]">{word.term}</span>
            {POS_ABBR[word.part_of_speech] && <span className="lex-pos text-[14px]">{POS_ABBR[word.part_of_speech]}</span>}
          </span>
          <p className="mt-1 text-[14.5px] leading-snug">{word.definition}</p>
          {word.example && (
            <p className="mt-1.5 text-[13.5px] italic leading-snug" style={{ color: 'var(--lex-ink-dim)' }}>
              “{word.example}”
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function InboxCard() {
  const items = useInbox()
  const setInbox = useLauncher((s) => s.setInbox)
  const openApp = useLauncher((s) => s.openApp)
  const unread = items.filter((n) => !n.read_at)

  return (
    <section className="flex min-h-[220px] flex-col rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <button onClick={() => setInbox(true)} className="desk-hover flex items-center gap-2.5 rounded-t-2xl px-4 pb-2.5 pt-3.5 text-left">
        <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>
          <Icon name="bell" size={15} />
        </span>
        <span className="flex-1 text-[14.5px] font-bold">Notifications</span>
        {unread.length > 0 && (
          <span className="grid h-[20px] min-w-[20px] place-items-center rounded-full px-1.5 text-[10.5px] font-bold text-white" style={{ background: 'var(--danger)' }}>
            {unread.length}
          </span>
        )}
        <span style={{ color: 'var(--text-faint)' }}>
          <Icon name="chevron" size={14} />
        </span>
      </button>
      <div className="flex flex-1 flex-col px-4 pb-3">
        {items.length === 0 ? (
          <Quiet>Nothing new.</Quiet>
        ) : (
          <ul className="flex flex-col">
            {items.slice(0, 5).map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    if (!n.read_at) void markRead([n.id])
                    if (appById(n.app_id)) openApp(n.app_id, n.deep_link)
                  }}
                  className="desk-hover flex w-full items-start gap-2.5 rounded-lg px-1 py-1.5 text-left"
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: n.read_at ? 'transparent' : 'var(--accent)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{n.title}</span>
                    <span className="block truncate text-[12px]" style={{ color: 'var(--text-faint)' }}>
                      {appName(n.app_id)}
                      {n.body ? ` · ${n.body}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
