import { describe, expect, it } from 'vitest'
import {
  clientAddress,
  codeProblem,
  GUESS_WINDOW_MS,
  GUESSES_HOUSEHOLD,
  GUESSES_PER_CLIENT,
  guessWait,
  minCodeLength,
  normaliseCode,
  waitMessage,
} from '../../supabase/functions/_shared/signin'

const now = new Date('2026-11-24T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const minutes = (n: number) => n * 60 * 1000
/** `count` failures, newest first, one every `gapMs`, the newest `startMs` ago. */
const failures = (count: number, gapMs: number, startMs = 0) =>
  Array.from({ length: count }, (_, i) => ago(startMs + i * gapMs))

const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name.toLowerCase()] ?? null })

describe('codes', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(normaliseCode('sunset harbor-42')).toBe('SUNSETHARBOR42')
  })

  it('asks owners for longer codes than everyone else', () => {
    expect(minCodeLength('owner')).toBe(12)
    expect(minCodeLength('member')).toBe(8)
    expect(minCodeLength('guest')).toBe(8)
    expect(minCodeLength(null)).toBe(8)
  })

  it('counts length after normalising', () => {
    // 11 letters and numbers once the spaces go: one short for an owner.
    expect(codeProblem('sunset 42 abc', 'owner')).toMatch(/at least 12/)
    expect(codeProblem('sunset harbor 42', 'owner')).toBeNull()
    expect(codeProblem('ab-cd-ef-g', 'guest')).toMatch(/at least 8/)
    expect(codeProblem('abcd efgh', 'guest')).toBeNull()
  })

  it('no longer takes the old four-character codes', () => {
    expect(codeProblem('1234', 'member')).not.toBeNull()
    expect(codeProblem('1234', 'owner')).not.toBeNull()
  })
})

describe('guess limit', () => {
  it('lets the first few wrong codes through', () => {
    expect(guessWait(failures(GUESSES_PER_CLIENT - 1, 1000), [], now)).toBe(0)
  })

  it('makes one device wait after five wrong codes in a quarter of an hour', () => {
    // Five wrong codes a minute apart, the newest just now: the oldest of
    // them was 4 minutes ago and ages out in 11.
    const wait = guessWait(failures(GUESSES_PER_CLIENT, minutes(1)), [], now)
    expect(wait).toBe(11 * 60)
  })

  it('forgets wrong codes older than the window', () => {
    const old = failures(GUESSES_PER_CLIENT, 1000, GUESS_WINDOW_MS + 1000)
    expect(guessWait(old, old, now)).toBe(0)
  })

  it('makes everyone wait after fifty wrong codes from anywhere', () => {
    const household = failures(GUESSES_HOUSEHOLD, 1000)
    expect(guessWait([], household, now)).toBeGreaterThan(0)
    expect(guessWait([], household.slice(1), now)).toBe(0)
  })

  it('never says to wait zero seconds once limited', () => {
    const edge = failures(GUESSES_PER_CLIENT, 0, GUESS_WINDOW_MS - 10)
    expect(guessWait(edge, [], now)).toBe(1)
  })

  it('says how long, in words', () => {
    expect(waitMessage(20)).toBe('Too many wrong codes. Wait a minute and try again.')
    expect(waitMessage(60)).toBe('Too many wrong codes. Wait 1 minute and try again.')
    expect(waitMessage(11 * 60)).toBe('Too many wrong codes. Wait 11 minutes and try again.')
  })
})

describe('which device is guessing', () => {
  it("prefers Cloudflare's address, which the caller can't set", () => {
    expect(clientAddress(headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9')
  })

  it('takes the last public hop, not the first one the caller wrote', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.3' }))).toBe('198.51.100.7')
  })

  it('falls back when nothing names an address', () => {
    expect(clientAddress(headers({}))).toBe('unknown')
    expect(clientAddress(headers({ 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '192.0.2.4' }))).toBe('192.0.2.4')
  })
})
