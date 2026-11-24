// The rules for household codes and for guessing at them.
//
// Plain functions with no Deno and no database, so the household function
// can ship them and the app's own test suite can check them
// (src/lib/signin-rules.test.ts).

/**
 * Fold a typed code to its canonical form.
 *
 * Someone reading a code off a note types "sunset 42", "Sunset-42" or
 * "SUNSET42" and means the same thing every time, so none of those may be a
 * wrong code. Normalising before hashing is what allows that without storing
 * the code itself to compare loosely against.
 */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * How long a code has to be, counted after normalising.
 *
 * Owners can do everything, including handing out codes and closing the
 * shared PIN, so theirs are the ones worth the most to a guesser. Everyone
 * else's open only their own items in the apps they were granted. A
 * generated code is the minimum for the role, drawn from 31 characters.
 */
export const MIN_CODE_LENGTH = { owner: 12, other: 8 } as const

export function minCodeLength(role: string | null | undefined): number {
  return role === 'owner' ? MIN_CODE_LENGTH.owner : MIN_CODE_LENGTH.other
}

/** Why a chosen code can't be used, or null when it can. */
export function codeProblem(raw: string, role: string | null | undefined): string | null {
  const min = minCodeLength(role)
  if (normaliseCode(raw).length < min) {
    return role === 'owner'
      ? `Codes for Avi and Jackie need at least ${min} letters or numbers`
      : `Codes need at least ${min} letters or numbers`
  }
  return null
}

/*
  Guessing.

  Two limits, checked before a code is even looked at:

  - Per device: five wrong codes inside a quarter of an hour, then a wait
    until the oldest of those five is a quarter of an hour old. About twenty
    guesses an hour, which is nothing to someone who knows their code and
    mistypes it, and nothing to a guesser either.
  - Household-wide: fifty wrong codes inside a quarter of an hour from
    anywhere, then everyone waits the same way. A guesser who spreads over
    many addresses, or forges them, still meets this one.

  A device that is already signed in never comes here: its session renews
  itself. The cost of the household-wide limit is that someone hammering
  wrong codes can make a new phone wait to sign in, for a quarter of an
  hour at most after they stop.
*/
export const GUESS_WINDOW_MS = 15 * 60 * 1000
export const GUESSES_PER_CLIENT = 5
export const GUESSES_HOUSEHOLD = 50

/**
 * Seconds to wait before another guess, or 0 to go ahead.
 *
 * @param clientFailures this device's wrong codes inside the window, newest first
 * @param householdFailures wrong codes from anywhere inside the window, newest first
 */
export function guessWait(clientFailures: Date[], householdFailures: Date[], now: Date): number {
  const waitFor = (failures: Date[], limit: number) => {
    const recent = failures.filter((d) => now.getTime() - d.getTime() < GUESS_WINDOW_MS)
    if (recent.length < limit) return 0
    // The limit-th most recent failure is the one that has to age out.
    const gate = recent[limit - 1].getTime() + GUESS_WINDOW_MS
    return Math.max(1, Math.ceil((gate - now.getTime()) / 1000))
  }
  return Math.max(waitFor(clientFailures, GUESSES_PER_CLIENT), waitFor(householdFailures, GUESSES_HOUSEHOLD))
}

/** "Too many tries. Wait 3 minutes and try again." */
export function waitMessage(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  const span = seconds < 60 ? 'a minute' : minutes === 1 ? '1 minute' : `${minutes} minutes`
  return `Too many wrong codes. Wait ${span} and try again.`
}

interface HeaderSource {
  get(name: string): string | null
}

const isPrivate = (ip: string) =>
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip)

/**
 * Which device is guessing, as far as the request can say.
 *
 * Cloudflare sets cf-connecting-ip itself and overwrites anything the caller
 * sent, so it is preferred. Failing that, the last public address in
 * x-forwarded-for: proxies append, so the end of the list is the hop the
 * platform saw, and the start is whatever the caller chose to write. Nothing
 * here is trusted for more than keeping one device's guesses together; the
 * household-wide limit doesn't depend on it.
 */
export function clientAddress(headers: HeaderSource): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isPrivate(hops[i])) return hops[i]
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
