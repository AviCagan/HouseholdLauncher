import { useState } from 'react'
import { Icon } from '@/components/primitives/Icon'
import { ColorPicker } from '@/components/primitives/ColorPicker'
import { ColorSwatchButton } from '@/components/primitives/ColorSwatchButton'
import { SettingsGroup, Segmented, Toggle } from './SettingsSheet'
import { useProfile, useSettings, updateSettings } from '@/store/useProfile'
import { ALL_HAPTIC_EVENTS, fire, hasRealHaptics } from '@/lib/haptics'
import { unlockAudio } from '@/lib/sound'
import { isIOS, isNative } from '@/lib/platform'
import type { HapticEventName, HapticIntensity, ThemeMode } from '@/data/types'

/**
 * How the whole launcher looks and feels.
 *
 * These lived in Things' settings sheet, which is where they were written —
 * back when Things was the entire app. They were never Things' to own: theme,
 * accent, text size and haptic strength are applied to the document root by
 * `applySettings` and take effect in Owe, Bluetooth, the home screen and every
 * sheet alike. Reaching them by opening one particular app was the giveaway.
 *
 * Everything here is per person, not per household: Avi's OLED theme has no
 * business following Jackie onto her phone.
 */

const ACCENTS = [
  '#7c5cff', '#ff6ea9', '#3aa0ff', '#2bb673',
  '#f5a524', '#e0563c', '#00c2b8', '#b06cff',
]

const THEMES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'oled', label: 'OLED' },
]

const INTENSITIES: { key: HapticIntensity; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'subtle', label: 'Subtle' },
  { key: 'normal', label: 'Normal' },
  { key: 'heavy', label: 'Heavy' },
]

export function AppearanceSettings() {
  const profileId = useProfile((s) => s.profileId)
  const settings = useSettings()
  const [accentWheel, setAccentWheel] = useState(false)
  const [showHaptics, setShowHaptics] = useState(false)

  if (!profileId || !settings) return null
  const set = (patch: Parameters<typeof updateSettings>[1]) =>
    void updateSettings(profileId, patch)

  return (
    <>
      <SettingsGroup label="Appearance">
        <Stacked label="Theme">
          <Segmented
            options={THEMES}
            value={settings.theme_mode}
            onChange={(v) => set({ theme_mode: v as ThemeMode })}
          />
        </Stacked>

        <Stacked label="Accent">
          <div className="flex flex-wrap items-center gap-2">
            <ColorSwatchButton
              value={settings.accent_hex}
              open={accentWheel}
              onClick={() => {
                fire('tap')
                setAccentWheel((v) => !v)
              }}
            />
            {ACCENTS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  fire('snap')
                  set({ accent_hex: c })
                }}
                aria-label={`Accent ${c}`}
                className="h-[34px] w-[34px] shrink-0 rounded-full"
                style={{
                  background: c,
                  outline: settings.accent_hex === c ? '2px solid var(--text)' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
          {accentWheel && (
            <div className="pt-3">
              <ColorPicker
                value={settings.accent_hex}
                onChange={(hex) => set({ accent_hex: hex })}
              />
            </div>
          )}
        </Stacked>

        <Stacked label="Text size">
          <div className="flex items-center gap-3">
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>A</span>
            <input
              type="range"
              min={0.8}
              max={1.4}
              step={0.05}
              value={settings.font_scale}
              onChange={(e) => set({ font_scale: parseFloat(e.target.value) })}
              aria-label="Text size"
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="text-[19px]" style={{ color: 'var(--text-faint)' }}>A</span>
          </div>
        </Stacked>

        <SwitchRow
          label="Reduce motion"
          hint="Fades instead of springs"
          value={settings.reduce_motion}
          onChange={(v) => set({ reduce_motion: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        label="Feel"
        hint={
          hasRealHaptics()
            ? undefined
            : isIOS()
              ? "iOS doesn't let web apps trigger haptics, so this device uses a visual pulse (and sound, if on) instead."
              : "This device doesn't report haptic support — you'll get the visual pulse instead."
        }
      >
        <Stacked label="Vibration strength">
          <Segmented
            options={INTENSITIES}
            value={settings.haptic_intensity}
            onChange={(v) => {
              set({ haptic_intensity: v as HapticIntensity })
              // A sample at the new strength, so the choice is felt rather
              // than read.
              setTimeout(() => fire('claim'), 60)
            }}
          />
        </Stacked>

        <SwitchRow
          label="Sounds"
          hint="Short synthesised ticks on actions"
          value={settings.sound_enabled}
          onChange={(v) => {
            unlockAudio()
            set({ sound_enabled: v })
          }}
        />

        {isIOS() && !isNative() && (
          <SwitchRow
            label="iPhone haptics"
            hint="iPhones give web apps no vibration API, so this borrows Apple's switch control to produce a real haptic. Works on iOS 17.4 and later; Apple changed it in 26.5, where it may do nothing. Turn it off if it feels wrong."
            value={settings.ios_native_switch}
            onChange={(v) => set({ ios_native_switch: v })}
          />
        )}

        <button
          onClick={() => {
            fire('tap')
            setShowHaptics((s) => !s)
          }}
          className="flex w-full items-center justify-between px-3.5 py-3 text-left"
        >
          <span className="text-[14.5px] font-medium">Test and fine-tune each buzz</span>
          <Chevron open={showHaptics} />
        </button>

        {showHaptics &&
          ALL_HAPTIC_EVENTS.map((event) => (
            <div
              key={event}
              className="flex items-center gap-2.5 px-3.5 py-2.5"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{labelFor(event)}</span>
              <button
                onClick={() => fire(event)}
                className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium"
                style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
              >
                Test
              </button>
              <Toggle
                on={settings.haptic_events[event] !== false}
                label={labelFor(event)}
                onChange={(v) =>
                  set({ haptic_events: { ...settings.haptic_events, [event]: v } })
                }
              />
            </div>
          ))}
      </SettingsGroup>
    </>
  )
}

/** A label with its control underneath, for anything too wide to sit beside it. */
function Stacked({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <p className="pb-2 text-[14.5px] font-medium">{label}</p>
      {children}
    </div>
  )
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      className="flex items-center gap-4 px-3.5 py-3"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-[12px] leading-snug" style={{ color: 'var(--text-faint)' }}>
            {hint}
          </span>
        )}
      </span>
      <Toggle on={value} label={label} onChange={onChange} />
    </div>
  )
}

/** The disclosure chevron, rotated when the list below it is showing. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className="shrink-0 transition-transform"
      style={{ color: 'var(--text-faint)', transform: `rotate(${open ? 90 : 0}deg)` }}
    >
      <Icon name="chevron" size={16} />
    </span>
  )
}

function labelFor(event: HapticEventName): string {
  const map: Record<HapticEventName, string> = {
    tap: 'Tap',
    toggleOn: 'Switch on',
    toggleOff: 'Switch off',
    claim: 'Claiming something',
    complete: 'Completing something',
    delete: 'Deleting',
    swipeThreshold: 'Swipe hits the line',
    longPress: 'Long press',
    dragStart: 'Starting a drag',
    snap: 'Small ticks',
    zipperTick: 'Swipe-to-pay teeth',
    zipperDone: 'Swipe-to-pay lands',
    success: 'Success',
    warning: 'Warning',
    error: 'Error',
  }
  return map[event]
}
