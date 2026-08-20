import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { isNative } from './platform'

/**
 * A shared "current time" that advances every 30s.
 *
 * This exists because of a structural fact about the chores tab: when a
 * cooldown expires, *nothing in the database changes*. No row is written, so
 * Postgres emits no realtime event and no push can arrive. A resting chore can
 * only return to the active list if the client works it out itself.
 *
 * setInterval alone is not enough — mobile OSes throttle timers in background
 * tabs and freeze them entirely in a suspended app, so a phone that slept for
 * an hour would show stale cooldowns. Hence the explicit recompute on
 * visibilitychange and on Capacitor's resume event.
 */

const TICK_MS = 30_000

type Listener = (now: number) => void

const listeners = new Set<Listener>()
let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null

function emit() {
  now = Date.now()
  for (const l of listeners) l(now)
}

function start() {
  if (timer !== null) return
  timer = setInterval(emit, TICK_MS)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) emit()
    })
  }
  if (isNative()) {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) emit()
    })
  }
}

export function subscribeTick(fn: Listener): () => void {
  start()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const nowMs = (): number => now

/** Re-renders roughly every 30s, and immediately whenever the app wakes up. */
export function useNow(): number {
  const [value, setValue] = useState(() => Date.now())
  useEffect(() => subscribeTick(setValue), [])
  return value
}
