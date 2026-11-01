import { describe, expect, it } from 'vitest'
import {
  DOC_FOOTER,
  GOOGLE_DOC,
  classifyFolder,
  detailsDocText,
  factsFromNotes,
  guessKind,
  notesFromDoc,
  reconcile,
  searchItems,
  sortItems,
  stockCode,
  warranty,
  yearsFrom,
  type DriveFile,
} from './model'
import type { InventoryItem } from '@/data/types'

/*
  The household's first real item, exactly as it sits in Drive:
  Joint Stuff › Warranties, manuals, extra parts › Vevor evaporative cooler.
*/
const VEVOR = 'Vevor evaporative cooler'
const VEVOR_NOTES =
  '100 dollars from Home Depot paid for by bubby\n\n  \n\nFan with a water tank, one extra gold part and 2 ice packs to fill the cooler for extra cold\n\n  '
const vevorFiles: DriveFile[] = [
  { id: 'doc', name: 'Evaporative cooler doc', mime: GOOGLE_DOC, size: 1024, url: 'u', created: '2026-11-01T21:35:37Z', description: '' },
  { id: 'pdf', name: 'Evaporative cooler manual/warranty.pdf', mime: 'application/pdf', size: 5277771, url: 'u', created: '2026-11-01T21:35:19Z', description: '' },
  { id: 'extra', name: 'Extra part', mime: 'image/jpeg', size: 2935065, url: 'u', created: '2026-11-01T21:33:32Z', description: '' },
  { id: 'whole', name: 'Evaporative cooler', mime: 'image/jpeg', size: 3139869, url: 'u', created: '2026-11-01T21:39:27Z', description: '' },
  { id: 'ice', name: 'Ice packs', mime: 'image/jpeg', size: 3706800, url: 'u', created: '2026-11-01T21:36:57Z', description: '' },
]

const item = (patch: Partial<InventoryItem> = {}): InventoryItem => ({
  id: '7c2f9a10-0000-4000-8000-000000000000',
  name: 'Thing',
  brand: null,
  model: null,
  category: null,
  store: null,
  price_cents: null,
  paid_by: null,
  purchased_on: null,
  warranty_until: null,
  location: null,
  notes: null,
  drive_folder_id: null,
  drive_folder_url: null,
  notes_doc_id: null,
  cover_file_id: null,
  cover_thumb: null,
  files: [],
  created_by: null,
  updated_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...patch,
})

describe('the Vevor cooler folder', () => {
  const sorted = classifyFolder(VEVOR, vevorFiles)
  const kindOf = (id: string) => sorted.files.find((f) => f.id === id)?.kind

  it('takes the Google Doc as the notes, not as paperwork', () => {
    expect(sorted.notesDocId).toBe('doc')
    expect(kindOf('doc')).toBeUndefined()
  })

  it('files the manual as paperwork', () => {
    expect(kindOf('pdf')).toBe('doc')
  })

  it('makes the photo named for the item the overall photo', () => {
    expect(kindOf('whole')).toBe('photo')
    expect(sorted.coverId).toBe('whole')
  })

  it('files the extra part and the ice packs as parts', () => {
    expect(kindOf('extra')).toBe('part')
    expect(kindOf('ice')).toBe('part')
  })

  it('reads price, store and who paid out of the note', () => {
    expect(factsFromNotes(VEVOR_NOTES)).toEqual({ price_cents: 10000, store: 'Home Depot', paid_by: 'bubby' })
  })

  it('keeps a hand-written doc whole as the notes, minus the stray blank lines', () => {
    expect(notesFromDoc(VEVOR_NOTES)).toBe(
      '100 dollars from Home Depot paid for by bubby\n\nFan with a water tank, one extra gold part and 2 ice packs to fill the cooler for extra cold',
    )
  })
})

describe('guessKind', () => {
  it('trusts the kind the app wrote on its own uploads', () => {
    expect(guessKind({ name: 'IMG_0001.jpg', mime: 'image/jpeg', description: 'household-inventory:doc' }, 'Drill')).toBe('doc')
  })

  it('calls a photographed warranty paperwork', () => {
    expect(guessKind({ name: 'Warranty card', mime: 'image/jpeg', description: '' }, 'Drill')).toBe('doc')
  })
})

describe('factsFromNotes', () => {
  it('reads a dollar sign', () => {
    expect(factsFromNotes('Got it for $49.99 at Costco').price_cents).toBe(4999)
    expect(factsFromNotes('Got it for $49.99 at Costco').store).toBe('Costco')
  })

  it('leaves out what it cannot find', () => {
    expect(factsFromNotes('works great')).toEqual({ price_cents: null, store: null, paid_by: null })
  })
})

describe('the notes doc', () => {
  it('round-trips the notes through the doc the app writes', () => {
    const it2 = item({ name: 'Cooler', store: 'Home Depot', price_cents: 10000, notes: 'Two ice packs.\nGold part in the drawer.' })
    const text = detailsDocText(it2)
    expect(text).toContain('Bought at Home Depot, for $100')
    expect(text.endsWith(DOC_FOOTER)).toBe(true)
    expect(notesFromDoc(text)).toBe('Two ice packs.\nGold part in the drawer.')
  })

  it('reads no notes back from a doc written with none', () => {
    expect(notesFromDoc(detailsDocText(item()))).toBe('')
  })
})

describe('reconcile', () => {
  it('keeps the kind the app knows and picks up what was added in Drive', () => {
    const known = item({
      name: VEVOR,
      cover_file_id: 'whole',
      files: [{ id: 'ice', kind: 'photo', name: 'Ice packs', mime: 'image/jpeg', url: 'u', size: 1, added_at: 'x' }],
    })
    const next = reconcile(known, vevorFiles)
    expect(next.files.find((f) => f.id === 'ice')?.kind).toBe('photo')
    expect(next.added).toBe(3)
    expect(next.cover_file_id).toBe('whole')
  })

  it('drops files deleted in Drive and moves the cover off a missing one', () => {
    const known = item({
      name: VEVOR,
      cover_file_id: 'gone',
      files: [{ id: 'gone', kind: 'photo', name: 'x', mime: 'image/jpeg', url: 'u', size: 1, added_at: 'x' }],
    })
    const next = reconcile(known, vevorFiles)
    expect(next.removed).toBe(1)
    expect(next.cover_file_id).toBe('whole')
  })
})

describe('warranty', () => {
  const today = new Date(2026, 10, 1)

  it('reads each state', () => {
    expect(warranty(item(), today).state).toBe('none')
    expect(warranty(item({ warranty_until: '2027-11-01' }), today).state).toBe('active')
    expect(warranty(item({ warranty_until: '2026-12-01' }), today)).toMatchObject({ state: 'soon', daysLeft: 30 })
    expect(warranty(item({ warranty_until: '2026-10-31' }), today)).toMatchObject({ state: 'expired', daysLeft: -1 })
  })

  it('adds whole years to the purchase date', () => {
    expect(yearsFrom('2026-11-01', 2, today)).toBe('2028-11-01')
    expect(yearsFrom(null, 1, today)).toBe('2027-11-01')
  })
})

describe('the list', () => {
  const a = item({ id: 'a', name: 'Air fryer', warranty_until: '2027-01-01', purchased_on: '2026-05-01' })
  const b = item({ id: 'b', name: 'Blender', warranty_until: '2026-01-01', purchased_on: '2026-09-01', store: 'Costco' })
  const c = item({ id: 'c', name: 'Cooler', purchased_on: '2026-11-01' })

  it('sorts newest first, by name, or by warranty running out', () => {
    const today = new Date(2026, 10, 1)
    expect(sortItems([a, b, c], 'recent').map((i) => i.id)).toEqual(['c', 'b', 'a'])
    expect(sortItems([c, b, a], 'name').map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(sortItems([c, b, a], 'warranty', today).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('searches every text field', () => {
    expect(searchItems([a, b, c], 'costco').map((i) => i.id)).toEqual(['b'])
  })

  it('labels every item with a stable stock code', () => {
    expect(stockCode('7c2f9a10-0000-4000-8000-000000000000')).toBe('INV·7C2F')
  })
})
