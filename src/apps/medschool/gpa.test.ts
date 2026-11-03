import { describe, expect, it } from 'vitest'
import type { MsCategory, MsCourse } from '@/data/types'
import { academicYear, byTerm, byYear, defaultCategory, fmtRange, gpaOf, gpaSummary, isOverridden, termOrder } from './gpa'

/** Made-up courses. Nothing here is anyone's real record. */
let n = 0
function course(term: string, code: string, grade: string, credits: number, category?: MsCategory, maybe_nonscience = false): MsCourse {
  return {
    id: `c${++n}`,
    term,
    code,
    title: code,
    grade,
    credits,
    category: category ?? defaultCategory(code),
    category_note: null,
    maybe_nonscience,
    imported: true,
    sort: n,
    updated_at: '',
  }
}

const record = [
  course('Fall 2020', 'ENG 101', 'A', 3),
  course('Fall 2020', 'BIO 101', 'B', 4),
  course('Spring 2021', 'CHM 110', 'C+', 4),
  course('Spring 2021', 'MTH 120', 'A-', 3),
  course('Spring 2021', 'HIS 100', 'W', 0),
  course('Summer 2021', 'PHY 101', 'B+', 4),
  course('Fall 2021', 'BIO 210', 'A', 4, 'bio', true),
  course('Fall 2021', 'BIO 260', 'A', 3, 'math'),
  course('Fall 2021', 'CHM 220', 'IP', 4),
  course('Winter 2022', 'ART 100', 'P', 1),
]

describe('gpa', () => {
  it('weights by credits and leaves W, IP and P out', () => {
    const r = gpaOf(record)
    // 3×4 + 4×3 + 4×2.3 + 3×3.7 + 4×3.3 + 4×4 + 3×4 = 85.5 over 25 credits.
    expect(r.credits).toBe(25)
    expect(r.gpa).toBeCloseTo(85.5 / 25, 6)
  })

  it('gives BCPM as a range when a course might not count as science', () => {
    const { bcpm } = gpaSummary(record)
    // With BIO 210: bio 4×3 + 4×4, chem 4×2.3, math 3×3.7 + 3×4, phys 4×3.3 → 73.5 / 22.
    // Without it: 57.5 / 18.
    expect(bcpm.high).toBeCloseTo(73.5 / 22, 6)
    expect(bcpm.low).toBeCloseTo(57.5 / 18, 6)
    expect(fmtRange(bcpm)).toBe(`${(57.5 / 18).toFixed(3)}–${(73.5 / 22).toFixed(3)}`)
  })

  it('leaves math out of AACOMAS science, including a statistics course filed as math', () => {
    const { aacomas } = gpaSummary(record)
    // bio 12 + 16, chem 9.2, phys 13.2 → 50.4 / 16 with BIO 210; 34.4 / 12 without.
    expect(aacomas.high).toBeCloseTo(50.4 / 16, 6)
    expect(aacomas.low).toBeCloseTo(34.4 / 12, 6)
  })

  it('shows one number when nothing is in doubt', () => {
    const plain = record.filter((c) => !c.maybe_nonscience)
    const { bcpm } = gpaSummary(plain)
    expect(fmtRange(bcpm)).toBe((57.5 / 18).toFixed(3))
  })

  it('has nothing to say about no graded courses', () => {
    expect(gpaOf([course('Fall 2030', 'BIO 1', 'IP', 4)]).gpa).toBeNull()
    expect(fmtRange(gpaSummary([]).bcpm)).toBe('—')
  })
})

describe('categories', () => {
  it('come from the subject code, and a different one counts as overridden', () => {
    expect(defaultCategory('BIO 101')).toBe('bio')
    expect(defaultCategory('CHM 110')).toBe('chem')
    expect(defaultCategory('PHY 101')).toBe('phys')
    expect(defaultCategory('MTH 120')).toBe('math')
    expect(defaultCategory('PSY 100')).toBe('other')
    expect(isOverridden({ code: 'BIO 260', category: 'math' })).toBe(true)
    expect(isOverridden({ code: 'BIO 101', category: 'bio' })).toBe(false)
  })
})

describe('terms and years', () => {
  it('sorts terms in calendar order, winter in January', () => {
    const terms = ['Fall 2021', 'Winter 2022', 'Spring 2021', 'Summer 2021', 'Spring 2022']
    expect([...terms].sort((a, b) => termOrder(a) - termOrder(b))).toEqual([
      'Spring 2021',
      'Summer 2021',
      'Fall 2021',
      'Winter 2022',
      'Spring 2022',
    ])
  })

  it('runs academic years Fall to Summer', () => {
    expect(academicYear('Fall 2020')).toBe('2020–21')
    expect(academicYear('Spring 2021')).toBe('2020–21')
    expect(academicYear('Summer 2021')).toBe('2020–21')
    expect(academicYear('Winter 2022')).toBe('2021–22')
    expect(academicYear('Sometime')).toBeNull()
  })

  it('totals each year', () => {
    const years = byYear(record)
    expect(years.map((y) => [y.year, y.credits])).toEqual([
      ['2020–21', 18],
      ['2021–22', 7],
    ])
    expect(years[1].all).toBe(4)
    expect(years[0].terms).toEqual(['Fall 2020', 'Spring 2021', 'Summer 2021'])
  })

  it('groups courses by term in order', () => {
    expect(byTerm(record).map((t) => t.term)).toEqual(['Fall 2020', 'Spring 2021', 'Summer 2021', 'Fall 2021', 'Winter 2022'])
  })
})
