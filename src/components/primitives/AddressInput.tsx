import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from './Icon'
import { searchPlaces, type PlaceSuggestion } from '@/apps/things/routing/geocode'
import { fire } from '@/lib/haptics'

/**
 * Address field with type-ahead suggestions.
 *
 * Picking a suggestion hands back coordinates too, so the address never needs
 * geocoding again later — the trip planner gets to skip straight to routing.
 */
export function AddressInput({
  value,
  onChange,
  onPick,
  fillWith = 'address',
  placeholder = 'Start typing an address…',
  className,
  style,
}: {
  value: string
  onChange: (v: string) => void
  onPick?: (place: PlaceSuggestion) => void
  /**
   * What picking a suggestion writes into this field. A *name* field wants
   * "Taster's Market", not "Taster's Market, 330 Bradley Avenue, New York…".
   * Places without their own name fall back to the address either way.
   */
  fillWith?: 'address' | 'name'
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  // Set while applying a pick, so the resulting value change doesn't
  // immediately trigger a fresh search for the text we just inserted.
  const justPicked = useRef(false)

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false
      return
    }
    if (value.trim().length < 3) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const results = await searchPlaces(value, controller.signal)
        setSuggestions(results)
        setOpen(results.length > 0)
      } catch {
        /* aborted or offline — the field still works as free text */
      } finally {
        setLoading(false)
      }
    }, 350)

    return () => {
      clearTimeout(timer)
      controller.abort()
      setLoading(false)
    }
  }, [value])

  function pick(s: PlaceSuggestion) {
    fire('snap')
    justPicked.current = true
    onChange(fillWith === 'name' ? (s.name ?? s.address) : s.address)
    onPick?.(s)
    setOpen(false)
    setSuggestions([])
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        // Delay so a tap on a suggestion lands before the list unmounts.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className={className ?? 'w-full rounded-xl px-3.5 py-3 outline-none'}
        style={style ?? { background: 'var(--surface)', border: '1px solid var(--border)' }}
      />

      {loading && (
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px]"
          style={{ color: 'var(--text-faint)' }}
        >
          …
        </span>
      )}

      <AnimatePresence>
        {open && suggestions.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-x-0 z-30 mt-1 overflow-hidden rounded-xl"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {suggestions.map((s, i) => (
              <li key={`${s.lat},${s.lng},${i}`}>
                <button
                  type="button"
                  // pointerdown fires before blur, so the pick isn't lost.
                  onPointerDown={(e) => {
                    e.preventDefault()
                    pick(s)
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                  style={{
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <span style={{ color: 'var(--text-faint)' }}>
                    <Icon name="pin" size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
