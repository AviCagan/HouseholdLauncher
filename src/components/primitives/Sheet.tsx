import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { Icon } from './Icon'
import { fire } from '@/lib/haptics'
import { isDesktop } from '@/lib/surface'
import { isTopDialog, pushDialog } from '@/lib/dialogStack'

/**
 * How a sheet is drawn on the laptop page (see lib/surface.ts).
 *
 *   dialog — centred, sized for a form. The default.
 *   wide   — centred and wider, for something with its own navigation inside
 *            (Settings) or a lot of side-by-side fields.
 *   drawer — full height along the right edge, for a feed you glance at while
 *            the page behind stays readable (notifications, activity).
 */
export type DesktopSheet = 'dialog' | 'wide' | 'drawer'

/**
 * Bottom sheet with drag-to-dismiss. Every modal surface in the app uses it.
 *
 * On the desktop page the same component becomes a dialog closed with Escape
 * or a click outside — so every edit form in every app works there unchanged,
 * rather than each one being rebuilt for a pointer.
 */
export function Sheet(props: SheetProps) {
  if (isDesktop()) return <DesktopSheetView {...props} />
  return <PhoneSheet {...props} />
}

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  maxHeight?: string
  /**
   * Pins the sheet to a fixed height instead of letting it size to its
   * content. For a sheet whose content can be swapped in place — the activity
   * feed's Summary/History tabs — sizing to content means the whole sheet
   * jumps up or down every time you switch, because the two views are
   * different heights. Fixing the height moves the difference into the inner
   * scroll area, where it belongs.
   */
  height?: string
  /** Shape on the desktop page. Ignored on the phone. */
  desktop?: DesktopSheet
}

function PhoneSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = '86vh',
  height,
}: SheetProps) {
  const dragControls = useDragControls()

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              fire('tap')
              onClose()
            }}
            style={{ background: 'rgb(0 0 0 / 0.5)', backdropFilter: 'blur(3px)' }}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[81] flex flex-col safe-bottom"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            drag="y"
            // Only the handle and title start a drag. With the whole sheet
            // draggable, any control you drag inside it — the colour wheel,
            // a slider — pulled the sheet down instead of doing its job.
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 550) {
                fire('tap')
                onClose()
              }
            }}
            style={{
              background: 'var(--bg-elevated)',
              borderRadius: '26px 26px 0 0',
              borderTop: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
              maxHeight,
              ...(height ? { height } : {}),
            }}
          >
            <div
              className="grid shrink-0 cursor-grab place-items-center pt-3 pb-2"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div
                className="h-1 w-10 rounded-full"
                style={{ background: 'var(--border-strong)' }}
              />
            </div>

            {title && (
              <div
                className="flex shrink-0 items-center justify-between px-5 pb-4 pt-1"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => {
                  // Not from the close button — that would swallow the tap.
                  if ((e.target as HTMLElement).closest('button')) return
                  dragControls.start(e)
                }}
              >
                <h2 className="text-[17px] font-semibold">{title}</h2>
                <button
                  onClick={() => {
                    fire('tap')
                    onClose()
                  }}
                  aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded-full"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            )}

            <div className="scroll-y min-h-0 flex-1 px-5 pb-8">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

const DESKTOP_WIDTH: Record<DesktopSheet, string> = {
  dialog: 'min(620px, calc(100vw - 48px))',
  wide: 'min(880px, calc(100vw - 48px))',
  drawer: 'min(460px, calc(100vw - 48px))',
}

/**
 * The laptop form of a sheet.
 *
 * Keeps everything the phone version guarantees — one component per surface,
 * mounted permanently and animated by `open` — and swaps the gesture for the
 * keyboard. Escape closes the dialog on top of the stack and nothing under
 * it; focus moves into the dialog when it opens and back to whatever had it
 * when it closes, so a keyboard user is never left stranded on a control the
 * dialog covered.
 */
function DesktopSheetView({ open, onClose, title, children, maxHeight, height, desktop = 'dialog' }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const entry = pushDialog()
    const before = document.activeElement as HTMLElement | null

    // After the first paint, so a field the form autofocuses keeps its focus
    // and only a dialog with nothing focused takes it onto itself.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopDialog(entry.id)) return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      entry.pop()
      if (before && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [open])

  const drawer = desktop === 'drawer'
  const cap = drawer ? '100vh' : `min(${height ?? maxHeight ?? '86vh'}, calc(100vh - 64px))`

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            style={{ background: drawer ? 'rgb(0 0 0 / 0.28)' : 'rgb(0 0 0 / 0.45)', backdropFilter: 'blur(2px)' }}
          />
          <div
            className={`pointer-events-none fixed inset-0 z-[81] flex ${drawer ? 'justify-end' : 'items-center justify-center p-6'}`}
          >
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              className="desk-sheet pointer-events-auto flex flex-col outline-none"
              initial={drawer ? { x: 40, opacity: 0 } : { y: 12, scale: 0.98, opacity: 0 }}
              animate={drawer ? { x: 0, opacity: 1 } : { y: 0, scale: 1, opacity: 1 }}
              exit={drawer ? { x: 40, opacity: 0 } : { y: 8, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              style={{
                width: DESKTOP_WIDTH[desktop],
                height: drawer ? '100vh' : height ? cap : undefined,
                maxHeight: cap,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: drawer ? '18px 0 0 18px' : 20,
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-3 pt-5">
                <h2 className="min-w-0 flex-1 text-[17px] font-semibold">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  title="Close (Esc)"
                  className="desk-hover grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="desk-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-7">{children}</div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
