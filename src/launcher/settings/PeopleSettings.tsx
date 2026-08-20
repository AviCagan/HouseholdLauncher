import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { SettingsGroup, SettingsRow, Toggle, PrimaryButton, Notice } from './SettingsSheet'
import { APPS } from '@/launcher/registry'
import { useCurrentMember, type Member } from '@/store/useMember'
import { useData } from '@/store/useData'
import {
  createMember,
  setAppAccess,
  setMemberCode,
  updateMember,
  type NewMember,
} from '@/lib/household'
import { fire } from '@/lib/haptics'
import type { MemberRole } from '@/data/types'

/**
 * Add people, hand out codes, and decide what each of them can open.
 *
 * Owner-only, and the server agrees independently — every call here goes to
 * the household Edge Function, which re-checks the caller's role before it
 * touches anything. Hiding this tab is presentation; the refusal is real.
 */
export function PeopleSettings() {
  const me = useCurrentMember()
  const profiles = useData((s) => s.profiles) as Member[]
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const active = profiles.filter((p) => p.is_active !== false)
  const inactive = profiles.filter((p) => p.is_active === false)

  return (
    <>
      <SettingsGroup label="Household">
        {active.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            isSelf={person.id === me?.id}
            open={expanded === person.id}
            onToggle={() => {
              fire('tap')
              setExpanded((current) => (current === person.id ? null : person.id))
            }}
          />
        ))}
      </SettingsGroup>

      {inactive.length > 0 && (
        <SettingsGroup
          label="Removed"
          hint="Their history stays on the lists. Switching someone back on lets them sign in again with a new code."
        >
          {inactive.map((person) => (
            <SettingsRow
              key={person.id}
              title={<span style={{ opacity: 0.6 }}>{person.display_name}</span>}
              subtitle="Can't sign in"
              right={
                <Toggle
                  on={false}
                  label={`Restore ${person.display_name}`}
                  onChange={() => void updateMember(person.id, { is_active: true })}
                />
              }
            />
          ))}
        </SettingsGroup>
      )}

      <AnimatePresence initial={false} mode="wait">
        {adding ? (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <AddPersonForm onDone={() => setAdding(false)} />
          </motion.div>
        ) : (
          <motion.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <PrimaryButton
              onClick={() => {
                fire('tap')
                setAdding(true)
              }}
            >
              Add someone
            </PrimaryButton>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** One person, expanding to reveal their app grants and code controls. */
function PersonRow({
  person,
  isSelf,
  open,
  onToggle,
}: {
  person: Member
  isSelf: boolean
  open: boolean
  onToggle: () => void
}) {
  const access = useData((s) => s.app_access)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const role: MemberRole = person.role ?? 'owner'
  const grantedApps = APPS.filter((app) => {
    if (role === 'owner') return true
    const row = access.find((a) => a.profile_id === person.id && a.app_id === app.id)
    return row ? row.granted : app.defaultForEveryone === true
  })

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[17px]"
          style={{ background: `color-mix(in oklab, ${person.color_hex} 22%, transparent)` }}
        >
          {person.avatar_emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium">
            {person.display_name}
            {isSelf && (
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {' '}
                · you
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {role === 'owner'
              ? 'Owner · everything'
              : grantedApps.length === 0
                ? 'No apps yet'
                : grantedApps.map((a) => a.name).join(', ')}
          </span>
        </span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} style={{ color: 'var(--text-faint)' }}>
          <Icon name="chevron" size={16} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5" style={{ background: 'var(--surface-3)' }}>
              <p
                className="pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-faint)' }}
              >
                Can open
              </p>

              {APPS.map((app) => {
                const row = access.find((a) => a.profile_id === person.id && a.app_id === app.id)
                const granted =
                  role === 'owner' ? true : (row?.granted ?? app.defaultForEveryone === true)
                return (
                  <div key={app.id} className="flex items-center gap-3 py-1.5">
                    <span style={{ color: app.color }}>
                      <Icon name={app.icon} size={16} />
                    </span>
                    <span className="flex-1 text-[13.5px]">{app.name}</span>
                    <Toggle
                      on={granted}
                      label={`${app.name} access for ${person.display_name}`}
                      // An owner's access is not a grant to revoke — the server
                      // returns true for them unconditionally, so a switch here
                      // would flip back on the next render and read as a bug.
                      disabled={role === 'owner'}
                      onChange={(next) => void setAppAccess(person.id, app.id, next)}
                    />
                  </div>
                )
              })}

              <div className="flex gap-2 pt-3">
                <button
                  onClick={() => {
                    void setMemberCode(person.id, '').then((result) => {
                      if (result.ok) {
                        fire('success')
                        setNotice({ text: `New code: ${result.data.code}`, tone: 'ok' })
                      } else {
                        fire('error')
                        setNotice({ text: result.error, tone: 'error' })
                      }
                    })
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-semibold"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
                >
                  <Icon name="key" size={14} />
                  New code
                </button>

                {!isSelf && (
                  <button
                    onClick={() => {
                      if (!confirmRemove) {
                        fire('warning')
                        setConfirmRemove(true)
                        return
                      }
                      void updateMember(person.id, { is_active: false }).then((result) => {
                        if (!result.ok) {
                          fire('error')
                          setNotice({ text: result.error, tone: 'error' })
                        }
                        setConfirmRemove(false)
                      })
                    }}
                    className="flex-1 rounded-xl py-2.5 text-[13px] font-semibold"
                    style={{
                      background: confirmRemove ? 'var(--danger)' : 'var(--surface-2)',
                      color: confirmRemove ? '#fff' : 'var(--danger)',
                    }}
                  >
                    {confirmRemove ? 'Tap to confirm' : 'Remove'}
                  </button>
                )}
              </div>

              {notice && <Notice text={notice.text} tone={notice.tone} />}
              {notice?.tone === 'ok' && (
                <p className="px-1 pt-1 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                  Write it down now — it can't be looked up again, only replaced.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const EMOJI_CHOICES = ['🙂', '🦊', '🦋', '🐻', '🐙', '🌵', '⚡', '🍀', '🎧', '🚀']

function AddPersonForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🙂')
  const [role, setRole] = useState<MemberRole>('guest')
  const [code, setCode] = useState('')
  const [apps, setApps] = useState<string[]>(
    APPS.filter((a) => a.defaultForEveryone).map((a) => a.id),
  )
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)

    const payload: NewMember = {
      display_name: name.trim(),
      avatar_emoji: emoji,
      role,
      code: code.trim(),
      apps,
    }
    const result = await createMember(payload)
    setBusy(false)

    if (result.ok) {
      fire('success')
      // Held on screen rather than closing: this is the only moment the code
      // exists in readable form anywhere.
      setIssued(result.data.code)
      return
    }
    fire('error')
    setError(result.error)
  }

  if (issued) {
    return (
      <SettingsGroup label="Their code">
        <div className="px-3.5 py-4 text-center">
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Give this to {name.trim()} — it won't be shown again.
          </p>
          <p className="py-3 text-[28px] font-bold tracking-[0.18em]">{issued}</p>
          <PrimaryButton
            onClick={() => {
              fire('tap')
              onDone()
            }}
          >
            Done
          </PrimaryButton>
        </div>
      </SettingsGroup>
    )
  }

  return (
    <SettingsGroup label="New person">
      <div className="flex flex-col gap-3 px-3.5 py-3.5">
        <div className="flex items-center gap-2">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]"
            style={{ background: 'var(--surface-3)' }}
          >
            {emoji}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Their name"
            autoCapitalize="words"
            className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-[15px] outline-none placeholder:opacity-35"
            style={{ background: 'var(--surface-3)' }}
          />
        </div>

        <div className="scroll-x -mx-1 flex gap-1.5 px-1">
          {EMOJI_CHOICES.map((choice) => (
            <button
              key={choice}
              onClick={() => {
                fire('snap')
                setEmoji(choice)
              }}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[17px]"
              style={{
                background: choice === emoji ? 'var(--accent-soft)' : 'var(--surface-3)',
                border: `1px solid ${choice === emoji ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {choice}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {(['guest', 'member', 'owner'] as MemberRole[]).map((option) => (
            <button
              key={option}
              onClick={() => {
                fire('snap')
                setRole(option)
              }}
              className="flex-1 rounded-xl py-2 text-[12.5px] font-semibold capitalize"
              style={{
                background: option === role ? 'var(--accent)' : 'var(--surface-3)',
                color: option === role ? '#fff' : 'var(--text-dim)',
              }}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="-mt-1.5 px-1 text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
          {role === 'owner'
            ? 'Owners see everything and can add or remove people. Only pick this for someone who lives here.'
            : 'Pick exactly which apps they get below.'}
        </p>

        {role !== 'owner' && (
          <div>
            <p
              className="pb-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-faint)' }}
            >
              Apps they get
            </p>
            {APPS.map((app) => {
              const on = apps.includes(app.id)
              return (
                <div key={app.id} className="flex items-center gap-3 py-1.5">
                  <span style={{ color: app.color }}>
                    <Icon name={app.icon} size={16} />
                  </span>
                  <span className="flex-1 text-[13.5px]">{app.name}</span>
                  <Toggle
                    on={on}
                    label={`Give them ${app.name}`}
                    onChange={(next) =>
                      setApps((current) =>
                        next ? [...current, app.id] : current.filter((id) => id !== app.id),
                      )
                    }
                  />
                </div>
              )
            })}
          </div>
        )}

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Their code (blank to generate one)"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-xl px-3 py-2.5 text-[14px] tracking-[0.08em] outline-none placeholder:tracking-normal placeholder:opacity-35"
          style={{ background: 'var(--surface-3)' }}
        />

        <PrimaryButton onClick={() => void submit()} disabled={!name.trim()} busy={busy}>
          Create and get their code
        </PrimaryButton>

        <button
          onClick={onDone}
          className="text-[13px] font-medium"
          style={{ color: 'var(--text-faint)' }}
        >
          Cancel
        </button>

        {error && <Notice text={error} tone="error" />}
      </div>
    </SettingsGroup>
  )
}
