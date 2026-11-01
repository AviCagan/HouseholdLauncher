import { useData } from '@/store/useData'
import { useMealsUI } from './store'

/**
 * Act on a deep link into Meals: {tab, id}, or {tab: 'shelf'}. Shared with the
 * laptop page, which calls it whenever a link arrives rather than on mount.
 */
export function openMealsLink(link: Record<string, unknown>): void {
  const { setTab, openSheet } = useMealsUI.getState()
  const { dishes, meals } = useData.getState()
  const wanted = link.tab
  if (wanted === 'dishes' || wanted === 'meals' || wanted === 'templates' || wanted === 'plan') setTab(wanted)
  if (wanted === 'shelf') openSheet({ kind: 'shelf' })
  const id = typeof link.id === 'string' ? link.id : null
  if (!id) return
  const dish = dishes.find((d) => d.id === id)
  if (dish) openSheet({ kind: 'dish', dish })
  const meal = meals.find((m) => m.id === id)
  if (meal) openSheet({ kind: 'meal', meal })
}
