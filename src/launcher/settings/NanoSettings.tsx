import { useCallback, useEffect, useState } from 'react'
import { SettingsGroup, SettingsRow, Toggle, PrimaryButton, Notice } from './SettingsSheet'
import { useData } from '@/store/useData'
import { useCurrentMember } from '@/store/useMember'
import { makeNanoCode, updateMember } from '@/lib/household'
import {
  approveWithCode,
  authenticatorSetAt,
  listApprovals,
  listNanoChanges,
  nanoOnline,
  refuseApproval,
  setAuthenticator,
  undoNanoChange,
  updateNanoSettings,
} from '@/lib/nano'
import { relativeTime, describeChange } from './nanoText'
import { fire } from '@/lib/haptics'
import type { NanoApproval, NanoChange } from '@/data/types'

const inputClass =
  'w-full rounded-xl px-3 py-2.5 text-[15px] font-semibold outline-none placeholder:font-normal placeholder:opacity-35'

type Note = { text: string; tone: 'ok' | 'error' } | null

/**
 * Settings › People › Nano. Owners only, like the rest of People.
 *
 * Her code, her off switch, her number for the Calendar's button, whether
 * she may change Med School data, what's waiting for Avi's code, and the
 * list of everything she has changed, each with Undo. The database decides
 * all of it independently (029_nano.sql); this is where the owners press
 * the buttons.
 */
export function NanoSettings() {
  const nano = useData((s) => s.nano)
  const status = useData((s) => s.nano_status[0])
  const settings = useData((s) => s.nano_settings[0])
  const me = useCurrentMember()
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>(null)
  const [whatsapp, setWhatsapp] = useState(settings?.whatsapp ?? '')

  useEffect(() => setWhatsapp(settings?.whatsapp ?? ''), [settings?.whatsapp])

  const on = nano?.is_active !== false
  const online = nanoOnline(status)
  const subtitle = !nano
    ? 'Not set up yet'
    : !on
      ? 'Turned off: she can read and change nothing'
      : online
        ? 'Connected'
        : status?.last_seen_at
          ? `Last heard from ${relativeTime(status.last_seen_at)}`
          : 'Not connected yet'

  async function make() {
    if (nano && !window.confirm("Make a new code for Nano? The old one stops working straight away, and the brain needs the new one.")) return
    setBusy(true)
    setNote(null)
    const result = await makeNanoCode()
    setBusy(false)
    if (!result.ok) {
      fire('error')
      setNote({ text: result.error, tone: 'error' })
      return
    }
    fire('success')
    setCode(result.data.code)
  }

  return (
    <>
      <SettingsGroup
        label="Nano"
        hint="Nano signs in with her own code, like everyone else, and can only do what the database lets her. Avi puts her code on the brain himself."
      >
        <SettingsRow
          icon="sparkle"
          title="Nano"
          subtitle={subtitle}
          right={
            nano ? (
              <Toggle
                on={on}
                label="Nano is on"
                onChange={(next) => {
                  fire('tap')
                  void updateMember(nano.id, { is_active: next }).then((result) => {
                    if (!result.ok) setNote({ text: result.error, tone: 'error' })
                  })
                }}
              />
            ) : undefined
          }
        />
        <div className="px-3.5 py-3">
          {code ? (
            <>
              <p className="pb-2 text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
                Nano's code. It's shown this once. Type it into Nano's own settings on the brain, then close this.
                Don't send it in a chat or paste it anywhere else.
              </p>
              <p
                className="select-all break-all rounded-xl px-3 py-2.5 font-mono text-[14px] font-semibold tracking-[0.08em]"
                style={{ background: 'var(--surface-3)' }}
              >
                {code}
              </p>
              <div className="mt-2.5">
                <PrimaryButton onClick={() => setCode(null)}>Done, hide it</PrimaryButton>
              </div>
            </>
          ) : (
            <PrimaryButton busy={busy} onClick={() => void make()}>
              {nano ? 'Make a new code for Nano' : "Make Nano's code"}
            </PrimaryButton>
          )}
          {note && <Notice text={note.text} tone={note.tone} />}
        </div>
      </SettingsGroup>

      {nano && (
        <SettingsGroup
          label="What Nano may do"
          hint="Her WhatsApp number is what the Calendar's Nano button opens, so nothing from the Calendar is ever saved as a request."
        >
          <SettingsRow
            icon="book"
            title="Change Med School data"
            subtitle="Off until Avi moves the Med School role to her. She can still read it for Avi or Jackie."
            right={
              <Toggle
                on={settings?.medschool_writes === true}
                label="Let Nano change Med School data"
                onChange={(next) => {
                  fire('tap')
                  void updateNanoSettings({ medschool_writes: next }, me?.id ?? null)
                }}
              />
            }
          />
          <div className="px-3.5 py-3">
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              onBlur={() => {
                const next = whatsapp.replace(/[^\d+]/g, '') || null
                if (next !== (settings?.whatsapp ?? null)) void updateNanoSettings({ whatsapp: next }, me?.id ?? null)
              }}
              inputMode="tel"
              placeholder="Her WhatsApp number, with country code"
              aria-label="Nano's WhatsApp number"
              className={inputClass}
              style={{ background: 'var(--surface-3)' }}
            />
          </div>
        </SettingsGroup>
      )}

      {nano && <Approvals />}
      {nano && <Changes />}
    </>
  )
}

/** Things Nano asked to do that need Avi's code, each approved on its own. */
function Approvals() {
  const [rows, setRows] = useState<NanoApproval[]>([])
  const load = useCallback(() => {
    void listApprovals().then((result) => result.ok && setRows(result.data))
  }, [])
  useEffect(load, [load])

  if (rows.length === 0) return null
  return (
    <SettingsGroup
      label="Waiting for Avi's code"
      hint="Each code approves only the one thing written above it, once. Codes come from the authenticator set up under General › Security."
    >
      {rows.map((row) => (
        <ApprovalRow key={row.id} row={row} onDone={load} />
      ))}
    </SettingsGroup>
  )
}

function ApprovalRow({ row, onDone }: { row: NanoApproval; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>(null)

  return (
    <div className="px-3.5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <p className="text-[14px] font-semibold leading-snug">{row.summary}</p>
      <p className="pb-2 pt-0.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
        Asked {relativeTime(row.created_at)}
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6-digit code"
        aria-label="Code from the authenticator"
        className={`${inputClass} mb-2.5 tracking-[0.3em]`}
        style={{ background: 'var(--surface-3)' }}
      />
      <div className="flex gap-2">
        <div className="flex-1">
          <PrimaryButton
            busy={busy}
            disabled={code.length !== 6}
            onClick={() => {
              setBusy(true)
              void approveWithCode(row.id, code).then((result) => {
                setBusy(false)
                if (result.ok) {
                  fire('success')
                  onDone()
                } else {
                  fire('error')
                  setNote({ text: result.error, tone: 'error' })
                }
              })
            }}
          >
            Approve
          </PrimaryButton>
        </div>
        <div className="flex-1">
          <PrimaryButton danger onClick={() => void refuseApproval(row.id).then(onDone)}>
            Refuse
          </PrimaryButton>
        </div>
      </div>
      {note && <Notice text={note.text} tone={note.tone} />}
    </div>
  )
}

/** Everything Nano changed, newest first, each with a way back. */
function Changes() {
  const profiles = useData((s) => s.profiles)
  const [rows, setRows] = useState<NanoChange[] | null>(null)
  const [note, setNote] = useState<Note>(null)
  const load = useCallback(() => {
    void listNanoChanges().then((result) => {
      if (result.ok) setRows(result.data)
      else setNote({ text: result.error, tone: 'error' })
    })
  }, [])
  useEffect(load, [load])

  const nameOf = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.display_name ?? 'someone' : null)

  return (
    <SettingsGroup
      label="Nano's changes"
      hint="Undo puts a row back as it was. If someone has changed it since, Undo says so and leaves their change alone."
    >
      {rows === null ? (
        <SettingsRow title="Loading…" />
      ) : rows.length === 0 ? (
        <SettingsRow title="Nothing yet" subtitle="Every change Nano makes shows up here." />
      ) : (
        rows.map((row) => (
          <SettingsRow
            key={row.id}
            title={describeChange(row)}
            subtitle={`${nameOf(row.acting_for) ? `For ${nameOf(row.acting_for)}` : 'On her own'} · ${relativeTime(row.at)}${row.undone_at ? ' · undone' : ''}`}
            right={
              row.undone_at ? undefined : (
                <button
                  className="rounded-full px-3 py-1.5 text-[13px] font-semibold"
                  style={{ background: 'var(--surface-3)', color: 'var(--accent)' }}
                  onClick={() => {
                    fire('tap')
                    void undoNanoChange(row.id).then((result) => {
                      if (result.ok) {
                        fire('success')
                        load()
                      } else {
                        fire('error')
                        setNote({ text: result.error, tone: 'error' })
                      }
                    })
                  }}
                >
                  Undo
                </button>
              )
            }
          />
        ))
      )}
      {note && (
        <div className="px-3.5 pb-3">
          <Notice text={note.text} tone={note.tone} />
        </div>
      )}
    </SettingsGroup>
  )
}

/**
 * The authenticator Nano's approvals are checked against, for Settings ›
 * General › Security. Avi enters its setup key once. Swapping it later for
 * another entry (one only the launcher knows) is the same box, plus a
 * current code from the old one.
 */
export function NanoAuthenticator() {
  const [setAt, setSetAt] = useState<string | null | undefined>(undefined)
  const [key, setKey] = useState('')
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>(null)

  useEffect(() => {
    void authenticatorSetAt().then((result) => setSetAt(result.ok ? result.data : null))
  }, [])

  if (setAt === undefined) return null
  return (
    <div className="px-3.5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <p className="pb-2.5 text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
        {setAt
          ? `Nano's approvals are checked against Avi's authenticator, set ${relativeTime(setAt)}. To swap it for another entry, enter the new setup key and a current code from the old one.`
          : "Nano's bulk deletes and changes to people, access or codes need a code from Avi's authenticator. To switch that on, enter the setup key of Nano's entry in the authenticator once. It's the long secret the entry was made from (16 or more letters and numbers, often in groups of four), not the 6-digit code. Nano keeps it on the brain, so ask her to show it, or paste its otpauth:// link here."}
      </p>
      <input
        value={key}
        onChange={(e) => setKey(setupKeyFrom(e.target.value))}
        placeholder="Setup key, like JBSW Y3DP EHPK 3PXP"
        aria-label="Authenticator setup key"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className={`${inputClass} mb-2.5 font-mono`}
        style={{ background: 'var(--surface-3)' }}
      />
      {/^\d{6,8}$/.test(key.replace(/\s/g, '')) && (
        <p className="pb-2.5 text-[12.5px] leading-snug" style={{ color: 'var(--danger)' }}>
          That&rsquo;s one of the 6-digit codes. This needs the setup key instead: the long one the entry was made
          from. Ask Nano to show it.
        </p>
      )}
      {setAt && (
        <input
          value={current}
          onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          placeholder="Current code from the old one"
          aria-label="Current code from the old authenticator"
          className={`${inputClass} mb-2.5 tracking-[0.3em]`}
          style={{ background: 'var(--surface-3)' }}
        />
      )}
      <PrimaryButton
        busy={busy}
        disabled={key.replace(/\s/g, '').length < 16 || (!!setAt && current.length !== 6)}
        onClick={() => {
          setBusy(true)
          setNote(null)
          void setAuthenticator(key, current).then((result) => {
            setBusy(false)
            if (result.ok) {
              fire('success')
              setKey('')
              setCurrent('')
              setSetAt(new Date().toISOString())
              setNote({ text: 'Saved. Codes from that entry now approve what Nano asks.', tone: 'ok' })
            } else {
              fire('error')
              setNote({ text: result.error, tone: 'error' })
            }
          })
        }}
      >
        {setAt ? 'Swap the authenticator' : 'Save the setup key'}
      </PrimaryButton>
      {note && <Notice text={note.text} tone={note.tone} />}
    </div>
  )
}

/**
 * What was typed or pasted, as a setup key. Takes an otpauth:// link (what
 * the QR code holds) as well as the key itself.
 */
export function setupKeyFrom(input: string): string {
  const text = input.trim()
  if (/^otpauth:\/\//i.test(text)) {
    const match = text.match(/[?&]secret=([^&]+)/i)
    return match ? decodeURIComponent(match[1]).toUpperCase() : ''
  }
  return text.toUpperCase()
}
