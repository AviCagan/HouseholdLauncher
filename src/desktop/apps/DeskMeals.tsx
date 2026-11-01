import { AnimatePresence, motion } from 'motion/react'
import { useData } from '@/store/useData'
import { DishesTab } from '@/apps/meals/DishesTab'
import { MealsTab } from '@/apps/meals/MealsTab'
import { TemplatesTab } from '@/apps/meals/TemplatesTab'
import { PlepTab } from '@/apps/meals/PlepTab'
import { MealsSheets } from '@/apps/meals/MealsApp'
import { openMealsLink } from '@/apps/meals/deepLink'
import { shelved } from '@/apps/meals/shelf'
import { useMealsUI, type MealsTab as TabKey } from '@/apps/meals/store'
import { POP } from '@/apps/meals/ui'
import { useKeys } from '../keys'
import { Kbd } from '../ui'
import { useDeepLink } from '../useDeepLink'
import '@/apps/meals/meals.css'

/**
 * Meals on a laptop.
 *
 * The four tabs are the phone's own, which is the point — a dish card, a meal
 * card and the planner already are what Meals looks like, and the sticker
 * book should feel like the same book at any size. What changes is how much
 * of it fits: the dish stickers flow into as many columns as the window
 * holds, saved meals sit two and three across, and Plep becomes a real
 * calendar, a week to a row and a day to a column (see desktop.css).
 *
 * The phone's floating tomato fans out into three choices; here they are
 * simply three buttons in the header, each with a key.
 */

const TABS: { key: TabKey; label: string; emoji: string }[] = [
  { key: 'dishes', label: 'Dishes', emoji: '🥘' },
  { key: 'meals', label: 'Meals', emoji: '🍽️' },
  { key: 'templates', label: 'Templates', emoji: '📋' },
  { key: 'plan', label: 'Plep', emoji: '📆' },
]

export function DeskMeals() {
  const tab = useMealsUI((s) => s.tab)
  const setTab = useMealsUI((s) => s.setTab)
  const openSheet = useMealsUI((s) => s.openSheet)
  const dishes = useData((s) => s.dishes)
  const meals = useData((s) => s.meals)
  const onShelf = shelved(dishes).length
  const cookable = dishes.length - onShelf

  useDeepLink('meals', openMealsLink)

  useKeys([
    ...TABS.map((t, i) => ({ keys: String(i + 1), run: () => setTab(t.key), label: `${t.label}`, group: 'Meals' })),
    { keys: 'p', run: () => openSheet({ kind: 'meal', meal: null }), label: 'Plan a meal', group: 'Meals' },
    { keys: 'd', run: () => openSheet({ kind: 'dish', dish: null }), label: 'Add a dish', group: 'Meals' },
    { keys: 'i', run: () => openSheet({ kind: 'import' }), label: 'Import a recipe from a link', group: 'Meals' },
    { keys: 'w', run: () => openSheet({ kind: 'shelf' }), label: 'Want to try', group: 'Meals' },
    {
      keys: '/',
      run: () => {
        setTab('dishes')
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.meals input[aria-label="Search dishes"]')?.focus())
      },
      label: 'Search dishes',
      group: 'Meals',
    },
  ])

  return (
    <div className="meals flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-4 px-6 pb-3 pt-5">
        <div className="min-w-0">
          <h1 className="m-title relative inline-block text-[30px] leading-none">
            Meals
            <svg className="absolute -bottom-1.5 left-0 w-full" height="7" viewBox="0 0 100 7" preserveAspectRatio="none" aria-hidden>
              <path d="M2 4 Q 15 1, 28 4 T 54 4 T 80 4 T 98 4" fill="none" stroke="var(--m-tomato)" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </h1>
          <p className="mt-2 text-[12px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
            {cookable} {cookable === 1 ? 'dish' : 'dishes'} · {meals.length} {meals.length === 1 ? 'meal' : 'meals'}
          </p>
        </div>

        <nav
          className="flex gap-1.5 rounded-[18px] p-1.5"
          style={{ background: 'var(--m-card)', border: '2.5px solid var(--m-line)', boxShadow: 'var(--m-shadow-sm)' }}
          aria-label="Sections"
        >
          {TABS.map((t, i) => {
            const active = t.key === tab
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={active ? 'page' : undefined}
                title={`${t.label} (${i + 1})`}
                className="relative flex items-center gap-1.5 rounded-[12px] px-3.5 py-1.5 text-[13.5px] font-extrabold"
                style={{ color: active ? '#fff' : 'var(--m-ink)' }}
              >
                {active && (
                  <motion.span layoutId="desk-meals-tab" className="absolute inset-0 rounded-[12px]" style={{ background: 'var(--m-tomato)' }} transition={{ type: 'spring', stiffness: 520, damping: 34 }} />
                )}
                <span className="relative">{t.emoji}</span>
                <span className="relative">{t.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <HeaderButton onClick={() => openSheet({ kind: 'shelf' })} combo="w" tone={onShelf ? 'var(--m-butter)' : 'var(--m-card)'}>
            ⭐ Want to try{onShelf ? ` · ${onShelf}` : ''}
          </HeaderButton>
          <HeaderButton onClick={() => openSheet({ kind: 'import' })} combo="i" tone="var(--m-sky)">
            🔗 Import a recipe
          </HeaderButton>
          <HeaderButton onClick={() => openSheet({ kind: 'dish', dish: null })} combo="d" tone="var(--m-mint)">
            🥘 Add a dish
          </HeaderButton>
          <HeaderButton onClick={() => openSheet({ kind: 'meal', meal: null })} combo="p" tone="var(--m-tomato)" ink="#fff">
            🍽️ Plan a meal
          </HeaderButton>
        </div>
      </header>

      <div className="desk-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2">
        <div className={tab === 'dishes' || tab === 'plan' ? '' : 'max-w-[1400px]'}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={POP}>
              {tab === 'dishes' && <DishesTab />}
              {tab === 'meals' && <MealsTab />}
              {tab === 'templates' && <TemplatesTab />}
              {tab === 'plan' && <PlepTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <MealsSheets />
    </div>
  )
}

function HeaderButton({
  onClick,
  combo,
  tone,
  ink = 'var(--m-ink)',
  children,
}: {
  onClick: () => void
  combo: string
  tone: string
  ink?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="m-press flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-extrabold"
      style={{ background: tone, color: ink, border: '2.5px solid var(--m-line)', boxShadow: 'var(--m-shadow-sm)' }}
    >
      {children}
      <Kbd combo={combo} className="opacity-70" />
    </button>
  )
}
