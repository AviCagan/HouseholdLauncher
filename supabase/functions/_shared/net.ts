// Shared by every function that fetches a URL somebody typed in.
//
// Plain Web APIs only — fetch, URL, TextDecoder — and nothing from Deno, so
// this file is importable from the app's own test suite as well as from the
// functions that ship it.

/*
  These functions are deployed with --no-verify-jwt, so anyone who learns a
  URL can ask it to fetch anything. Without a check it will happily retrieve
  http://169.254.169.254/ or any host on the platform's internal network and
  hand back the parsed contents — an unauthenticated SSRF probe wearing a
  recipe import as a disguise.

  Cheap and effective: refuse anything that isn't a public hostname, and
  follow redirects by hand so a public URL can't bounce to a private one on
  hop two.
*/
export const BLOCKED_HOST =
  /^(?:localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i

export function isPrivateAddress(host: string): boolean {
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

const BROWSER_HEADERS = {
  // Plain fetch gets bot-blocked by most sites.
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

/** Follows redirects manually so every hop is re-checked, not just the first. */
export async function safeFetch(target: string, signal: AbortSignal): Promise<Response> {
  let current = target
  for (let hop = 0; hop < 5; hop++) {
    const parsed = new URL(current)
    if (isPrivateAddress(parsed.hostname)) {
      throw new Error('refusing to fetch a non-public address')
    }

    const res = await fetch(current, { signal, redirect: 'manual', headers: BROWSER_HEADERS })

    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString()
      continue
    }
    return res
  }
  throw new Error('too many redirects')
}

/**
 * Read at most `maxBytes` of a response body as text.
 *
 * Recipe pages are not small — a food blog is a thousand words of story, ads
 * and comments around one JSON-LD block that is usually in the body, not the
 * head — so this reads further than a link preview would, but still stops.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let html = ''
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    html += decoder.decode(value, { stream: true })
  }
  await reader.cancel().catch(() => undefined)
  return html
}
