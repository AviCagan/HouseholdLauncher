import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  Google's scanner runs on top of the app, and Android may shut the app down
  behind it. These pin the two halves of surviving that: the item being
  scanned is written down before the scanner opens, and a result delivered to
  the restarted app (Capacitor's appRestoredResult) is matched back to it.
*/

type Restored = { pluginId: string; methodName: string; success: boolean; data?: unknown }
const restoredListeners: Array<(e: Restored) => void> = []
const scanDocument = vi.fn()

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_name: string, fn: (e: Restored) => void) => {
      restoredListeners.push(fn)
      return { remove: async () => void restoredListeners.splice(restoredListeners.indexOf(fn), 1) }
    }),
  },
}))
vi.mock('@capacitor-mlkit/document-scanner', () => ({
  DocumentScanner: {
    isGoogleDocumentScannerModuleAvailable: async () => ({ available: true }),
    scanDocument: (...args: unknown[]) => scanDocument(...args),
  },
}))
vi.mock('@/lib/platform', () => ({ isNative: () => true, nativePlatform: () => 'android' }))

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  restoredListeners.length = 0
  scanDocument.mockReset()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

const { listenForRestoredScan, scanWithGoogle } = await import('./scanner')
const flush = () => new Promise((r) => setTimeout(r, 0))
const pdf = { uri: 'file:///cache/scan.pdf', pageCount: 4 }

describe('scanWithGoogle', () => {
  it('asks for the full scanner, many pages, as a PDF', async () => {
    scanDocument.mockResolvedValue({ pdf })
    await expect(scanWithGoogle('item-1')).resolves.toEqual({ uri: pdf.uri, pages: 4 })
    expect(scanDocument).toHaveBeenCalledWith(expect.objectContaining({ scannerMode: 'FULL', resultFormats: 'PDF' }))
    expect(scanDocument.mock.calls[0][0].pageLimit).toBeGreaterThan(10)
  })

  it('writes down the item while the scanner is open, and forgets it after', async () => {
    let during: string | undefined
    scanDocument.mockImplementation(async () => {
      during = store.get('inv:scanning')
      return { pdf }
    })
    await scanWithGoogle('item-1')
    expect(during).toBe('item-1')
    expect(store.has('inv:scanning')).toBe(false)
  })

  it('treats backing out as no scan, not an error', async () => {
    scanDocument.mockRejectedValue(new Error('Scan cancelled or failed. Result code: 0'))
    await expect(scanWithGoogle('item-1')).resolves.toBeNull()
    expect(store.has('inv:scanning')).toBe(false)
  })
})

describe('listenForRestoredScan', () => {
  it('hands a scan that outlived the app to the item it was for', async () => {
    store.set('inv:scanning', 'item-1')
    const onScan = vi.fn()
    listenForRestoredScan(onScan)
    await flush()
    restoredListeners[0]({ pluginId: 'DocumentScanner', methodName: 'scanDocument', success: true, data: { pdf } })
    expect(onScan).toHaveBeenCalledWith('item-1', { uri: pdf.uri, pages: 4 })
    expect(store.has('inv:scanning')).toBe(false)
  })

  it("ignores other plugins' results, backed-out scans, and scans it can't place", async () => {
    const onScan = vi.fn()
    listenForRestoredScan(onScan)
    await flush()
    const fire = restoredListeners[0]

    store.set('inv:scanning', 'item-1')
    fire({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: { pdf } })
    fire({ pluginId: 'DocumentScanner', methodName: 'scanDocument', success: false })
    fire({ pluginId: 'DocumentScanner', methodName: 'scanDocument', success: true, data: { pdf } })
    expect(onScan).not.toHaveBeenCalled()
  })

  it('stops listening when removed', async () => {
    const stop = listenForRestoredScan(vi.fn())
    await flush()
    stop()
    await flush()
    expect(restoredListeners).toHaveLength(0)
  })
})
