// Household — recipe importer (Supabase Edge Function, Deno)
//
// Turns a link — a recipe site, a food blog, an Instagram post — into a draft
// dish: name, picture, ingredients, steps, servings and nutrition where the
// page provides them.
//
// It has to be a server for the same reason `unfurl` is: a browser cannot read
// another site's HTML. And the parsing lives in parse.ts, which is pure and
// tested from the app's own suite, so this file is only fetching and plumbing.
//
// Two request shapes:
//   { url }   fetch the page and parse it
//   { text }  parse pasted text — the fallback for an Instagram post that
//             served a login wall instead of a caption
//
// Deploy:  supabase functions deploy recipe --no-verify-jwt
// No secrets needed.

import { safeFetch, readCapped } from '../_shared/net.ts'
import { parseRecipeHtml, parseRecipeText, type ParsedRecipe } from './parse.ts'

const TIMEOUT_MS = 10_000
// Further than a link preview reads: the JSON-LD on a food blog is usually
// in the body, below a thousand words of introduction.
const MAX_BYTES = 1536 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: CORS })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = (await req.json()) as { url?: unknown; text?: unknown }

    if (typeof body.text === 'string') {
      const text = body.text.slice(0, 20_000)
      const parsed = parseRecipeText(text)
      const result: ParsedRecipe = {
        name: parsed.name,
        image: null,
        ingredients: parsed.ingredients,
        steps: parsed.steps,
        servings: null,
        nutrition: {},
        sourceKind: 'instagram',
        confidence: 'heuristic',
        ...(parsed.ingredients.length === 0 && parsed.steps.length === 0
          ? { problem: 'nothing-found' as const }
          : {}),
      }
      return reply(result)
    }

    const url = body.url
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return reply({ error: 'Pass an http(s) url or some text' }, 400)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await safeFetch(url, controller.signal).finally(() => clearTimeout(timer))

    if (!res.ok) {
      return reply({ error: `That site answered ${res.status}` })
    }

    const html = await readCapped(res, MAX_BYTES)
    return reply(parseRecipeHtml(html, url))
  } catch (err) {
    console.error('[recipe]', err)
    return reply({ error: String((err as Error).message ?? err) }, 500)
  }
})
