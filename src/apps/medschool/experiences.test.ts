import { describe, expect, it } from 'vitest'
import type { MsCounter, MsExperience, MsExperienceLog, MsExperienceStep } from '@/data/types'
import {
  amcasText,
  blankExperience,
  capWarnings,
  datedSteps,
  dateSpan,
  experienceTotal,
  formatPartial,
  isPartialDate,
  lastLogged,
  loggedTotal,
  sortExperiences,
  targetTotals,
} from './experiences'

process.env.TZ = 'America/New_York'

/** Invented records, just enough to exercise the rules. */
const exp = (id: string, extra: Partial<MsExperience> = {}): MsExperience => ({
  ...blankExperience('shadowing', id, '2026-01-01T00:00:00.000Z', null),
  name: id,
  ...extra,
})

const log = (experience_id: string, on_date: string, hours: number | null, created_at = `${on_date}T12:00:00.000Z`): MsExperienceLog => ({
  id: `${experience_id}-${on_date}-${hours}`,
  experience_id,
  on_date,
  start_time: null,
  end_time: null,
  hours,
  note: null,
  created_by: null,
  created_at,
  updated_at: created_at,
})

const counter = (id: string, target: number, sort: number, unit = 'h'): MsCounter => ({
  id,
  label: id,
  unit,
  target,
  undated: 0,
  note: null,
  cap: null,
  cap_note: null,
  sort,
  updated_at: '',
})

describe('totals', () => {
  const shadow = exp('clinic', { status: 'active' })
  const club = exp('club', { kind: 'club', counts_toward: 'club', status: 'active', prior: 3 })
  const logs = [log('clinic', '2026-09-29', 6.5), log('clinic', '2026-10-06', 8), log('club', '2026-10-27', null), log('club', '2026-11-03', null)]

  it('adds the log to what came before it', () => {
    expect(loggedTotal(shadow, logs)).toBe(14.5)
    expect(experienceTotal(shadow, logs)).toBe(14.5)
  })

  it('counts a club meeting as one, whatever its hours', () => {
    expect(experienceTotal(club, logs)).toBe(5)
  })

  it('rolls each experience into the target it counts towards', () => {
    const service = exp('pantry', { kind: 'service', counts_toward: 'service', status: 'prospect' })
    const totals = targetTotals([counter('club', 10, 2, 'meetings'), counter('shadowing', 150, 0), counter('service', 100, 1)], [shadow, club, service], logs)
    expect(totals.map((t) => [t.counter.id, t.total, t.parts.map((p) => p.exp.id)])).toEqual([
      ['shadowing', 14.5, ['clinic']],
      // A prospect with nothing logged isn't listed under the target.
      ['service', 0, []],
      ['club', 5, ['club']],
    ])
  })
})

describe('cap warnings', () => {
  const observer = exp('observer', { status: 'active', cap_hours: 60, cap_until: '2026-12-29' })

  it('says nothing while far from both limits', () => {
    expect(capWarnings(observer, 20, '2026-11-05')).toEqual([])
  })

  it('warns near the hour cap and at it', () => {
    expect(capWarnings(observer, 50, '2026-11-05')[0].text).toBe('10 h left before the 60 h cap.')
    expect(capWarnings(observer, 60, '2026-11-05')[0].text).toMatch(/^At the 60 h cap/)
  })

  it('warns as the window closes, and once it has', () => {
    expect(capWarnings(observer, 20, '2026-12-19')[0].text).toBe('The window ends in 10 days.')
    expect(capWarnings(observer, 20, '2026-12-29')[0].text).toBe('The window ends today.')
    expect(capWarnings(observer, 20, '2027-01-01')[0].text).toBe('The window ended 3 days ago.')
  })

  it('stays quiet once the experience is over', () => {
    expect(capWarnings({ ...observer, status: 'done' }, 60, '2027-01-01')).toEqual([])
  })
})

describe('dates', () => {
  it('takes a year, a month or a day', () => {
    expect(['2021', '2021-03', '2021-03-05'].every(isPartialDate)).toBe(true)
    expect(['21', '2021-13', '2021-02-30', 'March 2021'].some(isPartialDate)).toBe(false)
  })

  it('writes each the way it was given', () => {
    expect(formatPartial('2021')).toBe('2021')
    expect(formatPartial('2021-03')).toBe('Mar 2021')
    expect(formatPartial('2021-03-05')).toBe('Mar 5, 2021')
  })

  it('says present for something still going, and not for something over', () => {
    expect(dateSpan({ start_on: '2021', end_on: null, status: 'active' })).toBe('2021 – present')
    expect(dateSpan({ start_on: '2020', end_on: '2021', status: 'done' })).toBe('2020 – 2021')
    expect(dateSpan({ start_on: '2024-03', end_on: null, status: 'done' })).toBe('Mar 2024')
    expect(dateSpan({ start_on: null, end_on: null, status: 'prospect' })).toBeNull()
  })
})

describe('the quick log', () => {
  it('picks the experience logged to most recently, by when it was entered', () => {
    const a = exp('a', { status: 'active' })
    const b = exp('b', { status: 'active' })
    const logs = [log('a', '2026-11-03', 2, '2026-11-03T20:00:00.000Z'), log('b', '2026-11-04', 2, '2026-11-03T19:00:00.000Z')]
    expect(lastLogged([a, b], logs)?.id).toBe('a')
  })

  it('skips estimate-only jobs, and falls back to the first going experience', () => {
    const job = exp('job', { kind: 'clinical_paid', status: 'active' })
    const later = exp('later', { status: 'prospect' })
    const now = exp('now', { status: 'active' })
    expect(lastLogged([job, later, now], [log('job', '2026-11-01', 5)])?.id).toBe('now')
  })
})

describe('order', () => {
  it('puts what is going first and what is over last', () => {
    const list = [exp('x', { status: 'done' }), exp('y', { status: 'prospect' }), exp('z', { status: 'active' })]
    expect(sortExperiences(list).map((e) => e.id)).toEqual(['z', 'y', 'x'])
  })
})

describe('the timeline', () => {
  it('shows only dated steps of experiences that still exist', () => {
    const step = (id: string, experience_id: string, due_on: string | null): MsExperienceStep => ({
      id,
      experience_id,
      title: id,
      due_on,
      done_at: null,
      done_by: null,
      sort: 0,
      updated_at: '',
    })
    const views = datedSteps([step('s1', 'a', '2026-11-20'), step('s2', 'a', null), step('s3', 'gone', '2026-11-21')], [exp('a')], '2026-11-05')
    expect(views.map((v) => [v.step.id, v.status.kind])).toEqual([['s1', 'later']])
  })
})

describe('Copy for AMCAS', () => {
  it('gives every field Work & Activities asks for, and flags a missing month', () => {
    const job = exp('Ambulance Co', { kind: 'clinical_paid', role: 'EMT-B', start_on: '2021', end_on: '2022-06', prior: 1200, prior_as_of: '2026-11-05', contact: 'A Supervisor', location: 'Brooklyn, NY' })
    const text = amcasText(job, [])
    expect(text).toContain('Experience type: Paid Employment - Medical/Clinical')
    expect(text).toContain('Experience name: EMT-B — Ambulance Co')
    expect(text).toContain('Dates: ??/2021 – 06/2022')
    expect(text).toContain('Total hours: 1200 (estimate as of 2026-11-05)')
    expect(text).toContain('Description: (write one')
  })

  it('names the specialty for shadowing, and adds up the log', () => {
    const visit = exp('A Hospital', { specialty: 'Surgery', physician_type: 'MD', start_on: '2026-09', description: 'Watched.' })
    const text = amcasText(visit, [log('A Hospital', '2026-09-29', 6.5), log('A Hospital', '2026-10-06', 8)])
    expect(text).toContain('Experience name: Surgery, MD — A Hospital')
    expect(text).toContain('Dates: 09/2026 – present')
    expect(text).toContain('Total hours: 14.5')
    expect(text).toContain('Description: Watched.')
  })
})
