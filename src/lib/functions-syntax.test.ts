/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * Check every Edge Function source.
 *
 * These files are the one part of the repo `tsc` never sees — they're Deno, so
 * they sit outside the app's tsconfig — which meant a plain grammar error in
 * `unfurl` (mixing `??` with `||`, illegal in ECMAScript) survived until the
 * Supabase bundler rejected it mid-deploy, taking the function queued behind it
 * down with it.
 *
 * Type checking proper is not the goal and not achievable from Node: `Deno`,
 * `jsr:` and `npm:` specifiers are all unresolvable here. So the four
 * diagnostics that says-nothing-is-wrong noise are ignored by code, and
 * anything else fails the test. Grammar errors — the class that actually
 * breaks a deploy — are not in that list, which the last case proves.
 */

/** Expected when checking Deno sources from Node, and only these. */
const EXPECTED_IN_DENO = new Map<number, string>([
  [2304, "Cannot find name — Deno's globals aren't in Node's lib"],
  [2307, 'Cannot find module — jsr:/npm: specifiers do not resolve here'],
  [5097, 'An import path may end with .ts — legal in Deno, not in this config'],
  [7006, 'Implicitly any parameter — no ambient types to infer from'],
])

const ROOT = new URL('../../supabase/functions', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

function realProblems(files: string[], file: string): string[] {
  const program = ts.createProgram(files, {
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
    noResolve: true,
    types: [],
  })
  const source = program.getSourceFile(file)
  return [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ]
    .filter((d) => !EXPECTED_IN_DENO.has(d.code))
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
}

const files = sourceFiles(ROOT)

describe('Edge Function sources', () => {
  it('finds the functions to check', () => {
    // A rename that silently emptied this list would make every case below
    // pass while checking nothing.
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))('checks out: %s', (_name, file) => {
    expect(realProblems(files, file)).toEqual([])
  })

  it('actually catches the error that broke the deploy', () => {
    // Guards the guard. `createSourceFile` and `transpileModule` both report
    // nothing for this, which is how a vacuous version of this test could
    // pass while the deploy still failed.
    const broken = join(ROOT, '__syntax_probe__.ts')
    const host = ts.createCompilerHost({})
    const original = host.getSourceFile.bind(host)
    host.getSourceFile = (name, ...rest) =>
      name === broken
        ? ts.createSourceFile(name, 'export const x = a ?? b || c', ts.ScriptTarget.ESNext)
        : original(name, ...rest)

    const program = ts.createProgram([broken], { noEmit: true, noResolve: true, types: [] }, host)
    const found = program
      .getSemanticDiagnostics(program.getSourceFile(broken))
      .filter((d) => !EXPECTED_IN_DENO.has(d.code))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))

    expect(found).toContain("'??' and '||' operations cannot be mixed without parentheses.")
  })
})
