// Things — link unfurler (Supabase Edge Function, Deno)
//
// Reads a product page and returns its title, image and price.
//
// This has to live on a server: a browser cannot fetch another site's HTML,
// because the browser blocks cross-origin reads unless that site opts in with
// CORS headers — and shops do not. So the app asks this function, and this
// function does the fetching.
//
// Deploy:  supabase functions deploy unfurl --no-verify-jwt
// No secrets needed.

const TIMEOUT_MS = 8000
const MAX_BYTES = 512 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface Unfurled {
  title: string | null
  image: string | null
  priceCents: number | null
  siteName: string | null
}

/** Pull a meta tag's content by property or name, whichever the page used. */
function meta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return decodeEntities(m[1].trim())
  }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function parsePrice(raw: string | null): number | null {
  if (!raw) return null
  // Strip currency symbols and thousands separators, keep the decimal.
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}\b)/g, '')
  const normalised = cleaned.replace(',', '.')
  const n = Number.parseFloat(normalised)
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null
  return Math.round(n * 100)
}

/** JSON-LD is where most shops put the real, structured price. */
function fromJsonLd(html: string): { price: number | null; image: string | null; name: string | null } {
  const out = { price: null as number | null, image: null as string | null, name: null as string | null }
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim())
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] ?? [])]
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue
        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers
        const price = offers?.price ?? offers?.lowPrice ?? node.price
        if (price != null && out.price == null) out.price = parsePrice(String(price))
        if (node.name && out.name == null && typeof node.name === 'string') out.name = node.name
        const img = Array.isArray(node.image) ? node.image[0] : node.image
        if (typeof img === 'string' && out.image == null) out.image = img
      }
    } catch {
      // A page with malformed JSON-LD is common; fall back to meta tags.
    }
  }
  return out
}

function absolute(url: string | null, base: string): string | null {
  if (!url) return null
  try {
    return new URL(url, base).href
  } catch {
    return null
  }
}

/*
  This function is deployed with --no-verify-jwt, so anyone who learns its URL
  can ask it to fetch anything. Without a check it will happily retrieve
  http://169.254.169.254/ or any host on the platform's internal network and
  hand back the parsed contents — an unauthenticated SSRF probe wearing a link
  preview as a disguise.

  Cheap and effective: refuse anything that isn't a public hostname, and follow
  redirects by hand so a public URL can't bounce to a private one on hop two.
*/
const BLOCKED_HOST =
  /^(?:localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i

function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOST.test(h)) return true
  // IPv6 loopback, link-local and unique-local.
  if (h === '::1' || h.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(h)) return true

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) {
    // A name with no dot can only be an internal short host.
    return !h.includes('.')
  }
  const [a, b] = v4.slice(1).map(Number)
  if ([a, b].some((n) => Number.isNaN(n) || n > 255)) return true
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||          // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224                              // multicast and reserved
  )
}

/** Follows redirects manually so every hop is re-checked, not just the first. */
async function safeFetch(target: string, signal: AbortSignal): Promise<Response> {
  let current = target
  for (let hop = 0; hop < 5; hop++) {
    const parsed = new URL(current)
    if (isPrivateAddress(parsed.hostname)) {
      throw new Error('refusing to fetch a non-public address')
    }

    const res = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: {
        // Plain fetch gets bot-blocked by most shops.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString()
      continue
    }
    return res
  }
  throw new Error('too many redirects')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { url } = await req.json()
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return Response.json({ error: 'Pass an http(s) url' }, { status: 400, headers: CORS })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await safeFetch(url, controller.signal).finally(() =>
      clearTimeout(timer),
    )

    if (!res.ok) {
      return Response.json({ error: `Site returned ${res.status}` }, { status: 200, headers: CORS })
    }

    // Read a capped slice — product pages put their metadata in <head>, and
    // some listing pages are megabytes of markup we don't need.
    const reader = res.body?.getReader()
    let html = ''
    if (reader) {
      const decoder = new TextDecoder()
      let total = 0
      while (total < MAX_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        html += decoder.decode(value, { stream: true })
        if (/<\/head>/i.test(html)) break
      }
      await reader.cancel().catch(() => undefined)
    }

    const ld = fromJsonLd(html)
    const final = res.url || url

    // Pulled out rather than chained onto the ?? run below: mixing ?? with ||
    // in one expression is a syntax error, not a style preference, and every
    // engine rejects the whole file for it.
    const pageTitle = decodeEntities(
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? '',
    ).trim()

    const result: Unfurled = {
      title: meta(html, 'og:title') ?? ld.name ?? (pageTitle || null),
      image: absolute(meta(html, 'og:image') ?? ld.image, final),
      priceCents:
        ld.price ??
        parsePrice(meta(html, 'product:price:amount')) ??
        parsePrice(meta(html, 'og:price:amount')) ??
        null,
      siteName: meta(html, 'og:site_name'),
    }

    return Response.json(result, { headers: CORS })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not read that page' },
      { status: 200, headers: CORS },
    )
  }
})
