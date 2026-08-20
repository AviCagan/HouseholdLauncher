/**
 * Live check of the address type-ahead against Photon.
 * Not part of `npm test` — it hits the network. Run by hand:
 *   npx vite-node scripts/verify-address.ts
 */
import { searchPlaces } from '../src/routing/geocode'

const queries = ['350 5th Ave New York', '19 walcott ave staten island', 'costco brooklyn']

for (const q of queries) {
  const results = await searchPlaces(q)
  console.log(`\n"${q}" → ${results.length} suggestion(s)`)
  for (const s of results.slice(0, 3)) {
    console.log(`   ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}   ${s.label}`)
  }
  if (results.length === 0) console.log('   (none)')
}
