import { motion } from 'motion/react'
import type { Profile } from '@/data/types'
import { fire } from '@/lib/haptics'
import { unlockAudio } from '@/lib/sound'

/**
 * "Sign in" — tap your name. No passwords, no accounts.
 *
 * The choice is remembered per device, so this screen appears on first launch
 * and whenever someone deliberately switches from Settings.
 */
export function ProfileSelect({
  profiles,
  onSelect,
}: {
  profiles: Profile[]
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 px-6 safe-top safe-bottom">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center"
      >
        <h1 className="text-[34px] font-bold tracking-tight">Things</h1>
        <p className="mt-1 text-[15px]" style={{ color: 'var(--text-dim)' }}>
          Who's this?
        </p>
      </motion.div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        {profiles.map((p, i) => (
          <motion.button
            key={p.id}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.07, type: 'spring', stiffness: 320, damping: 26 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              // First real gesture — the only moment iOS lets us open audio.
              unlockAudio()
              fire('success')
              onSelect(p.id)
            }}
            className="flex items-center gap-4 rounded-[22px] p-4 text-left"
            style={{
              background: `linear-gradient(135deg, color-mix(in oklab, ${p.color_hex} 18%, var(--surface)) 0%, var(--surface) 70%)`,
              border: `1px solid color-mix(in oklab, ${p.color_hex} 38%, transparent)`,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <span
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[26px]"
              style={{
                background: `color-mix(in oklab, ${p.color_hex} 24%, transparent)`,
                border: `2px solid ${p.color_hex}`,
              }}
            >
              {p.avatar_emoji}
            </span>
            <span className="flex-1">
              <span className="block text-[20px] font-semibold">{p.display_name}</span>
              <span className="block text-[13px]" style={{ color: 'var(--text-dim)' }}>
                Tap to continue
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
