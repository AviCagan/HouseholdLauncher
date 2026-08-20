import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The URLs a Shortcut or an IFTTT applet is built around. Getting a parameter
 * name or the TEXT placeholder wrong here doesn't fail loudly — it produces a
 * shortcut that adds an item to the wrong list, or one that posts the literal
 * word "TEXT" every time.
 */

vi.mock('./env', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  isConfigured: () => true,
}))

const { voiceUrl, newVoiceToken, VOICE_LISTS } = await import('./voice')

const TOKEN = 'abc123'

beforeEach(() => vi.clearAllMocks())

describe('voiceUrl', () => {
  it('ends with the literal TEXT placeholder, unescaped', () => {
    // Both Shortcuts and IFTTT ask you to swap this for their own variable by
    // hand, so it must be findable as plain text rather than percent-encoded.
    expect(voiceUrl(TOKEN, 'todos')).toMatch(/&text=TEXT$/)
  })

  it('carries the token and the list', () => {
    const u = new URL(voiceUrl(TOKEN, 'shopping_items'))
    expect(u.searchParams.get('token')).toBe(TOKEN)
    expect(u.searchParams.get('list')).toBe('shopping_items')
    expect(u.pathname).toBe('/functions/v1/add')
  })

  it('carries who, so the scoreboard credits the right person', () => {
    const u = new URL(voiceUrl(TOKEN, 'todos', 'jackie'))
    expect(u.searchParams.get('who')).toBe('jackie')
  })

  it('pins a shortcut to one store when asked', () => {
    const u = new URL(voiceUrl(TOKEN, 'shopping_items', 'avi', "Trader Joe's"))
    expect(u.searchParams.get('store')).toBe("Trader Joe's")
    expect(u.searchParams.get('list')).toBe('shopping_items')
  })

  it('omits store entirely when there isn\'t one', () => {
    expect(voiceUrl(TOKEN, 'todos', 'avi')).not.toContain('store=')
  })

  it('returns nothing without a token, so a disabled feature has no URL', () => {
    expect(voiceUrl(null, 'todos')).toBe('')
  })
})

describe('newVoiceToken', () => {
  it('is unguessable and unique per call', () => {
    const a = newVoiceToken()
    const b = newVoiceToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).not.toContain('-')
  })
})

describe('VOICE_LISTS', () => {
  it('covers all four lists using the real table names', () => {
    expect(VOICE_LISTS.map((l) => l.list)).toEqual([
      'todos',
      'chores',
      'shopping_items',
      'wishlist_items',
    ])
  })
})
