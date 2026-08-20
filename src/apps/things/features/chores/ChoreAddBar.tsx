import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { QuickAdd } from '@/components/shell/QuickAdd'
import { Icon } from '@/components/primitives/Icon'
import { RECURRENCE_PRESETS, describeRecurrence } from '@/lib/time'
import { dataActions, type Recurrence } from '@/store/useData'
import { useProfile, useSettings } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import type { RecurrenceUnit, Weekday } from '@/data/types'
import { toast } from 'sonner'
import { RecurrenceFields, type RecurrenceMode } from './RecurrenceFields'

/**
 * Quick-add plus a recurrence picker that reveals itself only when armed.
 *
 * Three ways to say "how often", surfaced one at a time behind a mode switch
 * (see RecurrenceFields) rather than all stacked together — a chip row, a
 * stepper, and a 7-day picker shown simultaneously is exactly the "crowded"
 * this replaced.
 */
export function ChoreAddBar() {
  const profileId = useProfile((s) => s.profileId)
  const settings = useSettings()
  // An empty selection means "show the defaults" rather than "show nothing".
  const chosen = settings?.recurrence_presets ?? []
  const presets = chosen.length
    ? RECURRENCE_PRESETS.filter((p) => chosen.includes(p.label))
    : RECURRENCE_PRESETS

  const [recurring, setRecurring] = useState(false)
  const [mode, setMode] = useState<RecurrenceMode>('presets')
  const [preset, setPreset] = useState(RECURRENCE_PRESETS[0])
  const [custom, setCustom] = useState<{
    count: string
    unit: Exclude<RecurrenceUnit, 'weekdays'>
  }>({
    count: '3',
    unit: 'days',
  })
  const [days, setDays] = useState<Set<Weekday>>(new Set())

  const recurrence: Recurrence | null = !recurring
    ? null
    : mode === 'days'
      ? days.size
        ? { unit: 'weekdays', days: [...days] }
        : null
      : mode === 'every'
        ? { unit: custom.unit, count: Math.max(1, parseInt(custom.count) || 1) }
        : { unit: preset.unit, count: preset.count }

  const summary =
    mode === 'days'
      ? describeRecurrence(null, 'weekdays', [...days])
      : mode === 'every'
        ? describeRecurrence(Math.max(1, parseInt(custom.count) || 1), custom.unit)
        : describeRecurrence(preset.count, preset.unit)

  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence>
        {recurring && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            /* pointer-events-auto: the parent bar is pointer-events-none so
               taps fall through to the list, and this panel must opt back in. */
            className="pointer-events-auto mx-3 overflow-hidden"
          >
            <div
              className="rounded-2xl p-2.5"
              style={{
                background: 'var(--dock-bg)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid var(--border)',
              }}
            >
              <RecurrenceFields
                mode={mode}
                setMode={setMode}
                presets={presets}
                preset={preset}
                setPreset={setPreset}
                custom={custom}
                setCustom={setCustom}
                days={days}
                setDays={setDays}
                summary={summary}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <QuickAdd
        placeholder={
          recurring && mode === 'days' && days.size === 0
            ? 'Pick a day first…'
            : recurring
              ? 'Recurring chore…'
              : 'Add a chore…'
        }
        onSubmit={(title, urgency) => {
          // Without this, submitting with the "Days" tab open but nothing
          // picked would silently add a one-off chore — the toggle reads as
          // on, but recurrence quietly resolves to null.
          if (recurring && mode === 'days' && days.size === 0) {
            fire('warning')
            toast.warning('Pick at least one day first')
            return
          }
          void dataActions.addChore(title, urgency, profileId, recurrence)
        }}
        leading={
          <button
            onClick={() => {
              fire(recurring ? 'toggleOff' : 'toggleOn')
              setRecurring((r) => !r)
            }}
            aria-label={recurring ? 'Recurring on' : 'Make recurring'}
            aria-pressed={recurring}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
            style={{
              background: recurring ? 'var(--accent)' : 'transparent',
              color: recurring ? '#fff' : 'var(--text-faint)',
              border: `1.5px solid ${recurring ? 'var(--accent)' : 'var(--border-strong)'}`,
            }}
          >
            <Icon name="repeat" size={15} strokeWidth={2.4} />
          </button>
        }
      />
    </div>
  )
}
