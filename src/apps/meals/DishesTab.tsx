import { useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useData } from '@/store/useData'
import { formatPrice } from '@/lib/money'
import { DISH_KINDS, type Dish, type DishKind } from '@/data/types'
import { PotDoodle } from './doodles'
import { dishCost } from './nutrition'
import { cookable } from './shelf'
import { useMealsUI } from './store'
import { Chip, KIND_META, MCard, Stat, TextInput } from './ui'

/**
 * The library: every dish, as a grid of stickers.
 *
 * A search box and a row of kind chips are the whole navigation. Two columns
 * because a dish is mostly its emoji and its name, and one-per-row wastes the
 * width on a phone.
 */
export function DishesTab() {
  // Shelved recipes (see shelf.ts) live behind the star, not here.
  const dishes = cookable(useData((s) => s.dishes))
  const openSheet = useMealsUI((s) => s.openSheet)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<DishKind | null>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...dishes]
      .filter((d) => (kind ? d.kind === kind : true))
      .filter((d) =>
        q
          ? d.name.toLowerCase().includes(q) || d.ingredients.some((i) => i.name.toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [dishes, query, kind])

  if (dishes.length === 0) {
    return (
      <Empty
        doodle={<PotDoodle />}
        title="Nothing in the pot yet"
        hint="Add a dish, or paste a link to a recipe and let it read the page for you."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search dishes or ingredients…"
        aria-label="Search dishes"
      />

      <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1">
        <Chip active={kind === null} onClick={() => setKind(null)}>
          All
        </Chip>
        {DISH_KINDS.map((k) => (
          <Chip key={k} active={kind === k} color={KIND_META[k].color} onClick={() => setKind(kind === k ? null : k)}>
            {KIND_META[k].emoji} {KIND_META[k].label}
          </Chip>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="px-2 py-10 text-center text-[14px] font-semibold" style={{ color: 'var(--m-ink-faint)' }}>
          Nothing matches that.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 pb-2">
          <AnimatePresence initial={false}>
            {shown.map((dish) => (
              <DishCard key={dish.id} dish={dish} onOpen={() => openSheet({ kind: 'dish', dish })} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

export function DishCard({ dish, onOpen, compact = false }: { dish: Dish; onOpen: () => void; compact?: boolean }) {
  const cost = dishCost(dish)
  const kcal = dish.nutrition.calories
  const meta = KIND_META[dish.kind]
  return (
    <MCard onClick={onOpen} layout className={compact ? 'flex items-center gap-3 px-3 py-2.5' : 'flex flex-col px-3 pb-3 pt-4'}>
      <span
        className={`grid place-items-center rounded-[18px] ${compact ? 'h-12 w-12 text-[26px]' : 'mx-auto h-[68px] w-[68px] text-[38px]'}`}
        style={{ background: meta.soft, border: '2px solid var(--m-line)' }}
      >
        {dish.emoji}
      </span>
      <div className={compact ? 'min-w-0 flex-1' : 'mt-2.5 min-w-0 text-center'}>
        <span className="block truncate text-[14.5px] font-extrabold leading-tight">{dish.name}</span>
        <span className="mt-0.5 block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
          {meta.label} · serves {dish.servings}
        </span>
        <div className={`mt-2 flex flex-wrap gap-1 ${compact ? '' : 'justify-center'}`}>
          {cost != null && <Stat>{formatPrice(cost)}</Stat>}
          {kcal != null && <Stat tone="var(--m-mint-soft)">{Math.round(kcal)} kcal</Stat>}
          {cost == null && kcal == null && (
            <Stat tone="var(--m-card-2)">
              <span style={{ color: 'var(--m-ink-faint)' }}>no numbers yet</span>
            </Stat>
          )}
        </div>
      </div>
    </MCard>
  )
}

export function Empty({ doodle, title, hint }: { doodle: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="grid place-items-center gap-2 px-8 pb-10 pt-8 text-center">
      {doodle}
      <span className="m-title text-[19px]">{title}</span>
      <span className="max-w-[260px] text-[13.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
        {hint}
      </span>
    </div>
  )
}
