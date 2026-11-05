import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A fingerprint of everything native in the APK: the Android project, the
 * Capacitor config, and the version of every package that ships native code.
 *
 * Over-the-air updates swap the app's JavaScript and leave the native shell
 * alone, which is only safe while the shell is the one the JavaScript was
 * built for. A new plugin, a manifest change or a Capacitor upgrade means
 * JavaScript calling native code the installed APK doesn't have. So every
 * build carries this fingerprint; an update applies over the air only when
 * its fingerprint matches the installed one, and asks for a new APK when it
 * doesn't.
 *
 * Only tracked files count, so build output, the copied web assets and the
 * google-services.json CI writes never change it.
 */

const NATIVE_PACKAGE = /^@capacitor(-[a-z]+)?\/|^@capgo\/|^@capawesome\//

export function nativeFingerprint(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const hash = createHash('sha256')
  try {
    const files = execFileSync('git', ['ls-files', '-z', '--', 'android', 'capacitor.config.ts'], { cwd: root })
      .toString()
      .split('\0')
      .filter(Boolean)
      .sort()
    if (files.length === 0) return 'unknown'
    for (const file of files) {
      hash.update(`${file}\0`)
      hash.update(readFileSync(path.join(root, file)))
      hash.update('\0')
    }
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter((n) => NATIVE_PACKAGE.test(n))
      .sort()
    for (const name of names) hash.update(`${name}@${lock.packages?.[`node_modules/${name}`]?.version ?? '?'}\0`)
  } catch {
    // No git, no lockfile: say so, and the app will never take this bundle
    // over the air rather than guess.
    return 'unknown'
  }
  return hash.digest('hex').slice(0, 16)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(nativeFingerprint())
}
