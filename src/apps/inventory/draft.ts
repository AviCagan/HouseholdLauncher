import { parsePrice, priceToInput } from '@/lib/money'
import type { InventoryItem } from '@/data/types'
import type { ItemInput } from './actions'
import { isoDay } from './model'

/** The item form's working copy: every field a string, as inputs hold them. */
export interface Draft {
  name: string
  brand: string
  model: string
  category: string
  store: string
  price: string
  paid_by: string
  purchased_on: string
  warranty_until: string
  location: string
  notes: string
}

export function draftOf(item: InventoryItem | null): Draft {
  return {
    name: item?.name ?? '',
    brand: item?.brand ?? '',
    model: item?.model ?? '',
    category: item?.category ?? '',
    store: item?.store ?? '',
    price: priceToInput(item?.price_cents ?? null),
    paid_by: item?.paid_by ?? '',
    purchased_on: item?.purchased_on ?? (item ? '' : isoDay(new Date())),
    warranty_until: item?.warranty_until ?? '',
    location: item?.location ?? '',
    notes: item?.notes ?? '',
  }
}

export function inputOf(d: Draft): ItemInput {
  return {
    name: d.name,
    brand: d.brand,
    model: d.model,
    category: d.category,
    store: d.store,
    price_cents: d.price.trim() ? parsePrice(d.price) : null,
    paid_by: d.paid_by,
    purchased_on: d.purchased_on || null,
    warranty_until: d.warranty_until || null,
    location: d.location,
    notes: d.notes,
  }
}

export const priceProblem = (d: Draft): string | null =>
  d.price.trim() && parsePrice(d.price) === null ? "That price isn't a number" : null
