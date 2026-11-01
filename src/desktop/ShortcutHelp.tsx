import { useMemo } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { listedBindings, type Binding } from './keys'
import { Kbd } from './ui'

/**
 * "?" — every shortcut that works right now.
 *
 * Read from the live layers rather than a hand-kept list, so what it shows is
 * exactly what the keyboard will do on this screen: Things' row keys while
 * Things is open, the dictionary's while the dictionary is, and never a
 * shortcut for an app this member can't open.
 */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = useMemo(() => {
    if (!open) return []
    const out = new Map<string, Binding[]>()
    for (const b of listedBindings()) {
      const g = b.group ?? 'This screen'
      const list = out.get(g) ?? []
      // The newest layer is listed first, so a key an app redefines shows
      // once, with the app's meaning.
      if (!list.some((x) => x.label === b.label)) list.push(b)
      out.set(g, list)
    }
    // The app's own keys first — that's what someone pressing "?" inside an
    // app is usually asking about.
    const order = (g: string) => (g === 'Anywhere' ? 1 : g === 'Go to' ? 2 : 0)
    return [...out.entries()].sort((a, b) => order(a[0]) - order(b[0]))
  }, [open])

  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts" desktop="wide">
      <div className="grid gap-x-10 gap-y-6 pt-1 md:grid-cols-2">
        {groups.map(([group, bindings]) => (
          <section key={group}>
            <h3 className="pb-2 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              {group}
            </h3>
            <div className="flex flex-col">
              {bindings.map((b) => {
                const combos = b.display ? [b.display] : Array.isArray(b.keys) ? b.keys : [b.keys]
                return (
                  <div
                    key={b.label}
                    className="flex items-center justify-between gap-4 py-1.5 text-[13.5px]"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <span>{b.label}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {combos.map((c, i) => (
                        <span key={c} className="flex items-center gap-2">
                          {i > 0 && (
                            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                              or
                            </span>
                          )}
                          <Kbd combo={c} />
                        </span>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <p className="pt-6 text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
        Single keys never fire while you're typing in a box, and every dialog closes with Esc.
      </p>
    </Sheet>
  )
}
