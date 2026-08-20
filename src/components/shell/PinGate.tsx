import { useState } from 'react'
import { motion } from 'motion/react'
import { Icon } from '../primitives/Icon'
import { unlockWithPin } from '@/lib/supabase'
import { fire } from '@/lib/haptics'
import { unlockAudio } from '@/lib/sound'

const PIN_LENGTH = 4

/**
 * The one-time household unlock.
 *
 * Shown once per device, ever — supabase-js persists and refreshes the session
 * indefinitely afterwards, so from the second launch onward "signing in" is
 * just tapping your name.
 */
export function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'wrong' | 'offline'>('idle')

  async function submit(code: string) {
    setState('checking')
    const result = await unlockWithPin(code)
    if (result.ok) {
      fire('success')
      onUnlocked()
      return
    }
    fire('error')
    setState(result.reason === 'offline' ? 'offline' : 'wrong')
    setPin('')
  }

  function press(digit: string) {
    unlockAudio()
    if (state === 'wrong' || state === 'offline') setState('idle')
    if (pin.length >= PIN_LENGTH) return

    fire('tap')
    const next = pin + digit
    setPin(next)
    if (next.length === PIN_LENGTH) void submit(next)
  }

  function backspace() {
    fire('toggleOff')
    setPin((p) => p.slice(0, -1))
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8 safe-top safe-bottom">
      <div className="text-center">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          <Icon name="pin" size={26} />
        </div>
        <h1 className="text-[24px] font-bold tracking-tight">Household code</h1>
        <p className="mt-1.5 max-w-[280px] text-[14px]" style={{ color: 'var(--text-dim)' }}>
          {state === 'wrong'
            ? "That's not it — try again."
            : state === 'offline'
              ? "Can't reach the server. Check your connection."
              : 'Just this once on this device.'}
        </p>
      </div>

      <motion.div
        className="flex gap-3"
        animate={state === 'wrong' ? { x: [0, -9, 9, -6, 6, 0] } : { x: 0 }}
        transition={{ duration: 0.38 }}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className="h-3.5 w-3.5 rounded-full transition-colors"
            style={{
              background: i < pin.length ? 'var(--accent)' : 'transparent',
              border: `2px solid ${i < pin.length ? 'var(--accent)' : 'var(--border-strong)'}`,
            }}
          />
        ))}
      </motion.div>

      <div className="grid w-full max-w-[280px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <PinKey key={d} onClick={() => press(d)} disabled={state === 'checking'}>
            {d}
          </PinKey>
        ))}
        <span />
        <PinKey onClick={() => press('0')} disabled={state === 'checking'}>
          0
        </PinKey>
        <PinKey onClick={backspace} disabled={state === 'checking' || pin.length === 0}>
          <Icon name="close" size={19} />
        </PinKey>
      </div>
    </div>
  )
}

function PinKey({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      className="grid h-16 place-items-center rounded-2xl text-[22px] font-medium disabled:opacity-40"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {children}
    </motion.button>
  )
}
