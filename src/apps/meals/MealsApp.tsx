import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useLauncher } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import { Confetti } from './doodles'
import { DishesTab } from './DishesTab'
import { DishSheet } from './DishSheet'
import { ImportSheet } from './ImportSheet'
import { MealSheet } from './MealSheet'
import { MealsTab } from './MealsTab'
import { TemplateSheet, TemplatesTab } from './TemplatesTab'
import { useMealsUI, type MealsTab as TabKey } from './store'
import { POP, useReduceMotion } from './ui'
import './meals.css'

/**
 * Meals.
 *
 * Three tabs — the dishes you know how to make, the meals you've put them
 * into, and the templates that give a meal its shape — under one bouncy
 * header and a tomato-red button that does all the adding.
 *
 * Everything visual about this app is scoped by the `.meals` class on the
 * root; see meals.css for what that buys and why.
 */

const TABS: { key: TabKey; label: string; emoji: string }[] = [
  { key: 'dishes', label: 'Dishes', emoji: '🥘' },
  { key: 'meals', label: 'Meals', emoji: '🍽️' },
  { key: 'templates', label: 'Templates', emoji: '📋' },
]

export function MealsApp() {
  const tab = useMealsUI((s) => s.tab)
  const setTab = useMealsUI((s) => s.setTab)
  const sheet = useMealsUI((s) => s.sheet)
  const openSheet = useMealsUI((s) => s.openSheet)
  const closeSheet = useMealsUI((s) => s.closeSheet)
  const burst = useMealsUI((s) => s.burst)
  const goHome = useLauncher((s) => s.goHome)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)
  const dishes = useData((s) => s.dishes)
  const meals = useData((s) => s.meals)
  const [fab, setFab] = useState(false)

  /*
    Honour a notification tap: {tab, id}. The dish or meal is opened only if
    it is actually loaded — a notification for something since deleted lands
    on the right tab and nothing more.
  */
  useEffect(() => {
    const link = consumeDeepLink()
    if (!link) return
    const wanted = link.tab
    if (wanted === 'dishes' || wanted === 'meals' || wanted === 'templates') setTab(wanted)
    const id = typeof link.id === 'string' ? link.id : null
    if (!id) return
    const dish = dishes.find((d) => d.id === id)
    if (dish) openSheet({ kind: 'dish', dish })
    const meal = meals.find((m) => m.id === id)
    if (meal) openSheet({ kind: 'meal', meal })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeDeepLink])

  return (
    <div className="meals flex h-full flex-col">
      <header className="shrink-0 px-4 pb-2 pt-[max(var(--safe-top),0.75rem)]">
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9, rotate: -8 }}
            onClick={() => {
              fire('tap')
              goHome()
            }}
            aria-label="Back to the launcher"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
            style={{ background: 'var(--m-card)', border: '2.5px solid var(--m-line)', boxShadow: 'var(--m-shadow-sm)', color: 'var(--m-ink)' }}
          >
            <Icon name="back" size={20} strokeWidth={2.8} />
          </motion.button>
          <div className="min-w-0 flex-1">
            <h1 className="m-title relative inline-block text-[28px] leading-none">
              Meals
              <svg className="absolute -bottom-1.5 left-0 w-full" height="7" viewBox="0 0 100 7" preserveAspectRatio="none" aria-hidden>
                <path d="M2 4 Q 15 1, 28 4 T 54 4 T 80 4 T 98 4" fill="none" stroke="var(--m-tomato)" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </h1>
            <p className="mt-1.5 text-[12px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
              {dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'} · {meals.length} {meals.length === 1 ? 'meal' : 'meals'}
            </p>
          </div>
        </div>

        <nav className="mt-3 flex gap-1.5 rounded-[20px] p-1.5" style={{ background: 'var(--m-card)', border: '2.5px solid var(--m-line)', boxShadow: 'var(--m-shadow-sm)' }} aria-label="Sections">
          {TABS.map((t) => {
            const active = t.key === tab
            return (
              <button
                key={t.key}
                onClick={() => {
                  if (active) return
                  fire('snap')
                  setTab(t.key)
                }}
                aria-current={active ? 'page' : undefined}
                className="relative flex flex-1 items-center justify-center gap-1.5 rounded-[14px] py-2 text-[13px] font-extrabold"
                style={{ color: active ? '#fff' : 'var(--m-ink)' }}
              >
                {active && (
                  <motion.span layoutId="meals-tab" className="absolute inset-0 rounded-[14px]" style={{ background: 'var(--m-tomato)' }} transition={{ type: 'spring', stiffness: 520, damping: 34 }} />
                )}
                <span className="relative">{t.emoji}</span>
                <span className="relative">{t.label}</span>
              </button>
            )
          })}
        </nav>
      </header>

      <div className="scroll-y min-h-0 flex-1 px-4 pb-[120px] pt-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={POP}
          >
            {tab === 'dishes' && <DishesTab />}
            {tab === 'meals' && <MealsTab />}
            {tab === 'templates' && <TemplatesTab />}
          </motion.div>
        </AnimatePresence>
      </div>

      <Fab
        open={fab}
        onToggle={() => setFab((v) => !v)}
        onPick={(kind) => {
          setFab(false)
          if (kind === 'dish') openSheet({ kind: 'dish', dish: null })
          if (kind === 'import') openSheet({ kind: 'import' })
          if (kind === 'meal') openSheet({ kind: 'meal', meal: null })
          if (kind === 'template') openSheet({ kind: 'template', template: null })
        }}
      />

      <DishSheet
        open={sheet?.kind === 'dish'}
        dish={sheet?.kind === 'dish' ? sheet.dish : null}
        draft={sheet?.kind === 'dish' ? sheet.draft : undefined}
        note={sheet?.kind === 'dish' ? sheet.note : undefined}
        onClose={closeSheet}
      />
      <MealSheet
        open={sheet?.kind === 'meal'}
        meal={sheet?.kind === 'meal' ? sheet.meal : null}
        template={sheet?.kind === 'meal' ? sheet.template : null}
        onClose={closeSheet}
      />
      <TemplateSheet open={sheet?.kind === 'template'} template={sheet?.kind === 'template' ? sheet.template : null} onClose={closeSheet} />
      <ImportSheet open={sheet?.kind === 'import'} onClose={closeSheet} />
      <Confetti burst={burst} />
    </div>
  )
}

/**
 * The add button: a tomato that bobs, and fans out into what you can add.
 *
 * The fan is three labelled buttons rather than icons alone; on a phone the
 * difference between "add a dish" and "plan a meal" has to be readable at a
 * glance, and an icon for either is a guess.
 */
function Fab({ open, onToggle, onPick }: { open: boolean; onToggle: () => void; onPick: (k: 'dish' | 'import' | 'meal' | 'template') => void }) {
  const reduce = useReduceMotion()
  const options: { key: 'dish' | 'import' | 'meal' | 'template'; label: string; emoji: string; tone: string }[] = [
    { key: 'meal', label: 'Plan a meal', emoji: '🍽️', tone: 'var(--m-butter)' },
    { key: 'import', label: 'Import a recipe', emoji: '🔗', tone: 'var(--m-sky)' },
    { key: 'dish', label: 'Add a dish', emoji: '🥘', tone: 'var(--m-mint)' },
  ]
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-end gap-2 px-5 pb-[max(var(--safe-bottom),1rem)]">
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              className="pointer-events-auto fixed inset-0 -z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onToggle}
              style={{ background: 'rgb(58 36 24 / 0.35)' }}
            />
            {options.map((o, i) => (
              <motion.button
                key={o.key}
                initial={{ opacity: 0, y: 16, scale: 0.7 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.7 }}
                transition={{ ...POP, delay: reduce ? 0 : (options.length - 1 - i) * 0.05 }}
                onClick={() => {
                  fire('snap')
                  onPick(o.key)
                }}
                className="m-card m-press pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 text-[14px] font-extrabold"
                style={{ background: o.tone, borderRadius: 999 }}
              >
                <span className="text-[18px]">{o.emoji}</span>
                {o.label}
              </motion.button>
            ))}
          </>
        )}
      </AnimatePresence>

      <motion.button
        whileTap={{ scale: 0.9 }}
        animate={{ rotate: open ? 45 : 0 }}
        transition={POP}
        onClick={() => {
          fire(open ? 'toggleOff' : 'toggleOn')
          onToggle()
        }}
        aria-label={open ? 'Close' : 'Add something'}
        aria-expanded={open}
        className={`pointer-events-auto grid h-[60px] w-[60px] place-items-center rounded-full ${open || reduce ? '' : 'm-bob'}`}
        style={{ background: 'var(--m-tomato)', border: '3px solid var(--m-line)', boxShadow: 'var(--m-shadow)', color: '#fff' }}
      >
        <Icon name="plus" size={28} strokeWidth={3} />
      </motion.button>
    </div>
  )
}
