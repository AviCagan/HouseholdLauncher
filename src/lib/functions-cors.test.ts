/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every Edge Function the app calls from a browser must allow the headers the
 * app sends.
 *
 * A browser asks first (a CORS preflight) whether the request's headers are
 * allowed, and if one isn't it never sends the request — no error reaches the
 * function and nothing shows in its logs except the preflight. `household`
 * and `unfurl` allowed only `authorization, content-type` while the app sent
 * `apikey` as well, so personal household codes could not be redeemed or set
 * from any browser, and pasted links never filled themselves in.
 */

const ROOT = new URL('../../supabase/functions', import.meta.url).pathname
const SRC = new URL('..', import.meta.url).pathname

/** Headers the app's own fetches to a function send. */
const SENT = ['authorization', 'apikey', 'content-type']

const functions = readdirSync(ROOT).filter((d) => !d.startsWith('_') && statSync(join(ROOT, d)).isDirectory())

/** Functions some file under src/ fetches directly. */
const calledFromApp = (() => {
  const all: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) all.push(readFileSync(full, 'utf8'))
    }
  }
  walk(SRC)
  const text = all.join('\n')
  return functions.filter((f) => text.includes(`/functions/v1/${f}`))
})()

describe('Edge Function CORS', () => {
  it('finds the functions the app calls', () => {
    expect(calledFromApp).toEqual(expect.arrayContaining(['household', 'unfurl', 'recipe']))
  })

  for (const name of calledFromApp) {
    it(`${name} allows every header the app sends`, () => {
      const source = readFileSync(join(ROOT, name, 'index.ts'), 'utf8')
      const match = source.match(/'Access-Control-Allow-Headers':\s*'([^']*)'/)
      expect(match, `${name} declares no Access-Control-Allow-Headers`).not.toBeNull()
      const allowed = match![1].split(',').map((h) => h.trim().toLowerCase())
      for (const header of SENT) expect(allowed, `${name} must allow ${header}`).toContain(header)
    })
  }
})
