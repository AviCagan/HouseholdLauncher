import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { useData } from '@/store/useData'
import type { DataAdapter } from '@/data/adapter'
import type { InventoryItem } from '@/data/types'

/*
  Scanning paperwork into an item, with Drive and Google's scanner stood in
  for. The scanner ends a scan on its big Next button — the next page is the
  small + above it — so a scan that comes back a page short has to be easy to
  finish: Add pages scans the rest onto the same PDF.
*/

type Toasted = { message: string; opts?: { action?: { label: string; onClick: () => void } } }
const { toasts, record } = vi.hoisted(() => {
  const toasts: Toasted[] = []
  return { toasts, record: (message: string, opts?: Toasted['opts']) => void toasts.push({ message, opts }) }
})
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(record), { error: vi.fn(record), success: vi.fn(record), dismiss: vi.fn() }) }))
vi.mock('@/lib/haptics', () => ({ fire: vi.fn() }))
vi.mock('@/apps/things/routing/deeplink', () => ({ openExternal: vi.fn() }))

let uploads = 0
const uploadFile = vi.fn(async (_folder: string, file: { name: string; data: string }) => ({
  id: `file-${++uploads}`,
  name: file.name,
  mime: 'application/pdf',
  size: 1,
  url: 'u',
  created: '2026-11-02T00:00:00Z',
  description: '',
}))
const trashFile = vi.fn(async () => ({ ok: true }))
vi.mock('./drive', () => ({
  driveConnected: () => true,
  useDrive: { getState: () => ({ status: { connected: true }, refresh: async () => {} }) },
  uploadFile: (...a: Parameters<typeof uploadFile>) => uploadFile(...a),
  trashFile: () => trashFile(),
  ensureFolder: vi.fn(),
  listFolder: vi.fn(),
  preview: vi.fn(),
  primePreview: vi.fn(),
  readDoc: vi.fn(),
  writeDoc: vi.fn(),
}))

/** Each fake scan is a PDF of that many pages, told apart by width. */
const scans = new Map<string, string>()
async function scanned(uri: string, widths: number[]) {
  const doc = await PDFDocument.create()
  for (const w of widths) doc.addPage([w, 792])
  scans.set(uri, await doc.saveAsBase64())
  return { uri, pages: widths.length }
}
const scanWithGoogle = vi.fn()
vi.mock('./scanner', () => ({
  scanWithGoogle: (...a: unknown[]) => scanWithGoogle(...a),
  readScan: async (s: { uri: string }) => scans.get(s.uri)!,
}))

const { addPagesToScan, fileScan, scanIntoItem } = await import('./actions')

const ID = '7c2f9a10-0000-4000-8000-000000000000'
const item: InventoryItem = {
  id: ID,
  name: 'Cooler',
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
  drive_folder_id: 'folder',
  drive_folder_url: 'https://drive.google.com/drive/folders/folder',
  notes_doc_id: null,
  cover_file_id: null,
  cover_thumb: null,
  files: [],
  created_by: null,
  updated_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const adapter = { kind: 'supabase', update: vi.fn(async () => null) } as unknown as DataAdapter
const files = () => useData.getState().inventory_items[0].files
const widthsOf = async (data: string) => (await PDFDocument.load(data)).getPages().map((p) => p.getWidth())

beforeEach(() => {
  toasts.length = 0
  uploads = 0
  uploadFile.mockClear()
  trashFile.mockClear()
  scanWithGoogle.mockReset()
  useData.setState({ adapter, inventory_items: [{ ...item, files: [] }] })
})

describe('scanning paperwork', () => {
  it('files the scan as paperwork and offers to add pages', async () => {
    await fileScan(ID, await scanned('one', [600]))
    expect(uploadFile.mock.calls[0][1].name).toMatch(/^Cooler — scan .+\.pdf$/)
    expect(files().map((f) => [f.id, f.kind])).toEqual([['file-1', 'doc']])
    const done = toasts.at(-1)!
    expect(done.message).toBe('The scan is in Drive')
    expect(done.opts?.action?.label).toBe('Add pages')
  })

  it('adds the next pages to the end of the same PDF, which replaces the short one', async () => {
    await fileScan(ID, await scanned('one', [600]))
    const firstName = uploadFile.mock.calls[0][1].name

    scanWithGoogle.mockResolvedValue(await scanned('two', [601, 602]))
    await addPagesToScan(ID)

    const merged = uploadFile.mock.calls[1][1]
    expect(merged.name).toBe(firstName)
    expect(await widthsOf(merged.data)).toEqual([600, 601, 602])
    expect(trashFile).toHaveBeenCalledTimes(1)
    expect(files().map((f) => f.id)).toEqual(['file-2'])
    expect(toasts.at(-1)!.message).toBe('3-page scan is in Drive')

    // And again, onto the longer one.
    scanWithGoogle.mockResolvedValue(await scanned('three', [603]))
    await addPagesToScan(ID)
    expect(await widthsOf(uploadFile.mock.calls[2][1].data)).toEqual([600, 601, 602, 603])
    expect(files().map((f) => f.id)).toEqual(['file-3'])
  })

  it('leaves the scan alone when adding pages is backed out of', async () => {
    await fileScan(ID, await scanned('one', [600]))
    scanWithGoogle.mockResolvedValue(null)
    await addPagesToScan(ID)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(trashFile).not.toHaveBeenCalled()
    expect(files().map((f) => f.id)).toEqual(['file-1'])
  })

  it('points to the Drive app when the scanner closes with nothing', async () => {
    scanWithGoogle.mockResolvedValue(null)
    await scanIntoItem(ID)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(toasts.at(-1)!.message).toBe('Nothing was scanned')
    expect(toasts.at(-1)!.opts?.action?.label).toBe('Open Drive')
  })
})
