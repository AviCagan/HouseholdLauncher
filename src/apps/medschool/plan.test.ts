import { describe, expect, it } from 'vitest'
import type { MsSettings } from '@/data/types'
import { countPlan, courseId, describeCounts, exportPlan, parsePlan, type PlanRows } from './plan'

process.env.TZ = 'America/New_York'

/**
 * A made-up plan in the import shape. Invented people, invented grades —
 * just enough of every part to exercise the parser.
 */
function samplePlan() {
  return {
    snapshotDate: '2026-11-03',
    about: 'A sample plan.',
    settings: { testDate: '2027-05-07', booked: true, aamcOrderNumber: '0000-0000', targetScore: null, commencement: { date: '2027-06-03' } },
    mcatCalendar2027: [
      { testDate: '2027-05-07', scoreRelease: '2027-06-08', deadline60: '2027-03-08', deadline30: '2027-04-07', deadline10: '2027-04-27' },
    ],
    mcatFees: { reschedule: { '60plus': 55 } },
    tasks: [
      { id: 'a-fixed', title: 'Something fixed', area: 'School', due: { fixed: '2026-11-10' }, done: true, doneAt: '2026-11-01' },
      { id: 'a-test', title: 'Test day', area: 'MCAT', due: { anchor: 'T', offsetDays: 0 }, hardDeadline: true },
      { id: 'a-fl', title: 'Full-length', area: 'MCAT', due: { anchor: 'fl', offsetDays: 0 }, note: 'Before {d30}.' },
      { id: 'a-advisor', title: 'See the advisor', area: 'CSI', due: { fixed: '2026-11-06' } },
    ],
    eligibility: [
      { id: 'e-one', title: 'Two semesters', met: true },
      { id: 'a-advisor', title: 'Met an advisor' },
      { id: 'e-two', title: 'An essay' },
    ],
    counters: [
      { id: 'hours', label: 'Hours', target: 50, unit: 'h', value: 7.5, log: [{ date: '2026-10-01', hours: 5, note: 'Clinic' }] },
      { id: 'meetings', label: 'Meetings', target: 10, unit: 'meetings', value: 3, log: [], undated: 3 },
    ],
    letters: [
      { id: 'l-one', title: 'Professor A', status: 'not_asked' },
      { id: 'l-two', title: 'Professor B', status: 'asked', askedOn: '2026-10-20' },
    ],
    committee: { rules: ['Meets twice a month.'], contacts: [{ name: 'An Office', email: 'office@example.edu' }], openQuestions: ['Does X count?'] },
    record: {
      source: 'Sample',
      summary: [{ k: 'stale', v: '9.99' }],
      gpaRules: { ambiguous: 'BIO 330 Ethics may be classified as non-science.' },
      courses: [
        { term: 'Fall 2025', code: 'BIO 110', title: 'Biology', grade: 'A', credits: 4, category: 'bio' },
        { term: 'Fall 2025', code: 'BIO 330', title: 'Ethics', grade: 'B', credits: 3, category: 'bio' },
        { term: 'Spring 2026', code: 'BIO 250', title: 'Statistics', grade: 'A-', credits: 3, category: 'math' },
        { term: 'Spring 2026', code: 'CHM 120', title: 'Chemistry', grade: 'W', credits: 0 },
        { term: 'Fall 2026', code: 'PHY 101', title: 'Physics', grade: 'IP', credits: 4 },
      ],
    },
    decisions: ['Apply to both.'],
  }
}

function parse(blob: unknown = samplePlan()) {
  const r = parsePlan(JSON.stringify(blob), new Date(2026, 10, 3, 9))
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r
}

describe('parsePlan', () => {
  it('counts what it found', () => {
    const { counts } = parse()
    expect(describeCounts(counts)).toBe(
      '4 tasks (1 done), 2 counters, 3 eligibility items (1 met), 2 letters, 5 courses (3 graded, 1 in progress, 1 withdrawal), 1 open question',
    )
  })

  it('keeps anchors, and works out the date for the test date', () => {
    const { rows } = parse()
    const test = rows.tasks.find((t) => t.id === 'a-test')!
    expect(test).toMatchObject({ due_fixed: null, due_anchor: 'T', due_offset: 0, due_on: '2027-05-07', hard: true, builtin: true })
    expect(rows.tasks.find((t) => t.id === 'a-fl')!.due_on).toBe('2027-03-26')
  })

  it('puts a day-only doneAt at noon that day', () => {
    const done = parse().rows.tasks.find((t) => t.id === 'a-fixed')!
    expect(new Date(done.done_at!).getDate()).toBe(1)
    expect(new Date(done.done_at!).getHours()).toBe(12)
  })

  it('links an eligibility item to the task with the same id', () => {
    const { rows } = parse()
    expect(rows.eligibility.find((e) => e.id === 'a-advisor')!.task_id).toBe('a-advisor')
    expect(rows.eligibility.find((e) => e.id === 'e-one')!.task_id).toBeNull()
  })

  it('splits a counter into what was logged and what came before', () => {
    const { rows } = parse()
    expect(rows.counters.find((c) => c.id === 'hours')!.undated).toBe(2.5)
    expect(rows.counters.find((c) => c.id === 'meetings')!.undated).toBe(3)
    expect(rows.logs).toHaveLength(1)
    expect(rows.logs[0]).toMatchObject({ counter_id: 'hours', on_date: '2026-10-01', amount: 5 })
  })

  it('gives courses stable ids, defaults their category and flags the doubtful one', () => {
    const { rows } = parse()
    expect(rows.courses.map((c) => c.id)).toContain(courseId('Fall 2025', 'BIO 110'))
    expect(rows.courses.find((c) => c.code === 'CHM 120')!.category).toBe('chem')
    expect(rows.courses.filter((c) => c.maybe_nonscience).map((c) => c.code)).toEqual(['BIO 330'])
  })

  it('keeps everything else as reference, and leaves stale summaries behind', () => {
    const ref = parse().rows.settings.reference
    expect(ref.mcatCalendar2027).toHaveLength(1)
    expect(ref.decisions).toEqual(['Apply to both.'])
    expect(ref.committee?.contacts?.[0].email).toBe('office@example.edu')
    expect(ref.commencement?.date).toBe('2027-06-03')
    expect(ref.record?.source).toBe('Sample')
    expect(ref.record).not.toHaveProperty('summary')
    expect(ref).not.toHaveProperty('tasks')
  })

  it('says what is wrong, item by item, and writes nothing', () => {
    const bad = samplePlan() as Record<string, unknown>
    bad.tasks = [
      { id: 'x', title: 'No date', area: 'MCAT', due: {} },
      { id: 'y', title: 'Odd anchor', area: 'MCAT', due: { anchor: 'whenever' } },
      { id: 'y', title: 'Twice', area: 'MCAT', due: { fixed: '2026-01-01' } },
    ]
    bad.letters = [{ id: 'l', title: 'L', status: 'maybe' }]
    const r = parsePlan(JSON.stringify(bad))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toMatch(/tasks\[0\] \(x\): needs due.fixed or due.anchor/)
    expect(r.errors.join('\n')).toMatch(/"whenever" isn't an anchor/)
    expect(r.errors.join('\n')).toMatch(/used twice/)
    expect(r.errors.join('\n')).toMatch(/letters\[0\].*status/)
  })

  it('refuses something that is not JSON', () => {
    const r = parsePlan('{ nope')
    expect(r.ok).toBe(false)
  })
})

describe('exportPlan', () => {
  function stateFrom(rows: PlanRows) {
    const settings: MsSettings = { singleton: true, ...rows.settings, updated_by: null, updated_at: '' }
    return { ...rows, settings }
  }

  it('gives back what Import was given', () => {
    const first = parse().rows
    const again = parse(exportPlan(stateFrom(first), new Date(2026, 10, 3))).rows
    // Export sorts tasks by date; the rows themselves are what must match.
    const strip = <T extends { id: string }>(rows: T[]) =>
      rows.map((r) => ({ ...r, created_at: '', updated_at: '' })).sort((a, b) => a.id.localeCompare(b.id))
    expect(strip(again.tasks)).toEqual(strip(first.tasks))
    expect(strip(again.counters)).toEqual(strip(first.counters))
    expect(strip(again.logs)).toEqual(strip(first.logs))
    expect(strip(again.eligibility)).toEqual(strip(first.eligibility))
    expect(strip(again.letters)).toEqual(strip(first.letters))
    expect(strip(again.courses)).toEqual(strip(first.courses))
    expect(again.questions.map((q) => q.text)).toEqual(first.questions.map((q) => q.text))
    expect(again.settings).toEqual(first.settings)
    expect(countPlan(again)).toEqual(countPlan(first))
  })

  it('writes the resolved date, the done state of linked items, and fresh GPAs', () => {
    const out = exportPlan(stateFrom(parse().rows), new Date(2026, 10, 3)) as {
      tasks: { id: string; resolvedDue: string }[]
      eligibility: { id: string; met?: boolean }[]
      record: { computed: { cumulative: number } }
    }
    expect(out.tasks.find((t) => t.id === 'a-fl')!.resolvedDue).toBe('2027-03-26')
    expect(out.eligibility.find((e) => e.id === 'e-one')!.met).toBe(true)
    // A 4, B 3, A- 3: (16 + 9 + 11.1) / 10.
    expect(out.record.computed.cumulative).toBeCloseTo(3.61, 3)
  })
})
