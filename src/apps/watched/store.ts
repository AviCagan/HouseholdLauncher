import { create } from 'zustand'
import { useMemo } from 'react'
import { useData } from '@/store/useData'
import { useMembers, type Member } from '@/store/useMember'
import { useProfile } from '@/store/useProfile'
import type { Destination, FinishOutcome } from './actions'

/**
 * Which channel is on and which sheet is up. A store rather than props
 * because almost every card in the app can open almost every sheet.
 *
 * Sheets stack — the show sheet opens the picture picker on top of itself —
 * and only the top one is drawn, so closing it brings back the one under.
 */

export type WatchTab = 'onair' | 'shelf' | 'watched'

export type WatchSheet =
  | { kind: 'search'; preset: Destination | null }
  | { kind: 'show'; showId: string }
  | {
      kind: 'rate'
      showId: string
      seasons: number[]
      includeShow: boolean
      outcome?: FinishOutcome
      /** Added after the fact: ask which seasons they watched as well. */
      backfill?: boolean
    }
  | { kind: 'pace' }
  | { kind: 'slot'; showId: string }
  | { kind: 'posters'; showId: string }
  | { kind: 'manual'; preset: Destination | null }
  /** Finish the season (or show) with the real dates, for the pace. */
  | { kind: 'finish'; showId: string }
  /** Log episodes watched earlier, with when. */
  | { kind: 'log'; showId: string; from: number }

interface WatchUI {
  tab: WatchTab
  /** Whose shelf is showing: a profile id, or null for the shared one. */
  shelf: string | null | undefined
  stack: WatchSheet[]
  setTab: (tab: WatchTab) => void
  setShelf: (owner: string | null) => void
  open: (sheet: WatchSheet) => void
  replace: (sheet: WatchSheet) => void
  close: () => void
  closeAll: () => void
}

export const useWatchUI = create<WatchUI>((set) => ({
  tab: 'onair',
  shelf: undefined,
  stack: [],
  setTab: (tab) => set({ tab }),
  setShelf: (shelf) => set({ shelf }),
  open: (sheet) => set((s) => ({ stack: [...s.stack, sheet] })),
  replace: (sheet) => set((s) => ({ stack: [...s.stack.slice(0, -1), sheet] })),
  close: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  closeAll: () => set({ stack: [] }),
}))

// --- people ------------------------------------------------------------------------

export interface Person {
  id: string
  name: string
  emoji: string
  avatar: string | null
  color: string
  /** The AV-cable colour of their shelf's jack. */
  jack: string
}

/**
 * The jack colours. Two people get the two audio channels, red and white —
 * left and right, the stereo pair — and the shared shelf gets yellow, the
 * picture, which is the part you watch together.
 */
const JACKS = ['#ec4a3c', '#f3efe4', '#7ad3a1', '#74c0fc', '#c77dff']
export const OURS_JACK = '#f8c534'

function canWatch(member: Member, access: { profile_id: string; app_id: string; granted: boolean }[]): boolean {
  if (member.role === undefined || member.role === 'owner') return true
  return access.some((a) => a.profile_id === member.id && a.app_id === 'watched' && a.granted)
}

/** Everyone who can use Watched, in a stable order so jack colours never shuffle. */
export function usePeople(): Person[] {
  const members = useMembers()
  const access = useData((s) => s.app_access)
  return useMemo(
    () =>
      members
        .filter((m) => canWatch(m, access))
        .map((m, i) => ({
          id: m.id,
          name: m.display_name,
          emoji: m.avatar_emoji,
          avatar: m.avatar_url,
          color: m.color_hex,
          jack: JACKS[i % JACKS.length],
        })),
    [members, access],
  )
}

export function useMe(): string | null {
  return useProfile((s) => s.profileId)
}

/** "Jackie's shelf", "Your shelf", "Our shelf". */
export function shelfName(owner: string | null, people: Person[], me: string | null): string {
  if (owner === null) return 'Our shelf'
  if (owner === me) return 'Your shelf'
  const p = people.find((x) => x.id === owner)
  return p ? `${p.name}'s shelf` : 'A shelf'
}
