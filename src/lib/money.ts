/**
 * Prices are stored as integer cents, never floats — 0.1 + 0.2 problems have
 * no place in a total you're going to read.
 */

/**
 * Parse whatever someone types into cents.
 * Accepts "12", "12.5", "12.99", "$12.99", "1,299.00". Returns null for
 * anything it can't make sense of, so a typo clears rather than guesses.
 */
export function parsePrice(input: string): number | null {
  const cleaned = input.replace(/[$£€,\s]/g, '').trim()
  if (!cleaned) return null

  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null

  // Round rather than truncate so "19.999" doesn't quietly become 19.99.
  return Math.round(n * 100)
}

/** 1299 -> "$12.99", 130000 -> "$1,300" (whole amounts drop the cents). */
export function formatPrice(cents: number | null | undefined): string {
  if (cents == null) return ''
  const dollars = cents / 100
  const whole = cents % 100 === 0
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/** Value for an <input> being edited — no symbol, no thousands separators. */
export function priceToInput(cents: number | null | undefined): string {
  if (cents == null) return ''
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

export const sumPrices = (items: { price_cents: number | null }[]): number =>
  items.reduce((total, i) => total + (i.price_cents ?? 0), 0)
