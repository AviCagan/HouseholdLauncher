import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { EmptyState } from '@/components/shell/Screen'
import { Toggle } from '@/launcher/settings/SettingsSheet'
import { BluetoothControl, type BtDevice } from './plugin'
import { fire } from '@/lib/haptics'

/**
 * One switch per paired device.
 *
 * The thing it replaces: with the car and a pair of headphones both paired,
 * dropping the car means Settings → Connected devices → the car → the gear →
 * Disconnect, and the same four taps in reverse to get it back. Here it is one
 * switch, and the pairing is never touched — so reconnecting in the driveway
 * is instant rather than a re-pair.
 *
 * Turning a device off does not stop it reconnecting on its own later; Android
 * offers no such block to an app. What it does is disconnect it right now,
 * which is what the moment actually calls for.
 */

const ICONS: Record<BtDevice['kind'], IconName> = {
  car: 'nav',
  headphones: 'bluetooth',
  speaker: 'bluetooth',
  phone: 'bluetooth',
  watch: 'clock',
  other: 'bluetooth',
}

type Status =
  | { kind: 'loading' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'needs-permission' }
  | { kind: 'ready'; devices: BtDevice[]; adapterOn: boolean }
  | { kind: 'error'; message: string }

export function BluetoothApp() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  /** Addresses with a call in flight, so their row can't be double-tapped. */
  const [busy, setBusy] = useState<string[]>([])

  const refresh = useCallback(async () => {
    try {
      const supported = await BluetoothControl.isSupported()
      if (!supported.supported) {
        setStatus({
          kind: 'unsupported',
          reason: supported.reason ?? 'Bluetooth control is not available here.',
        })
        return
      }

      const permission = await BluetoothControl.checkPermissions()
      if (!permission.granted) {
        setStatus({ kind: 'needs-permission' })
        return
      }

      const { devices, adapterOn } = await BluetoothControl.listDevices()
      setStatus({
        kind: 'ready',
        adapterOn,
        // Connected first, then alphabetical. The device you want to drop is
        // by definition one that is currently connected, so it should never be
        // below the fold.
        devices: [...devices].sort(
          (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
        ),
      })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
    Re-read the list when the app comes back to the foreground.

    Connections change while you are elsewhere — you get in the car, the stereo
    grabs the phone — and coming back to a screen that still shows the state
    from ten minutes ago is worse than showing nothing, because the switches
    look authoritative.
  */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  async function toggle(device: BtDevice) {
    setBusy((current) => [...current, device.address])

    // Optimistic, and reverted below on failure: the radio takes a second or
    // two to actually drop a link, and a switch that sits still for that long
    // reads as an ignored tap.
    setStatus((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            devices: current.devices.map((d) =>
              d.address === device.address ? { ...d, connected: !d.connected } : d,
            ),
          }
        : current,
    )

    try {
      const result = device.connected
        ? await BluetoothControl.disconnect({ address: device.address })
        : await BluetoothControl.connect({ address: device.address })

      if (!result.ok) {
        fire('error')
        toast.error(result.error ?? "That didn't work")
      } else {
        fire(device.connected ? 'toggleOff' : 'toggleOn')
      }
    } catch (err) {
      fire('error')
      toast.error(err instanceof Error ? err.message : "That didn't work")
    } finally {
      setBusy((current) => current.filter((a) => a !== device.address))
      // Always re-read rather than trusting the optimistic flip: the profile
      // call can report success while the link survives on the other profile,
      // and the truth is whatever the proxies say a moment later.
      setTimeout(() => void refresh(), 900)
    }
  }

  if (status.kind === 'loading') {
    return <div className="h-full" />
  }

  if (status.kind === 'unsupported' || status.kind === 'error') {
    return (
      <div className="px-3">
        <EmptyState
          icon={<Icon name="bluetooth" size={34} />}
          title={status.kind === 'unsupported' ? 'Not available here' : "Couldn't read Bluetooth"}
          hint={status.kind === 'unsupported' ? status.reason : status.message}
        />
      </div>
    )
  }

  if (status.kind === 'needs-permission') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
        <span style={{ color: 'var(--accent)' }}>
          <Icon name="bluetooth" size={38} />
        </span>
        <h2 className="text-[18px] font-bold">Bluetooth permission needed</h2>
        <p className="max-w-[290px] text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
          To show your paired devices and switch them on and off, Android needs you
          to allow Bluetooth access. Nothing is scanned and nothing is shared.
        </p>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            fire('tap')
            void BluetoothControl.requestPermissions().then(() => refresh())
          }}
          className="mt-1 rounded-full px-5 py-3 text-[15px] font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          Allow Bluetooth
        </motion.button>
      </div>
    )
  }

  return (
    <div className="scroll-y h-full px-3 pb-10">
      {!status.adapterOn && (
        <div
          className="mb-3 flex items-center gap-2 rounded-2xl px-3.5 py-3"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--warn)' }}
        >
          <span style={{ color: 'var(--warn)' }}>
            <Icon name="bluetooth" size={17} />
          </span>
          <span className="flex-1 text-[13px]" style={{ color: 'var(--text-dim)' }}>
            Bluetooth is switched off. Turn it on to connect anything.
          </span>
        </div>
      )}

      {status.devices.length === 0 ? (
        <EmptyState
          icon={<Icon name="bluetooth" size={34} />}
          title="Nothing paired yet"
          hint="Pair your car or headphones in Android's Bluetooth settings first — they'll show up here afterwards."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {status.devices.map((device) => (
              <motion.div
                key={device.address}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-2xl p-3"
                style={{
                  background: 'var(--surface)',
                  border: `1px solid ${device.connected ? 'var(--accent-muted)' : 'var(--border)'}`,
                }}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  style={{
                    background: device.connected
                      ? 'var(--accent-soft)'
                      : 'var(--surface-3)',
                    color: device.connected ? 'var(--accent-text)' : 'var(--text-faint)',
                  }}
                >
                  <Icon name={ICONS[device.kind]} size={19} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{device.name}</span>
                  <span className="block text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    {device.connected ? 'Connected' : 'Paired, not connected'}
                    {device.kind === 'car' ? ' · car' : ''}
                  </span>
                </span>

                <Toggle
                  on={device.connected}
                  label={`${device.connected ? 'Disconnect' : 'Connect'} ${device.name}`}
                  disabled={busy.includes(device.address) || !status.adapterOn}
                  onChange={() => void toggle(device)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <button
        onClick={() => {
          fire('tap')
          void refresh()
        }}
        className="mt-4 w-full rounded-2xl py-3 text-[13.5px] font-semibold"
        style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
      >
        Refresh
      </button>

      <p className="px-2 pt-3 text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
        Switching a device off disconnects it now without unpairing, so turning it
        back on reconnects straight away. Devices can still reconnect on their own
        later — Android doesn't let an app block that.
      </p>
    </div>
  )
}
