import type { ThingsStock } from '@/data/types'

/**
 * At or below its low level. The database's things_stock_low() trigger
 * uses the same rule to put the item on the shopping list.
 */
export function isLow(row: Pick<ThingsStock, 'on_hand' | 'low_at'>): boolean {
  return row.low_at !== null && row.on_hand <= row.low_at
}
