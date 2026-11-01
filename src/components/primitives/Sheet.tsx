import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { Icon } from './Icon'
import { fire } from '@/lib/haptics'
import { useDesktop } from '@/lib/useDesktop'

/**
 * The modal surface every app uses.
 *
 * On a phone it is a bottom sheet with drag-to-dismiss. On a laptop the same
 * component is a centred dialog: a sheet that slides up from the bottom of a
 * 900px-tall window and stretches the full width of it is a form you have to
 * read sideways. Nothing that opens a sheet knows which one it got, which is
 * what lets every app's forms work on a laptop without each being rewritten.
 *
 * Escape closes the topmost open sheet — only the topmost, so a dish sheet
 * over a meal sheet closes one layer per press, the way the close button does.
 */

/** Open sheets, oldest first. Escape goes to the last one in. */
const openStack: symbol[] = []

export function Sheet({
  open,
  onClose,
  title,
  children,
  maxHeight = '86vh',
  height,
}: {
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
}) {
  const dragControls = useDragControls()
  const desktop = useDesktop()

  // Read through a ref so the keyboard effect depends on `open` alone: an
  // inline `onClose` is a new function every render, and re-running the
  // effect for it would re-push this sheet onto the stack above one opened
  // on top of it.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const id = Symbol('sheet')
    openStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openStack[openStack.length - 1] !== id) return
      e.preventDefault()
      fire('tap')
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = openStack.indexOf(id)
      if (i >= 0) openStack.splice(i, 1)
    }
  }, [open])

  const close = () => {
    fire('tap')
    onClose()
  }

  const closeButton = (
    <button
      onClick={close}
      aria-label="Close"
      className="grid h-8 w-8 place-items-center rounded-full"
      style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
    >
      <Icon name="close" size={17} />
    </button>
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            style={{ background: 'rgb(0 0 0 / 0.5)', backdropFilter: 'blur(3px)' }}
          />

          {desktop ? (
            <motion.div
              role="dialog"
              aria-modal="true"
              className="fixed left-1/2 top-1/2 z-[81] flex w-[min(640px,calc(100vw-48px))] flex-col overflow-hidden"
              initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-48%' }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
              exit={{ opacity: 0, scale: 0.97, x: '-50%', y: '-49%' }}
              transition={{ type: 'spring', stiffness: 460, damping: 38 }}
              style={{
                background: 'var(--bg-elevated)',
                borderRadius: 24,
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-lg)',
                maxHeight: `min(${maxHeight}, calc(100vh - 48px))`,
                ...(height ? { height: `min(${height}, calc(100vh - 48px))` } : {}),
              }}
            >
              {title ? (
                <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-5">
                  <h2 className="min-w-0 flex-1 text-[17px] font-semibold">{title}</h2>
                  {closeButton}
                </div>
              ) : (
                <div className="absolute right-4 top-4 z-10">{closeButton}</div>
              )}
              <div className={`scroll-y min-h-0 flex-1 px-5 pb-6 ${title ? '' : 'pt-5'}`}>{children}</div>
            </motion.div>
          ) : (
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
                if (info.offset.y > 110 || info.velocity.y > 550) close()
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
                <div className="h-1 w-10 rounded-full" style={{ background: 'var(--border-strong)' }} />
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
                  {closeButton}
                </div>
              )}

              <div className="scroll-y min-h-0 flex-1 px-5 pb-8">{children}</div>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  )
}
