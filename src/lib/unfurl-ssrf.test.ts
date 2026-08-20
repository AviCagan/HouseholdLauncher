import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The unfurl function is deployed with --no-verify-jwt, so anyone who learns
 * its URL can ask it to fetch anything. These pin the address filter that
 * stops it being used as an unauthenticated probe of the platform's internal
 * network.
 *
 * The predicate is extracted from the Deno source rather than imported: the
 * Edge Functions run on a different runtime and aren't part of the app's
 * tsconfig, so this is the same arrangement functions-syntax.test.ts uses to
 * check them at all.
 */

const SRC = new URL('../../supabase/functions/unfurl/index.ts', import.meta.url).pathname

function loadIsPrivateAddress(): (host: string) => boolean {
  const source = readFileSync(SRC, 'utf8')
  const blocked = source.match(/const BLOCKED_HOST =\s*\n?\s*(\/.*\/i)/)
  const fn = source.match(/function isPrivateAddress\(host: string\): boolean \{[\s\S]*?\n\}/)
  if (!blocked || !fn) throw new Error('could not extract the address filter from unfurl')

  const body = fn[0].replace(/: string/g, '').replace(/: boolean/g, '')
  // eslint-disable-next-line no-new-func
  return new Function(`const BLOCKED_HOST = ${blocked[1]}; ${body}; return isPrivateAddress`)() as (
    host: string,
  ) => boolean
}

const isPrivateAddress = loadIsPrivateAddress()

describe('unfurl address filter', () => {
  it('blocks the cloud metadata endpoint', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('metadata.google.internal')).toBe(true)
  })

  it('blocks loopback and every private IPv4 range', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
    ]) {
      expect(isPrivateAddress(host), host).toBe(true)
    }
  })

  it('blocks IPv6 loopback, link-local and unique-local', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('[::1]')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
    expect(isPrivateAddress('fd00::1')).toBe(true)
  })

  it('blocks internal-looking names and bare hostnames', () => {
    expect(isPrivateAddress('localhost')).toBe(true)
    expect(isPrivateAddress('db')).toBe(true)
    expect(isPrivateAddress('printer.local')).toBe(true)
    expect(isPrivateAddress('api.internal')).toBe(true)
  })

  it('allows ordinary public hosts, which is the actual job', () => {
    for (const host of ['amazon.com', 'www.johnlewis.com', 'shop.example.co.uk', '8.8.8.8']) {
      expect(isPrivateAddress(host), host).toBe(false)
    }
  })

  it('does not mistake a public address for a private one on a near miss', () => {
    expect(isPrivateAddress('172.15.0.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('192.169.1.1')).toBe(false)
    expect(isPrivateAddress('11.0.0.1')).toBe(false)
  })
})
