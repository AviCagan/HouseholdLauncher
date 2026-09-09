import { useMemo } from 'react'
import { AnimatePresence } from 'motion/react'
import { useData } from '@/store/useData'
import { formatPrice } from '@/lib/money'
import type { Meal } from '@/data/types'
import { PlateDoodle } from './doodles'
import { Empty } from './DishesTab'
import { summariseMeal } from './nutrition'
import { useMealsUI } from './store'
import { Heading, MCard, Stat, occasionEmoji, occasionLabel } from './ui'

/**
 * Meals that have been planned or saved.
 *
 * Three groups by date: coming up, undated (saved combinations to reuse),
 * and past. The past stays, because "what did we make last Rosh Hashanah" is
 * a question this app should be able to answer.
 */
export function MealsTab() {
  const meals = useData((s) => s.meals)
  const dishes = useData((s) => s.dishes)
  const openSheet = useMealsUI((s) => s.openSheet)

  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const upcoming = meals.filter((m) => m.planned_for && m.planned_for >= today).sort((a, b) => a.planned_for!.localeCompare(b.planned_for!))
    const saved = meals.filter((m) => !m.planned_for).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const past = meals.filter((m) => m.planned_for && m.planned_for < today).sort((a, b) => b.planned_for!.localeCompare(a.planned_for!))
    return { upcoming, saved, past }
  }, [meals])

  if (meals.length === 0) {
    return (
      <Empty
        doodle={<PlateDoodle />}
        title="No meals planned"
        hint="Pick a template — Shabbat dinner, a weeknight, a holiday — and fill in the courses."
      />
    )
  }

  const open = (meal: Meal) => openSheet({ kind: 'meal', meal })

  return (
    <div className="flex flex-col pb-2">
      {groups.upcoming.length > 0 && (
        <>
          <Heading>Coming up</Heading>
          <List meals={groups.upcoming} dishes={dishes} onOpen={open} />
        </>
      )}
      {groups.saved.length > 0 && (
        <>
          <Heading>Saved</Heading>
          <List meals={groups.saved} dishes={dishes} onOpen={open} />
        </>
      )}
      {groups.past.length > 0 && (
        <>
          <Heading>Made before</Heading>
          <List meals={groups.past} dishes={dishes} onOpen={open} faded />
        </>
      )}
    </div>
  )
}

function List({
  meals,
  dishes,
  onOpen,
  faded = false,
}: {
  meals: Meal[]
  dishes: ReturnType<typeof useData.getState>['dishes']
  onOpen: (m: Meal) => void
  faded?: boolean
}) {
  return (
    <div className="flex flex-col gap-3" style={{ opacity: faded ? 0.8 : 1 }}>
      <AnimatePresence initial={false}>
        {meals.map((meal) => {
          const s = summariseMeal(meal, dishes)
          const filled = meal.courses.filter((c) => c.dish_id).length
          return (
            <MCard key={meal.id} onClick={() => onOpen(meal)} layout className="flex items-center gap-3 px-3.5 py-3">
              <span
                className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] text-[30px]"
                style={{ background: 'var(--m-butter-soft)', border: '2px solid var(--m-line)' }}
              >
                {meal.emoji || occasionEmoji(meal.occasion)}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-extrabold leading-tight">{meal.name}</span>
                <span className="mt-0.5 block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                  {occasionLabel(meal.occasion)}
                  {meal.planned_for ? ` · ${prettyDate(meal.planned_for)}` : ''}
                  {` · ${filled}/${meal.courses.length} courses`}
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.cost != null && <Stat>{formatPrice(s.cost)}</Stat>}
                  {s.nutrition.totals.calories != null && (
                    <Stat tone="var(--m-mint-soft)">{Math.round(s.nutrition.totals.calories)} kcal / plate</Stat>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 -space-x-2">
                {s.dishes.slice(0, 3).map((d) => (
                  <span
                    key={d.id}
                    className="grid h-8 w-8 place-items-center rounded-full text-[15px]"
                    style={{ background: 'var(--m-card)', border: '2px solid var(--m-line)' }}
                  >
                    {d.emoji}
                  </span>
                ))}
              </div>
            </MCard>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/** "2026-09-12" → "Fri 12 Sep". */
export function prettyDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
