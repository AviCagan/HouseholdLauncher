import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { fire } from '@/lib/haptics'
import { useData } from '@/store/useData'
import type { EpisodeTuple, WatchShow } from '@/data/types'
import { useWatched } from './useWatched'
import { OURS_JACK, useMe, usePeople, useWatchUI } from './store'
import { Poster } from './ui'
import { addShow, between, setPoster, slotIntoLineup, updatePace, type Destination } from './actions'
import { fetchPosters, type PosterOption } from './tvmaze'
import { allEpisodes, formatHours, formatMinutes, formatSpan, isoDay } from './model'
import { clampPace, episodesPerWeek } from './pace'

// --- pace ---------------------------------------------------------------------------

const DIAL_MIN = 30
const DIAL_MAX = 2400

/**
 * How much TV a week. Measured by default; dial it in by hand if the
 * measurement is off (a holiday binge, a busy month).
 */
export function PaceSheet() {
  const close = useWatchUI((s) => s.close)
  const { pace, sample, settings } = useWatched()
  const me = useMe()
  const mode = settings?.pace_mode ?? 'auto'
  const [dial, setDial] = useState(() => clampPace(settings?.pace_minutes ?? pace.minutesPerWeek))
  const commit = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (commit.current) clearTimeout(commit.current)
  }, [])

  function turn(minutes: number) {
    setDial(minutes)
    if (commit.current) clearTimeout(commit.current)
    commit.current = setTimeout(() => updatePace({ pace_mode: 'manual', pace_minutes: minutes }, me), 400)
  }

  const shown = mode === 'manual' ? dial : pace.minutesPerWeek
  const ticks = [0.5, 2, 5, 10, 20, 40]

  return (
    <Sheet open onClose={close} title={<span className="tv-osd tv-yellow text-[23px]">YOUR PACE</span>}>
      <div className="flex flex-col gap-4 pb-6">
        <div className="tv-card flex flex-col items-center gap-1 py-4">
          <span className="tv-osd tv-green text-[46px] leading-none">{formatMinutes(shown).toUpperCase()}</span>
          <span className="tv-osd text-[16px]" style={{ color: 'var(--tv-faint)' }}>
            OF TV A WEEK
          </span>
          <span className="tv-osd mt-1 text-[16px]" style={{ color: 'var(--tv-dim)' }}>
            ≈ {Math.round(episodesPerWeek(shown, 45) * 10) / 10} HOUR-LONG DRAMAS · {Math.round(episodesPerWeek(shown, 22) * 10) / 10} SITCOMS
          </span>
        </div>

        <div className="tv-card flex gap-1 p-1">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                if (m === mode) return
                fire('snap')
                updatePace(m === 'manual' ? { pace_mode: 'manual', pace_minutes: dial } : { pace_mode: 'auto' }, me)
              }}
              className={`tv-osd flex-1 rounded-[10px] py-2 text-[17px] ${m === mode ? 'tv-btn tv-btn--cream' : ''}`}
              style={{ color: m === mode ? undefined : 'var(--tv-dim)' }}
            >
              {m === 'auto' ? 'MEASURE IT' : 'SET IT MYSELF'}
            </button>
          ))}
        </div>

        {mode === 'auto' ? (
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--tv-dim)' }}>
            {sample
              ? `Measured from your last ${sample.seasons} season${sample.seasons === 1 ? '' : 's'}: ${sample.episodes} episodes, ${formatHours(sample.minutes)}, over ${formatSpan(sample.days)} — breaks included, so the dates fit real life.${
                  pace.confidence < 1
                    ? ` That's only ${formatSpan(sample.spanDays)} of history, so it's blended with the starter pace for now — it's all yours after about three weeks.`
                    : ''
                }`
              : `No finished seasons yet, so the estimates use ${formatMinutes(pace.minutesPerWeek)} a week until you finish one. It gets more accurate every time you tap “Finished season”.`}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* A tuning dial: a frequency scale with a red needle. */}
            <div className="tv-card relative px-3 pb-2 pt-3">
              <div className="relative h-7">
                {ticks.map((h) => {
                  const x = dialPosition(h * 60)
                  return (
                    <span key={h} className="tv-osd absolute top-0 -translate-x-1/2 text-[13px]" style={{ left: `${x * 100}%`, color: 'var(--tv-faint)' }}>
                      {h < 1 ? '½' : h}H
                    </span>
                  )
                })}
              </div>
              <div
                className="relative h-3 rounded"
                style={{ background: 'repeating-linear-gradient(90deg, rgb(255 255 255 / 0.25) 0 1px, transparent 1px 8px)' }}
              >
                <span className="absolute -top-2 bottom-[-8px] w-[3px] -translate-x-1/2 rounded" style={{ left: `${dialPosition(dial) * 100}%`, background: 'var(--tv-red)', boxShadow: '0 0 8px var(--tv-red)' }} />
              </div>
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round(dialPosition(dial) * 1000)}
                onChange={(e) => turn(dialMinutes(Number(e.target.value) / 1000))}
                aria-label="Hours of TV a week"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </div>
            <p className="text-[12.5px]" style={{ color: 'var(--tv-dim)' }}>
              Every date in the app moves with this. Switch back to “Measure it” any time.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  )
}

/** The dial is logarithmic: the difference between 1 and 2 hours matters more than 30 and 31. */
function dialPosition(minutes: number): number {
  const m = Math.min(DIAL_MAX, Math.max(DIAL_MIN, minutes))
  return Math.log(m / DIAL_MIN) / Math.log(DIAL_MAX / DIAL_MIN)
}

function dialMinutes(position: number): number {
  const raw = DIAL_MIN * Math.pow(DIAL_MAX / DIAL_MIN, position)
  // Snap to the quarter hour; nobody means 3h 7m.
  return clampPace(Math.round(raw / 15) * 15)
}

// --- slotting into the lineup ------------------------------------------------------

/** "Put it here": every gap in the lineup, from next up to the very end. */
export function SlotSheet({ showId }: { showId: string }) {
  const close = useWatchUI((s) => s.close)
  const setTab = useWatchUI((s) => s.setTab)
  const { shows, lineup, playing, projections, now } = useWatched()
  const me = useMe()
  const show = shows.find((s) => s.id === showId)
  const queue = lineup.filter((s) => s.id !== showId)
  const today = isoDay(now)
  const airing = show ? allEpisodes(show).some((e) => e.airdate !== null && e.airdate > today) : false
  const [live, setLive] = useState(airing)

  if (!show) return null

  function put(order: number) {
    slotIntoLineup(show!, order, me, { live })
    toast.success(`${show!.title} is in the lineup`)
    setTab('onair')
    close()
  }

  const binging = playing.filter((p) => !p.live)
  const gaps: { label: string; sub?: string; order: number }[] = [
    {
      label: '⏭ PLAY NEXT',
      sub: binging.length ? `after ${binging.map((p) => p.title).join(' & ')}` : 'first in line',
      order: between(undefined, queue[0]?.lineup_order),
    },
    // Nothing waits for a show watched as it airs — it runs alongside — so
    // "after" it isn't a place in the line.
    ...queue.flatMap((s, i) =>
      s.live
        ? []
        : [
            {
              label: `AFTER ${s.title.toUpperCase()}`,
              sub: projections.get(s.id)?.finish
                ? `that's done ~${projections.get(s.id)!.finish!.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                : undefined,
              order: between(s.lineup_order, queue[i + 1]?.lineup_order),
            },
          ],
    ),
  ]
  // The last "after X" is the end of the line; say so.
  if (gaps.length > 1) gaps[gaps.length - 1].label += ' (THE END)'

  return (
    <Sheet open onClose={close} title={<span className="tv-osd tv-yellow text-[22px]">SLOT IT IN</span>} maxHeight="88vh">
      <div className="flex flex-col gap-3 pb-6">
        <div className="flex items-center gap-3">
          <Poster url={show.poster_url} title={show.title} className="h-[72px] w-[48px] shrink-0" />
          <p className="tv-glow min-w-0 truncate text-[17px] font-bold">{show.title}</p>
        </div>

        {airing && (
          <button
            onClick={() => {
              fire(live ? 'toggleOff' : 'toggleOn')
              setLive((v) => !v)
            }}
            className="tv-card flex items-center justify-between gap-3 px-3 py-2.5 text-left"
            role="switch"
            aria-checked={live}
          >
            <span>
              <span className="tv-osd block text-[17px]">{live ? 'WATCH IT AS IT AIRS' : 'BINGE IT IN ITS TURN'}</span>
              <span className="block text-[12px]" style={{ color: 'var(--tv-dim)' }}>
                {live ? 'Each episode on the day it drops, alongside everything else.' : 'Waits for its place in the line.'}
              </span>
            </span>
            <span className="tv-led shrink-0" data-on={live} style={{ width: 12, height: 12 }} />
          </button>
        )}

        <div className="flex flex-col gap-2">
          {gaps.map((g) => (
            <button key={g.label} onClick={() => put(g.order)} className="tv-btn flex flex-col items-start px-3 py-2.5 text-left">
              <span className="tv-osd text-[17px]">{g.label}</span>
              {g.sub && <span className="text-[11.5px] opacity-70">{g.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

// --- pictures ------------------------------------------------------------------------

/** Swap the picture: any of TVmaze's for the show, or a link to one. */
export function PosterSheet({ showId }: { showId: string }) {
  const close = useWatchUI((s) => s.close)
  const show = useData((s) => s.watch_shows.find((x) => x.id === showId))
  const me = useMe()
  const [options, setOptions] = useState<PosterOption[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [link, setLink] = useState('')

  useEffect(() => {
    if (!show?.tvmaze_id) return
    const ctrl = new AbortController()
    fetchPosters(show.tvmaze_id, ctrl.signal)
      .then(setOptions)
      .catch((err) => {
        if ((err as { name?: string })?.name !== 'AbortError') setFailed(true)
      })
    return () => ctrl.abort()
  }, [show?.tvmaze_id])

  if (!show) return null

  const choose = (url: string) => {
    setPoster(show, url, me)
    toast.success('New picture')
    close()
  }

  const posters = options?.filter((o) => o.kind === 'poster') ?? []
  const wide = options?.filter((o) => o.kind !== 'poster') ?? []
  const validLink = /^https?:\/\/\S+$/i.test(link.trim())

  return (
    <Sheet open onClose={close} title={<span className="tv-osd tv-yellow text-[22px]">PICK A PICTURE</span>} maxHeight="90vh">
      <div className="flex flex-col gap-4 pb-6">
        {show.tvmaze_id !== null && options === null && !failed && (
          <p className="tv-osd tv-green text-[17px]">TUNING IN…</p>
        )}
        {failed && <p className="tv-osd tv-red text-[16px]">COULDN'T REACH TVMAZE</p>}

        {posters.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5">
            {posters.map((p) => (
              <button key={p.url} onClick={() => choose(p.thumb)} className="text-left" aria-label="Use this picture">
                <Poster url={p.thumb} title={show.title} className="aspect-[2/3] w-full" />
                {show.poster_url === p.thumb && (
                  <span className="tv-osd tv-green mt-1 block text-center text-[13px]">ON NOW</span>
                )}
              </button>
            ))}
          </div>
        )}

        {wide.length > 0 && (
          <>
            <p className="tv-osd px-1 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
              WIDE SHOTS
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {wide.map((p) => (
                <button key={p.url} onClick={() => choose(p.url)} aria-label="Use this picture">
                  <Poster url={p.thumb} title={show.title} className="aspect-video w-full" />
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          <p className="tv-osd px-1 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
            OR PASTE A PICTURE LINK
          </p>
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              className="tv-input min-w-0 flex-1 text-[15px]"
            />
            <button
              disabled={!validLink}
              onClick={() => choose(link.trim())}
              className="tv-btn tv-btn--yellow tv-osd shrink-0 px-3 text-[17px]"
            >
              USE
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

// --- typed in by hand ----------------------------------------------------------------

/**
 * For the show TVmaze doesn't have: a title, how many seasons, how many
 * episodes in each, and how long they run. Enough for every estimate.
 */
export function ManualSheet({ preset }: { preset: Destination | null }) {
  const close = useWatchUI((s) => s.close)
  const closeAll = useWatchUI((s) => s.closeAll)
  const open = useWatchUI((s) => s.open)
  const setTab = useWatchUI((s) => s.setTab)
  const people = usePeople()
  const me = useMe()
  const [title, setTitle] = useState('')
  const [seasons, setSeasons] = useState('1')
  const [episodes, setEpisodes] = useState('10')
  const [minutes, setMinutes] = useState('45')
  const [poster, setPosterUrl] = useState('')
  const [dest, setDest] = useState<Destination>(preset ?? { kind: 'shelf', owner: me })

  const parsed = useMemo(() => {
    const count = Math.max(1, Math.min(60, parseInt(seasons, 10) || 0))
    const perSeason = episodes
      .split(/[,\s]+/)
      .map((n) => parseInt(n, 10))
      .filter((n) => n > 0 && n < 1000)
    const runtime = Math.max(1, Math.min(600, parseInt(minutes, 10) || 0))
    return { count, perSeason, runtime }
  }, [seasons, episodes, minutes])

  const valid = title.trim().length > 0 && parsed.perSeason.length > 0 && parsed.runtime > 0

  function save() {
    if (!valid) return
    const today = isoDay(new Date())
    const eps: EpisodeTuple[] = []
    for (let s = 1; s <= parsed.count; s++) {
      const n = parsed.perSeason[s - 1] ?? parsed.perSeason[parsed.perSeason.length - 1]
      // Dated today: a show typed in by hand is assumed to be all out.
      for (let e = 1; e <= n; e++) eps.push([s, e, parsed.runtime, today])
    }
    const result = addShow(
      {
        tvmaze_id: null,
        title: title.trim(),
        premiered: null,
        ended: null,
        status: null,
        network: null,
        genres: [],
        summary: null,
        poster_url: /^https?:\/\//i.test(poster.trim()) ? poster.trim() : null,
        avg_runtime: parsed.runtime,
        episodes: eps,
        seasons: [],
        next_airdate: null,
      },
      dest,
      me,
    )
    if (result.status !== 'added') return
    if (dest.kind === 'watched') {
      closeAll()
      open({ kind: 'rate', showId: result.show.id, seasons: [], includeShow: true, backfill: true })
      return
    }
    toast.success(`${result.show.title} added`)
    if (dest.kind === 'shelf') useWatchUI.getState().setShelf(dest.owner)
    setTab(dest.kind === 'shelf' ? 'shelf' : 'onair')
    closeAll()
  }

  const destKey = (d: Destination) => (d.kind === 'shelf' ? `shelf:${d.owner ?? 'ours'}` : d.kind === 'lineup' ? `lineup:${d.at}` : d.kind)
  const choices: { d: Destination; label: string; jack?: string }[] = [
    ...people.filter((p) => p.id === me).map((p) => ({ d: { kind: 'shelf', owner: p.id } as Destination, label: 'MY SHELF', jack: p.jack })),
    { d: { kind: 'shelf', owner: null }, label: 'OUR SHELF', jack: OURS_JACK },
    ...people.filter((p) => p.id !== me).map((p) => ({ d: { kind: 'shelf', owner: p.id } as Destination, label: `${p.name.toUpperCase()}'S`, jack: p.jack })),
    { d: { kind: 'lineup', at: 'end' }, label: '+ LINEUP' },
    { d: { kind: 'watching' }, label: '▶ WATCHING' },
    { d: { kind: 'watched', throughSeason: null }, label: '✓ WATCHED' },
  ]

  const totalEps = Array.from({ length: parsed.count }, (_, i) => parsed.perSeason[i] ?? parsed.perSeason[parsed.perSeason.length - 1] ?? 0).reduce((a, b) => a + b, 0)

  return (
    <Sheet open onClose={close} title={<span className="tv-osd tv-yellow text-[22px]">TYPE IT IN</span>} maxHeight="92vh">
      <div className="flex flex-col gap-3 pb-6">
        <Field label="TITLE">
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="tv-input text-[16px]" placeholder="What's it called?" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="SEASONS">
            <input value={seasons} onChange={(e) => setSeasons(e.target.value)} inputMode="numeric" className="tv-input text-[16px]" />
          </Field>
          <Field label="MINUTES / EPISODE">
            <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" className="tv-input text-[16px]" />
          </Field>
        </div>
        <Field label="EPISODES PER SEASON" hint="One number for all, or one each: 10, 8, 12">
          <input value={episodes} onChange={(e) => setEpisodes(e.target.value)} className="tv-input text-[16px]" />
        </Field>
        <Field label="PICTURE LINK (OPTIONAL)">
          <input value={poster} onChange={(e) => setPosterUrl(e.target.value)} inputMode="url" autoCapitalize="off" className="tv-input text-[15px]" placeholder="https://…" />
        </Field>

        {valid && (
          <p className="tv-osd tv-green text-[17px]">
            {parsed.count} SEASON{parsed.count === 1 ? '' : 'S'} · {totalEps} EPS · {formatHours(totalEps * parsed.runtime).toUpperCase()}
          </p>
        )}

        <div>
          <p className="tv-osd px-1 pb-2 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
            WHERE IT GOES
          </p>
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => {
              const on = destKey(c.d) === destKey(dest)
              return (
                <button
                  key={destKey(c.d)}
                  onClick={() => {
                    fire('snap')
                    setDest(c.d)
                  }}
                  className={`tv-btn tv-osd flex items-center gap-1.5 px-2.5 py-2 text-[15px] ${on ? 'tv-btn--cream' : ''}`}
                >
                  {c.jack && <span className="tv-jack" style={{ ['--jack' as string]: c.jack, width: 18, height: 18 }} />}
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>

        <button disabled={!valid} onClick={save} className="tv-btn tv-btn--yellow tv-osd mt-2 py-3 text-[19px]">
          ADD IT
        </button>
      </div>
    </Sheet>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="tv-osd block px-1 pb-1.5 text-[15px]" style={{ color: 'var(--tv-faint)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="block px-1 pt-1 text-[11.5px]" style={{ color: 'var(--tv-faint)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

export type { WatchShow }
