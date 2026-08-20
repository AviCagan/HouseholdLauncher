import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env'

/**
 * Ask the server what's behind a link.
 *
 * The fetching happens in the `unfurl` Edge Function, not here, because a
 * browser cannot read another site's HTML — cross-origin reads are blocked
 * unless that site sends CORS headers, and shops don't.
 *
 * If the function isn't deployed this returns null and the caller falls back
 * to using the domain as the title, so pasting a link always does *something*.
 */

export interface LinkPreview {
  title: string | null
  image: string | null
  priceCents: number | null
  siteName: string | null
}

export const isUrl = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim())

/**
 * Accept what someone would actually type into a "website" field.
 *
 * "amazon.com" is what you say out loud, but `window.open` treats a
 * scheme-less string as a relative path and navigates inside the app instead
 * of out to the shop. Returns null for anything that isn't plausibly a domain,
 * so a blank or junk field stores nothing rather than a broken link.
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    // A bare word like "amazon" parses fine but isn't a reachable host.
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** "https://www.amazon.com/dp/x" → "amazon.com" */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export async function unfurl(url: string): Promise<LinkPreview | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/unfurl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) return null
    const data = (await res.json()) as LinkPreview & { error?: string }
    if (data.error) return null

    // A preview with nothing usable in it is the same as no preview.
    if (!data.title && !data.image && data.priceCents == null) return null
    return data
  } catch {
    return null
  }
}
