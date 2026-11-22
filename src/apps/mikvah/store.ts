import { create } from 'zustand'

/**
 * Which tab is showing and which sheet is up. Sheets stack — a "Why?" opened
 * from the mikvah-night sheet sits on top of it — and only the top one is
 * drawn, so closing it brings back the one under.
 */

export type MkTab = 'today' | 'calendar' | 'onot' | 'history' | 'more'

export type MkSheet =
  | { kind: 'why'; ruleId: string; note?: string }
  | { kind: 'flag'; key: string }
  | { kind: 'flow' }
  | { kind: 'hefsek' }
  | { kind: 'bedikot'; cycleId: string }
  | { kind: 'mikvah'; cycleId: string }
  | { kind: 'day'; abs: number }
  | { kind: 'event'; preset?: string }
  | { kind: 'events' }
  | { kind: 'trips' }
  | { kind: 'memos' }
  | { kind: 'contacts' }
  | { kind: 'kavua' }
  | { kind: 'settings' }
  | { kind: 'sources'; ruleId?: string }
  | { kind: 'help' }
  | { kind: 'share' }
  | { kind: 'print' }
  | { kind: 'export' }
  | { kind: 'partner' }

interface MkUI {
  tab: MkTab
  stack: MkSheet[]
  setTab: (tab: MkTab) => void
  open: (sheet: MkSheet) => void
  close: () => void
  closeAll: () => void
}

export const useMkUI = create<MkUI>((set) => ({
  tab: 'today',
  stack: [],
  setTab: (tab) => set({ tab }),
  open: (sheet) => set((s) => ({ stack: [...s.stack, sheet] })),
  close: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  closeAll: () => set({ stack: [] }),
}))

export const openSheet = (sheet: MkSheet) => useMkUI.getState().open(sheet)
export const why = (ruleId: string, note?: string) => openSheet({ kind: 'why', ruleId, note })
