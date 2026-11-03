import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { useData } from '@/store/useData'
import { useLauncher } from '@/store/useLauncher'
import { useDesktop } from '@/lib/useDesktop'
import { fire } from '@/lib/haptics'
import { copyToClipboard, openExternal } from '@/apps/things/routing/deeplink'
import { importRows, settingsRow, syncDueDates, updateSettings } from './actions'
import { describeCounts, exportPlan, parsePlan, type ParseResult } from './plan'
import { todayDay } from './dates'
import { useMsUI } from './store'
import { Field, SwitchRow } from './ui'

/**
 * The plan's settings, and the way in and out: Import reads a pasted plan
 * and, after showing what's in it, writes it; Export copies the whole plan
 * as the same JSON, ready to paste into a conversation.
 */
export function SettingsSheet() {
  const close = useMsUI((s) => s.close)
  const settings = useData((s) => s.ms_settings[0] ?? null)
  const openSettings = useLauncher((s) => s.openSettings)
  const ref = settings?.reference ?? {}
  const [target, setTarget] = useState(settings?.target_score ? String(settings.target_score) : '')
  const [order, setOrder] = useState(settings?.order_number ?? '')
  const targetN = Number(target)
  const targetBad = target.trim() !== '' && !(Number.isInteger(targetN) && targetN >= 472 && targetN <= 528)

  const saveTarget = () => {
    if (targetBad) return
    const next = target.trim() ? targetN : null
    if (next !== (settings?.target_score ?? null)) void updateSettings({ target_score: next })
  }
  const saveOrder = () => {
    const next = order.trim() || null
    if (next !== (settings?.order_number ?? null)) void updateSettings({ order_number: next })
  }

  const links = linkList(ref.links)

  return (
    <Sheet open onClose={close} title="Settings" className="lg-sheet" maxHeight="90vh">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <Field label="Target MCAT score" hint={targetBad ? '472 to 528.' : 'Draws the target line on the practice chart.'}>
            <input
              className="lg-field lg-field--mono"
              inputMode="numeric"
              value={target}
              aria-invalid={targetBad}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={saveTarget}
            />
          </Field>
          <SwitchRow label="Booked" hint="The test date is booked with AAMC." on={settings?.booked ?? false} onChange={(v) => void updateSettings({ booked: v })} />
          <Field label="AAMC order number">
            <input className="lg-field lg-field--mono" value={order} onChange={(e) => setOrder(e.target.value)} onBlur={saveOrder} />
          </Field>
          <SwitchRow
            label="Show estimated dates"
            hint="Off hides the tasks whose dates are only estimates."
            on={settings?.show_estimated !== false}
            onChange={(v) => void updateSettings({ show_estimated: v })}
          />
          <button
            type="button"
            className="lg-btn self-start"
            onClick={() => {
              close()
              openSettings('notifications')
            }}
          >
            Reminders and alerts
          </button>
        </section>

        <ImportSection />
        <ExportSection />

        {links.length > 0 && (
          <section>
            <h3 className="lg-label mb-2">Sources and links</h3>
            <ul>
              {links.map((l) => (
                <li key={l.url} className="lg-rule first:border-t-0">
                  <button type="button" className="flex min-h-[44px] w-full items-center gap-2 py-1 text-left" onClick={() => openExternal(l.url)}>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{l.label}</span>
                    <span className="lg-num lg-dim max-w-[45%] truncate text-[11px]">{l.url.replace(/^https?:\/\//, '')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}

/** "liveTrackerArtifact" → "Live tracker artifact". */
const labelOf = (key: string) => {
  const words = key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function linkList(links: unknown): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = []
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) out.push({ label: labelOf(key), url: v })
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, k)
  }
  walk(links, 'links')
  return out
}

function ImportSection() {
  const [text, setText] = useState('')
  const [checked, setChecked] = useState<ParseResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function write() {
    if (!checked?.ok) return
    setBusy('Writing…')
    const result = await importRows(checked.rows, (done, total) => setBusy(`Writing ${done} of ${total}…`))
    await syncDueDates()
    setBusy(null)
    if (result.failed) {
      fire('error')
      toast.error(`${result.failed} rows didn't save`, { description: `${result.written} did. Import again to retry — it only adds and updates.` })
    } else {
      fire('success')
      toast.success('Plan imported', { description: describeCounts(checked.counts) })
      setText('')
      setChecked(null)
    }
  }

  return (
    <section>
      <h3 className="lg-label mb-1">Import</h3>
      <p className="lg-dim mb-2 text-[12.5px] leading-snug">
        Paste a plan as JSON. You'll see what's in it before anything is written. It adds and updates; it never deletes.
      </p>
      <textarea
        className="lg-field lg-field--mono !text-[12px]"
        rows={5}
        value={text}
        aria-label="Plan JSON"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          setChecked(null)
        }}
      />
      {checked && !checked.ok && (
        <div className="mt-2 border-l-2 border-[var(--lg-warn)] pl-3">
          <p className="lg-warn-text text-[13px] font-medium">That plan has problems:</p>
          <ul className="lg-dim mt-1 flex flex-col gap-0.5 text-[12px]">
            {checked.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {checked?.ok && (
        <div className="mt-2 border-l-2 border-[var(--lg-cyan)] pl-3">
          <p className="text-[13.5px] leading-snug">{describeCounts(checked.counts)}</p>
          {checked.warnings.length > 0 && (
            <ul className="lg-dim mt-1 flex flex-col gap-0.5 text-[12px]">
              {checked.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        {checked?.ok ? (
          <button type="button" className="lg-btn lg-btn--primary" disabled={Boolean(busy)} onClick={() => void write()}>
            {busy ?? 'Write it'}
          </button>
        ) : (
          <button
            type="button"
            className="lg-btn"
            disabled={!text.trim()}
            onClick={() => {
              fire('tap')
              setChecked(parsePlan(text))
            }}
          >
            Check
          </button>
        )}
      </div>
    </section>
  )
}

function ExportSection() {
  const desktop = useDesktop()
  const state = () => {
    const s = useData.getState()
    return exportPlan({
      settings: settingsRow() ?? null,
      tasks: s.ms_tasks,
      counters: s.ms_counters,
      logs: s.ms_counter_logs,
      eligibility: s.ms_eligibility,
      letters: s.ms_letters,
      courses: s.ms_courses,
      practice: s.ms_practice,
      questions: s.ms_questions,
    })
  }
  return (
    <section>
      <h3 className="lg-label mb-1">Export</h3>
      <p className="lg-dim mb-2 text-[12.5px] leading-snug">The whole plan as JSON, in the shape Import reads, with every date worked out.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="lg-btn"
          onClick={() => {
            copyToClipboard(JSON.stringify(state(), null, 1)).then(
              () => {
                fire('success')
                toast.success('Plan copied as JSON')
              },
              () => toast.error("Couldn't copy it"),
            )
          }}
        >
          Copy JSON
        </button>
        {desktop && (
          <button
            type="button"
            className="lg-btn lg-btn--ghost"
            onClick={() => {
              const blob = new Blob([JSON.stringify(state(), null, 1)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `med-school-plan-${todayDay()}.json`
              a.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}
          >
            Download
          </button>
        )}
      </div>
    </section>
  )
}
