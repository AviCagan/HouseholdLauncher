import { CycleChart } from './CycleChart'
import { dateBoth } from './format'
import { cycleRows, stats } from './history'
import { openSheet } from './store'
import { S } from './strings'
import { Card, Section, Why } from './ui'
import { useHer } from './useMikvah'

/** Every cycle, with the numbers across them. */
export function HistoryTab() {
  const { result } = useHer()
  if (!result) return null
  const rows = cycleRows(result)
  const length = stats(rows.map((r) => r.length))
  const toHefsek = stats(rows.map((r) => r.toHefsek))

  if (rows.length === 0) {
    return (
      <Card>
        <p className="mk-dim text-[14px]">{S.history.empty}</p>
      </Card>
    )
  }

  return (
    <div className="pb-8">
      <div className="grid grid-cols-3 gap-2">
        <Stat label={S.history.average} value={length.average} />
        <Stat label={S.history.shortest} value={length.shortest} />
        <Stat label={S.history.longest} value={length.longest} />
      </div>
      <p className="mk-faint mt-2 px-1 text-[12px]">
        Cycle length in days, over {length.count} cycle{length.count === 1 ? '' : 's'}. Hefsek on flow day {toHefsek.average ?? '—'} on average.
      </p>

      <Section title={S.history.chart}>
        <Card>
          <CycleChart rows={rows} />
        </Card>
      </Section>

      <Section title="Every cycle" right={<Why ruleId="V5" label="Haflagah?" />}>
        {[...rows].reverse().map((r) => (
          <Card key={r.id} onClick={() => openSheet({ kind: 'day', abs: r.day1 })}>
            <p className="text-[14.5px] font-semibold">
              {dateBoth(r.day1)} <span className="mk-dim font-normal">· {r.half}</span>
            </p>
            <div className="mk-dim mt-1 grid grid-cols-3 gap-2 text-[12.5px]">
              <span>
                {S.history.length}: <b className="text-[var(--text)]">{r.length ?? '—'}</b>
              </span>
              <span>
                {S.history.toHefsek}: <b className="text-[var(--text)]">{r.toHefsek ? `day ${r.toHefsek}` : '—'}</b>
              </span>
              <span>
                {S.history.number}: <b className="text-[var(--text)]">{r.haflagah ?? '—'}</b>
              </span>
            </div>
          </Card>
        ))}
      </Section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="mk-card px-3 py-3 text-center">
      <p className="text-[22px] font-bold leading-none">{value ?? '—'}</p>
      <p className="mk-dim mt-1 text-[11.5px]">{label}</p>
    </div>
  )
}
