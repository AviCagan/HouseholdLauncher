import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { useData } from '@/store/useData'
import type { MsCounter, MsCourse, MsExperience, MsExperienceKind, MsPractice, MsSettings, MsTask } from '@/data/types'
import { anchorsFor, dueStatus, resolveDue, todayDay, type Anchors, type Day, type DueStatus } from './dates'
import { sortExperiences } from './experiences'

/**
 * Which tab is showing and which sheet is up. Sheets stack — the settings
 * sheet can open a task on top of itself — and only the top one is drawn.
 */

export type MsTab = 'hud' | 'timeline' | 'exp' | 'file' | 'mcat' | 'record'

export type MsSheet =
  | { kind: 'task'; taskId: string | null }
  | { kind: 'settings' }
  | { kind: 'date' }
  | { kind: 'log'; counterId: string }
  | { kind: 'total'; counterId: string }
  | { kind: 'course'; courseId: string | null; term?: string }
  | { kind: 'practice'; practiceId: string | null }
  | { kind: 'letter'; letterId: string }
  /** An experience: its log, checklist and details. */
  | { kind: 'experience'; experienceId: string }
  /** Add one (experienceId null, starting as `preset`) or edit its details. */
  | { kind: 'experience-edit'; experienceId: string | null; preset?: MsExperienceKind }
  /**
   * Log to an experience, or edit an entry. With no experience the sheet
   * picks the one logged to last — the HUD's quick log.
   */
  | { kind: 'explog'; experienceId: string | null; logId?: string | null }

interface MsUI {
  tab: MsTab
  stack: MsSheet[]
  setTab: (tab: MsTab) => void
  open: (sheet: MsSheet) => void
  close: () => void
  closeAll: () => void
}

export const useMsUI = create<MsUI>((set) => ({
  tab: 'hud',
  stack: [],
  setTab: (tab) => set({ tab }),
  open: (sheet) => set((s) => ({ stack: [...s.stack, sheet] })),
  close: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  closeAll: () => set({ stack: [] }),
}))

/**
 * Today's date, kept current: it rolls over at midnight and is checked again
 * whenever the app comes back to the front, so a phone left open overnight
 * doesn't keep yesterday's chips.
 */
export function useToday(): Day {
  const [today, setToday] = useState(() => todayDay())
  useEffect(() => {
    const check = () => setToday((d) => (d === todayDay() ? d : todayDay()))
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    const timer = setTimeout(check, midnight.getTime() - now.getTime())
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [today])
  return today
}

export interface TaskView {
  task: MsTask
  due: Day | null
  status: DueStatus
}

export interface MsModel {
  settings: MsSettings | null
  anchors: Anchors | null
  today: Day
  views: TaskView[]
  /** Tasks the settings say to show: not hidden, and estimates only if wanted. */
  visible: TaskView[]
}

/** Everything the tabs read, worked out once per change. */
export function useMs(): MsModel {
  const settings = useData((s) => s.ms_settings[0] ?? null)
  const tasks = useData((s) => s.ms_tasks)
  const today = useToday()
  const anchors = useMemo(() => anchorsFor(settings?.test_date ?? null, settings?.reference), [settings])
  const views = useMemo(
    () =>
      tasks
        .map((task) => {
          // Worked out here rather than read from due_on, which is only the
          // server's copy and can lag a moment behind a date change.
          const due = resolveDue(task, anchors)
          return { task, due, status: dueStatus(due, today, Boolean(task.done_at)) }
        })
        .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || Number(b.task.hard) - Number(a.task.hard) || a.task.title.localeCompare(b.task.title)),
    [tasks, today, anchors],
  )
  const showEstimated = settings?.show_estimated !== false
  const visible = useMemo(() => views.filter((v) => !v.task.hidden && (showEstimated || !v.task.estimated)), [views, showEstimated])
  return { settings, anchors, today, views, visible }
}

export function useCounters(): MsCounter[] {
  const counters = useData((s) => s.ms_counters)
  return useMemo(() => [...counters].sort((a, b) => a.sort - b.sort), [counters])
}

export const useCourses = (): MsCourse[] => useData((s) => s.ms_courses)

export function usePractice(): MsPractice[] {
  const practice = useData((s) => s.ms_practice)
  return useMemo(() => [...practice].sort((a, b) => a.taken_on.localeCompare(b.taken_on)), [practice])
}

/** Every experience, going ones first. */
export function useExperiences(): MsExperience[] {
  const list = useData((s) => s.ms_experiences)
  return useMemo(() => sortExperiences(list), [list])
}

/**
 * Whether the experiences tables are there and in use. Until they are, the
 * File tab and the HUD keep showing the old counters.
 */
export function useExperiencesLive(): boolean {
  const missing = useData((s) => s.missingTables.includes('ms_experiences'))
  const any = useData((s) => s.ms_experiences.length > 0)
  return !missing && any
}
