import { registerPlugin } from '@capacitor/core'

/**
 * The Bluetooth control plugin.
 *
 * Android exposes connect/disconnect on the A2DP and Headset profile proxies,
 * but only as `@hide` methods — present and stable for years, absent from the
 * public SDK, so they are reached by reflection. That is the whole reason this
 * is a custom plugin rather than a community one: nothing in the public API
 * lets an app drop the car stereo and leave the headphones connected, which is
 * the entire point of the app.
 *
 * There is no iOS half and there will not be one. iOS gives an app no
 * visibility into the phone's pairings at all, let alone control of them, so
 * the registry marks this app Android-only and the launcher says so rather
 * than shipping a screen that cannot work.
 */

export interface BtDevice {
  /** MAC address. Stable per device, and what toggles are keyed on. */
  address: string
  name: string
  /** Currently connected on at least one profile. */
  connected: boolean
  /** Best guess from the Bluetooth class of device, for the row's icon. */
  kind: 'car' | 'headphones' | 'speaker' | 'phone' | 'watch' | 'other'
  /** Which profiles this device supports, so the UI can say what it'll drop. */
  profiles: ('a2dp' | 'headset')[]
}

export interface BluetoothControlPlugin {
  /**
   * Whether this build can do anything at all: Android, with the adapter
   * present. Everything else short-circuits to a plain explanation.
   */
  isSupported(): Promise<{ supported: boolean; reason?: string }>

  /** Whether BLUETOOTH_CONNECT has been granted. */
  checkPermissions(): Promise<{ granted: boolean }>

  /** Prompts for BLUETOOTH_CONNECT. Resolves once the dialog is answered. */
  requestPermissions(): Promise<{ granted: boolean }>

  /** Every bonded (paired) device, with its current connection state. */
  listDevices(): Promise<{ devices: BtDevice[]; adapterOn: boolean }>

  /** Disconnect one device without unpairing it. */
  disconnect(options: { address: string }): Promise<{ ok: boolean; error?: string }>

  /** Reconnect a device this app disconnected. */
  connect(options: { address: string }): Promise<{ ok: boolean; error?: string }>
}

export const BluetoothControl = registerPlugin<BluetoothControlPlugin>('BluetoothControl', {
  /*
    Web fallback.

    registerPlugin throws "not implemented" on a platform with no
    implementation, which would surface as an unhandled rejection during a
    render on iPhone. Answering honestly instead lets the same screen explain
    itself on every platform, and keeps the dev server usable.
  */
  web: {
    isSupported: async () => ({
      supported: false,
      reason: 'Bluetooth control needs the Android app.',
    }),
    checkPermissions: async () => ({ granted: false }),
    requestPermissions: async () => ({ granted: false }),
    listDevices: async () => ({ devices: [], adapterOn: false }),
    disconnect: async () => ({ ok: false, error: 'Not supported on this platform' }),
    connect: async () => ({ ok: false, error: 'Not supported on this platform' }),
  },
})
