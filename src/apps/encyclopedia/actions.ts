import { toast } from 'sonner'
import { useData } from '@/store/useData'
import { newId, nowIso } from '@/data/adapter'
import { fire } from '@/lib/haptics'
import type { LexiconEntry } from '@/data/types'

/**
 * Writes for the Encyclopedia. Optimistic, like everything else: the entry
 * appears on the page at once and is put back the way it was if the commit
 * fails.
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

export async function addEntry(input: EntryInput, profileId: string | null): Promise<LexiconEntry | null> {
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
  try {
    await useData.getState().adapter.insert(TABLE, row)
    return row
  } catch (err) {
    replaceRow(row.id, null)
    fire('error')
    toast.error("Couldn't add that entry")
    console.error(`[${TABLE}]`, err)
    return null
  }
}

export async function updateEntry(
  entry: LexiconEntry,
  input: EntryInput,
  profileId: string | null,
): Promise<boolean> {
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
  const next = { ...entry, ...patch, updated_at: nowIso() }
  replaceRow(entry.id, next)
  fire('success')
  try {
    await useData.getState().adapter.update(TABLE, entry.id, patch)
    return true
  } catch (err) {
    replaceRow(entry.id, entry)
    fire('error')
    toast.error("Couldn't save that entry")
    console.error(`[${TABLE}]`, err)
    return false
  }
}

export async function removeEntry(entry: LexiconEntry): Promise<boolean> {
  fire('delete')
  replaceRow(entry.id, null)
  try {
    await useData.getState().adapter.remove(TABLE, entry.id)
    return true
  } catch (err) {
    replaceRow(entry.id, entry)
    fire('error')
    toast.error("Couldn't remove that entry")
    console.error(`[${TABLE}]`, err)
    return false
  }
}
