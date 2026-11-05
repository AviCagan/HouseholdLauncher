/**
 * Whether the installed app is behind, and how it catches up. Pure: the
 * native side (lib/appUpdate.ts) does the fetching and installing.
 *
 * CI publishes version.json beside every APK on the rolling "latest"
 * release. It names the build, the native shell it was built for, the
 * bundle zip with its checksum, and the APK. Two ways forward:
 *
 *   - same native shell  → swap the bundle in over the air, no reinstall
 *   - different shell    → only a new APK will do; offer the download
 */

export interface LatestBuild {
  /** The CI run number: the APK's versionCode and the bundle's BUILD_RUN. */
  versionCode: number
  sha: string
  builtAt: string | null
  /** scripts/native-fingerprint.mjs, for the shell this bundle needs. */
  native: string
  bundle: { url: string; checksum: string }
  apk: string
}

export interface Running {
  /** BUILD_RUN of the bundle running now; 0 for a build that wasn't from CI. */
  build: number
  /** The fingerprint the running bundle was built with. */
  native: string
}

export type UpdatePlan = { kind: 'none' } | { kind: 'bundle'; latest: LatestBuild } | { kind: 'apk'; latest: LatestBuild }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isHttps = (v: unknown): v is string => typeof v === 'string' && /^https:\/\//.test(v)

/** version.json as fetched, or null if it isn't one. */
export function parseLatest(json: unknown): LatestBuild | null {
  const v = typeof json === 'string' ? safeParse(json) : json
  if (!isObj(v) || !isObj(v.bundle)) return null
  const code = v.versionCode
  if (typeof code !== 'number' || !Number.isInteger(code) || code <= 0) return null
  if (typeof v.native !== 'string' || !v.native || !isHttps(v.bundle.url) || !isHttps(v.apk)) return null
  const checksum = v.bundle.checksum
  if (typeof checksum !== 'string' || !/^[0-9a-f]{64}$/.test(checksum)) return null
  return {
    versionCode: code,
    sha: typeof v.sha === 'string' ? v.sha : '',
    builtAt: typeof v.builtAt === 'string' ? v.builtAt : null,
    native: v.native,
    bundle: { url: v.bundle.url, checksum },
    apk: v.apk,
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export function runningFrom(buildRun: string, native: string): Running {
  const build = Number(buildRun)
  return { build: Number.isInteger(build) && build > 0 ? build : 0, native }
}

/**
 * What to do about the latest build. A build that wasn't made by CI never
 * updates itself — it would "update" to whatever is on the release — and an
 * unknown fingerprint never takes a bundle over the air.
 */
export function planUpdate(latest: LatestBuild | null, running: Running): UpdatePlan {
  if (!latest || running.build === 0) return { kind: 'none' }
  if (latest.versionCode <= running.build) return { kind: 'none' }
  if (latest.native !== 'unknown' && running.native !== 'unknown' && latest.native === running.native) return { kind: 'bundle', latest }
  return { kind: 'apk', latest }
}
