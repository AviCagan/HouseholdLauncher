import { motion } from 'motion/react'
import type { Profile } from '@/data/types'

/**
 * Who's taken this.
 *
 * Unclaimed shows an explicit "Claim" button rather than an empty circle —
 * a blank outline reads as decoration, and nobody taps decoration. Once
 * claimed it collapses to that person's avatar, which is what you actually
 * want to scan for down a list.
 */
export function ClaimChip({
  claimedBy,
  profiles,
  onClick,
  size = 30,
  compact = false,
}: {
  claimedBy: string | null
  profiles: Profile[]
  onClick?: () => void
  size?: number
  /** Avatar only, never the wider button — for dense rows. */
  compact?: boolean
}) {
  const owner = profiles.find((p) => p.id === claimedBy) ?? null

  if (!owner) {
    if (compact) return null
    return (
      <motion.button
        onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
        whileTap={{ scale: 0.94 }}
        aria-label="Claim this"
        className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold"
        style={{
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent-muted)',
          color: 'var(--accent-text)',
        }}
      >
        Claim
      </motion.button>
    )
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      aria-label={`Claimed by ${owner.display_name}. Tap to release.`}
      title={owner.display_name}
      className="grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size }}
    >
      <motion.span
        key={owner.id}
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 22 }}
        className="grid h-full w-full place-items-center overflow-hidden rounded-full"
        style={{
          background: `color-mix(in oklab, ${owner.color_hex} 26%, transparent)`,
          border: `1.5px solid ${owner.color_hex}`,
          fontSize: size * 0.5,
          lineHeight: 1,
        }}
      >
        <Avatar profile={owner} size={size} />
      </motion.span>
    </button>
  )
}

/** Photo when one is set, emoji otherwise. Used everywhere a person appears. */
export function Avatar({ profile, size = 30 }: { profile: Profile; size?: number }) {
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt={profile.display_name}
        className="h-full w-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return <span>{profile.avatar_emoji}</span>
}
