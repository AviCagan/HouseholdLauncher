import type { InventoryFile, InventoryFileKind, InventoryItem } from '@/data/types'
import { formatPrice } from '@/lib/money'

/**
 * Inventory's pure logic: how long things are covered, what each file in a
 * Drive folder is for, what the notes doc says, and how the list sorts.
 *
 * Kept free of the store and of Drive so all of it can be tested against the
 * household's real first folder — the Vevor cooler — without either.
 */

// --- warranty ----------------------------------------------------------------

export type WarrantyState = 'none' | 'active' | 'soon' | 'expired'

export interface Warranty {
  state: WarrantyState
  /** Days until it ends; negative once it has. Null with no date. */
  daysLeft: number | null
  label: string
}

/** Inside this many days a warranty is "ending soon" and the list says so. */
export const SOON_DAYS = 60

const DAY_MS = 86_400_000

/** "2026-11-01" → local midnight, so a date never lands a day early in the west. */
export function localDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function warranty(item: Pick<InventoryItem, 'warranty_until'>, today = new Date()): Warranty {
  if (!item.warranty_until) return { state: 'none', daysLeft: null, label: 'No warranty date' }
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((localDay(item.warranty_until).getTime() - start.getTime()) / DAY_MS)
  if (days < 0) return { state: 'expired', daysLeft: days, label: `Warranty ended ${shortDate(item.warranty_until)}` }
  if (days === 0) return { state: 'soon', daysLeft: 0, label: 'Warranty ends today' }
  if (days <= SOON_DAYS) return { state: 'soon', daysLeft: days, label: `Warranty ends in ${days} day${days === 1 ? '' : 's'}` }
  return { state: 'active', daysLeft: days, label: `Covered until ${shortDate(item.warranty_until)}` }
}

/** The warranty end, a whole number of years after purchase (or today). */
export function yearsFrom(purchasedOn: string | null, years: number, today = new Date()): string {
  const base = purchasedOn ? localDay(purchasedOn) : today
  return isoDay(new Date(base.getFullYear() + years, base.getMonth(), base.getDate()))
}

export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function shortDate(iso: string): string {
  return localDay(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// --- the stock label ---------------------------------------------------------

/**
 * A short code for the box label, like a warehouse bin tag: "INV·7C2F".
 * Read from the id, so it never changes and needs no counter to keep.
 */
export const stockCode = (id: string): string => `INV·${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`

// --- files -------------------------------------------------------------------

/** What the app writes on every file it uploads, so the folder says what each is. */
export const DESCRIPTION_PREFIX = 'household-inventory:'

export const describeKind = (kind: InventoryFileKind): string => `${DESCRIPTION_PREFIX}${kind}`

export const KIND_LABEL: Record<InventoryFileKind, string> = {
  photo: 'Overall',
  part: 'Extra parts',
  doc: 'Paperwork',
}

export const GOOGLE_DOC = 'application/vnd.google-apps.document'

export const isImage = (mime: string): boolean => mime.startsWith('image/')

/** A file as Drive lists it — see fileInfo() in the bridge script. */
export interface DriveFile {
  id: string
  name: string
  mime: string
  size: number | null
  url: string
  created: string
  description: string
}

const words = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,4}$/, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  )

/** How many words two names share — "Evaporative cooler" vs "Vevor evaporative cooler" is 2. */
export function overlap(a: string, b: string): number {
  const wa = words(a)
  let n = 0
  for (const w of words(b)) if (wa.has(w)) n++
  return n
}

const PAPERWORK = /manual|warrant|receipt|invoice|guide|instruction|scan|registration|spec/i
const PARTS = /part|spare|extra|accessor|filter|pack|refill|replacement|battery|cable|charger|attachment/i

/**
 * What one file is for, when nobody has said.
 *
 * The app's own uploads carry their kind in the Drive description. For a
 * folder made by hand — like the cooler's — it's read from the file: PDFs
 * and documents are paperwork, so is a photo called "warranty"; a photo
 * named for a spare is a part; a photo named for the item is the item.
 */
export function guessKind(file: Pick<DriveFile, 'name' | 'mime' | 'description'>, folderName: string): InventoryFileKind {
  if (file.description.startsWith(DESCRIPTION_PREFIX)) {
    const kind = file.description.slice(DESCRIPTION_PREFIX.length)
    if (kind === 'photo' || kind === 'part' || kind === 'doc') return kind
  }
  if (!isImage(file.mime)) return 'doc'
  if (PAPERWORK.test(file.name)) return 'doc'
  if (overlap(file.name, folderName) > 0) return 'photo'
  if (PARTS.test(file.name)) return 'part'
  // A photo with no name to go on is most often of something that came with
  // it — the item itself is usually the one named after it.
  return 'part'
}

export interface Classified {
  files: InventoryFile[]
  coverId: string | null
  /** The Google Doc whose text is the item's notes. */
  notesDocId: string | null
}

/**
 * Sort a whole folder: which file is which, which photo is the overall one,
 * and which doc holds the notes.
 *
 * The overall photo is the photo that shares the most words with the item's
 * name, so "Evaporative cooler" wins in "Vevor evaporative cooler" over
 * "Extra part" and "Ice packs". With no photo of the item at all, the first
 * part photo stands in rather than leaving the box blank.
 */
export function classifyFolder(folderName: string, driveFiles: DriveFile[], existingDocId: string | null = null): Classified {
  const sorted = [...driveFiles].sort((a, b) => a.created.localeCompare(b.created))
  const docs = sorted.filter((f) => f.mime === GOOGLE_DOC)
  const notesDoc = docs.find((d) => d.id === existingDocId) ?? docs[0] ?? null

  const files: InventoryFile[] = sorted
    .filter((f) => f.id !== notesDoc?.id)
    .map((f) => ({
      id: f.id,
      kind: guessKind(f, folderName),
      name: f.name,
      mime: f.mime,
      url: f.url,
      size: f.size,
      added_at: f.created,
    }))

  const photos = files.filter((f) => f.kind === 'photo' && isImage(f.mime))
  const best = [...photos].sort((a, b) => overlap(b.name, folderName) - overlap(a.name, folderName))[0]
  const fallback = files.find((f) => isImage(f.mime))
  return { files, coverId: (best ?? fallback)?.id ?? null, notesDocId: notesDoc?.id ?? null }
}

/**
 * Bring a row's file list in line with what is actually in the folder.
 *
 * The folder is the truth about which files exist — something added or
 * deleted in Drive directly should show up here — but the row is the truth
 * about what each is for, so a file the app already knows keeps its kind.
 */
export function reconcile(item: Pick<InventoryItem, 'files' | 'cover_file_id' | 'notes_doc_id' | 'name'>, driveFiles: DriveFile[]) {
  const known = new Map(item.files.map((f) => [f.id, f]))
  const fresh = classifyFolder(item.name, driveFiles, item.notes_doc_id)
  const files = fresh.files.map((f) => {
    const had = known.get(f.id)
    return had ? { ...f, kind: had.kind, added_at: had.added_at } : f
  })
  const coverStillThere = files.some((f) => f.id === item.cover_file_id)
  return {
    files,
    cover_file_id: coverStillThere ? item.cover_file_id : fresh.coverId,
    notes_doc_id: fresh.notesDocId,
    added: files.filter((f) => !known.has(f.id)).length,
    removed: item.files.filter((f) => !files.some((x) => x.id === f.id)).length,
  }
}

// --- the notes doc -----------------------------------------------------------

/** The last line of every doc the app writes. */
export const DOC_FOOTER =
  '— Kept by the Household app. Edit the notes in Inventory; changes made here are replaced the next time it saves.'

const NOTES_HEADING = 'Notes'

/**
 * The item, written out for its folder.
 *
 * So the folder explains itself to anyone who opens it in Drive — with or
 * without the app, and long after the app is gone.
 */
export function detailsDocText(item: InventoryItem): string {
  const lines: string[] = [item.name]
  const make = [item.brand, item.model].filter(Boolean).join(' · ')
  if (make) lines.push(make)
  if (item.category) lines.push(`Category: ${item.category}`)

  const bought: string[] = []
  if (item.purchased_on) bought.push(`on ${shortDate(item.purchased_on)}`)
  if (item.store) bought.push(`at ${item.store}`)
  if (item.price_cents != null) bought.push(`for ${formatPrice(item.price_cents)}`)
  if (item.paid_by) bought.push(`paid for by ${item.paid_by}`)
  if (bought.length) lines.push(`Bought ${bought.join(', ')}`)

  if (item.warranty_until) lines.push(`Warranty until ${shortDate(item.warranty_until)}`)
  if (item.location) lines.push(`Kept in ${item.location}`)

  lines.push('', NOTES_HEADING, item.notes?.trim() || '(none yet)', '', DOC_FOOTER)
  return lines.join('\n')
}

/**
 * The notes, read back out of a doc.
 *
 * A doc the app wrote has its details above a "Notes" heading and a footer
 * below; only what's between is notes. A doc written by hand — the cooler's —
 * is notes from top to bottom.
 */
export function notesFromDoc(text: string): string {
  // Docs typed on a phone collect lines of stray spaces and runs of blank
  // lines; keep the paragraphs, lose the padding.
  const clean = text
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!clean.includes(DOC_FOOTER)) return clean
  const body = clean.slice(0, clean.lastIndexOf(DOC_FOOTER)).trimEnd()
  const at = body.search(new RegExp(`(^|\\n)${NOTES_HEADING}\\n`))
  const notes = at < 0 ? body : body.slice(body.indexOf('\n', at + 1) + 1)
  return notes.trim() === '(none yet)' ? '' : notes.trim()
}

export interface NoteFacts {
  price_cents: number | null
  store: string | null
  paid_by: string | null
}

/**
 * The details a hand-written note tends to carry, pulled out so a folder
 * brought in from Drive arrives with its fields filled.
 *
 * Deliberately narrow — "100 dollars", "$49.99", "from Home Depot", "paid for
 * by bubby" — and every guess is left in the notes too, so nothing a person
 * wrote is lost to a parser that read it wrong.
 */
export function factsFromNotes(text: string): NoteFacts {
  const price =
    /\$\s?(\d{1,6}(?:[.,]\d{1,2})?)/.exec(text) ?? /\b(\d{1,6}(?:\.\d{1,2})?)\s*(?:dollars|bucks|usd)\b/i.exec(text)
  // Spaces and tabs only between words, never a newline: "paid for by bubby"
  // must stop at the end of its line, not run on into the next paragraph.
  const store = /\b(?:from|at)[ \t]+([A-Z][\w&'.-]*(?:[ \t]+[A-Z][\w&'.-]*){0,3})/.exec(text)
  const payer = /\bpaid[ \t]+(?:for[ \t]+)?by[ \t]+([A-Za-z][\w'-]*(?:[ \t]+[A-Z][\w'-]*)?)/i.exec(text)
  return {
    price_cents: price ? Math.round(Number(price[1].replace(',', '.')) * 100) : null,
    store: store ? store[1].trim() : null,
    paid_by: payer ? payer[1].trim() : null,
  }
}

// --- the list ----------------------------------------------------------------

export type InventorySort = 'recent' | 'name' | 'warranty'

export function searchItems(items: InventoryItem[], query: string): InventoryItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) =>
    [i.name, i.brand, i.model, i.category, i.store, i.location, i.paid_by, i.notes, stockCode(i.id)]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(q)),
  )
}

export function sortItems(items: InventoryItem[], by: InventorySort, today = new Date()): InventoryItem[] {
  const out = [...items]
  if (by === 'name') return out.sort((a, b) => a.name.localeCompare(b.name))
  if (by === 'warranty') {
    // Soonest to run out first; no date, then already ended, at the bottom.
    const rank = (i: InventoryItem) => {
      const w = warranty(i, today)
      if (w.state === 'none') return Number.MAX_SAFE_INTEGER
      if (w.state === 'expired') return Number.MAX_SAFE_INTEGER - 1_000_000 - (w.daysLeft ?? 0)
      return w.daysLeft ?? 0
    }
    return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }
  return out.sort((a, b) => (b.purchased_on ?? b.created_at).localeCompare(a.purchased_on ?? a.created_at))
}

/** Categories in use, most used first, for the filter chips and the form. */
export function categories(items: InventoryItem[]): string[] {
  const counts = new Map<string, number>()
  for (const i of items) {
    const c = i.category?.trim()
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c)
}

/** Distinct free-text values already typed for a field, for the form's suggestions. */
export function suggestions(items: InventoryItem[], field: 'store' | 'paid_by' | 'location' | 'brand'): string[] {
  return [...new Set(items.map((i) => i[field]?.trim()).filter((v): v is string => !!v))].sort()
}
