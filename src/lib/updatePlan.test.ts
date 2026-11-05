import { describe, expect, it } from 'vitest'
import { parseLatest, planUpdate, runningFrom, type LatestBuild } from './updatePlan'

const latest = (extra: Partial<LatestBuild> = {}): LatestBuild => ({
  versionCode: 50,
  sha: 'abc1234',
  builtAt: '2026-11-05T19:00:00Z',
  native: 'f1',
  bundle: { url: 'https://github.com/o/r/releases/download/latest/bundle.zip', checksum: 'a'.repeat(64) },
  apk: 'https://github.com/o/r/releases/download/latest/app-release.apk',
  ...extra,
})

describe('planUpdate', () => {
  it('swaps the bundle in when only the JavaScript changed', () => {
    expect(planUpdate(latest(), runningFrom('44', 'f1')).kind).toBe('bundle')
  })

  it('asks for a new APK when the native shell changed', () => {
    expect(planUpdate(latest({ native: 'f2' }), runningFrom('44', 'f1')).kind).toBe('apk')
  })

  it('does nothing when already on that build, or newer', () => {
    expect(planUpdate(latest(), runningFrom('50', 'f1')).kind).toBe('none')
    expect(planUpdate(latest(), runningFrom('51', 'f1')).kind).toBe('none')
  })

  it('never updates a build that did not come from CI', () => {
    expect(planUpdate(latest(), runningFrom('', 'f1')).kind).toBe('none')
  })

  it('never takes a bundle over the air when either fingerprint is unknown', () => {
    expect(planUpdate(latest({ native: 'unknown' }), runningFrom('44', 'unknown')).kind).toBe('apk')
    expect(planUpdate(latest(), runningFrom('44', 'unknown')).kind).toBe('apk')
  })

  it('does nothing without a latest build', () => {
    expect(planUpdate(null, runningFrom('44', 'f1')).kind).toBe('none')
  })
})

describe('parseLatest', () => {
  const json = {
    versionCode: 50,
    sha: 'abc1234',
    builtAt: '2026-11-05T19:00:00Z',
    native: 'f1',
    bundle: { url: 'https://example.com/bundle.zip', checksum: 'b'.repeat(64) },
    apk: 'https://example.com/app-release.apk',
  }

  it('reads version.json, as an object or as text', () => {
    expect(parseLatest(json)?.versionCode).toBe(50)
    expect(parseLatest(JSON.stringify(json))?.bundle.checksum).toBe('b'.repeat(64))
  })

  it('refuses anything it cannot act on safely', () => {
    expect(parseLatest('not json')).toBeNull()
    expect(parseLatest({ ...json, versionCode: '50' })).toBeNull()
    expect(parseLatest({ ...json, bundle: { ...json.bundle, url: 'http://example.com/b.zip' } })).toBeNull()
    expect(parseLatest({ ...json, bundle: { ...json.bundle, checksum: 'XYZ' } })).toBeNull()
    expect(parseLatest({ ...json, native: '' })).toBeNull()
  })
})
