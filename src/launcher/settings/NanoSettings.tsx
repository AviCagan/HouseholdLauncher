import { useCallback, useEffect, useState } from 'react'
import { SettingsGroup, SettingsRow, Toggle, PrimaryButton, Notice } from './SettingsSheet'
import { useData } from '@/store/useData'
import { useCurrentMember } from '@/store/useMember'
import { startNanoPairing, updateMember } from '@/lib/household'
import { openExternal } from '@/apps/things/routing/deeplink'
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
  const [pairing, setPairing] = useState<{
    code: string
    expires: number
  } | null>(null)
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

  async function pair() {
    if (
      nano &&
      !window.confirm('Pair Nano again? Her current link stops working, and she links again with the new code.')
    )
      return
    setBusy(true)
    setNote(null)
    const result = await startNanoPairing()
    setBusy(false)
    if (!result.ok) {
      fire('error')
      setNote({ text: result.error, tone: 'error' })
      return
    }
    fire('success')
    setPairing({
      code: result.data.code,
      expires: new Date(result.data.expires_at).getTime(),
    })
  }

  const message = pairing ? `pair launcher ${pairing.code}` : ''
  const number = (settings?.whatsapp ?? '').replace(/[^\d]/g, '')

  return (
    <>
      <SettingsGroup
        label="Nano"
        hint="Pairing links Nano's brain to the launcher, like pairing a TV. She can then only do what the database lets her."
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
          {pairing ? (
            <PairingCode
              code={pairing.code}
              expires={pairing.expires}
              onWhatsApp={
                number ? () => openExternal(`https://wa.me/${number}?text=${encodeURIComponent(message)}`) : null
              }
              onDone={() => setPairing(null)}
            />
          ) : (
            <PrimaryButton busy={busy} onClick={() => void pair()}>
              {nano ? 'Pair Nano again' : 'Pair Nano'}
            </PrimaryButton>
          )}
          {note && <Notice text={note.text} tone={note.tone} />}
        </div>
      </SettingsGroup>

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

  const nameOf = (id: string | null) => (id ? (profiles.find((p) => p.id === id)?.display_name ?? 'someone') : null)

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
                  style={{
                    background: 'var(--surface-3)',
                    color: 'var(--accent)',
                  }}
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
          : "Optional. Without it Nano works, and only what needs your approval is refused: bulk deletes, and changes to people, access or codes. To switch approvals on, get the key at the brain PC: Nano's tray icon › Security… › Set up on a new phone… shows a new key and QR code. Scan it into the authenticator (it replaces the old Nano entry), then enter the same key here."}
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
          That&rsquo;s one of the 6-digit codes. This needs the setup key: at the brain PC, Nano&rsquo;s tray icon ›
          Security… › Set up on a new phone… shows it, with a QR code to scan into the authenticator.
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
              setNote({
                text: 'Saved. Codes from that entry now approve what Nano asks.',
                tone: 'ok',
              })
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

/** The 6-digit pairing code, how to send it, and how long it lasts. */
function PairingCode({
  code,
  expires,
  onWhatsApp,
  onDone,
}: {
  code: string
  expires: number
  onWhatsApp: (() => void) | null
  onDone: () => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])
  const minutes = Math.max(0, Math.ceil((expires - now) / 60_000))
  const expired = now >= expires
  const message = `pair launcher ${code}`

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
        Text this to Nano on WhatsApp. It works once
        {expired ? '' : `, for the next ${minutes} minute${minutes === 1 ? '' : 's'}`}.
      </p>
      <p
        className="select-all rounded-xl px-3 py-3 text-center font-mono text-[20px] font-semibold tracking-[0.08em]"
        style={{ background: 'var(--surface-3)', opacity: expired ? 0.4 : 1 }}
      >
        {message}
      </p>
      {expired ? (
        <p className="text-[12.5px]" style={{ color: 'var(--danger)' }}>
          This code ran out. Tap Done and pair again.
        </p>
      ) : onWhatsApp ? (
        <PrimaryButton onClick={onWhatsApp}>Send it to Nano on WhatsApp</PrimaryButton>
      ) : (
        <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
          Add her WhatsApp number below and this becomes one tap.
        </p>
      )}
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
    </div>
  )
}
