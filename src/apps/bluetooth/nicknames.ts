import { Preferences } from '@capacitor/preferences'
import { isNative } from '@/lib/platform'

/**
 * Custom names for paired Bluetooth devices.
 *
 * Stored on the device, not in the household database, and that is the right
 * call rather than a shortcut: the list these name comes from is the pairings
 * of one specific phone. Avi's car stereo is not on Jackie's phone, so a synced
 * nickname would be a row about a device the other person cannot see, and two
 * phones paired to the same speaker may reasonably want to call it different
 * things.
 *
 * Keyed on MAC address, which is what Android reports and what survives the
 * device renaming itself — a firmware update that changes "SYNC 3" to "My Ford"
 * must not silently discard the name you chose.
 */

const KEY = 'bluetooth:nicknames'

type NicknameMap = Record<string, string>

/**
 * Cached after the first read.
 *
 * The device list re-renders on every refresh and every toggle, and each row
 * needs its nickname — going to Preferences (which is async and, on native, a
 * bridge call) per row per render would make a ten-device list do dozens of
 * round trips to display text it already had.
 */
let cache: NicknameMap | null = null

async function readAll(): Promise<NicknameMap> {
  if (cache) return cache

  let raw: string | null = null
  try {
    raw = isNative()
      ? (await Preferences.get({ key: KEY })).value
      : localStorage.getItem(KEY)
  } catch {
    // Private browsing, or storage disabled. Nicknames are a convenience;
    // losing them should never stop the device list from rendering.
    cache = {}
    return cache
  }

  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    // Guard the shape rather than trusting it: this survives across app
    // versions, and a malformed value would otherwise throw on every render.
    cache =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as NicknameMap)
        : {}
  } catch {
    cache = {}
  }
  return cache
}

async function writeAll(map: NicknameMap): Promise<void> {
  cache = map
  const value = JSON.stringify(map)
  try {
    if (isNative()) await Preferences.set({ key: KEY, value })
    else localStorage.setItem(KEY, value)
  } catch {
    // Kept in memory for this session even if it can't be persisted.
  }
}

export const loadNicknames = (): Promise<NicknameMap> => readAll()

/**
 * Set or clear one nickname.
 *
 * A blank name clears the entry rather than storing an empty string, so
 * "rename it back" and "never renamed it" end up in the same state instead of
 * leaving a row that makes the device fall back to a name of nothing.
 */
export async function setNickname(address: string, nickname: string): Promise<NicknameMap> {
  const map = { ...(await readAll()) }
  const trimmed = nickname.trim()
  if (trimmed) map[address] = trimmed
  else delete map[address]
  await writeAll(map)
  return map
}

/** What to show for a device: its nickname if it has one, else Android's name. */
export const displayName = (
  map: NicknameMap,
  address: string,
  reported: string,
): string => map[address] ?? reported

/** Whether this device is showing a name someone chose. */
export const isRenamed = (map: NicknameMap, address: string): boolean =>
  typeof map[address] === 'string'

/** Test seam — resets the module cache between cases. */
export const __resetNicknameCache = (): void => {
  cache = null
}
