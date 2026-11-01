import { toast } from 'sonner'
import { dataActions } from '@/store/useData'
import { newId } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import { unfurl, isUrl, domainOf } from '@/lib/unfurl'
import { isDesktop } from '@/lib/surface'
import type { Desire, Store, Urgency } from '@/data/types'

/**
 * Adding a shopping item or a wish, including the case where what was typed
 * is a link.
 *
 * Shared by the phone's add bars and the laptop's column inputs, because the
 * link case is the fiddly one and it has to behave identically on both: the
 * row goes in at once under the link's domain, so pasting never waits on the
 * network, and the real title, photo and price fill in when the preview comes
 * back.
 */

/** How to change what the preview filled in, in the words of this surface. */
const editHint = (): string => (isDesktop() ? 'Click the item to change details.' : 'Long-press the item to change details.')

export async function addShoppingEntry(input: {
  title: string
  urgency: Urgency
  store: Pick<Store, 'id' | 'is_online'> | null
  profileId: string | null
  quantity?: string | null
}): Promise<void> {
  const { title, urgency, store, profileId } = input
  const storeId = store?.id ?? null

  // Online stores can carry a product link, the same way wishlist items do.
  if (store?.is_online && isUrl(title)) {
    const id = newId()
    await dataActions.addShoppingItem(domainOf(title), urgency, storeId, profileId, input.quantity ?? null, {
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
    toast.success('Filled in from the link', { description: editHint() })
    return
  }
  await dataActions.addShoppingItem(title, urgency, storeId, profileId, input.quantity ?? null)
}

export async function addWishEntry(input: {
  raw: string
  desire: Desire
  profileId: string | null
  /** Who it's for. null is both of you. */
  owner: string | null
  /** Typed in by hand; never overwritten by a scraped one. */
  priceCents: number | null
  /** Told when a link preview starts and stops loading, for a spinner. */
  onPreview?: (loading: boolean) => void
}): Promise<void> {
  const { raw, desire, profileId, owner, priceCents } = input

  if (!isUrl(raw)) {
    await dataActions.addWish(raw, desire, profileId, {
      owner_id: owner,
      ...(priceCents != null ? { price_cents: priceCents } : {}),
    })
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
    ...(priceCents != null ? { price_cents: priceCents } : {}),
  })

  input.onPreview?.(true)
  const preview = await unfurl(raw)
  input.onPreview?.(false)

  // Silent by design when the unfurl service isn't set up — the item is
  // already added and usable, it just kept the domain as its name.
  if (!preview) return

  await dataActions.patchRow('wishlist_items', id, {
    ...(preview.title ? { title: preview.title.slice(0, 120) } : {}),
    ...(preview.image ? { image_url: preview.image } : {}),
    ...(priceCents == null && preview.priceCents != null ? { price_cents: preview.priceCents } : {}),
  })
  fire('success')
  toast.success('Filled in from the link', {
    description: isDesktop() ? 'Click the wish to change any of it.' : 'Tap the title or price to change either.',
  })
}
