import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Screen, Section, EmptyState } from '@/components/shell/Screen'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useUI } from '@/store/useUI'
import { SortBar, compareBy } from '@/components/shell/SortBar'
import { Avatar } from '@/components/primitives/ClaimChip'
import { fire } from '@/lib/haptics'
import { formatPrice, parsePrice, priceToInput, sumPrices } from '@/lib/money'
import { DesireMeter, DESIRE_COLOR } from '@/components/primitives/DesireMeter'
import { type WishlistItem, type Profile } from '@/data/types'

/**
 * The wishlist deliberately uses a different visual grammar from the other
 * tabs: cards with a desire gradient rising from the bottom edge, rather than
 * rows with an urgency spine. Fill height reads instantly across a grid, and
 * "how badly do I want this" never gets confused with "how urgent is this".
 */
export function WishlistTab() {
  const wishes = useData((s) => s.wishlist_items)
  const profiles = useData((s) => s.profiles)

  const wishSort = useUI((s) => s.sortBy.wishlist)
  const wishDesc = useUI((s) => s.sortDesc.wishlist)
  const wishOwner = useUI((s) => s.wishOwner)

  const { active, purchased } = useMemo(() => {
    const matchesOwner = (w: WishlistItem) => {
      if (wishOwner === null) return true
      if (wishOwner === 'shared') return w.owner_id === null
      return w.owner_id === wishOwner
    }

    const sorted = [...wishes].filter(matchesOwner).sort(compareBy(wishSort, wishDesc))

    return {
      active: sorted.filter((w) => !w.is_purchased),
      purchased: sorted.filter((w) => w.is_purchased),
    }
  }, [wishes, wishSort, wishDesc, wishOwner])

  const total = sumPrices(active)
  const priced = active.filter((w) => w.price_cents != null).length

  return (
    <Screen
      title="Wishlist"
      count={active.length}
      subtitle={
        total > 0 ? (
          <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
            <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatPrice(total)}
            </span>
            {priced === active.length ? ' total' : ` · ${priced} of ${active.length} priced`}
          </span>
        ) : undefined
      }
    >
      <SortBar
        tab="wishlist"
        options={[
          { key: 'desire', label: 'Wanted' },
          { key: 'price', label: 'Price' },
          { key: 'added', label: 'Added' },
        ]}
        trailing={<OwnerFilter profiles={profiles} />}
      />
      {active.length === 0 && purchased.length === 0 ? (
        <EmptyState
          icon={<Icon name="star" size={44} strokeWidth={1.5} />}
          title="Nothing on the list"
          hint="Stuff you want to buy for yourselves — not household needs. Tap the meter to say how badly."
        />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 px-1">
          <AnimatePresence initial={false}>
            {active.map((wish) => (
              <WishCard key={wish.id} wish={wish} profiles={profiles} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Section label="Bought" count={purchased.length}>
        <div className="grid grid-cols-2 gap-2.5 px-1">
          {purchased.map((wish) => (
            <WishCard key={wish.id} wish={wish} profiles={profiles} />
          ))}
        </div>
      </Section>
    </Screen>
  )
}

/**
 * Whose wish, as one compact control.
 *
 * Avatars rather than names: with four options plus three sort chips, names
 * pushed the row onto a second line, and a filter row that changes height as
 * you use it makes the grid below jump.
 */
function OwnerFilter({ profiles }: { profiles: Profile[] }) {
  const owner = useUI((s) => s.wishOwner)
  const setOwner = useUI((s) => s.setWishOwner)

  const options: { key: string | null; label: string; node: React.ReactNode; color?: string }[] = [
    { key: null, label: 'Everyone', node: <span className="text-[11px] font-semibold">All</span> },
    ...profiles.map((p) => ({
      key: p.id,
      label: p.display_name,
      color: p.color_hex,
      node: <Avatar profile={p} size={22} />,
    })),
    {
      key: 'shared',
      label: 'Both of you',
      node: (
        <span className="flex items-center">
          {profiles.slice(0, 2).map((p, i) => (
            <span
              key={p.id}
              className="block h-2 w-2 rounded-full"
              style={{
                background: p.color_hex,
                marginLeft: i === 0 ? 0 : -3,
                border: '1px solid var(--surface-2)',
              }}
            />
          ))}
        </span>
      ),
    },
  ]

  return (
    <div
      className="ml-1 flex shrink-0 items-center gap-0.5 rounded-full p-0.5"
      style={{ background: 'var(--surface-3)' }}
    >
      {options.map((o) => {
        const active = owner === o.key
        return (
          <button
            key={String(o.key)}
            onClick={() => {
              fire('snap')
              setOwner(o.key)
            }}
            aria-label={o.label}
            aria-pressed={active}
            className="grid h-[30px] w-[30px] place-items-center overflow-hidden rounded-full"
            style={{
              background: active
                ? (o.color ? `color-mix(in oklab, ${o.color} 34%, transparent)` : 'var(--accent)')
                : 'transparent',
              border: active && o.color ? `1.5px solid ${o.color}` : '1.5px solid transparent',
              color: active ? '#fff' : 'var(--text-dim)',
            }}
          >
            {o.node}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Price, edited in place. Tap it and it becomes an input — no sheet, no edit
 * mode, matching how urgency and desire are changed everywhere else.
 */
function PriceTag({ wish }: { wish: WishlistItem }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => priceToInput(wish.price_cents))

  function save() {
    setEditing(false)
    const cents = draft.trim() ? parsePrice(draft) : null
    if (cents === wish.price_cents) return
    fire('toggleOn')
    void dataActions.patchRow('wishlist_items', wish.id, { price_cents: cents })
  }

  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>$</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              setDraft(priceToInput(wish.price_cents))
              setEditing(false)
            }
          }}
          onClick={(e) => e.stopPropagation()}
          inputMode="decimal"
          placeholder="0.00"
          className="w-16 rounded-md px-1 text-[12px] outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--accent-muted)' }}
        />
      </div>
    )
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        fire('tap')
        setDraft(priceToInput(wish.price_cents))
        setEditing(true)
      }}
      className="mt-0.5 text-[12px]"
      style={{
        color: wish.price_cents == null ? 'var(--text-faint)' : 'var(--text-dim)',
        opacity: wish.price_cents == null ? 0.75 : 1,
      }}
    >
      {wish.price_cents == null ? 'add price' : formatPrice(wish.price_cents)}
    </button>
  )
}

function WishCard({ wish, profiles }: { wish: WishlistItem; profiles: Profile[] }) {
  const openSheet = useUI((s) => s.openSheet)
  const [confirming, setConfirming] = useState(false)
  const owner = profiles.find((p) => p.id === wish.owner_id) ?? null
  const color = DESIRE_COLOR[wish.desire_level]
  // Level 1 barely tints, level 5 floods the card.
  const fill = 8 + wish.desire_level * 17

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="relative flex flex-col justify-between overflow-hidden rounded-[var(--radius)] p-3"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        opacity: wish.is_purchased ? 0.55 : 1,
        minHeight: wish.image_url ? 180 : 132,
      }}
    >
      {wish.image_url && (
        <>
          <img
            src={wish.image_url}
            alt=""
            loading="lazy"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            // A broken link shouldn't leave a torn-image icon on the card.
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          {/* Scrim so the title stays readable over any photo. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, rgb(0 0 0 / .82) 0%, rgb(0 0 0 / .55) 45%, rgb(0 0 0 / .25) 100%)',
            }}
          />
        </>
      )}

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: `${fill}%`,
          background: `linear-gradient(to top, color-mix(in oklab, ${color} 42%, transparent), transparent)`,
        }}
      />

      <div className="relative z-10">
        {/* pr-5 keeps long titles clear of the delete button in the corner. */}
        <div
          className="pr-5 text-[14px] font-semibold leading-snug"
          style={{
            textDecoration: wish.is_purchased ? 'line-through' : 'none',
            color: wish.image_url ? '#fff' : undefined,
            textShadow: wish.image_url ? '0 1px 3px rgb(0 0 0 / .6)' : undefined,
          }}
        >
          {wish.title}
        </div>
        <PriceTag wish={wish} />
      </div>

      <div className="relative z-10 flex items-end justify-between gap-2">
        <DesireMeter
          value={wish.desire_level}
          onChange={(next) =>
            void dataActions.patchRow('wishlist_items', wish.id, { desire_level: next })
          }
          showLabel
        />

        <div className="flex items-center gap-1">
          {owner && (
            <span
              className="grid h-6 w-6 place-items-center rounded-full text-[12px]"
              style={{
                background: `color-mix(in oklab, ${owner.color_hex} 26%, transparent)`,
                border: `1.5px solid ${owner.color_hex}`,
              }}
              title={owner.display_name}
            >
              {owner.avatar_emoji}
            </span>
          )}
          {wish.url && (
            <button
              onClick={() => {
                fire('tap')
                window.open(wish.url!, '_blank', 'noopener,noreferrer')
              }}
              aria-label="Open link"
              className="grid h-6 w-6 place-items-center rounded-full"
              style={{ color: 'var(--text-faint)' }}
            >
              <Icon name="link" size={13} />
            </button>
          )}
          <button
            onClick={() => {
              fire(wish.is_purchased ? 'toggleOff' : 'complete')
              void dataActions.patchRow('wishlist_items', wish.id, {
                is_purchased: !wish.is_purchased,
                purchased_at: wish.is_purchased ? null : new Date().toISOString(),
              })
            }}
            aria-label={wish.is_purchased ? 'Mark not bought' : 'Mark bought'}
            className="grid h-6 w-6 place-items-center rounded-full"
            style={{
              border: `1.5px solid ${wish.is_purchased ? 'var(--ok)' : 'var(--border-strong)'}`,
              background: wish.is_purchased ? 'var(--ok)' : 'transparent',
              color: '#fff',
            }}
          >
            {wish.is_purchased && <Icon name="check" size={11} strokeWidth={3.4} />}
          </button>
        </div>
      </div>

      {confirming ? (
        <div className="absolute inset-0 z-20 grid place-items-center gap-2 p-3" style={{ background: 'var(--surface)' }}>
          <span className="text-[12px]">Delete this?</span>
          <div className="flex gap-2">
            <button
              onClick={() => void dataActions.remove('wishlist_items', wish.id)}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ background: 'var(--danger)' }}
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-full px-3 py-1.5 text-[12px]"
              style={{ color: 'var(--text-dim)' }}
            >
              Keep
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={() => {
              fire('tap')
              openSheet({ kind: 'item', table: 'wishlist_items', id: wish.id })
            }}
            aria-label="Edit"
            className="absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full opacity-45"
            style={{ color: 'var(--text-faint)' }}
          >
            <Icon name="pencil" size={12} strokeWidth={2.6} />
          </button>
          <button
            onClick={() => setConfirming(true)}
            aria-label="Delete"
            className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full opacity-45"
            style={{ color: 'var(--text-faint)' }}
          >
            <Icon name="close" size={12} strokeWidth={2.6} />
          </button>
        </>
      )}
    </motion.div>
  )
}
