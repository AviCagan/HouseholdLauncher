/**
 * Which desktop dialogs are open, in the order they opened.
 *
 * Two things need the answer. Escape should close the dialog on top and only
 * that one — Meals opens the shopping export over a meal, Watched opens the
 * poster picker over a show — and a single keypress unwinding the whole pile
 * loses whatever was being typed underneath. And the desktop shell's
 * single-key shortcuts ("n" for new, "j"/"k" to move) must stand down while a
 * dialog has the keyboard, or typing "jam" into a shopping item would walk the
 * list behind it.
 *
 * Plain module state: nothing renders from it, and every reader asks at the
 * moment a key is pressed rather than subscribing.
 */

let next = 1
const stack: number[] = []

/** Register a dialog as open. Returns the function that unregisters it. */
export function pushDialog(): { id: number; pop: () => void } {
  const id = next++
  stack.push(id)
  return {
    id,
    pop: () => {
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
    },
  }
}

export const isTopDialog = (id: number): boolean => stack[stack.length - 1] === id

export const anyDialogOpen = (): boolean => stack.length > 0
