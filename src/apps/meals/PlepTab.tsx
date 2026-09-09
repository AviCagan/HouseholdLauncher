import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Icon } from '@/components/primitives/Icon'
import { Sheet } from '@/components/primitives/Sheet'
import { dataActions, useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { isConfigured } from '@/lib/env'
import { feedUrl, googleSubscribeUrl, newCalendarToken, webcalUrl } from '@/lib/calendar'
import { openExternal } from '@/apps/things/routing/deeplink'
import type { Dish, HouseholdSettings, Meal, MealTemplate } from '@/data/types'
import { addMeal } from './actions'
import { MissingSheet } from './MissingSheet'
import { copyMealForDate, googleMealEventUrl, mealsInRange, planWeeks, quickMeal, repeatable, type PlanDay } from './plan'
import { useMealsUI } from './store'
import { BigButton, Chip, Field, Heading, MCard, POP, TextInput, occasionEmoji } from './ui'

/**
 * Plep — plan and prep.
 *
 * The next two weeks as a board, Sunday to Saturday the way a Shabbat
 * household counts them, with today at the top and Friday and Saturday
 * marked. Every day is a tap away from having something on it: a template
 * (the meal opens with the date already set), a meal you've made before (a
 * copy lands straight on the day), or just a word — "Leftovers", "Out".
 *
 * The prep half is the two buttons at the top: shop for everything on the
 * board through the same missing-ingredients flow a single meal uses, and
 * put the board on Google Calendar. The calendar is the household feed Things
 * already publishes for chores — meals ride along as all-day events, so one
 * subscription carries both.
 */
export function PlepTab() {
  const meals = useData((s) => s.meals)
  const dishes = useData((s) => s.dishes)
  const templates = useData((s) => s.meal_templates)
  const household = useData((s) => s.household_settings)[0]
  const profileId = useProfile((s) => s.profileId)
  const openSheet = useMealsUI((s) => s.openSheet)
  const celebrate = useMealsUI((s) => s.celebrate)

  const [planning, setPlanning] = useState<PlanDay | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)

  const weeks = useMemo(() => planWeeks(meals, new Date()), [meals])
  const onBoard = useMemo(() => mealsInRange(meals, new Date()), [meals])

  function repeat(source: Meal) {
    const day = planning
    if (!day) return
    setPlanning(null)
    const row = addMeal(copyMealForDate(source, day.date), profileId)
    if (!row) return
    celebrate()
    toast.success(`${row.emoji} ${row.name} — ${day.label === 'Today' ? 'today' : day.label === 'Tomorrow' ? 'tomorrow' : day.short}`)
  }

  function quick(name: string) {
    const day = planning
    if (!day || !name.trim()) return
    setPlanning(null)
    if (addMeal(quickMeal(name, day.date, 2), profileId)) fire('success')
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="grid grid-cols-2 gap-2">
        <MCard onClick={() => setShopOpen(true)} className="flex items-center gap-2.5 px-3 py-3" tone="var(--m-mint-soft)">
          <span className="text-[24px]">🛒</span>
          <span className="min-w-0">
            <span className="block text-[14px] font-extrabold leading-tight">Shop the board</span>
            <span className="block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
              {onBoard.length} {onBoard.length === 1 ? 'meal' : 'meals'} · what’s missing
            </span>
          </span>
        </MCard>
        <MCard onClick={() => setCalendarOpen(true)} className="flex items-center gap-2.5 px-3 py-3" tone="var(--m-sky-soft)">
          <span className="text-[24px]">📅</span>
          <span className="min-w-0">
            <span className="block text-[14px] font-extrabold leading-tight">Google Calendar</span>
            <span className="block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
              {household?.calendar_token ? 'Feed is on' : 'Export the plan'}
            </span>
          </span>
        </MCard>
      </div>

      {weeks.map((week) => (
        <div key={week.label}>
          <Heading>{week.label}</Heading>
          <div className="flex flex-col gap-2">
            {week.days.map((day) => (
              <DayCard
                key={day.date}
                day={day}
                dishes={dishes}
                onPlan={() => {
                  fire('tap')
                  setPlanning(day)
                }}
                onOpen={(meal) => {
                  fire('tap')
                  openSheet({ kind: 'meal', meal })
                }}
              />
            ))}
          </div>
        </div>
      ))}

      <DayPlanSheet
        day={planning}
        templates={templates}
        meals={meals}
        onClose={() => setPlanning(null)}
        onTemplate={(t) => {
          const day = planning
          setPlanning(null)
          if (day) openSheet({ kind: 'meal', meal: null, template: t, date: day.date })
        }}
        onRepeat={repeat}
        onQuick={quick}
      />
      <CalendarSheet open={calendarOpen} onClose={() => setCalendarOpen(false)} household={household} />
      <MissingSheet open={shopOpen} meals={onBoard} onClose={() => setShopOpen(false)} />
    </div>
  )
}

function DayCard({
  day,
  dishes,
  onPlan,
  onOpen,
}: {
  day: PlanDay
  dishes: Dish[]
  onPlan: () => void
  onOpen: (meal: Meal) => void
}) {
  const isToday = day.label === 'Today'
  const [dayNum, month] = day.short.split(' ')
  return (
    <motion.div
      layout
      transition={POP}
      className="m-card-flat flex gap-3 px-3 py-2.5"
      style={{
        background: day.shabbat ? 'var(--m-butter-soft)' : 'var(--m-card)',
        borderColor: isToday ? 'var(--m-tomato)' : undefined,
      }}
    >
      <div
        className="flex w-[54px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5"
        style={{ background: 'var(--m-card)', border: '2px solid var(--m-line)' }}
      >
        <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: isToday ? 'var(--m-tomato)' : 'var(--m-ink-dim)' }}>
          {day.label}
        </span>
        <span className="m-title text-[20px] leading-none">{dayNum}</span>
        <span className="text-[10px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
          {month}
        </span>
        {day.shabbat && (
          <span className="text-[14px] leading-none" aria-label={day.shabbat === 'dinner' ? 'Shabbat dinner' : 'Shabbat lunch'}>
            {day.shabbat === 'dinner' ? '🕯️' : '☀️'}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        {day.meals.map((meal) => {
          const url = googleMealEventUrl(meal, dishes)
          return (
            <div key={meal.id} className="flex items-center gap-1.5">
              <button onClick={() => onOpen(meal)} className="m-chip min-w-0 flex-1 !justify-start !py-2" style={{ background: 'var(--m-card)' }}>
                <span>{meal.emoji || occasionEmoji(meal.occasion)}</span>
                <span className="min-w-0 truncate">{meal.name}</span>
                <span className="ml-auto shrink-0 text-[11px] font-bold" style={{ color: 'var(--m-ink-faint)' }}>
                  for {meal.people}
                </span>
              </button>
              {url && (
                <button
                  onClick={() => {
                    fire('tap')
                    openExternal(url)
                  }}
                  aria-label={`Add ${meal.name} to Google Calendar now`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{ border: '2px solid var(--m-line)', background: 'var(--m-card)', color: 'var(--m-ink)' }}
                >
                  <Icon name="calendar" size={14} strokeWidth={2.4} />
                </button>
              )}
            </div>
          )
        })}
        <button onClick={onPlan} className="m-chip self-start" style={{ background: 'var(--m-card-2)', borderStyle: 'dashed' }}>
          <Icon name="plus" size={12} strokeWidth={3} /> {day.meals.length ? 'Another' : 'Plan something'}
        </button>
      </div>
    </motion.div>
  )
}

/** Three ways to fill a day, quickest last. */
function DayPlanSheet({
  day,
  templates,
  meals,
  onClose,
  onTemplate,
  onRepeat,
  onQuick,
}: {
  day: PlanDay | null
  templates: MealTemplate[]
  meals: Meal[]
  onClose: () => void
  onTemplate: (t: MealTemplate) => void
  onRepeat: (m: Meal) => void
  onQuick: (name: string) => void
}) {
  const [note, setNote] = useState('')
  const again = useMemo(() => repeatable(meals), [meals])
  const sorted = useMemo(() => [...templates].sort((a, b) => a.sort_order - b.sort_order), [templates])
  const when = !day ? '' : day.label === 'Today' ? 'today' : day.label === 'Tomorrow' ? 'tomorrow' : `${day.label} ${day.short}`

  return (
    <Sheet open={day !== null} onClose={onClose} title={<span className="m-title text-[18px]">What’s for {when}?</span>}>
      <div className="meals -mx-4 -mb-4 flex flex-col gap-5 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        <Field label="Start from a template" hint="Opens the meal with the day already set.">
          <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1">
            {sorted.map((t) => (
              <Chip key={t.id} onClick={() => onTemplate(t)}>
                {t.emoji} {t.name}
              </Chip>
            ))}
          </div>
        </Field>

        {again.length > 0 && (
          <Field label="Make it again" hint="A copy for this day — same dishes, same headcount.">
            <div className="flex flex-col gap-1.5">
              {again.map((m) => {
                const filled = m.courses.filter((c) => c.dish_id).length
                return (
                  <button key={m.id} onClick={() => onRepeat(m)} className="m-card-flat flex items-center gap-2.5 px-3 py-2.5 text-left" style={{ background: 'var(--m-card)' }}>
                    <span className="text-[22px]">{m.emoji || occasionEmoji(m.occasion)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold">{m.name}</span>
                      <span className="block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                        {filled} {filled === 1 ? 'dish' : 'dishes'} · for {m.people}
                      </span>
                    </span>
                    <Icon name="plus" size={14} strokeWidth={3} />
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        <Field label="Or just a note" hint="“Leftovers”, “Out”, “Pizza night” — a name is enough.">
          <div className="flex gap-2">
            <TextInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Leftovers"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && note.trim()) {
                  onQuick(note)
                  setNote('')
                }
              }}
            />
            <BigButton
              onClick={() => {
                onQuick(note)
                setNote('')
              }}
              disabled={!note.trim()}
              tone="var(--m-mint)"
              ink="var(--m-ink)"
              className="!w-auto !px-4 !py-2 !text-[13.5px]"
            >
              Add
            </BigButton>
          </div>
        </Field>
      </div>
    </Sheet>
  )
}

/**
 * The plan onto Google Calendar.
 *
 * Two mechanisms, honestly described: the feed keeps every meal on the board
 * in step but refreshes when Google feels like it; the 📅 on each meal adds
 * that one event this minute. The feed is the household's — the same URL
 * Things publishes chores on — so turning it on here turns it on there.
 */
function CalendarSheet({ open, onClose, household }: { open: boolean; onClose: () => void; household: HouseholdSettings | undefined }) {
  const [copied, setCopied] = useState(false)
  const token = household?.calendar_token ?? null
  const url = feedUrl(token)
  const patch = (p: Partial<HouseholdSettings>) => void dataActions.patchRow('household_settings', 'singleton', p)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      fire('success')
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      fire('error')
      toast.error("Couldn't copy here — long-press the link instead")
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={<span className="m-title text-[18px]">Google Calendar</span>}>
      <div className="meals -mx-4 -mb-4 flex flex-col gap-4 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        {!isConfigured() ? (
          <p className="m-card-flat px-4 py-3 text-[13.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
            The calendar feed is served from the household’s Supabase project, and this phone isn’t connected to one yet.
          </p>
        ) : (
          <>
            <p className="text-[13.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
              Publishes the board as a private calendar Google can subscribe to. Every meal is an all-day event on its day, and
              the calendar follows the plan as it changes.
            </p>

            <button
              onClick={() => {
                fire(token ? 'toggleOff' : 'toggleOn')
                patch({ calendar_token: token ? null : newCalendarToken() })
              }}
              role="switch"
              aria-checked={token != null}
              className="m-card-flat flex items-center justify-between px-4 py-3 text-left"
              style={{ background: 'var(--m-card)' }}
            >
              <span>
                <span className="block text-[14.5px] font-extrabold">Calendar feed</span>
                <span className="block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                  {token ? 'On — chores from Things ride along' : 'Off'}
                </span>
              </span>
              <span className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: token ? 'var(--m-mint)' : 'var(--m-card-2)', border: '2px solid var(--m-line)' }}>
                <motion.span
                  layout
                  transition={POP}
                  className="absolute top-[2px] h-[18px] w-[18px] rounded-full"
                  style={{ left: token ? 24 : 2, background: 'var(--m-card)', border: '2px solid var(--m-line)' }}
                />
              </span>
            </button>

            {token && (
              <>
                <BigButton
                  onClick={() => {
                    fire('success')
                    openExternal(googleSubscribeUrl(token))
                  }}
                  tone="var(--m-sky)"
                  ink="var(--m-ink)"
                >
                  📅 Subscribe in Google Calendar
                </BigButton>
                <div className="flex flex-wrap gap-1.5">
                  <Chip onClick={() => void copy()}>{copied ? '✓ Copied' : '📋 Copy the link'}</Chip>
                  <Chip onClick={() => openExternal(webcalUrl(token))}>📲 Open on this phone</Chip>
                </div>
                <p className="m-card-flat break-all px-3 py-2 text-[11px] font-semibold" style={{ background: 'var(--m-card)', color: 'var(--m-ink-faint)' }}>
                  {url}
                </p>
                <p className="text-[12.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                  On a phone, “Subscribe” works best from a browser signed in to Google; the calendar then shows up in the
                  Google Calendar app on its own. Google refreshes feeds on its own schedule — often hours later — so for
                  something you want on the calendar right now, tap 📅 next to the meal.
                </p>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--m-ink-faint)' }}>
                  Anyone with the link can see the plan and the chores, and nothing else — it can’t change anything. Turning the
                  feed off revokes it.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
