import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import type { MkContact, MkEventRow, MkMemo, MkPartner, MkSettingsRow, MkShared, MkTrip } from '@/data/types'
import { calculate, hebcalZmanim, type Result, type SourceNote, type Zmanim } from './engine'
import { hisPrefs, readStored, settingsHistory, toEvent, toNotes, toPartner, toStays, type HisPrefs, type Stored } from './model'
import type { HisSnapshot } from './engine'

/**
 * The calendar as one value, computed once per minute and shared by every
 * screen through context.
 *
 * Who is looking decides what there is: her calendar row (mk_shared.id) makes
 * her the owner; a row naming her as partner makes him the viewer; neither
 * means setup. The database has already filtered the rows — he never
 * receives her events — so "him" can only ever show the published snapshot.
 */

export type Role = 'her' | 'him' | 'new'

export interface HerCalendar {
  role: 'her'
  me: string
  shared: MkShared
  stored: Stored
  /** Settings versions, oldest first. Empty until setup saves the first. */
  history: MkSettingsRow[]
  events: MkEventRow[]
  trips: MkTrip[]
  memos: MkMemo[]
  contacts: MkContact[]
  notes: SourceNote[]
  partnerRow: MkPartner | undefined
  his: HisPrefs
  zmanim: Zmanim | null
  result: Result | null
  now: number
}

export interface HisCalendar {
  role: 'him'
  me: string
  shared: MkShared
  snapshot: HisSnapshot | null
  partnerRow: MkPartner | undefined
  his: HisPrefs
  now: number
}

export interface NewCalendar {
  role: 'new'
  me: string | null
  now: number
}

export type Calendar = HerCalendar | HisCalendar | NewCalendar

/** Ticks on the minute, so statuses and countdowns roll over on time. */
export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      timer = setTimeout(tick, stepMs - (Date.now() % stepMs) + 50)
    }
    timer = setTimeout(tick, stepMs - (Date.now() % stepMs) + 50)
    return () => clearTimeout(timer)
  }, [stepMs])
  return now
}

const live = <T extends { voided_at: string | null; owner_id: string }>(list: T[], owner: string) =>
  list.filter((r) => r.owner_id === owner && r.voided_at === null)

export function useCalendarValue(): Calendar {
  const me = useProfile((s) => s.profileId)
  const now = useNow()
  const shared = useData((s) => s.mk_shared)
  const settingsRows = useData((s) => s.mk_settings)
  const eventRows = useData((s) => s.mk_events)
  const tripRows = useData((s) => s.mk_trips)
  const memoRows = useData((s) => s.mk_memos)
  const contactRows = useData((s) => s.mk_contacts)
  const noteRows = useData((s) => s.mk_source_notes)
  const partnerRows = useData((s) => s.mk_partner)

  const mine = me ? shared.find((r) => r.id === me) : undefined
  const named = me && !mine ? shared.find((r) => r.partner_id === me) : undefined

  // Everything that doesn't change with the clock.
  const base = useMemo(() => {
    if (!me || !mine) return null
    const history = settingsHistory(settingsRows, me)
    const stored = readStored(history[history.length - 1]?.settings)
    const events = eventRows.filter((e) => e.owner_id === me).sort((a, b) => a.at.localeCompare(b.at))
    const trips = live(tripRows, me)
    const stays = toStays(tripRows, me)
    const partnerRow = partnerRows.find((p) => p.owner_id === me && p.id === mine.partner_id)
    const zmanim = stored.home ? hebcalZmanim(stored.home, stays) : null
    return {
      history,
      stored,
      events,
      engineEvents: events.map(toEvent),
      stays,
      trips,
      memos: live(memoRows, me).sort((a, b) => a.day.localeCompare(b.day)),
      contacts: live(contactRows, me).sort((a, b) => a.sort - b.sort),
      notes: toNotes(noteRows, me),
      partnerRow,
      zmanim,
    }
  }, [me, mine, settingsRows, eventRows, tripRows, memoRows, contactRows, noteRows, partnerRows])

  const result = useMemo(() => {
    if (!base?.zmanim || base.history.length === 0) return null
    return calculate({
      events: base.engineEvents,
      settings: base.stored,
      zmanim: base.zmanim,
      now,
      partner: toPartner(base.partnerRow),
      trips: base.stays,
    })
  }, [base, now])

  if (me && mine && base) {
    return {
      role: 'her',
      me,
      shared: mine,
      stored: base.stored,
      history: base.history,
      events: base.events,
      trips: base.trips,
      memos: base.memos,
      contacts: base.contacts,
      notes: base.notes,
      partnerRow: base.partnerRow,
      his: hisPrefs(base.partnerRow),
      zmanim: base.zmanim,
      result,
      now,
    }
  }
  if (me && named) {
    const partnerRow = partnerRows.find((p) => p.id === me && p.owner_id === named.id)
    const snap = named.snapshot as HisSnapshot | null
    return {
      role: 'him',
      me,
      shared: named,
      snapshot: snap && typeof snap === 'object' && snap.v === 1 ? snap : null,
      partnerRow,
      his: hisPrefs(partnerRow),
      now,
    }
  }
  return { role: 'new', me, now }
}

export const CalendarContext = createContext<Calendar | null>(null)

export function useCalendar(): Calendar {
  const c = useContext(CalendarContext)
  if (!c) throw new Error('useCalendar outside the calendar')
  return c
}

/** Her calendar, for screens only she sees. */
export function useHer(): HerCalendar {
  const c = useCalendar()
  if (c.role !== 'her') throw new Error('her screens need her calendar')
  return c
}
