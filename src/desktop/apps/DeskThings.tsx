import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { Avatar } from '@/components/primitives/ClaimChip'
import { useData, dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useUI, type SortKey, type WishOwner } from '@/store/useUI'
import { useNow } from '@/lib/ticker'
import { formatPrice, sumPrices } from '@/lib/money'
import { nowIso } from '@/data/adapter'
import { ItemEditSheet } from '@/apps/things/features/items/ItemEditSheet'
import { ActivityBell, ActivitySheet } from '@/apps/things/features/activity/ActivityBell'
import { SettingsSheet as ThingsSettingsSheet } from '@/apps/things/features/settings/SettingsSheet'
import { StoresSheet } from '@/apps/things/features/shopping/StoresSheet'
import { TripSheet } from '@/apps/things/features/shopping/TripSheet'
import type { Desire, TabKey, Urgency } from '@/data/types'
import { useKeys, type Binding } from '../keys'
import { ToolButton } from '../ui'
import { usePersisted } from '../persisted'
import { useDeepLink } from '../useDeepLink'
import { AddBox } from './things/AddBox'
import { DeskRow } from './things/Rows'
import { COLUMNS, buildBoard, findRow, groupOpen, navOrder, step, tableOf, type ColKey, type Column, type RowModel } from './things/model'
import '@/apps/things/things.css'

/**
 * Things on a laptop: all four lists side by side.
 *
 * On the phone the four tabs take turns at one screen. Here they are columns
 * on one board, because the reason for having four lists at all is that
 * they're all live at once — the to-do you're doing, the chore it reminded
 * you of, the thing to buy for it. Each column has its own add box at the
 * top, and any column can be hidden from the toolbar for a narrower window.
 *
 * Everything works from the keyboard: arrows or J/K move down a column, H/L
 * or ←/→ across them, X finishes, C claims, E edits, 1–3 set urgency. The
 * full editor is the phone's own ItemEditSheet, drawn as a dialog.
 */

const SORTS: Record<ColKey, { key: SortKey; label: string }[]> = {
  todos: [
    { key: 'urgency', label: 'Urgency' },
    { key: 'added', label: 'Added' },
  ],
  chores: [
    { key: 'urgency', label: 'Urgency' },
    { key: 'recurring', label: 'Repeats' },
    { key: 'added', label: 'Added' },
  ],
  shopping: [
    { key: 'urgency', label: 'Urgency' },
    { key: 'added', label: 'Added' },
  ],
  wishlist: [
    { key: 'desire', label: 'Wanted' },
    { key: 'price', label: 'Price' },
    { key: 'added', label: 'Added' },
  ],
}

type Selection = { col: ColKey; id: string } | null

export function DeskThings() {
  const todos = useData((s) => s.todos)
  const chores = useData((s) => s.chores)
  const shopping = useData((s) => s.shopping_items)
  const stores = useData((s) => s.stores)
  const wishes = useData((s) => s.wishlist_items)
  const profiles = useData((s) => s.profiles)
  const profileId = useProfile((s) => s.profileId)
  const sortBy = useUI((s) => s.sortBy)
  const sortDesc = useUI((s) => s.sortDesc)
  const wishOwner = useUI((s) => s.wishOwner)
  const openSheet = useUI((s) => s.openSheet)
  const now = useNow()

  const [shown, setShown] = usePersisted<ColKey[]>('desk:things:columns', COLUMNS.map((c) => c.key))
  const [toggled, setToggled] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Selection>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const addRefs = {
    todos: useRef<HTMLInputElement>(null),
    chores: useRef<HTMLInputElement>(null),
    shopping: useRef<HTMLInputElement>(null),
    wishlist: useRef<HTMLInputElement>(null),
  }

  const board = useMemo(
    () => buildBoard({ todos, chores, shopping_items: shopping, stores, wishlist_items: wishes, now, sortBy, sortDesc, wishOwner }),
    [todos, chores, shopping, stores, wishes, now, sortBy, sortDesc, wishOwner],
  )
  const visible = COLUMNS.filter((c) => shown.includes(c.key))

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? 'Someone'

  /** The selected row's model, if it still exists and is still reachable. */
  const current: RowModel | null = useMemo(() => {
    if (!selected) return null
    return navOrder(board[selected.col], toggled).find((r) => r.id === selected.id) ?? null
  }, [selected, board, toggled])

  // Keep the keyboard's row in view as it moves.
  useEffect(() => {
    if (!selected) return
    document.querySelector(`[data-row-id="${CSS.escape(selected.id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // A finished row leaves the list under the selection; move to whatever now
  // sits where it was, rather than leaving the keyboard pointing at nothing.
  const lastOrder = useRef<Record<ColKey, string[]>>({ todos: [], chores: [], shopping: [], wishlist: [] })
  useEffect(() => {
    if (selected && !current) {
      const at = lastOrder.current[selected.col].indexOf(selected.id)
      const rows = navOrder(board[selected.col], toggled)
      const next = rows[Math.min(Math.max(at, 0), rows.length - 1)]
      setSelected(next ? { col: selected.col, id: next.id } : null)
    }
    for (const c of COLUMNS) lastOrder.current[c.key] = navOrder(board[c.key], toggled).map((r) => r.id)
  }, [board, toggled, selected, current])

  // --- actions on one row --------------------------------------------------

  function toggle(m: RowModel) {
    if (m.kind === 'todo') void dataActions.toggleTodo(m.row, profileId)
    else if (m.kind === 'chore') void dataActions.completeChore(m.row, profileId)
    else if (m.kind === 'shop') void dataActions.toggleShoppingItem(m.row)
    else
      void dataActions.patchRow('wishlist_items', m.id, {
        is_purchased: !m.row.is_purchased,
        purchased_at: m.row.is_purchased ? null : nowIso(),
      })
  }

  function claim(m: RowModel) {
    if (!profileId || m.kind === 'wish' || m.done) return
    if (m.kind === 'chore' && m.resting) return
    void dataActions.toggleClaim(tableOf(m) as 'todos' | 'chores' | 'shopping_items', m.id, profileId, m.row.claimed_by, nameOf)
  }

  const edit = (m: RowModel) => openSheet({ kind: 'item', table: tableOf(m), id: m.id })
  const remove = (m: RowModel) => {
    setConfirming(null)
    void dataActions.remove(tableOf(m), m.id)
  }

  function setLevel(m: RowModel, level: number) {
    if (m.kind === 'wish') {
      if (level >= 1 && level <= 5) void dataActions.patchRow('wishlist_items', m.id, { desire_level: level as Desire })
      return
    }
    if (level < 1 || level > 3) return
    void dataActions.patchRow(tableOf(m) as 'todos', m.id, { urgency: (level - 1) as Urgency })
  }

  // --- moving around -------------------------------------------------------

  function move(by: 1 | -1) {
    const col = selected?.col ?? visible[0]?.key
    if (!col) return
    const next = step(navOrder(board[col], toggled), selected?.col === col ? selected.id : null, by)
    if (next) setSelected({ col, id: next.id })
  }

  function across(by: 1 | -1) {
    if (visible.length === 0) return
    const from = selected ? visible.findIndex((c) => c.key === selected.col) : -1
    const to = visible[Math.min(visible.length - 1, Math.max(0, from + by))]?.key
    if (!to) return
    // Land on the row at the same height, so ← → reads as moving sideways.
    const fromRows = selected ? navOrder(board[selected.col], toggled) : []
    const depth = selected ? Math.max(0, fromRows.findIndex((r) => r.id === selected.id)) : 0
    const rows = navOrder(board[to], toggled)
    const target = rows[Math.min(depth, rows.length - 1)]
    if (target) setSelected({ col: to, id: target.id })
    else {
      setSelected(null)
      addRefs[to].current?.focus()
    }
  }

  function focusAdd(col?: ColKey) {
    const target = col ?? selected?.col ?? visible[0]?.key
    if (!target) return
    if (!shown.includes(target)) setShown((s) => [...s, target])
    requestAnimationFrame(() => addRefs[target].current?.focus())
  }

  const withRow = (fn: (m: RowModel) => void) => () => {
    if (current) fn(current)
  }

  const bindings: Binding[] = [
    { keys: ['j', 'arrowdown'], run: () => move(1), label: 'Next item', group: 'Things' },
    { keys: ['k', 'arrowup'], run: () => move(-1), label: 'Previous item', group: 'Things' },
    { keys: ['l', 'arrowright'], run: () => across(1), label: 'Next column', group: 'Things' },
    { keys: ['h', 'arrowleft'], run: () => across(-1), label: 'Previous column', group: 'Things' },
    { keys: ['x', 'space'], run: withRow(toggle), label: 'Finish, or bring back', group: 'Things' },
    { keys: 'c', run: withRow(claim), label: 'Claim, or let go (twice to take it)', group: 'Things' },
    { keys: ['e', 'enter'], run: withRow(edit), label: 'Open the editor', group: 'Things' },
    {
      keys: ['delete', 'backspace'],
      run: withRow((m) => (confirming === m.id ? remove(m) : setConfirming(m.id))),
      label: 'Delete (press again to confirm)',
      group: 'Things',
    },
    { keys: ['1', '2', '3', '4', '5'], run: (e) => current && setLevel(current, Number(e.key)), label: 'Set urgency 1–3, or a wish’s want 1–5', group: 'Things', display: '1–5' },
    { keys: 'o', run: withRow((m) => 'url' in m.row && m.row.url && window.open(m.row.url, '_blank', 'noopener,noreferrer')), label: 'Open the item’s link', group: 'Things' },
    { keys: 'n', run: () => focusAdd(), label: 'Add to this column', group: 'Things' },
    { keys: 't', run: () => focusAdd('todos'), label: 'Add a to-do' , group: 'Things' },
    { keys: 'r', run: () => focusAdd('chores'), label: 'Add a chore', group: 'Things' },
    { keys: 's', run: () => focusAdd('shopping'), label: 'Add to shopping', group: 'Things' },
    { keys: 'w', run: () => focusAdd('wishlist'), label: 'Add a wish', group: 'Things' },
    {
      keys: 'escape',
      run: () => {
        if (confirming) setConfirming(null)
        else setSelected(null)
      },
    },
  ]
  useKeys(bindings)

  // --- deep links: a notification, or a search result ----------------------

  useDeepLink('things', (link) => {
    const tab = typeof link.tab === 'string' ? (link.tab as ColKey) : null
    const id = typeof link.id === 'string' ? link.id : null
    const target = tab && COLUMNS.some((c) => c.key === tab) ? tab : null
    if (target && !shown.includes(target)) setShown((s) => [...s, target])
    if (id) {
      const hit = findRow(board, id)
      if (!hit) return
      if (!shown.includes(hit.col)) setShown((s) => [...s, hit.col])
      // Unfold the group it's in — a search can find something already done.
      if (!groupOpen(hit.col, hit.group, toggled)) {
        setToggled((t) => new Set(t).add(`${hit.col}:${hit.group.id}`))
      }
      setSelected({ col: hit.col, id })
      setFlash(id)
      setTimeout(() => setFlash(null), 1600)
    } else if (target) {
      const first = navOrder(board[target], toggled)[0]
      if (first) setSelected({ col: target, id: first.id })
      else focusAdd(target)
    }
  })

  // --- drawing -------------------------------------------------------------

  const liveWishes = wishes.filter((w) => !w.is_purchased)
  const physicalWithItems = new Set(shopping.filter((i) => !i.is_done && i.store_id).map((i) => i.store_id))
  const routable = stores.filter((s) => !s.is_online && physicalWithItems.has(s.id)).length

  return (
    <div className="things flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pb-3 pt-5">
        <h1 className="min-w-0 text-[26px] font-bold tracking-tight">
          <span className="screen-title">Things</span>
        </h1>

        <div className="ml-2 flex items-center gap-1" role="group" aria-label="Columns">
          {COLUMNS.map((c) => {
            const on = shown.includes(c.key)
            return (
              <button
                key={c.key}
                onClick={() => setShown((s) => (on ? s.filter((k) => k !== c.key) : COLUMNS.map((x) => x.key).filter((k) => k === c.key || s.includes(k))))}
                aria-pressed={on}
                title={on ? `Hide ${c.title}` : `Show ${c.title}`}
                className="sort-chip rounded-full px-3 py-1 text-[12.5px]"
                style={{ background: on ? 'var(--accent)' : 'var(--surface-2)', color: on ? '#fff' : 'var(--text-dim)' }}
              >
                {c.title}
                <span className="ml-1.5 opacity-75">{board[c.key].count}</span>
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ToolButton icon="pin" label="Stores" onClick={() => openSheet({ kind: 'stores' })} className="rail-btn">
            Stores
          </ToolButton>
          <ToolButton
            icon="route"
            label="Plan a shopping trip"
            onClick={() => openSheet({ kind: 'trip' })}
            disabled={routable === 0}
            tone="var(--accent)"
            className="rail-btn"
          >
            Plan trip
          </ToolButton>
          <ActivityBell />
          <ToolButton icon="settings" label="Things settings" onClick={() => openSheet({ kind: 'settings' })} className="rail-btn" />
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="grid flex-1 place-items-center text-[14px]" style={{ color: 'var(--text-faint)' }}>
          Every column is hidden — turn one back on above.
        </div>
      ) : (
        <div
          className="desk-scroll grid min-h-0 flex-1 gap-4 overflow-x-auto px-6 pb-6"
          style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(250px, 1fr))` }}
        >
          {visible.map((c) => (
            <BoardColumn
              key={c.key}
              column={board[c.key]}
              toggled={toggled}
              onToggleGroup={(gid) =>
                setToggled((t) => {
                  const next = new Set(t)
                  const k = `${c.key}:${gid}`
                  if (next.has(k)) next.delete(k)
                  else next.add(k)
                  return next
                })
              }
              addRef={addRefs[c.key]}
              subtitle={
                c.key === 'wishlist' && sumPrices(liveWishes) > 0 ? `${formatPrice(sumPrices(liveWishes))} total` : undefined
              }
              extra={c.key === 'wishlist' ? <OwnerFilter /> : undefined}
              renderRow={(m) => (
                <DeskRow
                  key={m.id}
                  model={m}
                  selected={(selected?.id === m.id && selected.col === c.key) || flash === m.id}
                  confirming={confirming === m.id}
                  profiles={profiles}
                  now={now}
                  nameOf={nameOf}
                  handlers={{
                    onSelect: () => {
                      setSelected({ col: c.key, id: m.id })
                      if (confirming && confirming !== m.id) setConfirming(null)
                    },
                    onToggle: () => toggle(m),
                    onClaim: () => claim(m),
                    onEdit: () => edit(m),
                    onAskDelete: () => {
                      setSelected({ col: c.key, id: m.id })
                      setConfirming(m.id)
                    },
                    onDelete: () => remove(m),
                    onCancelDelete: () => setConfirming(null),
                  }}
                />
              )}
            />
          ))}
        </div>
      )}

      <ItemEditSheet />
      <ActivitySheet />
      <ThingsSettingsSheet />
      <StoresSheet />
      <TripSheet />
    </div>
  )
}

function BoardColumn({
  column,
  toggled,
  onToggleGroup,
  addRef,
  subtitle,
  extra,
  renderRow,
}: {
  column: Column
  toggled: ReadonlySet<string>
  onToggleGroup: (id: string) => void
  addRef: React.RefObject<HTMLInputElement | null>
  subtitle?: string
  extra?: React.ReactNode
  renderRow: (m: RowModel) => React.ReactNode
}) {
  const empty = column.groups.every((g) => g.rows.length === 0)

  return (
    <section className="desk-col flex min-h-0 flex-col rounded-[20px]" aria-label={column.title}>
      <div className="shrink-0 px-3.5 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-[19px] font-bold tracking-tight">
            <span className="screen-title !text-[20px]">{column.title}</span>
          </h2>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-faint)' }}>
            {column.count}
          </span>
          {subtitle && (
            <span className="truncate text-[12px]" style={{ color: 'var(--text-dim)' }}>
              · {subtitle}
            </span>
          )}
        </div>
        <SortChips tab={column.key} trailing={extra} />
        <AddBox col={column.key} inputRef={addRef} />
      </div>

      <div className="desk-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
        {empty ? (
          <p className="px-2 py-8 text-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
            {EMPTY[column.key]}
          </p>
        ) : (
          column.groups.map((g) => {
            const open = groupOpen(column.key, g, toggled)
            const headed = g.label !== ''
            return (
              <div key={g.id} className={headed ? 'mt-3' : ''}>
                {g.divider && (
                  <p className="flex items-center gap-1.5 px-1 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                    <Icon name="globe" size={12} strokeWidth={2.4} /> {g.divider} · not part of a trip
                  </p>
                )}
                {headed && (
                  <button onClick={() => onToggleGroup(g.id)} className="flex w-full items-center gap-2 px-1 py-1" aria-expanded={open}>
                    <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} style={{ color: 'var(--text-faint)' }}>
                      <Icon name="chevron" size={13} strokeWidth={2.6} />
                    </motion.span>
                    {g.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />}
                    <span
                      className={`${g.color ? 'text-[13.5px] font-semibold' : 'section-label text-[12px] font-semibold uppercase tracking-wide'}`}
                      style={{ color: g.color ? 'var(--text)' : 'var(--text-dim)' }}
                    >
                      {g.label}
                    </span>
                    <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                      {g.rows.length}
                    </span>
                  </button>
                )}
                {open && (
                  <div className="flex flex-col gap-2 pt-1">
                    <AnimatePresence initial={false}>{g.rows.map(renderRow)}</AnimatePresence>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

const EMPTY: Record<ColKey, string> = {
  todos: 'All clear. Type above to add the first thing.',
  chores: 'Nothing to do. Pick “how often” as you add one and it comes back on its own.',
  shopping: 'Nothing to buy. Pick a store as you add, then plan the trip.',
  wishlist: 'Nothing on the list — things you want for yourselves, not household needs.',
}

function SortChips({ tab, trailing }: { tab: TabKey; trailing?: React.ReactNode }) {
  const sortBy = useUI((s) => s.sortBy[tab])
  const desc = useUI((s) => s.sortDesc[tab])
  const setSort = useUI((s) => s.setSort)
  const toggleDir = useUI((s) => s.toggleSortDir)
  return (
    <div className="flex flex-wrap items-center gap-1 py-2" role="group" aria-label="Sort">
      <span className="pr-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        Sort
      </span>
      {SORTS[tab].map((o) => {
        const on = o.key === sortBy
        return (
          <button
            key={o.key}
            onClick={() => (on ? toggleDir(tab) : setSort(tab, o.key))}
            aria-pressed={on}
            title={on ? 'Flip the order' : `Sort by ${o.label.toLowerCase()}`}
            className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
            style={{
              background: on ? 'var(--accent-soft)' : 'transparent',
              color: on ? 'var(--accent-text)' : 'var(--text-faint)',
              border: on ? '1.5px solid var(--accent-muted)' : '1.5px solid transparent',
            }}
          >
            {o.label}
            {on && <span className="ml-0.5">{desc ? '↓' : '↑'}</span>}
          </button>
        )
      })}
      {trailing && <span className="ml-auto">{trailing}</span>}
    </div>
  )
}

/** Whose wishes are showing: everyone's, one person's, or the shared ones. */
function OwnerFilter() {
  const profiles = useData((s) => s.profiles)
  const owner = useUI((s) => s.wishOwner)
  const setOwner = useUI((s) => s.setWishOwner)
  const options: { key: WishOwner; label: string; node: React.ReactNode }[] = [
    { key: null, label: 'Everyone', node: <span className="text-[10.5px] font-bold">All</span> },
    ...profiles.map((p) => ({ key: p.id as WishOwner, label: p.display_name, node: <Avatar profile={p} size={20} /> })),
    {
      key: 'shared',
      label: 'Both of you',
      node: (
        <span className="flex items-center">
          {profiles.slice(0, 2).map((p, i) => (
            <span key={p.id} className="block h-2 w-2 rounded-full" style={{ background: p.color_hex, marginLeft: i === 0 ? 0 : -3 }} />
          ))}
        </span>
      ),
    },
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-full p-0.5" style={{ background: 'var(--surface-3)' }}>
      {options.map((o) => (
        <button
          key={String(o.key)}
          onClick={() => setOwner(o.key)}
          aria-pressed={owner === o.key}
          title={o.label}
          className="grid h-[24px] min-w-[24px] place-items-center rounded-full px-0.5"
          style={{ background: owner === o.key ? 'var(--surface)' : 'transparent', color: 'var(--text-dim)' }}
        >
          {o.node}
        </button>
      ))}
    </div>
  )
}
