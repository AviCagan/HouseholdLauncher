import { useEffect, useRef, useState } from 'react'
import '@fontsource/oxanium/latin-600.css'
import '@fontsource/oxanium/latin-700.css'
import '@fontsource/exo-2/latin-400.css'
import '@fontsource/exo-2/latin-500.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './medschool.css'
import { Icon } from '@/components/primitives/Icon'
import { useLauncher } from '@/store/useLauncher'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import { useDesktop } from '@/lib/useDesktop'
import { syncDueDates } from './actions'
import { useMsUI, type MsTab } from './store'
import { HudTab } from './HudTab'
import { TimelineTab } from './TimelineTab'
import { FileTab } from './FileTab'
import { ExperiencesTab } from './ExperiencesTab'
import { ExperienceEditSheet, ExperienceSheet, ExpLogSheet } from './expSheets'
import { McatTab } from './McatTab'
import { RecordTab } from './RecordTab'
import { SettingsSheet } from './SettingsSheet'
import { CourseSheet, DateSheet, LetterSheet, LogSheet, PracticeSheet, TaskSheet, TotalSheet } from './sheets'
import { Panel, TabGlyph } from './ui'

/**
 * Med School 2028 — one person's plan, from the MCAT to the first day of
 * medical school, drawn as a world of light. See medschool.css for the look
 * and supabase/025_medschool.sql for the tables.
 */

const TABS: { id: MsTab; label: string; short?: string }[] = [
  { id: 'hud', label: 'HUD' },
  { id: 'timeline', label: 'Timeline' },
  // Too long for a sixth of a phone's width; the glyph carries it there.
  { id: 'exp', label: 'Experiences', short: 'Exp' },
  { id: 'file', label: 'File' },
  { id: 'mcat', label: 'MCAT' },
  { id: 'record', label: 'Record' },
]

const REZ_KEY = 'ms:rezzed'

/** The rez-in plays on the first open of a session, and not under reduced motion. */
function firstOpen(): boolean {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    if (document.documentElement.dataset.reduceMotion === 'true') return false
    if (sessionStorage.getItem(REZ_KEY)) return false
    sessionStorage.setItem(REZ_KEY, '1')
    return true
  } catch {
    return false
  }
}

export function MedSchoolApp() {
  const tab = useMsUI((s) => s.tab)
  const setTab = useMsUI((s) => s.setTab)
  const stack = useMsUI((s) => s.stack)
  const open = useMsUI((s) => s.open)
  const goHome = useLauncher((s) => s.goHome)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)
  const desktop = useDesktop()
  const ready = useData((s) => s.ready)
  const notSetUp = useData((s) => s.missingTables.some((t) => t.startsWith('ms_')))
  const hasPlan = useData((s) => s.ms_tasks.length > 0 || Boolean(s.ms_settings[0]?.test_date))
  const [rez] = useState(firstOpen)
  const scroller = useRef<HTMLDivElement>(null)

  // A reminder tapped in the notification centre: straight to that task.
  useEffect(() => {
    const link = consumeDeepLink()
    if (!link) return
    const id = typeof link.id === 'string' ? link.id : null
    if (typeof link.tab === 'string' && TABS.some((t) => t.id === link.tab)) setTab(link.tab as MsTab)
    if (id) open({ kind: 'task', taskId: id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeDeepLink])

  // Leaving closes the sheets, so coming back lands on the screen.
  useEffect(() => () => useMsUI.getState().closeAll(), [])

  // Keep the server's copy of each task's date current (it's what the
  // reminders read), once the plan has loaded.
  const synced = useRef(false)
  useEffect(() => {
    if (!ready || !hasPlan || synced.current || notSetUp) return
    synced.current = true
    void syncDueDates()
  }, [ready, hasPlan, notSetUp])

  function go(next: MsTab) {
    if (next === tab) return
    fire('snap')
    setTab(next)
    scroller.current?.scrollTo({ top: 0 })
  }

  const top = stack[stack.length - 1]

  return (
    <div className="lgrid relative flex h-full flex-col" data-rez={rez}>
      {rez && <div className="lg-scan" aria-hidden />}
      <header className="relative z-20 flex shrink-0 items-center gap-1 px-2 pb-1 pt-[max(var(--safe-top),0.5rem)] lg:mx-auto lg:w-full lg:max-w-[1100px] lg:px-6 lg:pt-5">
        {!desktop && (
          <button
            type="button"
            onClick={() => {
              fire('tap')
              goHome()
            }}
            aria-label="Back to the launcher"
            className="lg-icon-btn"
          >
            <Icon name="back" size={20} strokeWidth={2.2} />
          </button>
        )}
        <h1 className="lg-display min-w-0 flex-1 truncate px-1 text-[17px] tracking-[0.14em] lg:text-[22px]">
          MED SCHOOL <span className="text-[var(--lg-cyan)]">2028</span>
        </h1>
        <button
          type="button"
          onClick={() => {
            fire('tap')
            open({ kind: 'settings' })
          }}
          aria-label="Med School settings"
          className="lg-icon-btn"
        >
          <Icon name="settings" size={20} strokeWidth={1.8} />
        </button>
      </header>

      <div ref={scroller} className="scroll-y relative z-10 min-h-0 flex-1 px-4 pt-1 lg:px-6">
        <div key={tab} className="lg:mx-auto lg:max-w-[1100px]">
          {notSetUp ? (
            <Panel title="Not set up yet" edge="warn">
              <p className="text-[14px] leading-relaxed">
                Med School needs its tables on the server first. Run <span className="lg-num">supabase/025_medschool.sql</span> in the Supabase SQL editor,
                then come back.
              </p>
            </Panel>
          ) : !hasPlan && ready ? (
            <Panel title="No plan yet" edge="live">
              <p className="text-[14px] leading-relaxed">Bring your plan in from settings: paste it as JSON and it fills every tab.</p>
              <button type="button" className="lg-btn lg-btn--primary mt-4" onClick={() => open({ kind: 'settings' })}>
                Import a plan
              </button>
            </Panel>
          ) : (
            <>
              {tab === 'hud' && <HudTab />}
              {tab === 'timeline' && <TimelineTab />}
              {tab === 'exp' && <ExperiencesTab />}
              {tab === 'file' && <FileTab />}
              {tab === 'mcat' && <McatTab />}
              {tab === 'record' && <RecordTab />}
            </>
          )}
        </div>
      </div>

      <nav className="lg-dock safe-bottom relative z-20 shrink-0" aria-label="Sections">
        <div className="flex lg:mx-auto lg:max-w-[720px]">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="lg-tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <TabGlyph tab={t.id} />
              {t.short ? (
                <>
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </>
              ) : (
                t.label
              )}
            </button>
          ))}
        </div>
      </nav>

      {top?.kind === 'settings' && <SettingsSheet key={stack.length} />}
      {top?.kind === 'task' && <TaskSheet key={`${stack.length}:${top.taskId}`} taskId={top.taskId} />}
      {top?.kind === 'date' && <DateSheet key={stack.length} />}
      {top?.kind === 'log' && <LogSheet key={`${stack.length}:${top.counterId}`} counterId={top.counterId} />}
      {top?.kind === 'total' && <TotalSheet key={`${stack.length}:${top.counterId}`} counterId={top.counterId} />}
      {top?.kind === 'course' && <CourseSheet key={`${stack.length}:${top.courseId}`} courseId={top.courseId} term={top.term} />}
      {top?.kind === 'practice' && <PracticeSheet key={`${stack.length}:${top.practiceId}`} practiceId={top.practiceId} />}
      {top?.kind === 'letter' && <LetterSheet key={`${stack.length}:${top.letterId}`} letterId={top.letterId} />}
      {top?.kind === 'experience' && <ExperienceSheet key={`${stack.length}:${top.experienceId}`} experienceId={top.experienceId} />}
      {top?.kind === 'experience-edit' && (
        <ExperienceEditSheet key={`${stack.length}:${top.experienceId}`} experienceId={top.experienceId} preset={top.preset} />
      )}
      {top?.kind === 'explog' && <ExpLogSheet key={`${stack.length}:${top.experienceId}:${top.logId}`} experienceId={top.experienceId} logId={top.logId} />}
    </div>
  )
}
