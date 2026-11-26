import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useCurrentMember } from '@/store/useMember'
import { appById } from '@/launcher/registry'
import { askNano, cancelAsk, nanoOnline, pickedUp, PICKUP_MS } from '@/lib/nano'
import { useNanoContext } from './context'
import { isConfigured } from '@/lib/env'
import { fire } from '@/lib/haptics'
import { openExternal } from '@/apps/things/routing/deeplink'

/**
 * The Nano button, floating over every app.
 *
 * It hands Nano a request with who's asking (written by the database, not
 * by this code), the app, the screen and the item that's open, and shows her
 * answer as she writes it. She may be unreachable: then it says so, and the
 * app carries on exactly as it would without her. Nothing in any app waits
 * on this.
 *
 * Shown only once the household has a Nano who is switched on.
 */
export function NanoButton({ appId }: { appId: string }) {
  const nano = useData((s) => s.nano)
  const me = useCurrentMember()
  const [open, setOpen] = useState(false)
  const app = appById(appId)

  if (!isConfigured() || !nano || nano.is_active === false || !me || !app) return null

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => {
          fire('tap')
          setOpen(true)
        }}
        aria-label="Ask Nano"
        className="fixed right-4 z-40 grid h-11 w-11 place-items-center rounded-full text-white shadow-lg"
        style={{
          bottom: `calc(var(--safe-bottom, 0px) + ${app.nano.buttonBottom}px)`,
          background: 'linear-gradient(135deg, #ff7ac6, #7c5cff)',
          boxShadow: '0 6px 18px rgba(124, 92, 255, 0.35)',
        }}
      >
        <Icon name="sparkle" size={20} strokeWidth={2.2} />
      </motion.button>
      {open && (
        <NanoSheet appId={appId} profileId={me.id} isPrivate={app.nano.private === true} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function NanoSheet({
  appId,
  profileId,
  isPrivate,
  onClose,
}: {
  appId: string
  profileId: string
  isPrivate: boolean
  onClose: () => void
}) {
  const { screen, item } = useNanoContext()
  const status = useData((s) => s.nano_status[0])
  const whatsapp = useData((s) => s.nano_settings[0]?.whatsapp ?? null)
  const [text, setText] = useState('')
  const [askId, setAskId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const ask = useData((s) => (askId ? s.nano_asks.find((a) => a.id === askId) : undefined))
  const online = nanoOnline(status)
  const app = appById(appId)

  // Twenty seconds to pick it up. Any write to the row counts.
  useEffect(() => {
    if (!askId) return
    const timer = window.setTimeout(() => setTimedOut(true), PICKUP_MS)
    return () => window.clearTimeout(timer)
  }, [askId])

  const screenName = screen ? screen.charAt(0).toUpperCase() + screen.slice(1) : null
  const where = [app?.name, screenName, item?.title ? `“${item.title}”` : null].filter(Boolean).join(' · ')

  if (isPrivate) {
    return (
      <Sheet open onClose={onClose} title="Ask Nano">
        <div className="px-5 pb-6">
          <p className="pb-4 text-[14px] leading-snug" style={{ color: 'var(--text-dim)' }}>
            Questions about this calendar go to Nano privately on WhatsApp, so nothing from it is saved anywhere else.
          </p>
          {whatsapp ? (
            <SheetButton
              onClick={() => {
                openExternal(`https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`)
                onClose()
              }}
            >
              Open WhatsApp
            </SheetButton>
          ) : (
            <p className="text-[13.5px]" style={{ color: 'var(--text-faint)' }}>
              Nano's WhatsApp number isn't set yet. Avi or Jackie can add it in Settings › People › Nano.
            </p>
          )}
        </div>
      </Sheet>
    )
  }

  const unreachable = ask && !pickedUp(ask) && (timedOut || !online)

  return (
    <Sheet open onClose={onClose} title="Ask Nano">
      <div className="px-5 pb-6">
        <p className="pb-3 text-[12.5px] font-medium" style={{ color: 'var(--text-faint)' }}>
          {where || 'Anywhere'}
          {!online && !ask && ' · Nano seems to be away right now'}
        </p>

        {!ask ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              autoFocus
              placeholder="What should Nano do?"
              aria-label="Your request for Nano"
              className="mb-3 w-full resize-none rounded-xl px-3 py-2.5 text-[15px] outline-none placeholder:opacity-40"
              style={{ background: 'var(--surface-3)' }}
            />
            <SheetButton
              disabled={!text.trim() || sending}
              onClick={() => {
                setSending(true)
                void askNano({ appId, screen, item }, text, profileId).then((row) => {
                  setSending(false)
                  if (row) {
                    fire('success')
                    setAskId(row.id)
                  }
                })
              }}
            >
              {sending ? 'Sending…' : 'Send to Nano'}
            </SheetButton>
          </>
        ) : (
          <>
            <p className="rounded-xl px-3 py-2.5 text-[14.5px]" style={{ background: 'var(--surface-3)' }}>
              {ask.body}
            </p>
            <div className="mt-3 min-h-[3.5rem] text-[14.5px] leading-snug">
              {ask.status === 'cancelled' ? (
                <span style={{ color: 'var(--text-faint)' }}>Cancelled.</span>
              ) : ask.answer ? (
                <p className="whitespace-pre-line">
                  <span className="font-semibold">Nano: </span>
                  {ask.answer}
                </p>
              ) : unreachable ? (
                <span style={{ color: 'var(--text-dim)' }}>
                  Nano isn't answering right now. You can leave this for her, and she'll pick it up when she's
                  back, or cancel it.
                </span>
              ) : pickedUp(ask) ? (
                <span style={{ color: 'var(--text-dim)' }}>Nano has it…</span>
              ) : (
                <span style={{ color: 'var(--text-dim)' }}>Sent. Waiting for Nano…</span>
              )}
            </div>
            {ask.status === 'waiting' && !pickedUp(ask) && (
              <div className="mt-3 flex gap-2">
                <div className="flex-1">
                  <SheetButton onClick={onClose}>Leave it for her</SheetButton>
                </div>
                <div className="flex-1">
                  <SheetButton
                    quiet
                    onClick={() => {
                      void cancelAsk(ask.id)
                      onClose()
                    }}
                  >
                    Cancel it
                  </SheetButton>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

function SheetButton({
  children,
  onClick,
  disabled,
  quiet,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  quiet?: boolean
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-full px-5 py-3 text-[15px] font-semibold disabled:opacity-40"
      style={quiet ? { background: 'var(--surface-3)' } : { background: 'var(--accent)', color: 'white' }}
    >
      {children}
    </motion.button>
  )
}
