import { describe, expect, it } from 'vitest'
import type { MsCalendarRow } from '@/data/types'
import {
  addDays,
  anchorsFor,
  chipText,
  committeeMeetings,
  computeAnchors,
  currentPhase,
  dateFlags,
  daysBetween,
  dueStatus,
  feeSteps,
  lastTuesday,
  nextCommitteeMeeting,
  nextCountdown,
  renderNote,
  resolveDue,
  studyPhases,
} from './dates'

// Clocks change in New York on 2026-11-01 and 2027-03-14. Day arithmetic
// that went through milliseconds would slip a day across either.
process.env.TZ = 'America/New_York'

/** Four rows of AAMC's published 2027 calendar — what the fixtures need. */
const CALENDAR: MsCalendarRow[] = [
  { testDate: '2027-05-01', scoreRelease: '2027-06-02', deadline60: '2027-03-02', deadline30: '2027-04-01', deadline10: '2027-04-21' },
  { testDate: '2027-05-07', scoreRelease: '2027-06-08', deadline60: '2027-03-08', deadline30: '2027-04-07', deadline10: '2027-04-27' },
  { testDate: '2027-05-13', scoreRelease: '2027-06-15', deadline60: '2027-03-14', deadline30: '2027-04-13', deadline10: '2027-05-03' },
  { testDate: '2027-05-21', scoreRelease: '2027-06-23', deadline60: '2027-03-22', deadline30: '2027-04-21', deadline10: '2027-05-11' },
]
const row = (T: string) => CALENDAR.find((r) => r.testDate === T)!

describe('day arithmetic', () => {
  it('steps over the clock changes without losing or gaining a day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2027-03-13', 1)).toBe('2027-03-14')
    expect(addDays('2027-03-14', 1)).toBe('2027-03-15')
    expect(daysBetween('2027-03-01', '2027-04-01')).toBe(31)
    expect(daysBetween('2026-10-25', '2026-11-08')).toBe(14)
  })
})

describe('committee meetings', () => {
  it('are the first Tuesday and third Thursday', () => {
    expect(committeeMeetings(2027, 6)).toEqual(['2027-06-01', '2027-06-17'])
    expect(committeeMeetings(2027, 7)).toEqual(['2027-07-06', '2027-07-15'])
  })

  it('finds the first one on or after a day, into the next month if need be', () => {
    expect(nextCommitteeMeeting('2027-06-17')).toBe('2027-06-17')
    expect(nextCommitteeMeeting('2027-06-18')).toBe('2027-07-06')
    expect(nextCommitteeMeeting('2027-12-20')).toBe('2028-01-04')
  })
})

describe('anchors', () => {
  it('works out every anchor for May 7', () => {
    const a = computeAnchors(row('2027-05-07'))
    expect(a).toMatchObject({
      T: '2027-05-07',
      score: '2027-06-08',
      d60: '2027-03-08',
      d30: '2027-04-07',
      d10: '2027-04-27',
      contentStart: '2027-01-04',
      practice: '2027-03-12',
      fl: '2027-03-26',
      taper: '2027-05-02',
      csiFile: '2027-06-01',
      csiInterview: '2027-06-17',
      csiLetter: '2027-07-01',
      studyBlock1End: '2027-01-19',
      studyBlock2End: '2027-02-04',
      studyBlock3End: '2027-02-20',
      studyBlock4End: '2027-03-11',
    })
  })

  it.each([
    ['2027-05-13', '2027-06-15', '2027-07-06', '2027-07-20'],
    ['2027-05-21', '2027-06-23', '2027-07-06', '2027-07-20'],
    ['2027-05-01', '2027-06-02', '2027-06-17', '2027-07-01'],
  ])('T = %s: scores %s, interview %s, letter %s', (T, score, interview, letter) => {
    const a = computeAnchors(row(T))
    expect(a.score).toBe(score)
    expect(a.csiInterview).toBe(interview)
    expect(a.csiLetter).toBe(letter)
  })

  it('gives the last block the days left over', () => {
    const a = computeAnchors(row('2027-05-07'))
    // 67 days from Jan 4 to Mar 11: 16, 16, 16 and 19.
    expect(daysBetween('2027-01-04', a.studyBlock1End) + 1).toBe(16)
    expect(daysBetween(addDays(a.studyBlock3End, 1), a.studyBlock4End) + 1).toBe(19)
  })

  it('moves with the test date', () => {
    const a = computeAnchors(row('2027-05-13'))
    expect(a.practice).toBe('2027-03-18')
    expect(a.studyBlock4End).toBe('2027-03-17')
  })

  it("has none for a date that isn't in the calendar", () => {
    expect(anchorsFor('2027-05-09', { mcatCalendar2027: CALENDAR })).toBeNull()
    expect(anchorsFor(null, { mcatCalendar2027: CALENDAR })).toBeNull()
    expect(anchorsFor('2027-05-07', { mcatCalendar2027: CALENDAR })?.score).toBe('2027-06-08')
  })

  it('takes the study start from the plan when it has one', () => {
    const a = anchorsFor('2027-05-07', { mcatCalendar2027: CALENDAR, contentStart: '2027-01-11' })!
    expect(a.contentStart).toBe('2027-01-11')
    expect(a.studyBlock1End).toBe('2027-01-25')
  })
})

describe('task dates', () => {
  const a = computeAnchors(row('2027-05-07'))
  const at = (due_anchor: Parameters<typeof resolveDue>[0]['due_anchor'], due_offset = 0) =>
    resolveDue({ due_fixed: null, due_anchor, due_offset }, a)

  it('resolves fixed dates as they are and anchored ones from the test date', () => {
    expect(resolveDue({ due_fixed: '2026-11-03', due_anchor: null, due_offset: 0 }, a)).toBe('2026-11-03')
    expect(at('T', -35)).toBe('2027-04-02')
    expect(at('d10', -3)).toBe('2027-04-24')
    expect(at('score', 4)).toBe('2027-06-12')
    expect(at('studyBlock2End')).toBe('2027-02-04')
  })

  it('leaves an anchored date unknown without a test date', () => {
    expect(resolveDue({ due_fixed: null, due_anchor: 'T', due_offset: 0 }, null)).toBeNull()
  })

  it('fills {d30} in a note with the short date', () => {
    expect(renderNote('Move your date before {d30}.', a)).toBe('Move your date before Apr 7.')
    expect(renderNote('Keep {braces} you meant.', a)).toBe('Keep {braces} you meant.')
  })
})

describe('status chips', () => {
  const today = '2026-11-03'
  it.each([
    ['2026-10-31', false, '3d late'],
    ['2026-11-03', false, 'today'],
    ['2026-11-08', false, 'in 5d'],
    ['2026-11-10', false, 'in 7d'],
    ['2026-11-11', false, null],
    ['2026-10-01', true, 'done'],
  ])('due %s, done %s → %s', (due, done, chip) => {
    expect(chipText(dueStatus(due, today, done))).toBe(chip)
  })
})

describe('the MCAT date', () => {
  it('flags Saturdays, select centers and dates near commencement', () => {
    const sat = { testDate: '2027-05-08', scoreRelease: '2027-06-08', deadline60: '2027-03-09', deadline30: '2027-04-08', deadline10: '2027-04-28' }
    expect(dateFlags(sat, '2027-06-03')).toMatchObject({ saturday: true, nearCommencement: false })
    expect(dateFlags(row('2027-05-21'), '2027-06-03').nearCommencement).toBe(true)
    expect(dateFlags(row('2027-05-13'), '2027-06-03').nearCommencement).toBe(false)
    expect(dateFlags({ ...row('2027-05-13'), selectCentersOnly: true }, null).selectCenters).toBe(true)
  })

  it('lays out what a change costs on the way to test day', () => {
    const steps = feeSteps(row('2027-05-07'), undefined)
    expect(steps.map((s) => [s.from, s.until])).toEqual([
      [null, '2027-03-08'],
      ['2027-03-09', '2027-04-07'],
      ['2027-04-08', '2027-04-27'],
      ['2027-04-28', null],
    ])
    expect(steps[0].label).toContain('$55')
    expect(steps[1].label).toContain('$110')
    expect(steps[1].label).toContain('$180')
  })
})

describe('study phases', () => {
  const a = computeAnchors(row('2027-05-07'))
  const phases = studyPhases(a, '2026-11-02', [{ id: 'm-b2', title: 'Biochem & orgo', focus: 'Enzymes' }])

  it('runs from the light start to test day with no gaps', () => {
    expect(phases.map((p) => p.id)).toEqual(['light', 'block1', 'block2', 'block3', 'block4', 'practice', 'fl', 'taper', 'test'])
    for (let i = 1; i < phases.length; i++) expect(phases[i].start).toBe(addDays(phases[i - 1].end, 1))
    expect(phases[2]).toMatchObject({ label: 'Block 2: Biochem & orgo', focus: 'Enzymes' })
  })

  it('knows which one today is in', () => {
    expect(currentPhase(phases, '2026-11-03')?.id).toBe('light')
    expect(currentPhase(phases, '2027-03-26')?.id).toBe('fl')
    expect(currentPhase(phases, '2027-05-07')?.id).toBe('test')
    expect(currentPhase(phases, '2027-05-08')).toBeNull()
  })
})

describe('countdowns', () => {
  const steps = [
    { label: 'Days to MCAT', date: '2027-05-07' },
    { label: 'Days to scores', date: '2027-06-08' },
  ]

  it('counts down to the next step and lights what is left of its span', () => {
    const c = nextCountdown(steps, '2027-05-01', '2026-11-03', 'Scores are out')
    expect(c).toMatchObject({ label: 'Days to MCAT', days: 6, finished: false })
    if (!c.finished) expect(c.remaining).toBeCloseTo(6 / 185)
  })

  it('moves to the next step once one has passed, never below zero', () => {
    expect(nextCountdown(steps, '2027-05-07', '2026-11-03', 'x')).toMatchObject({ label: 'Days to MCAT', days: 0 })
    const after = nextCountdown(steps, '2027-05-08', '2026-11-03', 'x')
    expect(after).toMatchObject({ label: 'Days to scores', days: 31 })
    if (!after.finished) expect(after.remaining).toBeCloseTo(31 / 32)
    expect(nextCountdown(steps, '2027-06-09', '2026-11-03', 'Scores are out')).toEqual({ label: 'Scores are out', finished: true })
  })

  it('moves on early when the step is done', () => {
    const c = nextCountdown([{ label: 'Request', date: '2027-02-01', doneEarly: true }, ...steps], '2027-01-10', '2026-11-03', 'x')
    expect(c).toMatchObject({ label: 'Days to MCAT' })
  })
})

describe('club meetings', () => {
  it('default to today on a Tuesday and to the last Tuesday otherwise', () => {
    expect(lastTuesday('2026-11-03')).toBe('2026-11-03')
    expect(lastTuesday('2026-11-05')).toBe('2026-11-03')
    expect(lastTuesday('2026-11-02')).toBe('2026-10-27')
  })
})
