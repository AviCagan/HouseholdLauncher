import { get as idbGet, set as idbSet } from 'idb-keyval'
import { create } from 'zustand'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from '@/lib/env'
import { supabase } from '@/lib/supabase'
import type { DriveFile } from './model'

/**
 * Inventory's side of the `inventory` Edge Function — the only way the app
 * reaches Google Drive. See supabase/functions/inventory for the other side,
 * and why there is never a Google sign-in on the phone.
 */

const endpoint = () => `${SUPABASE_URL}/functions/v1/inventory`

export type DriveResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<DriveResult<T>> {
  if (!isConfigured()) return { ok: false, error: 'Google Drive needs the household to be online — this copy is running on its own' }

  let token = SUPABASE_ANON_KEY
  const sb = supabase()
  if (sb) {
    const { data } = await sb.auth.getSession()
    if (data.session) token = data.session.access_token
  }

  let response: Response
  try {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    return { ok: false, error: "Can't reach Google Drive right now" }
  }

  let payload: Record<string, unknown>
  try {
    payload = await response.json()
  } catch {
    return {
      ok: false,
      error:
        response.status === 404
          ? "Inventory's Drive link isn't set up on the server yet"
          : `Unexpected response (${response.status})`,
    }
  }
  if (!response.ok) return { ok: false, error: String(payload.error ?? `Something went wrong (${response.status})`) }
  return { ok: true, data: payload as T }
}

/** Throws the server's own words, for callers that want to toast them. */
async function must<T>(p: Promise<DriveResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}

// --- connection --------------------------------------------------------------

export interface DriveStatus {
  connected: boolean
  account: string | null
  root_url: string | null
  connected_at: string | null
}

interface DriveState {
  status: DriveStatus | null
  /** Why the status couldn't be read, when it couldn't. */
  error: string | null
  checking: boolean
  refresh: () => Promise<void>
  set: (status: DriveStatus) => void
}

export const useDrive = create<DriveState>((set) => ({
  status: null,
  error: null,
  checking: false,
  async refresh() {
    set({ checking: true })
    const r = await call<DriveStatus>('status')
    set(r.ok ? { status: r.data, error: null, checking: false } : { error: r.error, checking: false })
  },
  set: (status) => set({ status, error: null }),
}))

export const driveConnected = (): boolean => useDrive.getState().status?.connected === true

export const getScript = () => call<{ script: string }>('setup')
export const connectDrive = (url: string) => call<DriveStatus>('connect', { url })
export const disconnectDrive = () => call<DriveStatus>('disconnect')

// --- operations ----------------------------------------------------------------

export interface DriveFolder {
  id: string
  name: string
  url: string
  created: string
}

const op = <T>(name: string, args: Record<string, unknown> = {}) => must(call<T>('drive', { op: name, ...args }))

export const listFolders = () => op<{ folders: DriveFolder[] }>('folders').then((r) => r.folders)
export const listFolder = (folderId: string) => op<{ folder: DriveFolder; files: DriveFile[] }>('list', { folderId })
export const ensureFolder = (name: string, folderId: string | null) => op<DriveFolder>('ensureFolder', { name, folderId })
export const uploadFile = (folderId: string, file: { name: string; mime: string; data: string }, description: string) =>
  op<DriveFile>('upload', { folderId, ...file, description })
export const scanToPdf = (folderId: string, name: string, pages: { mime: string; data: string }[], description: string) =>
  op<DriveFile>('scan', { folderId, name, pages, description })
export const trashFile = (fileId: string) => op<{ ok: true }>('trash', { fileId })
export const readDoc = (docId: string) => op<{ text: string }>('readDoc', { docId }).then((r) => r.text)
export const writeDoc = (folderId: string, docId: string | null, title: string, text: string) =>
  op<DriveFile>('writeDoc', { folderId, docId, title, text })

// --- previews ----------------------------------------------------------------

/*
  A picture of a Drive file, as a data: URI.

  Drive files are private, so an <img> can't point at them; the bridge sends
  the bytes instead. Each size of each file is fetched once and then kept in
  memory and in IndexedDB, so opening an item a second time — or offline —
  costs nothing. A file's id never changes and neither do its bytes (the app
  never edits a photo in place), so a cached preview never goes stale.
*/

const memory = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

const cacheKey = (fileId: string, size: number) => `inv:preview:${fileId}:${size}`

export function cachedPreview(fileId: string, size: number): string | null {
  return memory.get(cacheKey(fileId, size)) ?? null
}

export function preview(fileId: string, size: number): Promise<string | null> {
  const key = cacheKey(fileId, size)
  const hit = memory.get(key)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(key)
  if (pending) return pending

  const job = (async () => {
    try {
      const stored = await idbGet<string>(key).catch(() => undefined)
      if (stored) {
        memory.set(key, stored)
        return stored
      }
      const r = await call<{ mime: string; data: string }>('drive', { op: 'preview', fileId, size })
      if (!r.ok) return null
      const url = `data:${r.data.mime};base64,${r.data.data}`
      memory.set(key, url)
      void idbSet(key, url).catch(() => undefined)
      return url
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, job)
  return job
}

/** Seed the cache with a picture we already have — the photo just taken. */
export function primePreview(fileId: string, size: number, url: string): void {
  memory.set(cacheKey(fileId, size), url)
  void idbSet(cacheKey(fileId, size), url).catch(() => undefined)
}
