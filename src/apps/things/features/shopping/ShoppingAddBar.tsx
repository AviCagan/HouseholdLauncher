import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { QuickAdd } from '@/components/shell/QuickAdd'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { useUI } from '@/store/useUI'
import { fire } from '@/lib/haptics'
import { unfurl, isUrl, domainOf } from '@/lib/unfurl'
import { newId } from '@/data/adapter'
import type { Urgency } from '@/data/types'
import { toast } from 'sonner'

/** Quick-add carrying a store chip, so items land in the right group as typed. */
export function ShoppingAddBar() {
  const stores = useData((s) => s.stores)
  const profileId = useProfile((s) => s.profileId)
  const openSheet = useUI((s) => s.openSheet)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  /**
   * Keep the keyboard up when switching store.
   *
   * A tap on a chip would otherwise blur the input and dismiss the keyboard,
   * which breaks the rhythm of adding several items in a row. Suppressing the
   * default on pointerdown stops the button taking focus at all.
   */
  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault()
  const refocus = () => {
    const input = barRef.current?.querySelector('input')
    input?.focus()
  }

  const store = stores.find((s) => s.id === storeId) ?? null

  return (
    <div ref={barRef} className="flex flex-col gap-2">
      <AnimatePresence>
        {picking && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.2 }}
            /* pointer-events-auto: the parent bar is pointer-events-none so
               taps fall through to the list, and this panel must opt back in. */
            className="pointer-events-auto mx-3 overflow-hidden"
          >
            <div
              className="flex flex-wrap items-center gap-2 rounded-2xl p-2.5"
              style={{
                background: 'var(--dock-bg)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid var(--border)',
              }}
            >
              <button
                onPointerDown={keepFocus}
                onClick={() => {
                  fire('snap')
                  setStoreId(null)
                  setPicking(false)
                  refocus()
                }}
                className="rounded-full px-3 py-2 text-[13px] font-medium"
                style={{
                  background: storeId === null ? 'var(--accent)' : 'var(--surface-2)',
                  color: storeId === null ? '#fff' : 'var(--text-dim)',
                }}
              >
                No store
              </button>

              {stores.map((s) => (
                <button
                  key={s.id}
                  onPointerDown={keepFocus}
                  onClick={() => {
                    fire('snap')
                    setStoreId(s.id)
                    setPicking(false)
                    refocus()
                  }}
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium"
                  style={{
                    background: storeId === s.id ? s.color_hex : 'var(--surface-2)',
                    color: storeId === s.id ? '#fff' : 'var(--text-dim)',
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: storeId === s.id ? '#fff' : s.color_hex }}
                  />
                  {s.name}
                  {s.is_online && <Icon name="globe" size={10} strokeWidth={2.6} />}
                </button>
              ))}

              <button
                onClick={() => {
                  fire('tap')
                  setPicking(false)
                  openSheet({ kind: 'stores' })
                }}
                className="rounded-full px-3 py-2 text-[13px] font-medium"
                style={{ background: 'var(--surface-2)', color: 'var(--accent-text)' }}
              >
                + New store
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <QuickAdd
        placeholder={
          store?.is_online ? `Add or paste a link to ${store.name}…` : store ? `Add to ${store.name}…` : 'Add an item…'
        }
        onSubmit={async (title: string, urgency: Urgency) => {
          // Online stores can carry a product link, the same way wishlist
          // items do: add immediately using the domain as a placeholder title
          // so pasting never feels like it's waiting on the network, then fill
          // in the real title/photo/price once the unfurl comes back.
          if (store?.is_online && isUrl(title)) {
            const id = newId()
            await dataActions.addShoppingItem(domainOf(title), urgency, storeId, profileId, null, {
              id,
              url: title,
            })
            const preview = await unfurl(title)
            if (!preview) return
            await dataActions.patchRow('shopping_items', id, {
              ...(preview.title ? { title: preview.title.slice(0, 120) } : {}),
              ...(preview.image ? { image_url: preview.image } : {}),
              ...(preview.priceCents != null ? { price_cents: preview.priceCents } : {}),
            })
            fire('success')
            toast.success('Filled in from the link', {
              description: 'Long-press the item to change details.',
            })
            return
          }
          await dataActions.addShoppingItem(title, urgency, storeId, profileId)
        }}
        leading={
          <button
            onPointerDown={keepFocus}
            onClick={() => {
              fire('tap')
              setPicking((p) => !p)
            }}
            aria-label="Choose store"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
            style={{
              background: store ? store.color_hex : 'transparent',
              color: store ? '#fff' : 'var(--text-faint)',
              border: `1.5px solid ${store ? store.color_hex : 'var(--border-strong)'}`,
            }}
          >
            <Icon name="cart" size={14} strokeWidth={2.4} />
          </button>
        }
      />
    </div>
  )
}
