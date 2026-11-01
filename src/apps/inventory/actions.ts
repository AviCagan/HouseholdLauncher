import { toast } from 'sonner'
import { create } from 'zustand'
import { useData } from '@/store/useData'
import { newId, nowIso } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { InventoryFile, InventoryFileKind, InventoryItem } from '@/data/types'
import {
  driveConnected,
  ensureFolder,
  listFolder,
  preview,
  primePreview,
  readDoc,
  scanToPdf,
  trashFile,
  uploadFile,
  writeDoc,
  type DriveFolder,
} from './drive'
import { classifyFolder, describeKind, detailsDocText, factsFromNotes, isImage, notesFromDoc, reconcile } from './model'
import { PAGE_MAX, blobFromBase64, prepareFile, thumbFromBlob } from './photos'

/**
 * Writes for Inventory.
 *
 * The row is optimistic like every other app's: it is on screen before the
 * network is touched, and put back if the database says no. Drive work —
 * making the folder, sending photos, rewriting the notes doc — happens after,
 * in the background, with a line under the item saying what it's doing. A
 * failed upload never takes the item away; the details are safe in the
 * database and the photo can be tried again.
 */

const TABLE = 'inventory_items'

const rows = () => useData.getState().inventory_items
const latest = (id: string) => rows().find((r) => r.id === id) ?? null

function replaceRow(id: string, next: InventoryItem | null): void {
  const current = rows()
  useData.setState({
    inventory_items: next
      ? current.some((r) => r.id === id)
        ? current.map((r) => (r.id === id ? next : r))
        : [...current, next]
      : current.filter((r) => r.id !== id),
  })
}

/**
 * Inserts still on their way to the database, by item id.
 *
 * A new item is on screen at once and can be given a photo straight away,
 * which means a folder id to save on a row the database may not have yet.
 * An update to a row that doesn't exist is not an error — it quietly touches
 * nothing — and then the insert lands without the folder. So every save waits
 * for its row's insert first.
 */
const inserting = new Map<string, Promise<boolean>>()

/** Apply a patch now, then save it; on failure put the row back. */
async function patchRow(id: string, patch: Partial<InventoryItem>): Promise<boolean> {
  const before = latest(id)
  if (!before) return false
  replaceRow(id, { ...before, ...patch, updated_at: nowIso() })
  try {
    if (!(await (inserting.get(id) ?? true))) return false
    await useData.getState().adapter.update(TABLE, id, patch)
    return true
  } catch (err) {
    // Only undo what this patch changed, so a write that landed meanwhile
    // (another photo finishing) isn't rolled back with it.
    const now = latest(id)
    if (now) {
      const undone = { ...now }
      for (const key of Object.keys(patch) as (keyof InventoryItem)[]) {
        ;(undone as Record<string, unknown>)[key] = before[key]
      }
      replaceRow(id, undone)
    }
    fire('error')
    toast.error("Couldn't save that")
    console.error(`[${TABLE}]`, err)
    return false
  }
}

// --- what's happening ----------------------------------------------------------

interface Busy {
  /** Item id → what Drive is doing for it right now. */
  busy: Record<string, string>
  setBusy: (id: string, what: string | null) => void
}

export const useInventoryBusy = create<Busy>((set) => ({
  busy: {},
  setBusy: (id, what) =>
    set((s) => {
      const next = { ...s.busy }
      if (what) next[id] = what
      else delete next[id]
      return { busy: next }
    }),
}))

const busy = (id: string, what: string | null) => useInventoryBusy.getState().setBusy(id, what)

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// --- items ---------------------------------------------------------------------

export type ItemInput = Pick<
  InventoryItem,
  'name' | 'brand' | 'model' | 'category' | 'store' | 'price_cents' | 'paid_by' | 'purchased_on' | 'warranty_until' | 'location' | 'notes'
>

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

function cleanInput(input: Partial<ItemInput>): Partial<ItemInput> {
  const out: Partial<ItemInput> = {}
  for (const [k, v] of Object.entries(input) as [keyof ItemInput, unknown][]) {
    ;(out as Record<string, unknown>)[k] = typeof v === 'string' ? (k === 'notes' ? (v.trim() ? v : null) : clean(v)) : v
  }
  return out
}

/** The new row, on screen already; null when there was no name. */
export function addItem(input: ItemInput, profileId: string | null): InventoryItem | null {
  const name = input.name.trim()
  if (!name) return null
  const row: InventoryItem = {
    ...(cleanInput(input) as ItemInput),
    id: newId(),
    name,
    drive_folder_id: null,
    drive_folder_url: null,
    notes_doc_id: null,
    cover_file_id: null,
    cover_thumb: null,
    files: [],
    created_by: profileId,
    updated_by: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  replaceRow(row.id, row)
  fire('success')
  const insert = (async () => {
    try {
      await useData.getState().adapter.insert(TABLE, row)
      return true
    } catch (err) {
      replaceRow(row.id, null)
      fire('error')
      toast.error("Couldn't add that — it's been taken back off the shelf")
      console.error(`[${TABLE}]`, err)
      return false
    } finally {
      inserting.delete(row.id)
    }
  })()
  inserting.set(row.id, insert)
  void insert.then(async (ok) => {
    if (!ok || !driveConnected()) return
    await ensureItemFolder(row.id)
    scheduleDoc(row.id, 0)
  })
  return row
}

export function updateItem(id: string, input: Partial<ItemInput>, profileId: string | null): void {
  const before = latest(id)
  if (!before) return
  const patch: Partial<InventoryItem> = { ...cleanInput(input), updated_by: profileId }
  if ('name' in input && !input.name?.trim()) return
  void patchRow(id, patch).then((ok) => {
    if (!ok || !driveConnected()) return
    // The folder is named for the item, so a rename follows it there.
    if (patch.name && patch.name !== before.name && before.drive_folder_id) void ensureItemFolder(id)
    scheduleDoc(id)
  })
}

/** Takes the item out of the app. Its folder stays in Drive, untouched. */
export function removeItem(item: InventoryItem): void {
  fire('delete')
  replaceRow(item.id, null)
  void (async () => {
    try {
      await useData.getState().adapter.remove(TABLE, item.id)
      if (item.drive_folder_url) toast('Removed from Inventory', { description: 'Its folder is still in Google Drive.' })
    } catch (err) {
      replaceRow(item.id, item)
      fire('error')
      toast.error("Couldn't remove that")
      console.error(`[${TABLE}]`, err)
    }
  })()
}

// --- Drive ---------------------------------------------------------------------

/** Folder work in flight, by item, so two callers at once make one folder. */
const folderJobs = new Map<string, Promise<string | null>>()

/** The item's folder id, making the folder the first time. */
export function ensureItemFolder(id: string): Promise<string | null> {
  const running = folderJobs.get(id)
  if (running) return running
  const job = makeFolder(id).finally(() => folderJobs.delete(id))
  folderJobs.set(id, job)
  return job
}

async function makeFolder(id: string): Promise<string | null> {
  const item = latest(id)
  if (!item) return null
  try {
    const folder = await ensureFolder(item.name, item.drive_folder_id)
    if (folder.id !== item.drive_folder_id || folder.url !== item.drive_folder_url) {
      await patchRow(id, { drive_folder_id: folder.id, drive_folder_url: folder.url })
    }
    return folder.id
  } catch (err) {
    toast.error("Couldn't make the item's folder in Drive", { description: errorText(err) })
    return null
  }
}

const docTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Rewrite the item's notes doc in Drive, a moment after the last change.
 * Typing notes saves on every pause; the doc only needs the final version.
 */
export function scheduleDoc(id: string, delay = 2500): void {
  clearTimeout(docTimers.get(id))
  docTimers.set(
    id,
    setTimeout(() => {
      docTimers.delete(id)
      void writeDetailsDoc(id)
    }, delay),
  )
}

async function writeDetailsDoc(id: string): Promise<void> {
  if (!driveConnected()) return
  const folderId = latest(id)?.drive_folder_id ?? (await ensureItemFolder(id))
  const item = latest(id)
  if (!folderId || !item) return
  try {
    const doc = await writeDoc(folderId, item.notes_doc_id, `${item.name} — details`, detailsDocText(item))
    if (doc.id !== item.notes_doc_id) await patchRow(id, { notes_doc_id: doc.id })
  } catch (err) {
    // Quiet on purpose: the details are saved in the app either way, and the
    // next change tries again. A toast on every keystroke-pause would be noise.
    console.warn('[inventory] notes doc not written', err)
  }
}

const asFile = (f: { id: string; name: string; mime: string; url: string; size: number | null }, kind: InventoryFileKind): InventoryFile => ({
  id: f.id,
  kind,
  name: f.name,
  mime: f.mime,
  url: f.url,
  size: f.size,
  added_at: nowIso(),
})

/** Add a file to the row's list, reading the latest list so two uploads at once both land. */
async function attach(id: string, file: InventoryFile, extra: Partial<InventoryItem> = {}) {
  const item = latest(id)
  if (!item) return
  await patchRow(id, { files: [...item.files.filter((f) => f.id !== file.id), file], ...extra })
}

/** Photos of the item, of its parts, or paperwork picked from the phone or computer. */
export async function addFiles(id: string, picked: File[], kind: InventoryFileKind): Promise<void> {
  if (picked.length === 0) return
  if (!driveConnected()) {
    toast('Connect Google Drive first', { description: 'Photos and paperwork are kept in Drive.' })
    return
  }
  const folderId = latest(id)?.drive_folder_id ?? (await ensureItemFolder(id))
  if (!folderId) return

  let done = 0
  for (const file of picked) {
    busy(id, `Sending ${picked.length > 1 ? `${done + 1} of ${picked.length}` : file.name || 'the file'} to Drive…`)
    try {
      const label = kind === 'part' ? 'Extra part' : kind === 'doc' ? 'Paperwork' : latest(id)?.name || 'Photo'
      const prepared = await prepareFile(file, label)
      const uploaded = await uploadFile(folderId, prepared, describeKind(kind))
      // The picture is already in hand: show it without asking Drive for it back.
      let thumb: string | null = null
      if (isImage(prepared.mime)) {
        thumb = await thumbFromBlob(blobFromBase64(prepared.data, prepared.mime)).catch(() => null)
        if (thumb) primePreview(uploaded.id, 240, thumb)
      }
      const item = latest(id)
      const makeCover = kind === 'photo' && isImage(uploaded.mime) && !item?.cover_file_id
      await attach(id, asFile(uploaded, kind), makeCover && thumb ? { cover_file_id: uploaded.id, cover_thumb: thumb } : {})
      done++
    } catch (err) {
      fire('error')
      toast.error(`Couldn't add ${file.name || 'that file'}`, { description: errorText(err) })
    }
  }
  busy(id, null)
  if (done > 0) fire('success')
}

/** Pages of a paper warranty or manual, photographed, made into one PDF in Drive. */
export async function scanPages(id: string, pages: File[], title: string): Promise<void> {
  if (pages.length === 0) return
  if (!driveConnected()) {
    toast('Connect Google Drive first', { description: 'Scans are kept in Drive.' })
    return
  }
  const folderId = latest(id)?.drive_folder_id ?? (await ensureItemFolder(id))
  if (!folderId) return
  busy(id, `Making a ${pages.length}-page PDF…`)
  try {
    const prepared = await Promise.all(pages.map((p, i) => prepareFile(p, `Page ${i + 1}`, PAGE_MAX)))
    const images = prepared.filter((p) => isImage(p.mime))
    if (images.length === 0) throw new Error('Scans need to be photos')
    const pdf = await scanToPdf(folderId, title.trim() || 'Scan', images.map(({ mime, data }) => ({ mime, data })), describeKind('doc'))
    await attach(id, asFile(pdf, 'doc'))
    fire('success')
    toast.success(`${pdf.name} is in Drive`)
  } catch (err) {
    fire('error')
    toast.error("Couldn't make the scan", { description: errorText(err) })
  } finally {
    busy(id, null)
  }
}

export async function setCover(id: string, fileId: string): Promise<void> {
  const item = latest(id)
  const file = item?.files.find((f) => f.id === fileId)
  if (!item || !file) return
  busy(id, 'Setting the overall photo…')
  try {
    const url = await preview(fileId, 360)
    const thumb = url ? await thumbFromBlob(await (await fetch(url)).blob()).catch(() => url) : null
    await patchRow(id, {
      cover_file_id: fileId,
      cover_thumb: thumb,
      // The overall photo is a photo of the item, whatever it was filed as.
      files: item.files.map((f) => (f.id === fileId ? { ...f, kind: 'photo' } : f)),
    })
    fire('success')
  } finally {
    busy(id, null)
  }
}

export function setKind(id: string, fileId: string, kind: InventoryFileKind): void {
  const item = latest(id)
  if (!item) return
  fire('tap')
  void patchRow(id, { files: item.files.map((f) => (f.id === fileId ? { ...f, kind } : f)) })
}

/** Moves the file to Drive's trash (recoverable there for 30 days). */
export async function removeFile(id: string, fileId: string): Promise<void> {
  const item = latest(id)
  if (!item) return
  busy(id, 'Moving it to Drive’s trash…')
  try {
    await trashFile(fileId)
    const now = latest(id)
    if (now) {
      const wasCover = now.cover_file_id === fileId
      await patchRow(id, {
        files: now.files.filter((f) => f.id !== fileId),
        ...(wasCover ? { cover_file_id: null, cover_thumb: null } : {}),
      })
    }
    fire('delete')
  } catch (err) {
    fire('error')
    toast.error("Couldn't remove that file", { description: errorText(err) })
  } finally {
    busy(id, null)
  }
}

/**
 * Bring the item in line with its folder: files added or deleted in Drive
 * directly show up here, and a new overall photo gets its thumbnail.
 */
export async function syncItem(id: string, quiet = false): Promise<void> {
  const item = latest(id)
  if (!item?.drive_folder_id) return
  busy(id, 'Checking Drive…')
  try {
    const { files, folder } = await listFolder(item.drive_folder_id)
    const now = latest(id)
    if (!now) return
    const next = reconcile(now, files)
    const patch: Partial<InventoryItem> = {
      files: next.files,
      cover_file_id: next.cover_file_id,
      notes_doc_id: next.notes_doc_id,
      drive_folder_url: folder.url,
    }
    if (next.cover_file_id !== now.cover_file_id || (next.cover_file_id && !now.cover_thumb)) {
      const url = next.cover_file_id ? await preview(next.cover_file_id, 360) : null
      patch.cover_thumb = url
    }
    await patchRow(id, patch)
    if (!quiet) {
      const changes = [next.added && `${next.added} new`, next.removed && `${next.removed} gone`].filter(Boolean)
      toast(changes.length ? `From Drive: ${changes.join(', ')}` : 'Up to date with Drive')
    }
  } catch (err) {
    if (!quiet) toast.error("Couldn't check Drive", { description: errorText(err) })
  } finally {
    busy(id, null)
  }
}

/**
 * Turn a folder made by hand in Drive into an item — the way the Vevor
 * cooler started. Its files are sorted into photo, parts and paperwork, its
 * doc becomes the notes, and whatever the note says about price, store and
 * who paid fills those fields in.
 */
export async function importFolder(folder: DriveFolder, profileId: string | null): Promise<InventoryItem | null> {
  const { files } = await listFolder(folder.id)
  const sorted = classifyFolder(folder.name, files)
  let notes = ''
  if (sorted.notesDocId) notes = notesFromDoc(await readDoc(sorted.notesDocId).catch(() => ''))
  const facts = factsFromNotes(notes)
  const cover = sorted.coverId ? await preview(sorted.coverId, 360) : null

  const row: InventoryItem = {
    id: newId(),
    name: folder.name,
    brand: null,
    model: null,
    category: null,
    store: facts.store,
    price_cents: facts.price_cents,
    paid_by: facts.paid_by,
    purchased_on: null,
    warranty_until: null,
    location: null,
    notes: notes || null,
    drive_folder_id: folder.id,
    drive_folder_url: folder.url,
    notes_doc_id: sorted.notesDocId,
    cover_file_id: sorted.coverId,
    cover_thumb: cover,
    files: sorted.files,
    created_by: profileId,
    updated_by: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  replaceRow(row.id, row)
  try {
    await useData.getState().adapter.insert(TABLE, row)
    return row
  } catch (err) {
    replaceRow(row.id, null)
    throw err
  }
}
