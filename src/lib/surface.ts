/**
 * Which shell is drawing the app: the phone launcher, or the laptop one.
 *
 * One codebase, two pages. `index.html` is the launcher as it has always
 * been — one app at a time, thumb-sized, every modal a bottom sheet you drag
 * away. `desktop/index.html` is the same data, the same sign-in and the same
 * edit forms laid out for a keyboard, a pointer and a wide screen.
 *
 * Most code never needs to ask. The few places that do are the ones whose
 * phone form is wrong on a laptop rather than merely small: a bottom sheet
 * dragged down by its handle becomes a dialog you close with Escape, and a
 * toast moves out from under the notch it was avoiding.
 *
 * Module state rather than React context because it is fixed for the life of
 * the page — it is decided by which HTML file loaded, before the first render
 * — and because `Sheet` is used from forty call sites that should not each
 * have to thread a prop through.
 */

export type Surface = 'phone' | 'desktop'

let surface: Surface = 'phone'

export function setSurface(next: Surface): void {
  surface = next
  if (typeof document !== 'undefined') document.documentElement.dataset.surface = next
}

export const isDesktop = (): boolean => surface === 'desktop'
