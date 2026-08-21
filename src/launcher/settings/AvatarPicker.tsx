import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/primitives/ClaimChip'
import { dataActions } from '@/store/useData'
import { fileToAvatarDataUrl, dataUrlBytes } from '@/lib/image'
import { fire } from '@/lib/haptics'
import type { Profile } from '@/data/types'

/**
 * Your photo: pick, downscale, store. The emoji stays as the fallback.
 *
 * Lives in the launcher rather than in Things, where it started, because the
 * photo was never a Things setting — it appears on the sign-in screen, in the
 * people list, on every claim chip and against every entry on the Owe list.
 * Editing launcher-wide identity from inside one of the apps meant the answer
 * to "where do I change my picture" was a different place from "where do I
 * change my name", for no reason other than which app happened to be built
 * first.
 *
 * Stored as a data URI on the profile row. Two people do not justify a storage
 * bucket, and `fileToAvatarDataUrl` downscales hard enough that the row stays
 * small — the 400KB ceiling below is a backstop for an image that resists it.
 */
export function AvatarPicker({ profile }: { profile: Profile }) {
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      if (dataUrlBytes(dataUrl) > 400_000) {
        throw new Error('That image is too large even after resizing')
      }
      await dataActions.patchRow('profiles', profile.id, { avatar_url: dataUrl })
      fire('success')
      setChoosing(false)
    } catch (err) {
      fire('error')
      toast.error(err instanceof Error ? err.message : "Couldn't use that photo")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4 px-3.5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <span
        className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full text-[26px]"
        style={{
          background: `color-mix(in oklab, ${profile.color_hex} 24%, transparent)`,
          border: `2px solid ${profile.color_hex}`,
        }}
      >
        <Avatar profile={profile} size={56} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">Your photo</div>
        <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {profile.avatar_url ? 'Shown wherever you appear' : 'Using your emoji for now'}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {!choosing ? (
          <button
            onClick={() => {
              fire('tap')
              setChoosing(true)
            }}
            className="rounded-full px-3 py-2 text-[12px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            {profile.avatar_url ? 'Change' : 'Add photo'}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            {/* Two inputs rather than one: `capture` opens the camera straight
                away, and without it the picker offers the photo library. There
                is no single control that offers both. */}
            <label
              className="cursor-pointer rounded-full px-3 py-2 text-[12px] font-semibold text-white"
              style={{ background: 'var(--accent)', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Saving…' : 'Camera'}
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => {
                  void pick(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>

            <label
              className="cursor-pointer rounded-full px-3 py-2 text-[12px] font-semibold"
              style={{
                background: 'var(--surface-3)',
                color: 'var(--text)',
                opacity: busy ? 0.6 : 1,
              }}
            >
              Library
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void pick(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>

            <button
              onClick={() => {
                fire('tap')
                setChoosing(false)
              }}
              aria-label="Cancel"
              className="px-1 text-[12px]"
              style={{ color: 'var(--text-faint)' }}
            >
              Cancel
            </button>
          </div>
        )}

        {profile.avatar_url && !choosing && (
          <button
            onClick={() => {
              fire('delete')
              void dataActions.patchRow('profiles', profile.id, { avatar_url: null })
            }}
            className="px-1 text-[12px]"
            style={{ color: 'var(--text-faint)' }}
          >
            Remove photo
          </button>
        )}
      </div>
    </div>
  )
}
