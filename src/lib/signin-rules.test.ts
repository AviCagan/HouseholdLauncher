import { describe, expect, it } from 'vitest'
import {
  APPROVAL_TTL_MS,
  approvalProblem,
  clientAddress,
  codeProblem,
  GUESS_WINDOW_MS,
  GUESSES_HOUSEHOLD,
  GUESSES_PER_CLIENT,
  guessWait,
  codeFormat,
  makeCode,
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

  it('takes 4 or 6 digits, for anyone', () => {
    expect(codeProblem('1234', 'owner')).toBeNull()
    expect(codeProblem('12 34', 'guest')).toBeNull()
    expect(codeProblem('123456', 'member')).toBeNull()
    expect(codeProblem('12345', 'owner')).toMatch(/4 or 6 digits/)
    expect(codeProblem('1234567', 'owner')).toMatch(/4 or 6 digits/)
  })

  it('takes letters and numbers from 6 characters', () => {
    expect(codeProblem('sunset', 'owner')).toBeNull()
    expect(codeProblem('ab-12-c', 'guest')).toMatch(/at least 6/)
    expect(codeProblem('sunset harbor 42', 'member')).toBeNull()
  })

  it("makes Nano's code as long as a key", () => {
    expect(codeProblem('1234', 'agent')).toMatch(/Nano's code needs at least 40/)
    expect(codeProblem('A'.repeat(40), 'agent')).toBeNull()
  })

  it('makes codes up in the format asked for', () => {
    let n = 0
    const bytes = (k: number) => Uint8Array.from({ length: k }, () => (n = (n * 97 + 31) % 256))
    expect(makeCode('digits4', bytes)).toMatch(/^\d{4}$/)
    expect(makeCode('digits6', bytes)).toMatch(/^\d{6}$/)
    expect(makeCode('letters', bytes)).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(makeCode('nano', bytes)).toHaveLength(40)
    for (const format of ['digits4', 'digits6', 'letters', 'nano'] as const) {
      expect(codeProblem(makeCode(format, bytes), format === 'nano' ? 'agent' : 'owner')).toBeNull()
    }
  })

  it('never makes a digit from a byte that would skew it', () => {
    // 250-255 are skipped, so 0-5 aren't more likely than 6-9.
    const seq = [255, 251, 250, 3, 249, 7, 9]
    let i = 0
    const bytes = (k: number) => Uint8Array.from({ length: k }, () => seq[i++ % seq.length])
    expect(makeCode('digits4', bytes)).toBe('3979')
  })

  it('falls back to 6 digits when no format is given', () => {
    expect(codeFormat(undefined)).toBe('digits6')
    expect(codeFormat('digits4')).toBe('digits4')
    expect(codeFormat('nonsense')).toBe('digits6')
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

describe("Nano's approvals in the household function", () => {
  const approved = (over: Partial<Parameters<typeof approvalProblem>[0] & object> = {}) => ({
    kind: 'code' as const,
    status: 'approved',
    approved_at: ago(minutes(1)).toISOString(),
    target_profile: 'p1',
    ...over,
  })

  it('lets an approved, unused, matching approval through', () => {
    expect(approvalProblem(approved(), 'set-code', 'p1', now)).toBeNull()
    expect(approvalProblem(approved({ kind: 'member', target_profile: null }), 'create-member', null, now)).toBeNull()
  })

  it('needs an approval at all', () => {
    expect(approvalProblem(null, 'set-code', 'p1', now)).toMatch(/Avi's code/)
  })

  it('is spent once', () => {
    expect(approvalProblem(approved({ status: 'used' }), 'set-code', 'p1', now)).toMatch(/already been used/)
  })

  it('covers only the action and the person it names', () => {
    expect(approvalProblem(approved({ kind: 'access' }), 'set-code', 'p1', now)).toMatch(/something else/)
    expect(approvalProblem(approved(), 'set-code', 'p2', now)).toMatch(/someone else/)
  })

  it('runs out ten minutes after Avi approves it', () => {
    const stale = approved({ approved_at: ago(APPROVAL_TTL_MS + 1000).toISOString() })
    expect(approvalProblem(stale, 'set-code', 'p1', now)).toMatch(/ran out/)
  })

  it('is never enough for actions outside the list', () => {
    expect(approvalProblem(approved(), 'close-legacy', null, now)).toMatch(/can't do that/)
  })
})
