import { useEffect, useRef } from 'react'
import { fire } from '@/lib/haptics'

/**
 * Tap for the everyday thing, hold for the careful version: tap "Finished
 * season" to finish it now, hold it to say when. Returns props to spread on
 * the button.
 *
 * A scroll that starts on the button cancels the hold (the browser sends
 * pointercancel), and the click that follows a hold is swallowed, so a hold
 * never also counts as a tap.
 */
export function useHold(onTap: () => void, onHold: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])

  const cancel = () => clearTimeout(timer.current)
  return {
    onPointerDown: () => {
      held.current = false
      cancel()
      timer.current = setTimeout(() => {
        held.current = true
        fire('longPress')
        onHold()
      }, ms)
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // The phone's own long-press menu would otherwise fight the hold.
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClick: () => {
      if (held.current) {
        held.current = false
        return
      }
      onTap()
    },
  }
}
