import { PUBLIC_APP_URL } from '@/lib/env'

/**
 * The link on an item's label.
 *
 * `?item=` and the id with its dashes taken out: 32 hex characters instead
 * of 36 keeps the whole address short enough for a version-5 QR code — 37
 * squares a side rather than 41 — so a small label still scans from a
 * comfortable distance. It reads back either way.
 */
export function itemUrl(id: string): string {
  return `${PUBLIC_APP_URL}?item=${id.replace(/-/g, '').toLowerCase()}`
}

const HEX32 = /^[0-9a-f]{32}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The item id a label's link points at, as a normal dashed uuid; null if it isn't one. */
export function itemIdFromUrl(url: string): string | null {
  let raw: string | null
  try {
    raw = new URL(url, PUBLIC_APP_URL).searchParams.get('item')
  } catch {
    return null
  }
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (UUID.test(v)) return v
  if (!HEX32.test(v)) return null
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`
}
