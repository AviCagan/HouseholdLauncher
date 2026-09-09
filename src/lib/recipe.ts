import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env'
import type { Nutrition } from '@/data/types'

/**
 * Ask the server to read a recipe from a link, or from pasted text.
 *
 * The parsing is the `recipe` Edge Function's job (and its pure `parse.ts`,
 * which is what the tests cover). This is the client half: one call, one
 * shape back, and an honest error instead of a null when the page could not
 * be read — because "Instagram wouldn't show us that post" and "the link was
 * wrong" call for different next steps and the sheet offers different ones.
 */

export interface ImportedRecipe {
  name: string | null
  image: string | null
  /** Raw ingredient lines, exactly as the page had them. */
  ingredients: string[]
  steps: string[]
  servings: number | null
  nutrition: Nutrition
  sourceKind: 'web' | 'instagram'
  confidence: 'structured' | 'heuristic'
  problem?: 'login-wall' | 'nothing-found'
}

export type ImportResult =
  | { ok: true; recipe: ImportedRecipe }
  | { ok: false; error: string }

async function call(body: Record<string, string>): Promise<ImportResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Importing needs the household to be connected' }
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/recipe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json()) as ImportedRecipe & { error?: string }
    if (!res.ok || data.error) {
      return { ok: false, error: data.error ?? `The importer answered ${res.status}` }
    }
    return { ok: true, recipe: data }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.name === 'TimeoutError'
        ? 'That site took too long to answer'
        : "Couldn't reach the importer",
    }
  }
}

export const importFromUrl = (url: string): Promise<ImportResult> => call({ url: url.trim() })

export const importFromText = (text: string): Promise<ImportResult> => call({ text })
