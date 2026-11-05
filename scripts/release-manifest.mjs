import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * version.json for the rolling release: what the installed Android app reads
 * to decide whether it's behind and how to catch up (src/lib/updatePlan.ts).
 *
 *   node scripts/release-manifest.mjs <dist> <out> <owner/repo>
 *
 * Everything about the build comes from the bundle's own build.json (emitted
 * by vite.config.ts), so the numbers the app compares against are exactly
 * the ones baked into the bundle it would download.
 */

const [dist, out, repo] = process.argv.slice(2)
if (!dist || !out || !repo) {
  console.error('usage: release-manifest.mjs <dist> <out> <owner/repo>')
  process.exit(2)
}

const stamp = JSON.parse(readFileSync(path.join(dist, 'build.json'), 'utf8'))
const versionCode = Number(stamp.run)
if (!Number.isInteger(versionCode) || versionCode <= 0) {
  console.error(`build.json has no CI run number (${JSON.stringify(stamp.run)}); not publishing an update.`)
  process.exit(1)
}

const zip = readFileSync(path.join(out, 'bundle.zip'))
const checksum = createHash('sha256').update(zip).digest('hex')
const apk = readdirSync(out).find((f) => f.endsWith('.apk'))
if (!apk) {
  console.error('No APK in the output folder.')
  process.exit(1)
}

// By the "latest" tag, not /releases/latest/: a tagged release marked latest
// would otherwise answer for the rolling one, without these files.
const base = `https://github.com/${repo}/releases/download/latest`
const manifest = {
  versionCode,
  sha: stamp.sha,
  builtAt: stamp.builtAt,
  native: stamp.native,
  bundle: { url: `${base}/bundle.zip`, checksum },
  apk: `${base}/${apk}`,
}
writeFileSync(path.join(out, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest, null, 2))
