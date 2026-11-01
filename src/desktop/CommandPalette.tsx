import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useLauncher, type SettingsSection } from '@/store/useLauncher'
import { useTiles } from '@/store/useMember'
import { useMealsUI } from '@/apps/meals/store'
import { useWatchUI } from '@/apps/watched/store'
import { pushDialog } from '@/lib/dialogStack'
import { searchEverything } from './search'
import { APP_KEYS } from './appKeys'
import { Kbd } from './ui'

/**
 * ⌘K: one box that finds anything and adds anything.
 *
 * Three kinds of row, in this order:
 *
 *   Add — what you typed, as a new to-do, shopping item, chore, wish, word
 *         or show. Typing "oat milk" and pressing Enter puts it on the
 *         to-do list without leaving whatever you were looking at.
 *   Found — every row in every app you can open whose name matches, opened
 *         in its own app on Enter.
 *   Go to — apps and settings, by name.
 *
 * With nothing typed it is a menu of everywhere you can go and everything
 * you can start.
 */

interface Command {
  key: string
  group: 'Add' | 'Found' | 'Go to' | 'Start'
  label: string
  hint?: string
  icon: IconName
  color?: string
  combo?: string
  run: () => void
}

const SETTINGS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'Settings — General' },
  { id: 'apps', label: 'Settings — Apps' },
  { id: 'people', label: 'Settings — People' },
  { id: 'notifications', label: 'Settings — Alerts' },
  { id: 'about', label: 'Settings — About' },
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <AnimatePresence>{open && <Palette onClose={onClose} />}</AnimatePresence>
}

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const profileId = useProfile((s) => s.profileId)
  const { openApp, goHome, setInbox, openSettings } = useLauncher()
  const tiles = useTiles().filter((t) => t.supported)
  const can = (id: string) => tiles.some((t) => t.app.id === id)

  const data = useData()
  const q = query.trim()

  // While open the palette is a dialog as far as every other shortcut is
  // concerned: "j" typed here must not move the list behind it.
  useEffect(() => {
    const entry = pushDialog()
    const before = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => {
      entry.pop()
      if (before && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [])

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = []
    const done = (fn: () => void) => () => {
      onClose()
      fn()
    }

    if (q) {
      if (can('things')) {
        out.push(
          {
            key: 'add:todo',
            group: 'Add',
            label: `Add “${q}” to To-do`,
            icon: 'check',
            color: '#7c5cff',
            run: done(() => {
              void dataActions.addTodo(q, 1, profileId)
              toast.success(`Added to To-do`, { description: q })
            }),
          },
          {
            key: 'add:shop',
            group: 'Add',
            label: `Add “${q}” to Shopping`,
            icon: 'cart',
            color: '#7c5cff',
            run: done(() => {
              void dataActions.addShoppingItem(q, 1, null, profileId)
              toast.success(`Added to Shopping`, { description: q })
            }),
          },
          {
            key: 'add:chore',
            group: 'Add',
            label: `Add “${q}” as a chore`,
            icon: 'repeat',
            color: '#7c5cff',
            run: done(() => {
              void dataActions.addChore(q, 1, profileId, null)
              toast.success(`Added to Chores`, { description: q })
            }),
          },
          {
            key: 'add:wish',
            group: 'Add',
            label: `Add “${q}” to the Wishlist`,
            icon: 'star',
            color: '#7c5cff',
            run: done(() => {
              void dataActions.addWish(q, 3, profileId, { owner_id: profileId })
              toast.success(`Added to the Wishlist`, { description: q })
            }),
          },
        )
      }
      if (can('encyclopedia')) {
        out.push({
          key: 'add:word',
          group: 'Add',
          label: `Define “${q}”`,
          icon: 'book',
          color: '#7c2f3a',
          run: done(() => openApp('encyclopedia', { define: q })),
        })
      }
      if (can('meals')) {
        out.push({
          key: 'add:dish',
          group: 'Add',
          label: `New dish “${q}”`,
          icon: 'chef',
          color: '#ff7a59',
          run: done(() => {
            openApp('meals')
            useMealsUI.getState().openSheet({ kind: 'dish', dish: null, draft: { name: q } })
          }),
        })
      }
      if (can('watched')) {
        out.push({
          key: 'add:show',
          group: 'Add',
          label: `Find the show “${q}”`,
          icon: 'tv',
          color: '#f8c534',
          run: done(() => {
            openApp('watched')
            useWatchUI.getState().open({ kind: 'search', preset: null, query: q })
          }),
        })
      }
      if (can('owe')) {
        out.push({
          key: 'add:debt',
          group: 'Add',
          label: `Record money with “${q}”`,
          icon: 'wallet',
          color: '#3fa96b',
          run: done(() => openApp('owe', { add: q })),
        })
      }

      for (const hit of searchEverything(q, data, can)) {
        out.push({
          key: hit.key,
          group: 'Found',
          label: hit.title,
          hint: hit.subtitle,
          icon: hit.icon,
          color: tiles.find((t) => t.app.id === hit.appId)?.app.color,
          run: done(() => openApp(hit.appId, hit.deepLink)),
        })
      }
    } else {
      // Nothing typed: the things worth starting from here.
      if (can('things'))
        out.push({ key: 'start:things', group: 'Start', label: 'Type something to add it to a list', icon: 'plus', run: () => inputRef.current?.focus() })
      if (can('meals')) {
        out.push(
          {
            key: 'start:meal',
            group: 'Start',
            label: 'Plan a meal',
            icon: 'chef',
            color: '#ff7a59',
            run: done(() => {
              openApp('meals')
              useMealsUI.getState().openSheet({ kind: 'meal', meal: null })
            }),
          },
          {
            key: 'start:import',
            group: 'Start',
            label: 'Import a recipe from a link',
            icon: 'link',
            color: '#ff7a59',
            run: done(() => {
              openApp('meals')
              useMealsUI.getState().openSheet({ kind: 'import' })
            }),
          },
        )
      }
      if (can('watched'))
        out.push({
          key: 'start:show',
          group: 'Start',
          label: 'Find a show',
          icon: 'tv',
          color: '#f8c534',
          run: done(() => {
            openApp('watched')
            useWatchUI.getState().open({ kind: 'search', preset: null })
          }),
        })
    }

    const nav: Command[] = [
      { key: 'go:home', group: 'Go to', label: 'Overview', icon: 'home', combo: 'g h', run: done(goHome) },
      ...tiles.map<Command>((t) => ({
        key: `go:${t.app.id}`,
        group: 'Go to',
        label: t.app.name,
        hint: t.app.blurb,
        icon: t.app.icon,
        color: t.app.color,
        combo: APP_KEYS[t.app.id] ? `g ${APP_KEYS[t.app.id]}` : undefined,
        run: done(() => openApp(t.app.id)),
      })),
      { key: 'go:inbox', group: 'Go to', label: 'Notifications', icon: 'bell', combo: 'g i', run: done(() => setInbox(true)) },
      ...SETTINGS.map<Command>((s) => ({
        key: `go:settings:${s.id}`,
        group: 'Go to',
        label: s.label,
        icon: 'settings',
        combo: s.id === 'general' ? 'g s' : undefined,
        run: done(() => openSettings(s.id)),
      })),
    ]
    const lower = q.toLowerCase()
    out.push(...(q ? nav.filter((c) => c.label.toLowerCase().includes(lower)) : nav))
    return out
    // `data` changes identity on every store write; that's what keeps the
    // results live while the palette is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data, profileId, tiles.length])

  // Keep the highlighted row valid and in view as the list changes under it.
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setActive((i) => Math.min(commands.length - 1, i + 1))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commands[active]?.run()
    } else if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  let lastGroup = ''

  return (
    <>
      <motion.div
        className="fixed inset-0 z-[90]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onClick={onClose}
        style={{ background: 'rgb(0 0 0 / 0.4)' }}
      />
      <div className="pointer-events-none fixed inset-0 z-[91] flex justify-center pt-[12vh]">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Search everything"
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 600, damping: 40 }}
          className="pointer-events-auto flex h-fit max-h-[70vh] w-[min(660px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-faint)' }}>
              <Icon name="search" size={18} />
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search everything, or type something to add…"
              aria-label="Search everything"
              aria-activedescendant={commands[active] ? `cmd-${active}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--text-faint)]"
              spellCheck={false}
              autoComplete="off"
            />
            <Kbd combo="escape" />
          </div>

          <div ref={listRef} role="listbox" className="desk-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {commands.length === 0 && (
              <p className="px-3 py-8 text-center text-[13.5px]" style={{ color: 'var(--text-faint)' }}>
                Nothing matches “{q}”.
              </p>
            )}
            {commands.map((c, i) => {
              const heading = c.group !== lastGroup ? c.group : null
              lastGroup = c.group
              return (
                <div key={c.key}>
                  {heading && (
                    <p
                      className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {heading}
                    </p>
                  )}
                  <button
                    id={`cmd-${i}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    data-active={i === active || undefined}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => c.run()}
                    className="desk-palette-item flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left"
                  >
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                      style={{
                        background: c.color ? `color-mix(in oklab, ${c.color} 18%, transparent)` : 'var(--surface-2)',
                        color: c.color ?? 'var(--text-dim)',
                      }}
                    >
                      <Icon name={c.icon} size={15} strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{c.label}</span>
                      {c.hint && (
                        <span className="block truncate text-[12px]" style={{ color: 'var(--text-faint)' }}>
                          {c.hint}
                        </span>
                      )}
                    </span>
                    {c.combo && <Kbd combo={c.combo} />}
                    {i === active && !c.combo && <Kbd combo="enter" />}
                  </button>
                </div>
              )
            })}
          </div>

          <div
            className="flex items-center gap-4 px-4 py-2 text-[11.5px]"
            style={{ borderTop: '1px solid var(--border)', color: 'var(--text-faint)' }}
          >
            <span className="flex items-center gap-1.5">
              <Kbd combo="arrowup" />
              <Kbd combo="arrowdown" /> move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd combo="enter" /> choose
            </span>
            <span className="ml-auto">Searches every app you can open</span>
          </div>
        </motion.div>
      </div>
    </>
  )
}
