/**
 * A UUID that is the same every time for the same inputs.
 *
 * Season records and ratings are one-per-(show, season[, person]), and two
 * phones can create the same one at the same moment — both tapping "finished
 * the season", or each person rating on their own phone. With random ids
 * that race makes two rows and the database's unique constraint rejects the
 * second; with the id derived from what the row *is*, both phones write the
 * same row and the second write is simply an update.
 *
 * cyrb128 — four interleaved 32-bit mixes — is plenty for a household's
 * worth of keys, and synchronous, which crypto.subtle's digests are not.
 */
function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

export function stableId(...parts: (string | number)[]): string {
  const hex = cyrb128(parts.join('|'))
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('')
  // Shape it as a v4 UUID (version nibble 4, variant 10xx) so anything that
  // checks the format — Postgres doesn't, but a future tool might — is happy.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export const seasonRowId = (showId: string, season: number): string => stableId('season', showId, season)

export const ratingRowId = (showId: string, season: number, profileId: string): string =>
  stableId('rating', showId, season, profileId)
