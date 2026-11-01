import { useCallback, useState } from 'react'

/**
 * State that survives a reload, for view choices only — which columns are
 * showing, whether the sidebar is narrow. Anything that is data lives in the
 * database like everything else; this is per browser on purpose.
 */
export function usePersisted<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          /* private mode: the choice just doesn't outlive the tab */
        }
        return resolved
      })
    },
    [key],
  )
  return [value, set]
}
