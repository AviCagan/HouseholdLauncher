import { describe, expect, it } from 'vitest'
import type { LexiconEntry } from '@/data/types'
import {
  citation,
  formatPronunciation,
  groupByLetter,
  initialOf,
  searchEntries,
  volumeLine,
  wordOfTheDay,
} from './lexicon'

const entry = (patch: Partial<LexiconEntry> = {}): LexiconEntry => ({
  id: patch.term ?? 'x',
  term: 'schlumpy',
  pronunciation: null,
  part_of_speech: 'adjective',
  definition: 'Looking as though one has been rained on, emotionally.',
  example: null,
  origin: null,
  tags: [],
  created_by: 'jackie',
  updated_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...patch,
})

describe('filing letter', () => {
  it('is the first letter, uppercased and unaccented', () => {
    expect(initialOf('schlumpy')).toBe('S')
    expect(initialOf('  Éclair')).toBe('E')
    expect(initialOf('"quoted"')).toBe('Q')
  })

  it('files anything that starts with a number or symbol under #', () => {
    expect(initialOf('2-in-the-morning')).toBe('#')
    expect(initialOf('🙃 face')).toBe('F')
    expect(initialOf('…')).toBe('#')
  })
})

describe('grouping', () => {
  it('sections alphabetically, case-blind, with # last', () => {
    const groups = groupByLetter([
      entry({ term: 'zoodle' }),
      entry({ term: 'Apple-ing' }),
      entry({ term: '3am snack' }),
      entry({ term: 'aardvark' }),
    ])
    expect(groups.map((g) => g.letter)).toEqual(['A', 'Z', '#'])
    expect(groups[0].entries.map((e) => e.term)).toEqual(['aardvark', 'Apple-ing'])
  })

  it('keeps a stable order for identical terms', () => {
    const a = entry({ id: 'a', term: 'same', created_at: '2026-01-01T00:00:00.000Z' })
    const b = entry({ id: 'b', term: 'Same', created_at: '2026-02-01T00:00:00.000Z' })
    expect(groupByLetter([b, a])[0].entries.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('looking up', () => {
  const list = [
    entry({ term: 'schedule-y', definition: 'Overly fond of schedules.' }),
    entry({ term: 'schlumpy' }),
    entry({ term: 'Bischlum', definition: 'A double schlump.' }),
    entry({ term: 'zip', definition: 'Nothing to do with the above.', example: 'schlumpy weather' }),
  ]

  it('puts a term that starts with the query before one that contains it before one that mentions it', () => {
    expect(searchEntries(list, 'schl').map((e) => e.term)).toEqual(['schlumpy', 'Bischlum', 'zip'])
  })

  it('is case- and accent-blind', () => {
    expect(searchEntries([entry({ term: 'Éclair' })], 'ecl')).toHaveLength(1)
    expect(searchEntries(list, 'SCHLUMPY')[0].term).toBe('schlumpy')
  })

  it('returns the whole book in order for an empty query', () => {
    expect(searchEntries(list, '   ').map((e) => e.term)).toEqual(['Bischlum', 'schedule-y', 'schlumpy', 'zip'])
  })
})

describe('word of the day', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((t) => entry({ term: t }))

  it('is null for an empty volume', () => {
    expect(wordOfTheDay([], new Date())).toBeNull()
  })

  it('is the same word all day and changes with the date', () => {
    const morning = new Date(2026, 8, 12, 7)
    const night = new Date(2026, 8, 12, 23)
    expect(wordOfTheDay(list, morning)?.term).toBe(wordOfTheDay(list, night)?.term)
    const picks = new Set(
      Array.from({ length: 30 }, (_, i) => wordOfTheDay(list, new Date(2026, 8, 1 + i))?.term),
    )
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe('typesetting', () => {
  it('wraps a bare pronunciation in slashes and leaves a bracketed one alone', () => {
    expect(formatPronunciation('SHLUM-pee')).toBe('/SHLUM-pee/')
    expect(formatPronunciation('/ʃlʌmpi/')).toBe('/ʃlʌmpi/')
    expect(formatPronunciation('[ʃlʌmpi]')).toBe('[ʃlʌmpi]')
    expect(formatPronunciation('  ')).toBeNull()
    expect(formatPronunciation(null)).toBeNull()
  })

  it('cites who added it and who revised it', () => {
    const nameOf = (id: string) => ({ jackie: 'Jackie', avi: 'Avi' })[id] ?? '?'
    expect(citation(entry(), nameOf)).toMatch(/^Added by Jackie · \d+ \w+ 2026$/)
    expect(citation(entry({ updated_by: 'avi' }), nameOf)).toMatch(/ · revised by Avi$/)
    expect(citation(entry({ updated_by: 'jackie' }), nameOf)).not.toContain('revised')
  })

  it('reads the volume line like a title page', () => {
    expect(volumeLine(0)).toBe('Volume I · no entries yet')
    expect(volumeLine(1)).toBe('Volume I · 1 entry')
    expect(volumeLine(37)).toBe('Volume I · 37 entries')
  })
})
