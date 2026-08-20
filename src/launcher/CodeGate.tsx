import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { redeemCode } from '@/lib/household'
import { unlockWithPin } from '@/lib/supabase'
import { fire } from '@/lib/haptics'
import { unlockAudio } from '@/lib/sound'

/**
 * Sign in with a household code.
 *
 * The code is the whole credential — there is no email, no password and no
 * account to create, by design. Each person has their own, which is what makes
 * "Jordan can see the Owe list but not the shopping list" enforceable rather
 * than cosmetic: the code decides which member the session belongs to, and the
 * database answers every later question from that.
 *
 * A free-text field rather than the old PIN keypad, because codes are now
 * words and digits ("SUNSET42") instead of four numbers. Anything typed is
 * normalised server-side, so spacing and case never make a correct code wrong.
 */
export function CodeGate({ onUnlocked }: { onUnlocked: (profileId: string | null) => void }) {
  const [code, setCode] = useState('')
  const [reveal, setReveal] = useState(false)
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    const entered = code.trim()
    if (!entered || state === 'checking') return

    unlockAudio()
    setState('checking')
    setMessage(null)

    const result = await redeemCode(entered)
    if (result.ok) {
      fire('success')
      onUnlocked(result.data.id)
      return
    }

    /*
      Fall back to the pre-launcher shared PIN.

      Both phones were signed in with one four-digit code before any of this
      existed, and the function that hands out personal codes needs an owner
      session to call — so on a fresh install, before anyone has been given a
      code, the old PIN is the only way in and the only way to bootstrap the
      new scheme. Settings closes this off once real codes exist.
    */
    const legacy = await unlockWithPin(entered)
    if (legacy.ok) {
      fire('success')
      // No member identity behind a legacy session: the caller falls back to
      // asking which of the two people you are.
      onUnlocked(null)
      return
    }

    fire('error')
    setState('error')
    setMessage(legacy.reason === 'offline' ? "Can't reach the household right now" : result.error)
    setCode('')
    inputRef.current?.focus()
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-8 safe-top safe-bottom">
      <div className="text-center">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          <Icon name="key" size={25} />
        </div>
        <h1 className="text-[24px] font-bold tracking-tight">Household code</h1>
        <p className="mt-1.5 max-w-[290px] text-[14px]" style={{ color: 'var(--text-dim)' }}>
          {state === 'error' && message ? message : 'Enter your code to get in.'}
        </p>
      </div>

      <motion.div
        className="w-full max-w-[320px]"
        animate={state === 'error' ? { x: [0, -9, 9, -6, 6, 0] } : { x: 0 }}
        transition={{ duration: 0.38 }}
      >
        <div
          className="flex items-center gap-2 rounded-2xl px-4"
          style={{
            background: 'var(--surface-2)',
            border: `1px solid ${state === 'error' ? 'var(--danger)' : 'var(--border)'}`,
          }}
        >
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => {
              if (state === 'error') setState('idle')
              // Upper-cased as you type so what you see matches what's on the
              // note it was written on.
              setCode(e.target.value.toUpperCase())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            // `password` would trigger a save-password prompt for something
            // that is not a password and has no username to pair with.
            type={reveal ? 'text' : 'password'}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="SUNSET42"
            aria-label="Household code"
            disabled={state === 'checking'}
            className="min-w-0 flex-1 bg-transparent py-4 text-[19px] font-semibold tracking-[0.14em] outline-none placeholder:tracking-normal placeholder:opacity-35"
          />
          <button
            onClick={() => {
              fire('tap')
              setReveal((r) => !r)
            }}
            aria-label={reveal ? 'Hide code' : 'Show code'}
            style={{ color: 'var(--text-faint)' }}
          >
            <Icon name={reveal ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => void submit()}
          disabled={!code.trim() || state === 'checking'}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[16px] font-semibold text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          {state === 'checking' ? 'Checking…' : 'Enter'}
          {state !== 'checking' && <Icon name="arrowRight" size={17} strokeWidth={2.4} />}
        </motion.button>
      </motion.div>

      <p className="max-w-[280px] text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>
        Asked for once on this device. Avi or Jackie can give you a code, or
        change yours in Settings.
      </p>
    </div>
  )
}
