/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { BRIDGE_OPS, ROOT_NAME, bridgeSource } from '../../supabase/functions/inventory/bridge'

/**
 * The Apps Script that Inventory hands an owner to paste into Google.
 *
 * It can't be run from here — it only exists inside Google — so what can be
 * checked is checked: it parses as JavaScript once the secret is baked in,
 * every operation the Edge Function forwards is one the script answers, and
 * it refuses to be built around something that isn't a generated secret.
 */

const SECRET = 'a'.repeat(20) + '_B-' + '9'.repeat(20)

describe('Inventory Drive bridge', () => {
  const source = bridgeSource(SECRET)

  it('is valid JavaScript', () => {
    const file = ts.createSourceFile('bridge.gs.js', source, ts.ScriptTarget.ES2015, true, ts.ScriptKind.JS)
    const diagnostics = (file as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  })

  it('carries the secret and the folder it works in', () => {
    expect(source).toContain(`var SECRET = '${SECRET}';`)
    expect(source).toContain(ROOT_NAME)
  })

  it('answers every operation the server forwards', () => {
    const ops = source.slice(source.indexOf('var OPS = {'))
    for (const op of BRIDGE_OPS) expect(ops).toMatch(new RegExp(`\\n  ${op}: function`))
  })

  it('keeps every operation inside the Inventory folder', () => {
    // Anything that takes an id goes through itemFolder/itemFile, so even a
    // leaked secret can't reach the rest of the Drive.
    for (const op of ['list', 'upload', 'scan', 'preview', 'trash', 'readDoc', 'writeDoc']) {
      const start = source.indexOf(`\n  ${op}: function`)
      const end = source.indexOf('\n  },', start)
      expect(source.slice(start, end), op).toMatch(/item(Folder|File)\(/)
    }
  })

  it('refuses anything that is not a generated secret', () => {
    expect(() => bridgeSource('')).toThrow()
    expect(() => bridgeSource("x'; DriveApp.getRootFolder(); '")).toThrow()
  })
})
