/**
 * Live end-to-end check of the trip-planning pipeline against the real free
 * services: Photon geocoding → OSRM distance matrix → solver → deep links.
 *
 * Not part of `npm test` — it hits the network and those endpoints are
 * courtesy-limited. Run it by hand when the routing stack needs verifying:
 *
 *   npx vite-node scripts/verify-route.ts
 */
import { geocode, type LatLng } from '../src/routing/geocode'
import { buildMatrix } from '../src/routing/osrm'
import { solveTrip, legs } from '../src/routing/solve'
import { googleMultiStop, singleStopUrl } from '../src/routing/deeplink'

const HOME = 'Prospect Park, Brooklyn, New York'
const STORES = [
  'Whole Foods Market, 3rd Avenue, Gowanus, Brooklyn',
  'Target, Atlantic Terminal, Brooklyn, New York',
  'Home Depot, Hamilton Avenue, Brooklyn, New York',
  'Trader Joes, Court Street, Brooklyn, New York',
]

const km = (m: number) => (m / 1000).toFixed(2)
const mins = (s: number) => Math.round(s / 60)

async function main() {
  console.log('Geocoding (serialised at ~1.1s intervals)…\n')

  const home = await geocode(HOME)
  if (!home) throw new Error(`could not geocode home: ${HOME}`)
  console.log(`  home  ${home.lat.toFixed(4)}, ${home.lng.toFixed(4)}  [${home.provider}]  ${home.displayName}`)

  const stops: { name: string; coords: LatLng }[] = []
  for (const query of STORES) {
    const found = await geocode(query)
    if (!found) {
      console.log(`  MISS  ${query}`)
      continue
    }
    stops.push({ name: query.split(',')[0], coords: found })
    console.log(`  stop  ${found.lat.toFixed(4)}, ${found.lng.toFixed(4)}  [${found.provider}]  ${found.displayName}`)
  }

  if (stops.length === 0) throw new Error('no stops resolved')

  console.log('\nBuilding distance matrix…')
  const points: LatLng[] = [home, ...stops.map((s) => s.coords)]
  const matrix = await buildMatrix(points)
  console.log(`  source: ${matrix.source}${matrix.source === 'haversine' ? '  (OSRM unavailable — fallback in use)' : ''}`)

  const solution = solveTrip(matrix.durations, matrix.distances)
  const legList = legs(solution.order, matrix.durations, matrix.distances)

  console.log('\nOptimal order:')
  console.log(`  Home`)
  solution.order.forEach((idx, i) => {
    const leg = legList[i]
    console.log(`    ↓ ${mins(leg.duration)} min, ${km(leg.distance)} km`)
    console.log(`  ${i + 1}. ${stops[idx - 1].name}`)
  })
  const last = legList.at(-1)!
  console.log(`    ↓ ${mins(last.duration)} min, ${km(last.distance)} km`)
  console.log(`  Home`)

  console.log(`\nTotal: ${mins(solution.totalDuration)} min, ${km(solution.totalDistance)} km`)

  // Sanity: the solved tour must be no worse than the naive input order.
  let naive = 0
  let prev = 0
  for (let i = 1; i < points.length; i++) {
    naive += matrix.durations[prev][i]
    prev = i
  }
  naive += matrix.durations[prev][0]
  console.log(`Naive order would be ${mins(naive)} min — saved ${mins(naive - solution.totalDuration)} min`)
  if (solution.totalDuration > naive + 1e-6) {
    throw new Error('solver returned a worse tour than the input order')
  }

  const ordered = solution.order.map((i) => stops[i - 1].coords)
  console.log('\nGoogle Maps (whole trip in one link):')
  console.log('  ' + googleMultiStop(home, ordered))
  console.log('\nWaze (first stop only — no multi-stop URL scheme exists):')
  console.log('  ' + singleStopUrl('waze', ordered[0]))

  console.log('\nOK')
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
