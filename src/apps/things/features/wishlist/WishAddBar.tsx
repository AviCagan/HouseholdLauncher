import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { Avatar } from '@/components/primitives/ClaimChip'
import { fire } from '@/lib/haptics'
import { parsePrice } from '@/lib/money'
import { unfurl, isUrl, domainOf } from '@/lib/unfurl'
import { newId } from '@/data/adapter'
import { toast } from 'sonner'
import { DesireMeter } from '@/components/primitives/DesireMeter'
import { type Desire } from '@/data/types'

/**
 * Wishlist add bar. Uses the want-meter rather than the urgency dot, matching
 * the tab's own visual language.
 */
export function WishAddBar() {
  const profileId = useProfile((s) => s.profileId)
  const profiles = useData((s) => s.profiles)
  // Who the wish is for: you, then your partner, then both. null = both.
  const [owner, setOwner] = useState<string | null>(profileId)
  const [value, setValue] = useState('')
  const [price, setPrice] = useState('')
  const [showPrice, setShowPrice] = useState(false)
  const [desire, setDesire] = useState<Desire>(3)
  const [focused, setFocused] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function commit() {
    const raw = value.trim()
    if (!raw) return

    const manualPrice = price.trim() ? parsePrice(price) : null

    // Not a link: straightforward add.
    if (!isUrl(raw)) {
      void dataActions.addWish(raw, desire, profileId, {
        owner_id: owner,
        ...(manualPrice != null ? { price_cents: manualPrice } : {}),
      })
      setValue('')
      setPrice('')
      inputRef.current?.focus()
      return
    }

    // A link goes in immediately using the domain, then fills itself in when
    // the preview comes back — waiting on the network before the item appears
    // would make pasting feel broken.
    const id = newId()
    void dataActions.addWish(domainOf(raw), desire, profileId, {
      id,
      owner_id: owner,
      url: raw,
      ...(manualPrice != null ? { price_cents: manualPrice } : {}),
    })
    setValue('')
    setPrice('')
    inputRef.current?.focus()

    setLoadingPreview(true)
    const preview = await unfurl(raw)
    setLoadingPreview(false)

    if (!preview) {
      // Silent by design when the unfurl service isn't set up — the item is
      // already added and usable, it just kept the domain as its name.
      return
    }

    await dataActions.patchRow('wishlist_items', id, {
      ...(preview.title ? { title: preview.title.slice(0, 120) } : {}),
      ...(preview.image ? { image_url: preview.image } : {}),
      // Never let a scraped price overwrite one that was typed in.
      ...(manualPrice == null && preview.priceCents != null
        ? { price_cents: preview.priceCents }
        : {}),
    })
    fire('success')
    toast.success('Filled in from the link', {
      description: 'Tap the title or price to change either.',
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence>
        {showPrice && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            transition={{ duration: 0.2 }}
            /* The parent bar is pointer-events-none so taps fall through to
               the grid; this panel has to opt back in. */
            className="pointer-events-auto mx-3 overflow-hidden"
          >
            <div
              className="flex items-center gap-2 rounded-2xl p-2"
              style={{
                background: 'var(--dock-bg)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid var(--border)',
              }}
            >
              <span
                className="pl-2 text-[15px] font-semibold"
                style={{ color: 'var(--text-faint)' }}
              >
                $
              </span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit()
                  }
                }}
                placeholder="How much?"
                inputMode="decimal"
                enterKeyHint="done"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--text-faint)]"
              />
              {price.trim() && parsePrice(price) === null && (
                <span className="pr-2 text-[12px]" style={{ color: 'var(--warn)' }}>
                  not a number
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <WishBar
        owner={owner}
        profiles={profiles}
        cycleOwner={() => {
          fire('snap')
          const order: (string | null)[] = [
            profileId,
            ...profiles.filter((p) => p.id !== profileId).map((p) => p.id),
            null,
          ]
          const i = order.indexOf(owner)
          setOwner(order[(i + 1) % order.length])
        }}
        value={value}
        setValue={setValue}
        desire={desire}
        setDesire={setDesire}
        focused={focused}
        setFocused={setFocused}
        inputRef={inputRef}
        commit={() => void commit()}
        loadingPreview={loadingPreview}
        showPrice={showPrice}
        togglePrice={() => {
          fire(showPrice ? 'toggleOff' : 'toggleOn')
          setShowPrice((p) => !p)
        }}
        hasPrice={price.trim().length > 0}
      />
    </div>
  )
}

function WishBar({
  owner,
  profiles,
  cycleOwner,
  value,
  setValue,
  desire,
  setDesire,
  focused,
  setFocused,
  inputRef,
  commit,
  loadingPreview,
  showPrice,
  togglePrice,
  hasPrice,
}: {
  owner: string | null
  profiles: import('@/data/types').Profile[]
  cycleOwner: () => void
  value: string
  setValue: (v: string) => void
  desire: Desire
  setDesire: (d: Desire) => void
  focused: boolean
  setFocused: (f: boolean) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  commit: () => void
  loadingPreview: boolean
  showPrice: boolean
  togglePrice: () => void
  hasPrice: boolean
}) {
  const on = showPrice || hasPrice

  return (
    <div
      className="pointer-events-auto mx-3 flex items-center gap-2 rounded-full px-2 py-2"
      style={{
        background: 'var(--dock-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: `1px solid ${focused ? 'var(--accent-muted)' : 'var(--border)'}`,
        boxShadow: 'var(--shadow-dock)',
      }}
    >
      <span
        className="flex h-8 shrink-0 items-center rounded-full px-2.5"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <DesireMeter value={desire} onChange={setDesire} size="sm" />
      </span>

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={loadingPreview ? 'Reading the link…' : 'Add or paste a link…'}
        enterKeyHint="done"
        // min-w-0 lets the field actually shrink inside the flex row; without
        // it the text runs on underneath the buttons instead of scrolling.
        className="w-full min-w-0 flex-1 truncate bg-transparent px-1 outline-none placeholder:text-[var(--text-faint)]"
      />

      <OwnerButton owner={owner} profiles={profiles} onClick={cycleOwner} />

      <button
        onClick={togglePrice}
        type="button"
        aria-label={showPrice ? 'Hide price' : 'Add a price'}
        aria-pressed={on}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[15px] font-bold"
        style={{
          background: on ? 'var(--accent)' : 'transparent',
          color: on ? '#fff' : 'var(--text-faint)',
          border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
        }}
      >
        $
      </button>

      <motion.button
        onClick={commit}
        aria-label="Add"
        animate={{ scale: value.trim() ? 1 : 0.86, opacity: value.trim() ? 1 : 0.45 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
        style={{ background: 'var(--accent)' }}
      >
        <Icon name="plus" size={19} strokeWidth={2.6} />
      </motion.button>
    </div>
  )
}


/** Who this wish is for — tap to cycle you → them → both. */
function OwnerButton({
  owner,
  profiles,
  onClick,
}: {
  owner: string | null
  profiles: import('@/data/types').Profile[]
  onClick: () => void
}) {
  const p = profiles.find((x) => x.id === owner) ?? null

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={p ? `For ${p.display_name}. Tap to change.` : 'For both of you. Tap to change.'}
      className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full text-[13px]"
      style={{
        background: p
          ? `color-mix(in oklab, ${p.color_hex} 26%, transparent)`
          : 'var(--surface-2)',
        border: `1.5px solid ${p ? p.color_hex : 'var(--border-strong)'}`,
        color: 'var(--text-dim)',
      }}
    >
      {p ? (
        <Avatar profile={p} size={30} />
      ) : (
        // Both of you: two overlapping dots rather than a third avatar.
        <span className="flex items-center">
          {profiles.slice(0, 2).map((x, i) => (
            <span
              key={x.id}
              className="block h-2.5 w-2.5 rounded-full"
              style={{
                background: x.color_hex,
                marginLeft: i === 0 ? 0 : -4,
                border: '1px solid var(--surface-2)',
              }}
            />
          ))}
        </span>
      )}
    </button>
  )
}
