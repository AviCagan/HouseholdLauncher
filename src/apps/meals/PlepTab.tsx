import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Icon } from '@/components/primitives/Icon'
import { Sheet } from '@/components/primitives/Sheet'
import { dataActions, useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { isConfigured } from '@/lib/env'
import { calendarPath, feedUrl, googleSubscribeUrl, newCalendarToken, webcalUrl } from '@/lib/calendar'
import { shareText } from '@/lib/share'
import { openExternal } from '@/apps/things/routing/deeplink'
import { DISH_KINDS, type Dish, type HouseholdSettings, type Meal, type MealTemplate } from '@/data/types'
import { addMeal } from './actions'
import { MissingSheet } from './MissingSheet'
import { copyMealForDate, googleMealEventUrl, mealFromDishes, mealsInRange, planWeeks, quickMeal, repeatable, type PlanDay } from './plan'
import { useMealsUI } from './store'
import { BigButton, Chip, Field, Heading, KIND_META, MCard, POP, Stepper, TextInput, occasionEmoji } from './ui'

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

  function fromDishes(picked: Dish[], people: number) {
    const day = planning
    if (!day || picked.length === 0) return
    setPlanning(null)
    const row = addMeal(mealFromDishes(picked, day.date, people), profileId)
    if (!row) return
    celebrate()
    toast.success(`${row.emoji} ${row.name} — ${day.label === 'Today' ? 'today' : day.label === 'Tomorrow' ? 'tomorrow' : day.short}`)
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
        onDishes={fromDishes}
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
        className="flex w-[68px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5"
        style={{ background: 'var(--m-card)', border: '2px solid var(--m-line)' }}
      >
        <span className="max-w-full truncate text-[8.5px] font-black uppercase tracking-[0.01em]" style={{ color: isToday ? 'var(--m-tomato)' : 'var(--m-ink-dim)' }}>
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

/** Four ways to fill a day, quickest last. */
function DayPlanSheet({
  day,
  templates,
  meals,
  onClose,
  onTemplate,
  onRepeat,
  onQuick,
  onDishes,
}: {
  day: PlanDay | null
  templates: MealTemplate[]
  meals: Meal[]
  onClose: () => void
  onTemplate: (t: MealTemplate) => void
  onRepeat: (m: Meal) => void
  onQuick: (name: string) => void
  onDishes: (dishes: Dish[], people: number) => void
}) {
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(false)
  const dishes = useData((s) => s.dishes)
  const again = useMemo(() => repeatable(meals), [meals])
  const sorted = useMemo(() => [...templates].sort((a, b) => a.sort_order - b.sort_order), [templates])
  const when = !day ? '' : day.label === 'Today' ? 'today' : day.label === 'Tomorrow' ? 'tomorrow' : `${day.label} ${day.short}`
  const usable = dishes.filter((d) => !d.tags.includes('want-to-try'))

  return (
    <>
    <Sheet open={day !== null} onClose={onClose} title={<span className="m-title text-[18px]">What’s for {when}?</span>}>
      <div className="meals -mx-4 -mb-4 flex flex-col gap-5 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        <MCard
          onClick={() => {
            if (usable.length === 0) {
              toast('No dishes yet — add a few on the Dishes tab first.')
              return
            }
            setPicking(true)
          }}
          className="flex items-center gap-3 px-3.5 py-3"
          tone="var(--m-mint-soft)"
        >
          <span className="text-[26px]">🥘</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold leading-tight">Put together a meal from dishes</span>
            <span className="block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
              Tick what you’re making, say how many, done.
            </span>
          </span>
          <Icon name="chevron" size={16} />
        </MCard>

        <Field label="Or start from a template" hint="Opens the meal with the day already set.">
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

    <DishPickSheet
      open={picking && day !== null}
      day={day}
      dishes={usable}
      onClose={() => setPicking(false)}
      onDone={(picked, people) => {
        setPicking(false)
        onDishes(picked, people)
      }}
    />
    </>
  )
}

/**
 * A meal from the dishes themselves: tick the ones you're making, say how
 * many are coming, and it lands on the day with a course per dish — no
 * template, no slots to fill, because "chicken, rice and a salad on Tuesday"
 * is most dinners and shouldn't take a form.
 */
function DishPickSheet({
  open,
  day,
  dishes,
  onClose,
  onDone,
}: {
  open: boolean
  day: PlanDay | null
  dishes: Dish[]
  onClose: () => void
  onDone: (picked: Dish[], people: number) => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [people, setPeople] = useState(2)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPicked(new Set())
  }, [open])

  const q = query.trim().toLowerCase()
  const groups = DISH_KINDS.map((kind) => ({
    kind,
    dishes: dishes
      .filter((d) => d.kind === kind && (!q || d.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.dishes.length > 0)
  const chosen = dishes.filter((d) => picked.has(d.id))

  const toggle = (id: string) => {
    fire('snap')
    setPicked((set) => {
      const next = new Set(set)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Sheet open={open} onClose={onClose} title={<span className="m-title text-[18px]">What are you making?</span>} height="88vh">
      <div className="meals -mx-4 -mb-4 flex flex-col gap-4 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        <div className="flex items-center gap-3">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes…" aria-label="Search dishes" className="min-w-0 flex-1 !py-2 !text-[14px]" />
          <Stepper value={people} onChange={setPeople} suffix={people === 1 ? 'person' : 'people'} />
        </div>

        {groups.map((g) => (
          <div key={g.kind} className="flex flex-col gap-1.5">
            <span className="px-0.5 text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--m-ink-dim)' }}>
              {KIND_META[g.kind].emoji} {KIND_META[g.kind].label}s
            </span>
            {g.dishes.map((d) => {
              const on = picked.has(d.id)
              return (
                <motion.button
                  key={d.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => toggle(d.id)}
                  aria-pressed={on}
                  className="m-card-flat flex items-center gap-2.5 px-3 py-2.5 text-left"
                  style={{ background: on ? 'var(--m-mint-soft)' : 'var(--m-card)' }}
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
                    style={{ border: '2px solid var(--m-line)', background: on ? 'var(--m-mint)' : 'transparent', color: 'var(--m-ink)' }}
                  >
                    {on && <Icon name="check" size={14} strokeWidth={3.5} />}
                  </span>
                  <span className="text-[20px]">{d.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold">{d.name}</span>
                  <span className="shrink-0 text-[11.5px] font-bold" style={{ color: 'var(--m-ink-faint)' }}>
                    serves {d.servings}
                  </span>
                </motion.button>
              )
            })}
          </div>
        ))}

        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-[14px] font-semibold" style={{ color: 'var(--m-ink-faint)' }}>
            Nothing matches that.
          </p>
        )}

        <BigButton onClick={() => onDone(chosen, people)} disabled={chosen.length === 0}>
          {chosen.length === 0
            ? 'Tick a dish or two'
            : `Plan it${day ? ` for ${day.label === 'Today' ? 'today' : day.label === 'Tomorrow' ? 'tomorrow' : day.short}` : ''} · ${chosen.length} ${chosen.length === 1 ? 'dish' : 'dishes'}`}
        </BigButton>
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
  const path = calendarPath()
  const patch = (p: Partial<HouseholdSettings>) => void dataActions.patchRow('household_settings', 'singleton', p)

  async function share() {
    fire('tap')
    const outcome = await shareText({ title: 'Household calendar', text: `Our meal plan and chores, as a calendar feed: ${url}`, url })
    if (outcome === 'copied') toast.success('Link copied — nothing here to share with, so it’s on the clipboard')
    if (outcome === 'unavailable') toast.error("Couldn't share or copy here — long-press the link instead")
  }

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
                {path === 'desktop' && (
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
                )}
                {path === 'ios' && (
                  <BigButton
                    onClick={() => {
                      fire('success')
                      openExternal(webcalUrl(token))
                    }}
                    tone="var(--m-sky)"
                    ink="var(--m-ink)"
                  >
                    📲 Open in the Calendar app
                  </BigButton>
                )}
                {path === 'android' && (
                  <BigButton onClick={() => void share()} tone="var(--m-sky)" ink="var(--m-ink)">
                    📤 Send the link to a computer
                  </BigButton>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Chip onClick={() => void copy()}>{copied ? '✓ Copied' : '📋 Copy the link'}</Chip>
                  {path !== 'android' && <Chip onClick={() => void share()}>📤 Share</Chip>}
                </div>
                <p className="m-card-flat break-all px-3 py-2 text-[11px] font-semibold" style={{ background: 'var(--m-card)', color: 'var(--m-ink-faint)' }}>
                  {url}
                </p>
                {path === 'android' ? (
                  <p className="text-[12.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                    Google Calendar can’t add a calendar from a link on the phone itself — only its website can. Send
                    yourself the link, open <span className="font-black">calendar.google.com</span> on a computer, and under
                    “Other calendars” choose <span className="font-black">＋ → From URL</span> and paste it. From then on the
                    plan shows up in the Google Calendar app on your phone by itself.
                  </p>
                ) : (
                  <p className="text-[12.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                    Once subscribed, the calendar follows the plan as it changes.
                  </p>
                )}
                <p className="text-[12.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                  Google refreshes feeds on its own schedule — often hours later — so for something you want on the
                  calendar right now, tap 📅 next to the meal: that one lands the moment you press Save.
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
