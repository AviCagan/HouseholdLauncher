import { AnimatePresence, motion } from 'motion/react'
import { fire } from '@/lib/haptics'
import type { RecurrenceUnit, Weekday } from '@/data/types'
import { WEEKDAY_LABELS } from '@/data/types'

export type RecurrenceMode = 'presets' | 'every' | 'days'

export const WEEKDAY_ORDER: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

/**
 * The three-mode "how often" picker — Quick presets, a custom interval, or
 * specific weekdays — shared between adding a new chore and editing one.
 *
 * Purely presentational: every value and setter is a prop, so the add bar and
 * the edit sheet each own their own state (one seeded with defaults, the
 * other seeded from an existing chore) without this component needing to know
 * which situation it's in.
 */
export function RecurrenceFields({
  mode,
  setMode,
  presets,
  preset,
  setPreset,
  custom,
  setCustom,
  days,
  setDays,
  summary,
}: {
  mode: RecurrenceMode
  setMode: (m: RecurrenceMode) => void
  presets: { label: string; count: number; unit: Exclude<RecurrenceUnit, 'weekdays'> }[]
  preset: { label: string; count: number; unit: Exclude<RecurrenceUnit, 'weekdays'> }
  setPreset: (p: { label: string; count: number; unit: Exclude<RecurrenceUnit, 'weekdays'> }) => void
  custom: { count: string; unit: Exclude<RecurrenceUnit, 'weekdays'> }
  setCustom: (c: { count: string; unit: Exclude<RecurrenceUnit, 'weekdays'> }) => void
  days: Set<Weekday>
  setDays: (d: Set<Weekday>) => void
  summary: string
}) {
  function toggleDay(d: Weekday) {
    fire('snap')
    const next = new Set(days)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    setDays(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-full p-1" style={{ background: 'var(--surface-2)' }}>
          {(
            [
              { key: 'presets', label: 'Quick' },
              { key: 'every', label: 'Every…' },
              { key: 'days', label: 'Days' },
            ] as { key: RecurrenceMode; label: string }[]
          ).map((m) => {
            const on = mode === m.key
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  fire('snap')
                  setMode(m.key)
                }}
                className="flex-1 rounded-full py-1.5 text-[12.5px] font-semibold"
                style={{
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? '#fff' : 'var(--text-dim)',
                }}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        {summary && (
          <span
            className="shrink-0 truncate text-[12px]"
            style={{ color: 'var(--text-faint)', maxWidth: 96 }}
          >
            {summary}
          </span>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode === 'presets' && (
          <motion.div
            key="presets"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="flex flex-wrap items-center gap-1.5"
          >
            {presets.map((p) => {
              const on = preset.label === p.label
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    fire('snap')
                    setPreset(p)
                  }}
                  className="rounded-full px-3 py-2 text-[13px] font-medium"
                  style={{
                    background: on ? 'var(--accent)' : 'var(--surface-2)',
                    color: on ? '#fff' : 'var(--text-dim)',
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </motion.div>
        )}

        {mode === 'every' && (
          <motion.div
            key="every"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="flex items-center gap-1 rounded-full px-2 py-1.5"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="pl-1 text-[13px]" style={{ color: 'var(--text-dim)' }}>
              every
            </span>
            <input
              value={custom.count}
              onChange={(e) =>
                setCustom({ ...custom, count: e.target.value.replace(/\D/g, '') })
              }
              inputMode="numeric"
              className="w-9 bg-transparent text-center text-[13px] outline-none"
            />
            <select
              value={custom.unit}
              onChange={(e) =>
                setCustom({ ...custom, unit: e.target.value as Exclude<RecurrenceUnit, 'weekdays'> })
              }
              className="bg-transparent text-[13px] outline-none"
              style={{ color: 'var(--text)' }}
            >
              <option value="hours">hours</option>
              <option value="days">days</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
              <option value="years">years</option>
            </select>
          </motion.div>
        )}

        {mode === 'days' && (
          <motion.div
            key="days"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-center justify-between gap-1">
              {WEEKDAY_ORDER.map((d) => {
                const on = days.has(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    aria-label={WEEKDAY_LABELS[d].short}
                    aria-pressed={on}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--surface-2)',
                      color: on ? '#fff' : 'var(--text-dim)',
                    }}
                  >
                    {WEEKDAY_LABELS[d].letter}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { label: 'Weekdays', set: [1, 2, 3, 4, 5] },
                  { label: 'Weekends', set: [0, 6] },
                  { label: 'Every day', set: [0, 1, 2, 3, 4, 5, 6] },
                ] as { label: string; set: Weekday[] }[]
              ).map((shortcut) => (
                <button
                  key={shortcut.label}
                  type="button"
                  onClick={() => {
                    fire('snap')
                    setDays(new Set(shortcut.set))
                  }}
                  className="rounded-full px-2.5 py-1 text-[11.5px] font-medium"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-faint)' }}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
