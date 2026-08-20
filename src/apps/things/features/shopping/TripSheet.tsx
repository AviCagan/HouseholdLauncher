import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useUI } from '@/store/useUI'
import { useSettings } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { geocode, parseCoordinates, type LatLng } from '@/apps/things/routing/geocode'
import { buildMatrix } from '@/apps/things/routing/osrm'
import { solveTrip, legs } from '@/apps/things/routing/solve'
import { navOptions, openExternal, singleStopUrl, copyToClipboard } from '@/apps/things/routing/deeplink'
import { formatDuration } from '@/lib/time'
import type { Store } from '@/data/types'

type Phase = 'select' | 'planning' | 'result'

interface Plan {
  ordered: { store: Store; coords: LatLng }[]
  legDurations: number[]
  legDistances: number[]
  totalDuration: number
  totalDistance: number
  estimated: boolean
  home: LatLng
}

export function TripSheet() {
  const sheet = useUI((s) => s.sheet)
  const closeSheet = useUI((s) => s.closeSheet)
  const stores = useData((s) => s.stores)
  const items = useData((s) => s.shopping_items)
  const household = useData((s) => s.household_settings)[0]
  const settings = useSettings()

  const open = sheet.kind === 'trip'

  // Only physical stores that actually have something to buy. Online stores
  // never appear here at all.
  const candidates = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) {
      if (i.is_done || !i.store_id) continue
      counts.set(i.store_id, (counts.get(i.store_id) ?? 0) + 1)
    }
    return stores
      .filter((s) => !s.is_online && counts.has(s.id))
      .map((s) => ({ store: s, count: counts.get(s.id) ?? 0 }))
  }, [stores, items])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<Phase>('select')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [progress, setProgress] = useState('')
  const [legIndex, setLegIndex] = useState(0)

  /*
    Reset only when the sheet opens.

    This used to also key on `candidates.length`, which is derived from the
    shared stores and items. So while one of you had a solved route on screen
    and was driving it, the other ticking off the last item at a shop changed
    that count and threw the whole plan back to the store picker — discarding
    the geocoding and the OSRM matrix that produced it. The list of candidates
    is captured at open; changes to it during a trip are deliberately ignored.
  */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    setSelected(new Set(candidates.map((c) => c.store.id)))
    setPhase('select')
    setPlan(null)
    setLegIndex(0)
  }, [open])

  const homeCoords: LatLng | null =
    household?.home_lat != null && household?.home_lng != null
      ? { lat: household.home_lat, lng: household.home_lng }
      : null

  async function resolveHome(): Promise<LatLng | null> {
    if (homeCoords) return homeCoords
    if (!household?.home_address) return null
    setProgress('Finding home…')
    const manual = parseCoordinates(household.home_address)
    const found = manual ?? (await geocode(household.home_address))
    if (!found) return null
    await dataActions.patchRow('household_settings', 'singleton', {
      home_lat: found.lat,
      home_lng: found.lng,
    })
    return { lat: found.lat, lng: found.lng }
  }

  async function resolveStop(store: Store): Promise<LatLng | null> {
    const override = overrides[store.id]?.trim()

    if (override) {
      // Overrides are ephemeral, so they're geocoded fresh and never cached
      // onto the store row.
      const manual = parseCoordinates(override)
      if (manual) return manual
      setProgress(`Finding ${store.name}…`)
      const found = await geocode(override)
      return found ? { lat: found.lat, lng: found.lng } : null
    }

    if (store.lat != null && store.lng != null) {
      return { lat: store.lat, lng: store.lng }
    }
    if (!store.address) return null

    setProgress(`Finding ${store.name}…`)
    const manual = parseCoordinates(store.address)
    const found = manual
      ? { ...manual, displayName: store.address, provider: 'manual' as const }
      : await geocode(store.address)
    if (!found) return null

    // Cache onto the store so steady-state planning makes zero geocode calls.
    await dataActions.patchRow('stores', store.id, {
      lat: found.lat,
      lng: found.lng,
      geocoded_at: new Date().toISOString(),
      geocode_source: (found.provider === 'manual' ? 'manual' : found.provider) as Store['geocode_source'],
    })
    return { lat: found.lat, lng: found.lng }
  }

  async function planTrip() {
    setPhase('planning')
    try {
      const home = await resolveHome()
      if (!home) {
        setPhase('select')
        fire('warning')
        toast.error('Set your home address first', {
          description: 'Settings → Home address.',
        })
        return
      }

      const chosen = candidates
        .filter((c) => selected.has(c.store.id))
        .map((c) => c.store)

      const resolved: { store: Store; coords: LatLng }[] = []
      const failed: string[] = []
      for (const store of chosen) {
        const coords = await resolveStop(store)
        if (coords) resolved.push({ store, coords })
        else failed.push(store.name)
      }

      if (failed.length > 0) {
        toast.warning(`Couldn't locate ${failed.join(', ')}`, {
          description: 'Add an address in Stores, or paste "lat, lng".',
        })
      }
      if (resolved.length === 0) {
        setPhase('select')
        fire('error')
        return
      }

      setProgress('Working out the best order…')
      const points = [home, ...resolved.map((r) => r.coords)]
      const matrix = await buildMatrix(points)
      const solution = solveTrip(matrix.durations, matrix.distances)
      const legList = legs(solution.order, matrix.durations, matrix.distances)

      setPlan({
        ordered: solution.order.map((i) => resolved[i - 1]),
        legDurations: legList.map((l) => l.duration),
        legDistances: legList.map((l) => l.distance),
        totalDuration: solution.totalDuration,
        totalDistance: solution.totalDistance,
        estimated: matrix.source === 'haversine',
        home,
      })
      setPhase('result')
      setLegIndex(0)
      fire('success')
    } catch (err) {
      console.error(err)
      setPhase('select')
      fire('error')
      toast.error("Couldn't plan that trip")
    }
  }

  return (
    <Sheet open={open} onClose={closeSheet} title="Plan a shopping trip">
      {phase === 'select' && (
        <SelectPhase
          candidates={candidates}
          selected={selected}
          setSelected={setSelected}
          overrides={overrides}
          setOverrides={setOverrides}
          onPlan={planTrip}
          homeAddress={household?.home_address ?? null}
        />
      )}

      {phase === 'planning' && (
        <div className="grid place-items-center gap-3 py-16">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
            style={{ color: 'var(--accent)' }}
          >
            <Icon name="route" size={30} />
          </motion.div>
          <span className="text-[14px]" style={{ color: 'var(--text-dim)' }}>
            {progress || 'Planning…'}
          </span>
        </div>
      )}

      {phase === 'result' && plan && (
        <ResultPhase
          plan={plan}
          navApp={settings?.nav_app ?? 'google'}
          legIndex={legIndex}
          setLegIndex={setLegIndex}
          onReplan={() => setPhase('select')}
        />
      )}
    </Sheet>
  )
}

function SelectPhase({
  candidates,
  selected,
  setSelected,
  overrides,
  setOverrides,
  onPlan,
  homeAddress,
}: {
  candidates: { store: Store; count: number }[]
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  overrides: Record<string, string>
  setOverrides: (o: Record<string, string>) => void
  onPlan: () => void
  homeAddress: string | null
}) {
  const [editing, setEditing] = useState<string | null>(null)

  function toggle(id: string) {
    fire('tap')
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {!homeAddress && (
        <div
          className="rounded-2xl p-3 text-[13px]"
          style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-muted)' }}
        >
          Set your home address in Settings — the route starts and ends there.
        </div>
      )}

      {candidates.length === 0 ? (
        <p className="py-8 text-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
          No physical stores have items yet. Tag some shopping items with a store first.
        </p>
      ) : (
        candidates.map(({ store, count }) => {
          const on = selected.has(store.id)
          const override = overrides[store.id] ?? ''
          return (
            <div
              key={store.id}
              className="rounded-2xl p-3"
              style={{
                background: 'var(--surface-2)',
                border: `1px solid ${on ? 'var(--accent-muted)' : 'var(--border)'}`,
              }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggle(store.id)}
                  role="checkbox"
                  aria-checked={on}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
                  style={{
                    background: on ? 'var(--accent)' : 'transparent',
                    border: `2px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                    color: '#fff',
                  }}
                >
                  {on && <Icon name="check" size={13} strokeWidth={3.4} />}
                </button>
                <span className="h-3 w-3 rounded-full" style={{ background: store.color_hex }} />
                <span className="flex-1 text-[15px] font-medium">{store.name}</span>
                <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  {count} item{count === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-2 pl-9">
                <span className="flex-1 truncate text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  {override || store.address || 'No address set'}
                </span>
                <button
                  onClick={() => setEditing(editing === store.id ? null : store.id)}
                  className="shrink-0 text-[12px] font-medium"
                  style={{ color: 'var(--accent-text)' }}
                >
                  {editing === store.id ? 'Done' : 'Change'}
                </button>
              </div>

              {editing === store.id && (
                <div className="mt-2 pl-9">
                  <input
                    value={override}
                    onChange={(e) =>
                      setOverrides({ ...overrides, [store.id]: e.target.value })
                    }
                    placeholder="Different address for this trip"
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                  />
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    Only for this trip — the saved address stays as it is.
                  </p>
                </div>
              )}
            </div>
          )
        })
      )}

      <button
        onClick={onPlan}
        disabled={selected.size === 0}
        className="mt-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-40"
        style={{ background: 'var(--accent)' }}
      >
        <Icon name="route" size={18} strokeWidth={2.4} />
        Plan route ({selected.size})
      </button>
    </div>
  )
}

function ResultPhase({
  plan,
  navApp,
  legIndex,
  setLegIndex,
  onReplan,
}: {
  plan: Plan
  navApp: import('@/data/types').NavApp
  legIndex: number
  setLegIndex: (i: number) => void
  onReplan: () => void
}) {
  const options = navOptions(
    plan.home,
    plan.ordered.map((o) => o.coords),
    navApp,
  )
  const preferred = options[0]
  // Waze can't take a whole route, so its flow is stop-by-stop by necessity.
  const stopByStop = !preferred.multiStop

  const currentStop = plan.ordered[legIndex]

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex items-center justify-between rounded-2xl px-4 py-3"
        style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-muted)' }}
      >
        <div>
          <div className="text-[19px] font-bold">
            {formatDuration(plan.totalDuration * 1000)}
          </div>
          <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
            {(plan.totalDistance / 1000).toFixed(1)} km · {plan.ordered.length} stops
          </div>
        </div>
        {plan.estimated && (
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
            title="Routing server unavailable — distances are straight-line estimates"
          >
            estimated
          </span>
        )}
      </div>

      <div className="flex flex-col">
        <TripStopRow label="Home" sub="Start" tone="home" />
        {plan.ordered.map((stop, i) => (
          <TripStopRow
            key={stop.store.id}
            label={stop.store.name}
            sub={`${formatDuration(plan.legDurations[i] * 1000)} · ${(plan.legDistances[i] / 1000).toFixed(1)} km`}
            color={stop.store.color_hex}
            index={i + 1}
            active={stopByStop && i === legIndex}
          />
        ))}
        <TripStopRow
          label="Home"
          sub={`${formatDuration(plan.legDurations.at(-1)! * 1000)} · back home`}
          tone="home"
        />
      </div>

      {stopByStop ? (
        <div className="flex flex-col gap-2">
          <div
            className="rounded-2xl p-3 text-[12px]"
            style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}
          >
            {preferred.label} navigates one destination at a time, so the route is
            handed over stop by stop. Come back here after each one.
          </div>

          {currentStop ? (
            <>
              <button
                onClick={() => {
                  fire('success')
                  openExternal(singleStopUrl(preferred.app, currentStop.coords))
                }}
                className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                <Icon name="nav" size={17} strokeWidth={2.4} />
                {preferred.label} to {currentStop.store.name}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    fire('tap')
                    setLegIndex(Math.max(0, legIndex - 1))
                  }}
                  disabled={legIndex === 0}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-medium disabled:opacity-35"
                  style={{ background: 'var(--surface-2)' }}
                >
                  Previous
                </button>
                <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                  Stop {legIndex + 1} of {plan.ordered.length}
                </span>
                <button
                  onClick={() => {
                    fire('tap')
                    setLegIndex(Math.min(plan.ordered.length - 1, legIndex + 1))
                  }}
                  disabled={legIndex >= plan.ordered.length - 1}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-medium disabled:opacity-35"
                  style={{ background: 'var(--surface-2)' }}
                >
                  Next stop
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <button
          onClick={() => {
            fire('success')
            openExternal(preferred.url)
          }}
          className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          <Icon name="nav" size={17} strokeWidth={2.4} />
          Open in {preferred.label}
        </button>
      )}

      {/* Every other option stays available — a preference is never a trap. */}
      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          Or open in
        </span>
        {options.slice(1).map((o) => (
          <button
            key={o.app}
            onClick={() => {
              fire('tap')
              openExternal(
                o.multiStop ? o.url : singleStopUrl(o.app, plan.ordered[0].coords),
              )
            }}
            className="flex items-center justify-between rounded-xl px-3 py-2.5 text-left"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-[14px] font-medium">{o.label}</span>
            {o.note && (
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {o.note}
              </span>
            )}
          </button>
        ))}

        <button
          onClick={() => {
            const text = [
              'Home',
              ...plan.ordered.map((s, i) => `${i + 1}. ${s.store.name} — ${s.store.address ?? ''}`),
              'Home',
            ].join('\n')
            void copyToClipboard(text)
              .then(() => {
                fire('success')
                toast.success('Route copied')
              })
              .catch(() => toast.error('Copy failed'))
          }}
          className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[14px]"
          style={{ background: 'var(--surface-2)' }}
        >
          <Icon name="link" size={15} />
          Copy the stop list
        </button>
      </div>

      <button
        onClick={onReplan}
        className="py-2 text-[13px] font-medium"
        style={{ color: 'var(--text-dim)' }}
      >
        Change stops
      </button>
    </div>
  )
}

function TripStopRow({
  label,
  sub,
  color,
  index,
  tone,
  active,
}: {
  label: string
  sub: string
  color?: string
  index?: number
  tone?: 'home'
  active?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex w-6 flex-col items-center">
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold"
          style={{
            background: tone === 'home' ? 'var(--surface-3)' : (color ?? 'var(--accent)'),
            color: tone === 'home' ? 'var(--text-dim)' : '#fff',
            outline: active ? '2px solid var(--accent)' : 'none',
            outlineOffset: 2,
          }}
        >
          {tone === 'home' ? <Icon name="pin" size={12} /> : index}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{label}</div>
        <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {sub}
        </div>
      </div>
    </div>
  )
}
