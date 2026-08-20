import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchPlaces, parseCoordinates, normalizeQuery } from './geocode'

/**
 * The address/label split is the point of these tests.
 *
 * A store's card shows its name with the address underneath, so folding the
 * place name into the address rendered as "Taster's Market" above "Taster's
 * Market, 330 Bradley Avenue, New York". The dropdown still needs the name
 * though — without it two branches of the same chain are indistinguishable
 * while you're picking one.
 */

function mockPhoton(properties: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{ geometry: { coordinates: [-74.006, 40.7128] }, properties }],
      }),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchPlaces', () => {
  it('keeps the place name out of the address', async () => {
    mockPhoton({
      name: "Taster's Market",
      housenumber: '330',
      street: 'Bradley Avenue',
      city: 'New York',
      state: 'NY',
      postcode: '10314',
    })

    const [place] = await searchPlaces('tasters market')
    expect(place.address).toBe('330 Bradley Avenue, New York, NY, 10314')
    expect(place.address).not.toMatch(/Taster/)
  })

  it('still shows the name in the dropdown label', async () => {
    mockPhoton({
      name: "Taster's Market",
      housenumber: '330',
      street: 'Bradley Avenue',
      city: 'New York',
    })

    const [place] = await searchPlaces('tasters market')
    expect(place.label).toContain("Taster's Market")
    expect(place.label).toContain('330 Bradley Avenue')
    expect(place.name).toBe("Taster's Market")
  })

  it('handles a plain address with no place name', async () => {
    mockPhoton({ housenumber: '12', street: 'Main Street', city: 'Boston' })

    const [place] = await searchPlaces('12 main street')
    expect(place.name).toBeNull()
    expect(place.address).toBe('12 Main Street, Boston')
    expect(place.label).toBe('12 Main Street, Boston')
  })

  it('does not treat a name that merely repeats the street as a name', async () => {
    mockPhoton({ name: 'Main Street', street: 'Main Street', city: 'Boston' })

    const [place] = await searchPlaces('main street')
    expect(place.name).toBeNull()
  })

  it('reads coordinates in GeoJSON order, which is lng first', async () => {
    mockPhoton({ street: 'Main Street', city: 'Boston' })

    const [place] = await searchPlaces('main street')
    expect(place.lat).toBeCloseTo(40.7128)
    expect(place.lng).toBeCloseTo(-74.006)
  })

  it('does not call out for a query too short to be meaningful', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await searchPlaces('ab')).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('parseCoordinates', () => {
  it('accepts the manual-entry escape hatch', () => {
    expect(parseCoordinates('40.7128, -74.0060')).toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('rejects out-of-range and malformed values', () => {
    expect(parseCoordinates('91, 0')).toBeNull()
    expect(parseCoordinates('0, 181')).toBeNull()
    expect(parseCoordinates('not coords')).toBeNull()
  })
})

describe('normalizeQuery', () => {
  it('collapses case and whitespace so the cache key is stable', () => {
    expect(normalizeQuery('  Costco   Brooklyn ')).toBe('costco brooklyn')
  })
})
