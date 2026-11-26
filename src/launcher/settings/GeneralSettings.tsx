import { useEffect, useState } from 'react'
import { SettingsGroup, SettingsRow, PrimaryButton, Notice } from './SettingsSheet'
import { AvatarPicker } from './AvatarPicker'
import { AppearanceSettings } from './AppearanceSettings'
import { useCurrentMember, useIsOwner } from '@/store/useMember'
import { useData } from '@/store/useData'
import { closeLegacyAuth, setMemberCode, updateMember, whoAmI, type CodeFormat, type SignInSecurity } from '@/lib/household'
import { signOut } from '@/lib/supabase'
import { useProfile } from '@/store/useProfile'
import { isConfigured } from '@/lib/env'
import { fire } from '@/lib/haptics'
import { NanoAuthenticator } from './NanoSettings'
import { CodeField, codeReady } from './CodeField'

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

      {/* Not a link out to an app's settings any more. Theme, accent, text
          size and vibration are applied to the document root and are felt in
          every app, so they belong to the launcher — the only reason they used
          to live inside Things is that Things once was the whole app. */}
      <AppearanceSettings />

      {isOwner && isConfigured() && (
        <SecurityCard legacyOpen={household?.legacy_auth_enabled !== false} />
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
  const [format, setFormat] = useState<CodeFormat>('digits4')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  async function save() {
    setBusy(true)
    setNotice(null)
    const result = await setMemberCode(profileId, code.trim(), format)
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
      hint="4 digits, 6 digits, or 6 or more letters and numbers. Leave it blank to have one made up. After five wrong tries a phone has to wait, so a short code can't just be guessed."
    >
      <div className="px-3.5 py-3">
        <CodeField format={format} onFormat={setFormat} code={code} onCode={setCode} label="New household code" />
        <div className="mt-2.5">
          <PrimaryButton onClick={() => void save()} busy={busy} disabled={!codeReady(format, code)}>
            {code.trim() ? 'Change my code' : 'Make one up for me'}
          </PrimaryButton>
        </div>
        {notice && <Notice text={notice.text} tone={notice.tone} />}
      </div>
    </SettingsGroup>
  )
}

/**
 * How sign-in stands, for the owners.
 *
 * Two things can be wrong, and both are fixed in order: the server needs the
 * secret that protects stored codes before any code can be issued, and the
 * old shared PIN has to be turned off once Avi and Jackie have their own.
 *
 * While the PIN is on, it still opens every table — it has to, because
 * handing out the first personal code requires a session and that PIN was
 * the only one that existed. Turning it off is the switch that makes
 * per-person access actually mean something.
 */
function SecurityCard({ legacyOpen }: { legacyOpen: boolean }) {
  const [security, setSecurity] = useState<SignInSecurity | null>(null)

  useEffect(() => {
    let live = true
    void whoAmI().then((result) => {
      if (live && result.ok && result.data.security) setSecurity(result.data.security)
    })
    return () => {
      live = false
    }
  }, [])

  const noSecret = security?.pepper_set === false
  const me = useCurrentMember()

  return (
    <SettingsGroup
      label="Security"
      hint={
        legacyOpen
          ? 'Until the old PIN is off, anyone with those four digits can still see everything, whatever their app access says.'
          : undefined
      }
    >
      {/* Only with your own code: the shared PIN can't set the key Nano's
          approvals are checked against, and the database refuses it too. */}
      {me && <NanoAuthenticator />}
      {noSecret && (
        <div className="px-3.5 py-3" style={legacyOpen ? { borderBottom: '1px solid var(--border)' } : undefined}>
          <p className="text-[13px] leading-snug" style={{ color: 'var(--danger)' }}>
            The server can't issue household codes yet: the secret that protects them
            (HOUSEHOLD_CODE_PEPPER) isn't set. Set it once, then set your codes.
          </p>
        </div>
      )}
      {legacyOpen && <LegacyOff />}
    </SettingsGroup>
  )
}

function LegacyOff() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  return (
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
  )
}
