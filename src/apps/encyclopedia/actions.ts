import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { newId, nowIso } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { LexiconEntry } from '@/data/types'

/**
 * Writes for the Encyclopedia.
 *
 * Optimistic in the strict sense the rest of the app means it: the entry is
 * on the page — and the caller has its row back — before the network is
 * involved at all. The commit runs on its own; if it fails, the row is put
 * back the way it was and a toast says so. Nothing in the UI ever waits on
 * the round-trip, because on a phone that round-trip can take a second or
 * three minutes and a sheet stuck on "Saving…" is the worse of the two.
 */

const TABLE = 'lexicon_entries'

function replaceRow(id: string, next: LexiconEntry | null): void {
  const current = useData.getState().lexicon_entries
  const updated = next
    ? current.some((r) => r.id === id)
      ? current.map((r) => (r.id === id ? next : r))
      : [...current, next]
    : current.filter((r) => r.id !== id)
  useData.setState({ lexicon_entries: updated })
}

export type EntryInput = Pick<
  LexiconEntry,
  'term' | 'pronunciation' | 'part_of_speech' | 'definition' | 'example' | 'origin'
>

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

async function commitInsert(row: LexiconEntry): Promise<void> {
  try {
    await useData.getState().adapter.insert(TABLE, row)
  } catch (err) {
    replaceRow(row.id, null)
    fire('error')
    toast.error("Couldn't add that entry — it's been taken back off the page")
    console.error(`[${TABLE}]`, err)
  }
}

async function commitUpdate(before: LexiconEntry, patch: Partial<LexiconEntry>): Promise<void> {
  try {
    await useData.getState().adapter.update(TABLE, before.id, patch)
  } catch (err) {
    replaceRow(before.id, before)
    fire('error')
    toast.error("Couldn't save that revision — the entry is back as it was")
    console.error(`[${TABLE}]`, err)
  }
}

/** The new row, already on the page, or null when there was nothing to add. */
export function addEntry(input: EntryInput, profileId: string | null): LexiconEntry | null {
  const term = input.term.trim()
  const definition = input.definition.trim()
  if (!term || !definition) return null
  const row: LexiconEntry = {
    id: newId(),
    term,
    pronunciation: clean(input.pronunciation),
    part_of_speech: input.part_of_speech,
    definition,
    example: clean(input.example),
    origin: clean(input.origin),
    tags: [],
    created_by: profileId,
    updated_by: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  replaceRow(row.id, row)
  fire('success')
  void commitInsert(row)
  return row
}

/** False only when the revision would blank the term or definition. */
export function updateEntry(entry: LexiconEntry, input: EntryInput, profileId: string | null): boolean {
  const patch: Partial<LexiconEntry> = {
    term: input.term.trim(),
    pronunciation: clean(input.pronunciation),
    part_of_speech: input.part_of_speech,
    definition: input.definition.trim(),
    example: clean(input.example),
    origin: clean(input.origin),
    updated_by: profileId,
  }
  if (!patch.term || !patch.definition) return false
  replaceRow(entry.id, { ...entry, ...patch, updated_at: nowIso() })
  fire('success')
  void commitUpdate(entry, patch)
  return true
}

export function removeEntry(entry: LexiconEntry): void {
  fire('delete')
  replaceRow(entry.id, null)
  void (async () => {
    try {
      await useData.getState().adapter.remove(TABLE, entry.id)
    } catch (err) {
      replaceRow(entry.id, entry)
      fire('error')
      toast.error("Couldn't remove that entry — it's back")
      console.error(`[${TABLE}]`, err)
    }
  })()
}
