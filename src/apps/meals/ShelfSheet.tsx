import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { domainOf } from '@/lib/unfurl'
import { openExternal } from '@/apps/things/routing/deeplink'
import type { Dish } from '@/data/types'
import { removeDish, updateDish } from './actions'
import { shelved } from './shelf'
import { useMealsUI } from './store'
import { BigButton, POP, Stat } from './ui'

/**
 * The want-to-try shelf, behind the star.
 *
 * Recipes found and saved but not yet cooked. Each one is a card with the
 * page it came from, and three ways out: open the page, make it a proper
 * dish (it moves to the Dishes tab), or drop it.
 */
export function ShelfSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dishes = useData((s) => s.dishes)
  const profileId = useProfile((s) => s.profileId)
  const openSheet = useMealsUI((s) => s.openSheet)
  const list = shelved(dishes)

  return (
    <Sheet open={open} onClose={onClose} title={<span className="m-title text-[18px]">⭐ Want to try</span>} height={list.length > 2 ? '88vh' : undefined}>
      <div className="meals -mx-4 -mb-4 flex flex-col gap-3 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        {list.length === 0 ? (
          <div className="grid place-items-center gap-2 px-6 py-8 text-center">
            <span className="text-[40px]">🔖</span>
            <span className="m-title text-[18px]">Nothing on the shelf</span>
            <span className="max-w-[270px] text-[13.5px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
              When you import a recipe you’re not sure about yet, choose “Save for later” and it lands here — even when
              the site won’t let the reader in, the link is kept.
            </span>
            <BigButton
              onClick={() => {
                onClose()
                openSheet({ kind: 'import' })
              }}
              tone="var(--m-sky)"
              ink="var(--m-ink)"
              className="mt-2 !w-auto !px-5 !py-2.5 !text-[14px]"
            >
              🔗 Import a recipe
            </BigButton>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {list.map((dish) => (
              <ShelfCard
                key={dish.id}
                dish={dish}
                onOpen={() => {
                  onClose()
                  openSheet({ kind: 'dish', dish })
                }}
                onKeep={() => {
                  updateDish(dish, { tags: dish.tags.filter((t) => t !== 'want-to-try') }, profileId)
                  toast.success(`${dish.emoji} ${dish.name} is one of your dishes now`)
                }}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </Sheet>
  )
}

function ShelfCard({ dish, onOpen, onKeep }: { dish: Dish; onOpen: () => void; onKeep: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const domain = dish.source_url ? domainOf(dish.source_url) : null
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={POP}
      className="m-card flex flex-col overflow-hidden"
    >
      {dish.image_url && <img src={dish.image_url} alt="" className="h-32 w-full object-cover" style={{ borderBottom: '2.5px solid var(--m-line)' }} />}
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <button onClick={onOpen} className="flex items-center gap-2.5 text-left">
          <span className="text-[24px]">{dish.emoji}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-extrabold leading-tight">{dish.name}</span>
            <span className="block truncate text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
              {domain ?? 'no link'} · saved {new Date(dish.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          </span>
          <Icon name="chevron" size={15} />
        </button>
        <div className="flex flex-wrap gap-1">
          <Stat tone={dish.ingredients.length ? 'var(--m-mint-soft)' : 'var(--m-card-2)'}>
            {dish.ingredients.length ? `${dish.ingredients.length} ingredients` : 'link only'}
          </Stat>
          {dish.steps.length > 0 && <Stat tone="var(--m-sky-soft)">{dish.steps.length} steps</Stat>}
        </div>
        <div className="flex gap-1.5">
          {dish.source_url && (
            <button
              onClick={() => {
                fire('tap')
                openExternal(dish.source_url!)
              }}
              className="m-chip"
              style={{ background: 'var(--m-sky-soft)' }}
            >
              🔗 Open the page
            </button>
          )}
          <button
            onClick={() => {
              fire('success')
              onKeep()
            }}
            className="m-chip"
            style={{ background: 'var(--m-mint-soft)' }}
          >
            ✅ Make it a dish
          </button>
          <button
            onClick={() => {
              if (!confirm) {
                fire('warning')
                setConfirm(true)
                return
              }
              removeDish(dish)
            }}
            className="m-chip ml-auto"
            style={confirm ? { background: '#ff4d4d', color: '#fff', borderColor: 'var(--m-line)' } : { background: 'var(--m-card)' }}
          >
            {confirm ? 'Drop it?' : '✕'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}
