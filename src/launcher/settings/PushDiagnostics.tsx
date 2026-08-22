import { useState } from 'react'
import { toast } from 'sonner'
import { SettingsGroup } from './SettingsSheet'
import { runPushDiagnostics, type Check } from '@/lib/pushDiagnostics'
import { useCurrentMember } from '@/store/useMember'
import { fire } from '@/lib/haptics'

/**
 * "Why am I not getting notifications?", answered from this device.
 *
 * Every push failure in this app so far has looked fine from the sending side
 * and obvious from here — a phone with no row in `push_subscriptions`, a
 * permission that was granted in a session whose save silently failed, an Edge
 * Function that was never deployed. So the check reads the local state and the
 * server's view of it side by side and names the one that is wrong.
 *
 * It moved out of Things' settings because it was never about Things: it
 * inspects the launcher's single delivery pipe, which every app shares.
 */
export function PushDiagnostics() {
  const member = useCurrentMember()
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [busy, setBusy] = useState(false)

  if (!member) return null

  async function run() {
    if (!member) return
    setBusy(true)
    fire('tap')
    try {
      setChecks(await runPushDiagnostics(member.id))
    } catch (err) {
      console.error('[push] diagnostics failed', err)
      toast.error("Couldn't run the check")
    } finally {
      setBusy(false)
    }
  }

  const COLOR: Record<Check['status'], string> = {
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    bad: 'var(--danger)',
  }

  return (
    <SettingsGroup label="Trouble">
      <button
        onClick={() => void run()}
        disabled={busy}
        className="w-full px-3.5 py-3.5 text-left text-[14px] font-semibold disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Why am I not getting notifications?'}
      </button>

      {checks && (
        <div
          className="flex flex-col gap-2.5 px-3.5 py-3.5"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2.5">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: COLOR[c.status] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold">{c.label}</span>
                  <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
                    {c.detail}
                  </span>
                </div>
                {c.fix && (
                  <p
                    className="mt-0.5 text-[12px] leading-relaxed"
                    style={{ color: COLOR[c.status] }}
                  >
                    {c.fix}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsGroup>
  )
}
