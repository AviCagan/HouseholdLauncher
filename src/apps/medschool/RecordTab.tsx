import { useMemo } from 'react'
import { byTerm, byYear, CATEGORY_LABEL, fmtGpa, fmtRange, gpaSummary, gradePoints, isOverridden } from './gpa'
import { scaleOf } from './plan'
import { useCourses, useMs, useMsUI } from './store'
import { Chip, Lines, Panel } from './ui'

/** The academic record, and the GPAs the applications will show. */
export function RecordTab() {
  const courses = useCourses()
  const { settings } = useMs()
  const open = useMsUI((s) => s.open)
  const ref = settings?.reference ?? {}
  const scale = scaleOf(ref)
  const summary = useMemo(() => gpaSummary(courses, scale), [courses, scale])
  const years = useMemo(() => byYear(courses, scale), [courses, scale])
  const terms = useMemo(() => byTerm(courses), [courses])
  const doubtful = courses.filter((c) => c.maybe_nonscience)

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="lg-rez grid grid-cols-3 gap-2" style={{ '--rez-i': 0 } as React.CSSProperties}>
        <Tile label="Cumulative" value={fmtGpa(summary.cumulative.gpa)} sub={`${summary.cumulative.credits} graded cr`} />
        <Tile label="AMCAS BCPM" value={fmtRange(summary.bcpm)} sub="bio, chem, phys, math" />
        <Tile label="AACOMAS sci" value={fmtRange(summary.aacomas)} sub="bio, chem, phys" />
      </div>
      {doubtful.length > 0 && (
        <p className="lg-dim -mt-1 px-1 text-[12px] leading-snug">
          The science ranges are with and without {doubtful.map((c) => c.code).join(', ')}, which might not be classified as science.
        </p>
      )}

      {years.length > 0 && (
        <Panel title="By academic year" rez={1}>
          <p className="lg-dim -mt-1 pb-2 text-[12px]">AMCAS years run Fall → Summer.</p>
          <table className="w-full text-left">
            <thead>
              <tr className="lg-label !text-[10px]">
                <th className="pb-1.5 font-semibold">Year</th>
                <th className="pb-1.5 text-right font-semibold">Cr</th>
                <th className="pb-1.5 pl-3 font-semibold">All</th>
                <th className="pb-1.5 pl-3 font-semibold">Science</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.year} className="lg-rule">
                  <td className="py-2 pr-2">
                    <span className="lg-num block text-[13px]">{y.year}</span>
                    <span className="lg-dim block text-[11px]">{y.terms.join(', ')}</span>
                  </td>
                  {y.credits === 0 ? (
                    <td colSpan={3} className="lg-dim py-2 pl-3 text-right text-[12.5px]">
                      In progress
                    </td>
                  ) : (
                    <>
                      <td className="lg-num py-2 text-right text-[12.5px]">{y.credits}</td>
                      <td className="py-2 pl-3">
                        <Bar value={y.all} />
                      </td>
                      <td className="py-2 pl-3">
                        <Bar value={y.science} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel
        title="Courses"
        rez={2}
        action={
          <button type="button" className="lg-btn lg-btn--small lg-btn--primary" onClick={() => open({ kind: 'course', courseId: null })}>
            Add course
          </button>
        }
      >
        {terms.length === 0 && <p className="lg-dim text-[13px]">No courses yet.</p>}
        <div className="flex flex-col gap-4">
          {terms.map((t) => (
            <div key={t.term}>
              <div className="flex items-center gap-2 pb-1">
                <h3 className="lg-label min-w-0 flex-1 !text-[11px] !text-[var(--lg-ice)]">{t.term}</h3>
                <button type="button" className="lg-btn lg-btn--small lg-btn--ghost !min-h-[32px] !px-2" onClick={() => open({ kind: 'course', courseId: null, term: t.term })}>
                  Add
                </button>
              </div>
              <ul>
                {t.courses.map((c) => {
                  const counts = gradePoints(c.grade, scale) !== null
                  return (
                    <li key={c.id} className="lg-rule">
                      <button type="button" className="flex min-h-[48px] w-full items-center gap-2.5 py-1.5 text-left" onClick={() => open({ kind: 'course', courseId: c.id })}>
                        <span className="lg-num w-[64px] shrink-0 text-[12.5px]">{c.code}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px]">{c.title}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            <Chip>
                              {CATEGORY_LABEL[c.category]}
                              {isOverridden(c) ? ' · set' : ''}
                            </Chip>
                            {c.maybe_nonscience && <Chip tone="warn">maybe not science</Chip>}
                          </span>
                        </span>
                        <span className="lg-num lg-dim shrink-0 text-[11.5px]">{c.credits} cr</span>
                        <span
                          className={`lg-num w-[30px] shrink-0 text-right text-[14px] ${c.grade === 'IP' ? 'lg-live' : counts ? '' : 'lg-dim'}`}
                        >
                          {c.grade ?? '—'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      {((ref.record?.notes?.length ?? 0) > 0 || ref.record?.openRequirement) && (
        <Panel title="Notes" rez={3}>
          {ref.record?.openRequirement && (
            <p className="mb-3 text-[13.5px] leading-snug">
              <span className="lg-label mr-1.5 !text-[10.5px]">Open requirement</span>
              {ref.record.openRequirement}
            </p>
          )}
          {ref.record?.notes && <Lines items={ref.record.notes} />}
          {ref.record?.source && <p className="lg-dim mt-3 text-[11.5px]">From the {ref.record.source}.</p>}
        </Panel>
      )}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="lg-panel px-2.5 pb-2.5 pt-2" data-edge="live">
      <p className="lg-label !text-[9.5px]">{label}</p>
      <p className="lg-num lg-live mt-1 whitespace-nowrap text-[13px] leading-tight tracking-tight min-[420px]:text-[15px] sm:text-[20px]">{value}</p>
      <p className="lg-dim mt-1 text-[10.5px] leading-tight">{sub}</p>
    </div>
  )
}

/** A GPA as a short bar from 2.0 to 4.0, with the number beside it. */
function Bar({ value }: { value: number | null }) {
  if (value === null) return <span className="lg-dim lg-num text-[12px]">—</span>
  const p = Math.max(0, Math.min(1, (value - 2) / 2))
  return (
    <span className="flex items-center gap-2">
      <span className="lg-num w-[32px] text-[12.5px]">{value.toFixed(2)}</span>
      <span className="relative h-[3px] min-w-[24px] flex-1 bg-[var(--lg-trace)]">
        <span className="absolute inset-y-0 left-0 bg-[var(--lg-blue)]" style={{ width: `${p * 100}%` }} />
        <span className="absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 bg-[var(--lg-cyan)]" style={{ left: `${p * 100}%` }} />
      </span>
    </span>
  )
}
