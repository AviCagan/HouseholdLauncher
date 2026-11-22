import { useEffect, useRef, useState } from 'react'
import './mikvah.css'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { Sheet } from '@/components/primitives/Sheet'
import { useData } from '@/store/useData'
import { useLauncher } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import { useDesktop } from '@/lib/useDesktop'
import { publish } from './actions'
import { hisView } from './engine'
import { queueRows } from './model'
import { useMkUI, type MkSheet, type MkTab } from './store'
import { S } from './strings'
import { Card } from './ui'
import { CalendarContext, useCalendarValue, type Calendar, type HerCalendar } from './useMikvah'
import { TodayTab } from './TodayTab'
import { CalendarTab } from './CalendarTab'
import { OnotTab } from './OnotTab'
import { HistoryTab } from './HistoryTab'
import { MoreTab } from './MoreTab'
import { HisView } from './HisView'
import { BedikotSheet, EventSheet, FlowSheet, HefsekSheet, MikvahSheet } from './sheets/log'
import { DaySheet, FlagSheet, HelpSheet, SourcesSheet, WhySheet } from './sheets/info'
import { ContactsSheet, EventsSheet, KavuaSheet, MemosSheet, PrintSheet, TripsSheet } from './sheets/lists'
import { ExportSheet, PartnerSheet, SettingsSheet, Setup } from './sheets/settings'

/**
 * The Mikvah Calendar. Her phone keeps the calendar; his shows what hers
 * publishes. See engine/ for the calculation, model.ts for the bridge to the
 * database, and supabase/027_mikvah.sql for who may read what.
 */

const TABS: { id: MkTab; label: string; icon: IconName }[] = [
  { id: 'today', label: S.tabs.today, icon: 'sparkle' },
  { id: 'calendar', label: S.tabs.calendar, icon: 'calendar' },
  { id: 'onot', label: S.tabs.onot, icon: 'clock' },
  { id: 'history', label: S.tabs.history, icon: 'history' },
  { id: 'more', label: S.tabs.more, icon: 'grid' },
]

export function MikvahApp() {
  const cal = useCalendarValue()
  const notSetUp = useData((s) => s.missingTables.some((t) => t.startsWith('mk_')))
  const ready = useData((s) => s.ready)
  const goHome = useLauncher((s) => s.goHome)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)
  const desktop = useDesktop()
  const tab = useMkUI((s) => s.tab)
  const setTab = useMkUI((s) => s.setTab)
  const scroller = useRef<HTMLDivElement>(null)

  // A reminder tapped in the notification centre lands on Today.
  useEffect(() => {
    const link = consumeDeepLink()
    if (link) setTab('today')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeDeepLink])

  // Leaving closes the sheets.
  useEffect(() => () => useMkUI.getState().closeAll(), [])

  const her = cal.role === 'her' && cal.history.length > 0 ? cal : null
  const title =
    cal.role === 'her' ? cal.stored.tile.name || 'Calendar' : cal.role === 'him' ? cal.his.tile?.name || 'Calendar' : 'Calendar'

  function body() {
    if (notSetUp) {
      return (
        <Card tone="ask">
          <p className="text-[16px] font-semibold">{S.notSetUp.title}</p>
          <p className="mk-dim mt-1 text-[13.5px]">{S.notSetUp.body}</p>
        </Card>
      )
    }
    if (!ready) return null
    if (cal.role === 'him') return <HisView />
    if (!her) return <NewOrSetup cal={cal} />
    if (tab === 'calendar') return <CalendarTab />
    if (tab === 'onot') return <OnotTab />
    if (tab === 'history') return <HistoryTab />
    if (tab === 'more') return <MoreTab />
    return <TodayTab />
  }

  return (
    <CalendarContext.Provider value={cal}>
      <div className="mk mk-root relative flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[max(var(--safe-top),0.75rem)] lg:mx-auto lg:w-full lg:max-w-[760px]">
          {!desktop && (
            <button
              type="button"
              onClick={() => {
                fire('tap')
                goHome()
              }}
              aria-label={S.back}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
              style={{ color: 'var(--text-dim)' }}
            >
              <Icon name="back" size={21} strokeWidth={2.4} />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-[19px] font-bold tracking-tight">{title}</h1>
          {her && <span className="mk-faint text-[12px]">{tabTitle(tab)}</span>}
        </header>

        <div ref={scroller} className="scroll-y min-h-0 flex-1 px-4 pt-1">
          <div key={her ? tab : cal.role} className="mx-auto max-w-[760px]">
            {body()}
          </div>
        </div>

        {her && (
          <nav className="mk-noprint flex shrink-0 justify-around border-t px-1 pb-[max(var(--safe-bottom),0.4rem)] pt-1" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
            {TABS.map((t) => {
              const on = t.id === tab
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (on) return
                    fire('snap')
                    setTab(t.id)
                    scroller.current?.scrollTo({ top: 0 })
                  }}
                  aria-current={on ? 'page' : undefined}
                  className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold"
                  style={{ color: on ? 'var(--accent)' : 'var(--text-faint)' }}
                >
                  <Icon name={t.icon} size={20} />
                  {t.label}
                </button>
              )
            })}
          </nav>
        )}

        {her && <Publisher cal={her} />}
        {(her || cal.role === 'him') && <Sheets />}
      </div>
    </CalendarContext.Provider>
  )
}

const tabTitle = (t: MkTab) => (t === 'onot' ? S.onot.title : '')

function NewOrSetup({ cal }: { cal: Calendar }) {
  // A calendar row with no settings yet (setup stopped half way) goes
  // straight back to setup. Otherwise ask first: the partner opens this app
  // too, and must not start a calendar of his own by mistake. Only a member
  // granted the app can start one (027) — the database has the last word.
  const [starting, setStarting] = useState(cal.role === 'her')
  if (cal.role === 'him') return null
  if (starting) return <Setup />
  return (
    <div className="flex flex-col gap-3 pt-4">
      <Card onClick={() => setStarting(true)}>
        <p className="text-[16px] font-semibold">{S.setup.title}</p>
        <p className="mk-dim mt-1 text-[13.5px]">For the one who keeps the calendar: her dates, checks and reminders.</p>
      </Card>
      <Card>
        <p className="text-[16px] font-semibold">{S.him.waiting}</p>
        <p className="mk-dim mt-1 text-[13.5px]">{S.him.waitingBody}</p>
      </Card>
    </div>
  )
}

/**
 * After every recompute, a couple of seconds later: his view and the
 * reminder queue brought in line with the calendar. Quiet; nothing to tap.
 */
function Publisher({ cal }: { cal: HerCalendar }) {
  const { result, zmanim, stored, his, me, shared, now } = cal
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!result || !zmanim) return
    const run = () => {
      pending.current = null
      const t = Date.now()
      const snap = hisView(result, zmanim, stored, t)
      const rows = queueRows({ result, zmanim, stored, his, her: me, partner: shared.partner_id, now: t })
      void publish(snap, rows, t)
    }
    pending.current = run
    const timer = setTimeout(run, 600)
    return () => clearTimeout(timer)
  }, [result, zmanim, stored, his, me, shared.partner_id, now])

  // Logged something and closed the app straight away: send it now, not never.
  useEffect(() => {
    const flush = () => pending.current?.()
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
  return null
}

const SHEET_TITLE: Partial<Record<MkSheet['kind'], string>> = {
  why: S.why,
  flag: S.askRav,
  day: 'The day',
  flow: S.flow.title,
  hefsek: S.hefsek.title,
  bedikot: S.bedikot.title,
  mikvah: S.mikvah.title,
  event: 'Log',
  events: S.more.events,
  trips: S.more.trips,
  memos: S.more.memos,
  contacts: S.more.contacts,
  kavua: S.more.kavua,
  settings: S.more.settings,
  sources: S.more.sources,
  help: S.more.help,
  share: S.more.share,
  print: S.more.print,
  export: S.more.export,
  partner: S.more.partner,
}

function Sheets() {
  const stack = useMkUI((s) => s.stack)
  const close = useMkUI((s) => s.close)
  const top = stack[stack.length - 1]
  return (
    <Sheet open={!!top} onClose={close} title={top ? SHEET_TITLE[top.kind] : undefined} maxHeight="92vh">
      {top && <div className="mk px-1 pb-6">{sheetBody(top, close)}</div>}
    </Sheet>
  )
}

function sheetBody(s: MkSheet, close: () => void) {
  switch (s.kind) {
    case 'why':
      return <WhySheet ruleId={s.ruleId} note={s.note} />
    case 'flag':
      return <FlagSheet flagKey={s.key} onDone={close} />
    case 'flow':
      return <FlowSheet onDone={close} />
    case 'hefsek':
      return <HefsekSheet onDone={close} />
    case 'bedikot':
      return <BedikotSheet cycleId={s.cycleId} />
    case 'mikvah':
      return <MikvahSheet cycleId={s.cycleId} onDone={close} />
    case 'day':
      return <DaySheet abs={s.abs} />
    case 'event':
      return <EventSheet preset={s.preset} onDone={close} />
    case 'events':
      return <EventsSheet />
    case 'trips':
      return <TripsSheet />
    case 'memos':
      return <MemosSheet />
    case 'contacts':
      return <ContactsSheet />
    case 'kavua':
      return <KavuaSheet />
    case 'settings':
      return <SettingsSheet onDone={close} />
    case 'sources':
      return <SourcesSheet ruleId={s.ruleId} />
    case 'help':
      return <HelpSheet />
    case 'share':
      return <PrintSheet mode="rav" />
    case 'print':
      return <PrintSheet mode="calendar" />
    case 'export':
      return <ExportSheet />
    case 'partner':
      return <PartnerSheet />
  }
}
