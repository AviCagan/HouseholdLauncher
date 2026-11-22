import { useState } from 'react'
import { logEvent } from './actions'
import { place, vesetName, type Veset } from './engine'
import { dateBoth, day, hebrew, time, tzAt, when } from './format'
import { S } from './strings'
import { Btn, Card, cap, Choice, Dot, Section, Why } from './ui'
import { useHer } from './useMikvah'

/**
 * Days of separation: every upcoming onah with its type, its number, its
 * times and bedikah window, a tick when the bedikah is done, and "Why?".
 */
export function OnotTab() {
  const { result, zmanim: z, stored: s, now } = useHer()
  if (!result || !z) return null
  const here = place(now, z, s).onah
  const list = result.vestot.filter((v) => v.end > now - 86_400_000 && (v.kind !== 'or_zarua' || s.orZarua))
  const sep = result.separation.filter((x) => x.abs >= here.abs)

  return (
    <div className="pb-8">
      {list.length === 0 && (
        <Card>
          <p className="mk-dim text-[14px]">{S.onot.none}</p>
        </Card>
      )}
      <div className="flex flex-col gap-2">
        {list.map((v) => (
          <VesetCard key={v.key} v={v} />
        ))}
      </div>

      <Section title={S.onot.list} right={<Why ruleId="V6" />}>
        <Card>
          <p className="text-[15px] font-semibold">{result.haflagahList.length ? result.haflagahList.join(', ') : 'None yet'}</p>
          <p className="mk-dim text-[12.5px]">Counted in onot. A larger number replaces smaller ones; each stays until passed.</p>
        </Card>
      </Section>

      {sep.length > 0 && (
        <Section title={S.onot.separation}>
          {sep.slice(0, 8).map((x) => (
            <Card key={`${x.abs}-${x.label}`} tone="sep">
              <div className="flex items-center gap-3">
                <Dot tone="sep" />
                <p className="min-w-0 flex-1 text-[14px]">
                  <b>{x.label}</b> · {dateBoth(x.abs)}
                </p>
                <Why ruleId={x.ruleId} />
              </div>
            </Card>
          ))}
        </Section>
      )}
    </div>
  )
}

function VesetCard({ v }: { v: Veset }) {
  const { zmanim: z, now } = useHer()
  const [ticking, setTicking] = useState(false)
  const [res, setRes] = useState<'clean' | 'not_clean' | 'question' | null>(null)
  const tz = tzAt(v.start, z)
  const active = v.start <= now && now <= v.end
  const canTick = now >= v.bedikahFrom && now <= v.end && !v.bedikahDone
  const beinonit = v.kind === 'beinonit' || v.kind === 'beinonit31'

  return (
    <Card tone="onah">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="mk-tone-text text-[12px] font-bold uppercase tracking-wider">
            {active ? 'Now' : v.onot.map((o) => `${hebrew(o.abs)} · ${o.half}`).join(' + ')}
          </p>
          <p className="mt-0.5 text-[16px] font-semibold">
            {cap(vesetName(v.kind))}
            {v.number ? <span className="mk-dim font-normal"> · {v.number}</span> : null}
            {v.carried ? <span className="mk-dim font-normal"> · carried</span> : null}
          </p>
          <p className="mk-dim mt-1 text-[13px]">
            {S.onot.window}: {when(v.start, z)} – {day(v.end, tz) === day(v.start, tz) ? time(v.end, tz) : when(v.end, z)}
          </p>
          <p className="mk-dim text-[13px]">
            {S.onot.bedikah}: from {when(v.bedikahFrom, z)}, before the onah ends
          </p>
          <p className="mk-faint mt-1 text-[12px]">{v.reason}</p>
        </div>
        <Why ruleId={v.ruleId} note={v.reason} />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        {v.bedikahDone ? (
          <p className="mk-tone-tehorah mk-tone-text flex-1 text-[14px] font-semibold">✓ {S.onot.done}</p>
        ) : (
          <p className="mk-dim flex-1 text-[13px]">{beinonit ? 'Relations wait until this bedikah is done.' : 'Not done yet.'}</p>
        )}
        {canTick && !ticking && (
          <Btn kind="toned" tone="onah" onClick={() => setTicking(true)}>
            {S.onot.tick}
          </Btn>
        )}
        <Why ruleId="V10" />
      </div>
      {ticking && (
        <div className="mt-3 flex flex-col gap-2">
          <Choice
            value={res}
            options={[
              { value: 'clean', label: S.result.clean },
              { value: 'not_clean', label: S.result.not_clean },
              { value: 'question', label: S.result.question },
            ]}
            onChange={setRes}
            tone="onah"
          />
          <div className="flex gap-2">
            <Btn
              kind="primary"
              className="flex-1"
              disabled={!res}
              onClick={async () => {
                if (res && (await logEvent('bedikah', Date.now(), { result: res }))) setTicking(false)
              }}
            >
              {S.save}
            </Btn>
            <Btn onClick={() => setTicking(false)}>{S.cancel}</Btn>
          </div>
        </div>
      )}
    </Card>
  )
}
