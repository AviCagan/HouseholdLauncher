import { Segmented } from './SettingsSheet'
import type { CodeFormat } from '@/lib/household'

/**
 * A household code: 4 digits, 6 digits, or letters and numbers.
 *
 * The server holds the same rule (codeProblem() in
 * supabase/functions/_shared/signin.ts); this only makes the right keyboard
 * come up and keeps a 4-digit code to 4 digits. Left blank, the server
 * makes one up in the chosen format.
 */
export function CodeField({
  format,
  onFormat,
  code,
  onCode,
  label,
}: {
  format: CodeFormat
  onFormat: (next: CodeFormat) => void
  code: string
  onCode: (next: string) => void
  label: string
}) {
  const digits = format !== 'letters'
  const length = format === 'digits4' ? 4 : 6
  return (
    <div className="flex flex-col gap-2.5">
      <Segmented<CodeFormat>
        options={[
          { key: 'digits4', label: '4 digits' },
          { key: 'digits6', label: '6 digits' },
          { key: 'letters', label: 'Letters' },
        ]}
        value={format}
        onChange={(next) => {
          onFormat(next)
          onCode('')
        }}
      />
      <input
        value={code}
        onChange={(e) =>
          onCode(digits ? e.target.value.replace(/\D/g, '').slice(0, length) : e.target.value.toUpperCase())
        }
        inputMode={digits ? 'numeric' : 'text'}
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        placeholder={digits ? `${length} digits, or blank to make one up` : '6 or more letters and numbers, or blank'}
        aria-label={label}
        className={`w-full rounded-xl px-3 py-2.5 text-[15px] font-semibold outline-none placeholder:font-normal placeholder:tracking-normal placeholder:opacity-35 ${
          digits ? 'tracking-[0.3em]' : 'tracking-[0.1em]'
        }`}
        style={{ background: 'var(--surface-3)' }}
      />
    </div>
  )
}

/** Whether what's typed so far can be sent: blank, or complete for its format. */
export function codeReady(format: CodeFormat, code: string): boolean {
  if (!code) return true
  if (format === 'digits4') return code.length === 4
  if (format === 'digits6') return code.length === 6
  return code.replace(/[^A-Z0-9]/gi, '').length >= 6
}
