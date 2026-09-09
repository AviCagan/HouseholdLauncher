import { useRef } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconName } from '../primitives/Icon'
import { TABS, useUI } from '@/store/useUI'
import { useLauncher } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import type { TabKey } from '@/data/types'

/**
 * The tab dock.
 *
 * Full-width with equal slots, so every target is a comfortable thumb-width
 * rather than a cramped pill. The active background is one element with a
 * shared layoutId, so it physically slides between tabs.
 *
 * You can also *drag* along the dock: hold and slide, and tabs change under
 * your thumb with a tick on each crossing. That's why selection is driven by
 * pointer events on the container rather than click handlers on the buttons —
 * a click only fires where the finger lifts, which would lose every tab you
 * passed through on the way.
 *
 * The way out of the app is the button to the *left* of the dock, and it is
 * deliberately not a fifth slot inside it. Things has no room for one in its
 * header — the title row already carries the settings and activity buttons,
 * and Shopping's own Trip button on top of that — and on the iPhone web app
 * there is no hardware back button, so without something here you are simply
 * stuck in Things until you force-quit. Keeping it outside the drag surface
 * means sliding your thumb along the tabs can never fling you back to the
 * launcher by accident.
 */

const DOCK_PADDING = 6

export function TabDock() {
  const tab = useUI((s) => s.tab)
  const setTab = useUI((s) => s.setTab)
  const goHome = useLauncher((s) => s.goHome)
  const navRef = useRef<HTMLElement>(null)
  const dragging = useRef(false)
  const lastIndex = useRef<number>(-1)

  function indexFromX(clientX: number): number | null {
    const el = navRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const inner = rect.width - DOCK_PADDING * 2
    if (inner <= 0) return null
    const offset = clientX - rect.left - DOCK_PADDING
    const clamped = Math.min(inner - 1, Math.max(0, offset))
    return Math.min(TABS.length - 1, Math.floor(clamped / (inner / TABS.length)))
  }

  function selectAt(clientX: number) {
    const i = indexFromX(clientX)
    if (i === null || i === lastIndex.current) return
    lastIndex.current = i
    const next: TabKey = TABS[i].key
    if (next !== tab) {
      fire('snap')
      setTab(next)
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-stretch gap-2 px-3 safe-bottom">
      <button
        type="button"
        onClick={() => {
          fire('tap')
          goHome()
        }}
        aria-label="Back to the launcher"
        className="pointer-events-auto mb-2.5 grid shrink-0 place-items-center rounded-[26px] px-4"
        style={{
          background: 'var(--dock-bg)',
          backdropFilter: 'blur(22px) saturate(180%)',
          WebkitBackdropFilter: 'blur(22px) saturate(180%)',
          border: 'var(--dock-border)',
          boxShadow: 'var(--shadow-dock)',
          color: 'var(--text-dim)',
        }}
      >
        <Icon name="grid" size={22} strokeWidth={2} />
      </button>

      <nav
        ref={navRef}
        aria-label="Sections"
        className="pointer-events-auto mb-2.5 flex min-w-0 flex-1 items-stretch rounded-[26px]"
        style={{
          padding: DOCK_PADDING,
          background: 'var(--dock-bg)',
          backdropFilter: 'blur(22px) saturate(180%)',
          WebkitBackdropFilter: 'blur(22px) saturate(180%)',
          border: 'var(--dock-border)',
          boxShadow: 'var(--shadow-dock)',
          // Stops the browser claiming the horizontal drag for a scroll.
          touchAction: 'none',
        }}
        onPointerDown={(e) => {
          dragging.current = true
          lastIndex.current = -1
          e.currentTarget.setPointerCapture(e.pointerId)
          selectAt(e.clientX)
        }}
        onPointerMove={(e) => {
          if (dragging.current) selectAt(e.clientX)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          lastIndex.current = -1
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => {
          dragging.current = false
          lastIndex.current = -1
        }}
      >
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              // Keyboard and assistive tech still need a real activation path;
              // pointer selection above handles touch and mouse.
              onClick={() => {
                if (t.key === tab) return
                fire('snap')
                setTab(t.key)
              }}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[21px] py-2.5"
              style={{
                color: active ? '#fff' : 'var(--text-dim)',
                minHeight: 54,
              }}
            >
              {active && (
                <motion.span
                  layoutId="dock-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                  className="dock-pill absolute inset-0 rounded-[21px]"
                  style={{ background: 'var(--accent)' }}
                />
              )}
              <span className="relative z-10 leading-none">
                <Icon
                  name={t.icon as IconName}
                  size={23}
                  strokeWidth={active ? 2.5 : 2}
                />
              </span>
              <span
                className="relative z-10 text-[11px] font-semibold leading-none"
                style={{ opacity: active ? 1 : 0.85 }}
              >
                {t.label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
