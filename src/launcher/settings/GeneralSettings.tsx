import { useState } from 'react'
import { Icon } from '@/components/primitives/Icon'
import { SettingsGroup, SettingsRow, PrimaryButton, Notice } from './SettingsSheet'
import { AvatarPicker } from './AvatarPicker'
import { useCurrentMember, useIsOwner } from '@/store/useMember'
import { useUI } from '@/store/useUI'
import { useData } from '@/store/useData'
import { closeLegacyAuth, setMemberCode, updateMember } from '@/lib/household'
import { signOut } from '@/lib/supabase'
import { useProfile } from '@/store/useProfile'
import { isConfigured } from '@/lib/env'
import { fire } from '@/lib/haptics'

/**
 * Your own settings: who you are, the code you sign in with, and the way out.
 *
 * Changing your code is here rather than under People because it is not an
 * administrative act — everyone can do it for themselves, including guests who
 * never see People at all.
 */
export function GeneralSettings() {
  const member = useCurrentMember()
  const isOwner = useIsOwner()
  const openThingsSettings = useUI((s) => s.openSheet)
  const household = useData((s) => s.household_settings)[0]

  const [name, setName] = useState(member?.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  async function saveName() {
    if (!member || !name.trim() || name.trim() === member.display_name) return
    setSaving(true)
    const result = await updateMember(member.id, { display_name: name.trim() })
    setSaving(false)
    setNotice(
      result.ok
        ? { text: 'Saved', tone: 'ok' }
        : { text: result.error, tone: 'error' },
    )
    if (result.ok) fire('success')
  }

  return (
    <>
      {member && (
        <SettingsGroup label="You">
          {/* Photo first: it is the thing you came here to change, and it says
              who this section is about better than the name field does. */}
          <AvatarPicker profile={member} />

          {/* No avatar on this row: the picker directly above already shows it,
              and two copies of the same face in one card reads as a mistake. */}
          <div className="flex items-center gap-3 px-3.5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              aria-label="Your name"
              // Read-only mid-save rather than disabled: disabling drops focus,
              // which fires onBlur again and saves a second time.
              readOnly={saving}
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none"
              style={{ opacity: saving ? 0.5 : 1 }}
            />
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ background: 'var(--surface-3)', color: 'var(--text-faint)' }}
            >
              {member.role ?? 'owner'}
            </span>
          </div>
          {notice && <Notice text={notice.text} tone={notice.tone} />}
        </SettingsGroup>
      )}

      {member && isConfigured() && <CodeCard profileId={member.id} />}

      <SettingsGroup label="Appearance & Things">
        <SettingsRow
          icon="sparkle"
          title="Theme, haptics and sound"
          subtitle="Accent colour, text size, vibration strength"
          right={<Icon name="chevron" size={16} />}
          onClick={() => {
            fire('tap')
            openThingsSettings({ kind: 'settings' })
          }}
        />
      </SettingsGroup>

      {isOwner && isConfigured() && household?.legacy_auth_enabled !== false && (
        <LegacyCard />
      )}

      <SettingsGroup>
        <SettingsRow
          icon="lock"
          tint="var(--danger)"
          title="Sign out of this device"
          subtitle="You'll need your household code to get back in"
          onClick={() => {
            fire('warning')
            void (async () => {
              await useProfile.getState().clearProfile()
              await signOut()
              // A full reload rather than resetting the stores by hand: every
              // one of them holds data from a session that no longer exists,
              // and unwinding that piecemeal is how a stale row survives into
              // the next person's session.
              window.location.reload()
            })()
          }}
        />
      </SettingsGroup>
    </>
  )
}

/**
 * Change your own household code.
 *
 * The current code is never shown, here or anywhere: only a peppered hash of
 * it reaches the database, so nothing can display it — which is the point. A
 * forgotten code is replaced, not recovered.
 */
function CodeCard({ profileId }: { profileId: string }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  async function save() {
    setBusy(true)
    setNotice(null)
    const result = await setMemberCode(profileId, code.trim())
    setBusy(false)

    if (result.ok) {
      fire('success')
      setCode('')
      setNotice({ text: `Your code is now ${result.data.code}`, tone: 'ok' })
      return
    }
    fire('error')
    setNotice({ text: result.error, tone: 'error' })
  }

  return (
    <SettingsGroup
      label="Your household code"
      hint="Leave it blank to have one generated. Codes ignore spaces and capitals, so SUNSET42 and sunset 42 both work."
    >
      <div className="px-3.5 py-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="New code"
          aria-label="New household code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="mb-2.5 w-full rounded-xl px-3 py-2.5 text-[15px] font-semibold tracking-[0.1em] outline-none placeholder:tracking-normal placeholder:opacity-35"
          style={{ background: 'var(--surface-3)' }}
        />
        <PrimaryButton onClick={() => void save()} busy={busy}>
          {code.trim() ? 'Change my code' : 'Generate a new code'}
        </PrimaryButton>
        {notice && <Notice text={notice.text} tone={notice.tone} />}
      </div>
    </SettingsGroup>
  )
}

/**
 * The last step of setup.
 *
 * While this is on, the pre-launcher shared PIN still opens every table — it
 * has to, because handing out the first personal code requires a session and
 * that PIN was the only one that existed. Once you and Jackie both have codes,
 * this is the switch that makes per-person access actually mean something.
 */
function LegacyCard() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  return (
    <SettingsGroup
      label="Security"
      hint="Until this is off, anyone with the old four-digit PIN can still see everything, whatever their app access says."
    >
      <div className="px-3.5 py-3">
        <p className="pb-2.5 text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
          The old shared PIN still works. Turn it off once you and Jackie have both
          set your own codes.
        </p>
        <PrimaryButton
          danger
          busy={busy}
          onClick={() => {
            setBusy(true)
            setNotice(null)
            void closeLegacyAuth().then((result) => {
              setBusy(false)
              if (result.ok) {
                fire('success')
                setNotice({ text: 'The old PIN no longer works.', tone: 'ok' })
              } else {
                fire('error')
                setNotice({ text: result.error, tone: 'error' })
              }
            })
          }}
        >
          Stop accepting the old PIN
        </PrimaryButton>
        {notice && <Notice text={notice.text} tone={notice.tone} />}
      </div>
    </SettingsGroup>
  )
}
