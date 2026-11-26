import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { pickPerson, signInWithCode, type Pickable } from '@/lib/household'
import { unlockWithPin } from '@/lib/supabase'
import { fire } from '@/lib/haptics'
import { unlockAudio } from '@/lib/sound'

/**
 * Sign in: the household code, then "who's this?", or someone's own code.
 *
 * The household code (the old shared PIN, to start with) answers with Avi
 * and Jackie; tapping a name signs this phone in as that person, a session of
 * their own, so everything kept to one person still knows who is who. A
 * friend's own code signs them straight in as themselves. There is no email,
 * no password and no account to create, by design. Anything typed is
 * normalised server-side, so spacing and case never make a correct code wrong.
 */
export function CodeGate({ onUnlocked }: { onUnlocked: (profileId: string | null) => void }) {
  const [code, setCode] = useState('')
  const [reveal, setReveal] = useState(false)
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [people, setPeople] = useState<Pickable[] | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    const entered = code.trim()
    if (!entered || state === 'checking') return

    unlockAudio()
    setState('checking')
    setMessage(null)

    const result = await signInWithCode(entered)
    if (result.ok && result.data.kind === 'member') {
      fire('success')
      onUnlocked(result.data.profile.id)
      return
    }
    if (result.ok && result.data.kind === 'pick') {
      fire('success')
      setState('idle')
      setPeople(result.data.people)
      return
    }

    /*
      An older household function that doesn't know `sign-in` yet: fall back
      to the shared account the way the app used to, so a deploy running a
      step behind never locks anyone out.
    */
    const legacy = result.error.startsWith('Unknown action') ? await unlockWithPin(entered) : { ok: false as const, reason: 'bad-pin' as const }
    if (legacy.ok) {
      fire('success')
      onUnlocked(null)
      return
    }

    fire('error')
    setState('error')
    setMessage(!result.ok ? result.error : "That code did not work")
    setCode('')
    inputRef.current?.focus()
  }

  async function choose(person: Pickable) {
    if (picking) return
    setPicking(person.id)
    setMessage(null)
    const result = await pickPerson(code.trim(), person.id)
    setPicking(null)
    if (result.ok) {
      fire('success')
      onUnlocked(result.data.id)
      return
    }
    fire('error')
    setMessage(result.error)
  }

  if (people) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-7 px-8 safe-top safe-bottom">
        <div className="text-center">
          <h1 className="text-[24px] font-bold tracking-tight">Who's this?</h1>
          <p className="mt-1.5 max-w-[290px] text-[14px]" style={{ color: message ? 'var(--danger)' : 'var(--text-dim)' }}>
            {message ?? 'This phone stays signed in as you.'}
          </p>
        </div>
        <div className="flex w-full max-w-[320px] flex-col gap-3">
          {people.map((person) => (
            <motion.button
              key={person.id}
              whileTap={{ scale: 0.97 }}
              disabled={picking !== null}
              onClick={() => void choose(person)}
              className="flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left disabled:opacity-60"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span
                className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full text-[24px]"
                style={{ background: `color-mix(in oklab, ${person.color_hex} 25%, transparent)` }}
              >
                {person.avatar_url ? (
                  <img src={person.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  person.avatar_emoji
                )}
              </span>
              <span className="flex-1 text-[18px] font-semibold">{person.display_name}</span>
              {picking === person.id ? (
                <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                  Signing in…
                </span>
              ) : (
                <Icon name="arrowRight" size={18} />
              )}
            </motion.button>
          ))}
        </div>
        <button
          onClick={() => {
            setPeople(null)
            setCode('')
            setMessage(null)
          }}
          className="text-[13px]"
          style={{ color: 'var(--text-faint)' }}
        >
          Use a different code
        </button>
      </div>
    )
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
          {state === 'error' && message ? message : 'Enter the household code, or your own code.'}
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
            placeholder="Code"
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
        Asked for once on this device. Friends get a code of their own from Avi
        or Jackie.
      </p>
    </div>
  )
}
