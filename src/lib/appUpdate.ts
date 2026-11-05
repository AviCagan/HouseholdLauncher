import { create } from 'zustand'
import { toast } from 'sonner'
import { App } from '@capacitor/app'
import { CapacitorHttp } from '@capacitor/core'
import { isNative } from './platform'
import { BUILD_RUN, NATIVE_FINGERPRINT } from './build'
import { parseLatest, planUpdate, runningFrom, type LatestBuild } from './updatePlan'

/**
 * Keeping the Android app current without reinstalling it.
 *
 * Every push builds a new APK, and with it the same app's JavaScript as a zip
 * and a version.json describing both (see .github/workflows/release-apk.yml).
 * On launch, and whenever the app comes back after half an hour away, this
 * reads version.json:
 *
 *   - Only the JavaScript changed: the zip downloads in the background, and
 *     goes in the next time the app starts fresh, or when it comes back after
 *     an hour or more away. Never while you might be in the middle of
 *     something: not on every trip to the background (opening the document
 *     scanner is one), and not while a scan is out. If the new bundle can't
 *     even start, the updater puts the previous one back by itself — that's
 *     what notifyAppReady confirms — and that build isn't tried again.
 *   - The native app changed too (a new plugin, a new permission): a bundle
 *     can't bring that, so it says a new version is ready and the button
 *     opens the APK download. Installing it over the top keeps everything.
 *
 * The updater is Capgo's, used with nothing of Capgo's behind it: no account,
 * its own update checks off, and its crash and usage reporting off (see
 * capacitor.config.ts). Everything comes from this repository's releases.
 */

/** The rolling release, by tag rather than "latest", so a tagged release can never stand in for it. */
const VERSION_URL = 'https://github.com/AviCagan/HouseholdLauncher/releases/download/latest/version.json'

/** Coming back to the app after this long checks again. */
const RECHECK_MS = 30 * 60 * 1000

/** Coming back after this long also swaps in a downloaded update. */
const APPLY_AFTER_AWAY_MS = 60 * 60 * 1000

/** The first check waits for the app to be on screen, so its toast has somewhere to go. */
const FIRST_CHECK_DELAY_MS = 5_000

/** Set by the Inventory scanner while Google's scanner is open (apps/inventory/scanner.ts). */
const SCAN_IN_FLIGHT_KEY = 'inv:scanning'

/** The bundle downloaded and waiting to go in. */
const PENDING_KEY = 'update:pending'

/** The last build that was swapped in and rolled back; it isn't fetched again. */
const FAILED_KEY = 'update:failed'

interface Pending {
  id: string
  version: string
  /** Launches that tried to swap it in. A second means it was rolled back. */
  tries: number
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; checkedAt: number }
  | { kind: 'downloading'; latest: LatestBuild; percent: number }
  | { kind: 'ready'; latest: LatestBuild; bundleId: string }
  | { kind: 'apk'; latest: LatestBuild }
  | { kind: 'error'; message: string; checkedAt: number }

export const useAppUpdate = create<{ status: UpdateStatus }>(() => ({ status: { kind: 'idle' } }))

const setStatus = (status: UpdateStatus) => useAppUpdate.setState({ status })

type Updater = typeof import('@capgo/capacitor-updater').CapacitorUpdater

let updater: Promise<Updater> | null = null
const loadUpdater = () => (updater ??= import('@capgo/capacitor-updater').then((m) => m.CapacitorUpdater))

let started = false
let inflight: Promise<void> | null = null
let lastCheck = 0
let pausedAt = 0

function readPending(): Pending | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null
    return v && typeof v.id === 'string' && typeof v.version === 'string' ? { ...v, tries: v.tries ?? 0 } : null
  } catch {
    return null
  }
}

function writePending(p: Pending | null): void {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    // No storage: the update still goes in with Restart now, or next check.
  }
}

function failedVersion(): string | null {
  try {
    return localStorage.getItem(FAILED_KEY)
  } catch {
    return null
  }
}

function markFailed(version: string): void {
  try {
    localStorage.setItem(FAILED_KEY, version)
  } catch {
    // No storage: the worst case is one more try at the same build.
  }
}

function scanInFlight(): boolean {
  try {
    return localStorage.getItem(SCAN_IN_FLIGHT_KEY) !== null
  } catch {
    return false
  }
}

/**
 * Swap in the downloaded bundle if there is one and now is a safe moment.
 * Returns true when it did, which reloads the app — nothing after it runs.
 */
async function applyPending(u: Updater): Promise<boolean> {
  const pending = readPending()
  if (!pending) return false
  const running = runningFrom(BUILD_RUN, NATIVE_FINGERPRINT).build
  const current = await u.current()
  // Already running it (this is the launch after the swap), or overtaken.
  if (current.bundle.id === pending.id || Number(pending.version) <= running) {
    writePending(null)
    return false
  }
  const bundle = (await u.list()).bundles.find((b) => b.id === pending.id)
  // Tried already and we're not on it: the updater rolled it back because it
  // never started. Don't fetch that build again; wait for a newer one.
  if (pending.tries >= 1 || (bundle && bundle.status === 'error')) {
    markFailed(pending.version)
    writePending(null)
    if (bundle) void u.delete({ id: bundle.id }).catch(() => {})
    return false
  }
  // Gone: a newly installed APK clears downloaded bundles.
  if (!bundle || bundle.status !== 'success') {
    writePending(null)
    return false
  }
  if (scanInFlight()) return false
  writePending({ ...pending, tries: pending.tries + 1 })
  await u.set({ id: pending.id })
  return true
}

/** Once per launch, before anything that touches the network. */
export function startAppUpdates(): void {
  if (!isNative() || started) return
  started = true
  void (async () => {
    const u = await loadUpdater()
    // First, always: tells the updater this bundle started, so it keeps it.
    await u.notifyAppReady()
    // A fresh start is the moment for a waiting update: nothing is open yet.
    if (await applyPending(u)) return
    void u.addListener('download', (e) => {
      const s = useAppUpdate.getState().status
      if (s.kind === 'downloading') setStatus({ ...s, percent: e.percent })
    })
    void App.addListener('pause', () => {
      pausedAt = Date.now()
    })
    void App.addListener('resume', () => {
      const away = pausedAt ? Date.now() - pausedAt : 0
      void (async () => {
        if (away > APPLY_AFTER_AWAY_MS && (await applyPending(u))) return
        if (Date.now() - lastCheck > RECHECK_MS) void checkForUpdate()
      })()
    })
    setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS)
  })().catch((err) => console.warn('[update] could not start', err))
}

const toldKey = (kind: string, code: number) => `update:told:${kind}:${code}`

/** Say something once per build, not on every check. */
function once(kind: string, code: number): boolean {
  try {
    if (localStorage.getItem(toldKey(kind, code))) return false
    localStorage.setItem(toldKey(kind, code), '1')
  } catch {
    // No storage: better to say it again than never.
  }
  return true
}

/**
 * Look for a newer build and do what it needs. `manual` is the Check now
 * button: it also says when there's nothing new, or when the check failed.
 */
export function checkForUpdate({ manual = false } = {}): Promise<void> {
  if (!isNative()) return Promise.resolve()
  inflight ??= run(manual).finally(() => {
    inflight = null
  })
  return inflight
}

async function run(manual: boolean): Promise<void> {
  lastCheck = Date.now()
  const before = useAppUpdate.getState().status
  // A bundle already waiting stays waiting; there's nothing newer to find
  // that it wouldn't be replaced by anyway on the next check.
  if (before.kind !== 'ready' && before.kind !== 'downloading') setStatus({ kind: 'checking' })
  try {
    const res = await CapacitorHttp.get({
      url: VERSION_URL,
      params: { t: String(Date.now()) },
      responseType: 'json',
      connectTimeout: 15_000,
      readTimeout: 15_000,
    })
    if (res.status !== 200) throw new Error(`The release answered ${res.status}`)
    const latest = parseLatest(res.data)
    if (!latest) throw new Error("The release's version.json isn't readable")
    const plan = planUpdate(latest, runningFrom(BUILD_RUN, NATIVE_FINGERPRINT))

    if (plan.kind === 'none') {
      if (before.kind !== 'ready') setStatus({ kind: 'current', checkedAt: Date.now() })
      if (manual) toast.success("You're on the latest version")
      return
    }

    if (plan.kind === 'apk') {
      setStatus({ kind: 'apk', latest })
      if (manual || once('apk', latest.versionCode)) {
        toast('A new version of the app is ready', {
          description: 'This one needs a fresh install. Your data stays.',
          duration: 15_000,
          action: { label: 'Download', onClick: () => void downloadApk() },
        })
      }
      return
    }

    const u = await loadUpdater()
    const version = String(latest.versionCode)
    const pending = readPending()
    const have = (await u.list()).bundles.find((b) => b.version === version && b.status === 'success')
    // Rolled back once already: don't download it again, wait for a newer one.
    if (failedVersion() === version) {
      setStatus({ kind: 'current', checkedAt: Date.now() })
      return
    }
    if (have && pending?.id === have.id) {
      setStatus({ kind: 'ready', latest, bundleId: have.id })
      return
    }
    setStatus({ kind: 'downloading', latest, percent: 0 })
    const bundle = have ?? (await u.download({ url: latest.bundle.url, version, checksum: latest.bundle.checksum }))
    writePending({ id: bundle.id, version, tries: 0 })
    setStatus({ kind: 'ready', latest, bundleId: bundle.id })
    if (manual || once('ready', latest.versionCode)) {
      toast('Update downloaded', {
        description: 'It goes in the next time you open the app.',
        action: { label: 'Restart now', onClick: () => void applyNow() },
      })
    }
  } catch (err) {
    console.warn('[update]', err)
    // A failed check is retried on the next launch or return; it only needs
    // saying when someone asked for it.
    const message = err instanceof Error ? err.message : String(err)
    setStatus(before.kind === 'ready' ? before : { kind: 'error', message, checkedAt: Date.now() })
    if (manual) toast.error("Couldn't check for updates", { description: message })
  }
}

/** Swap the downloaded bundle in now. The app reloads onto the home screen. */
export async function applyNow(): Promise<void> {
  const s = useAppUpdate.getState().status
  if (s.kind !== 'ready') return
  const u = await loadUpdater()
  const pending = readPending()
  writePending({ id: s.bundleId, version: String(s.latest.versionCode), tries: (pending?.id === s.bundleId ? pending.tries : 0) + 1 })
  await u.set({ id: s.bundleId })
}

/** Open the new APK in the browser, which downloads it and offers to install. */
export async function downloadApk(): Promise<void> {
  const s = useAppUpdate.getState().status
  const url = s.kind === 'apk' ? s.latest.apk : 'https://github.com/AviCagan/HouseholdLauncher/releases/download/latest/app-release.apk'
  try {
    const { AppLauncher } = await import('@capacitor/app-launcher')
    await AppLauncher.openUrl({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
