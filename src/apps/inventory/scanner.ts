import { isNative, nativePlatform } from '@/lib/platform'

/**
 * Google's document scanner — the one inside Google Drive.
 *
 * Drive's own scanner (finds the page's edges, straightens it, cleans up the
 * shadows, takes as many pages as you like, makes a PDF) is ML Kit's document
 * scanner, provided by Google Play services. The Android app opens exactly
 * that, right on top of Inventory, and the PDF it hands back goes into the
 * item's Drive folder.
 *
 * A web page can't open it — not on Android Chrome, and not on an iPhone,
 * which has no Play services at all. There, Inventory opens the item's folder
 * in the Drive app instead, where the same scanner is behind + → Scan, and
 * picks the new file up when you come back (see ItemSheet).
 */

export const hasGoogleScanner = (): boolean => isNative() && nativePlatform() === 'android'

/** How long the one-time download of the scanner may take before giving up. */
const INSTALL_TIMEOUT_MS = 120_000

// GoogleDocumentScannerModuleInstallState, by value — a type-only import
// keeps the plugin out of every bundle but the Android one.
const COMPLETED = 4
const FAILED = 5
const CANCELED = 3

/** A finished scan: the PDF Google's scanner wrote, still on the phone. */
export interface ScannedPdf {
  uri: string
  pages: number
}

/*
  Which item the scanner is open for, kept where it outlives the app.

  The scanner is Google's screen on top of this one, and while it runs —
  camera, edge detection, the clean-up model — Android may shut the app
  behind it down to free memory. The scan isn't lost when that happens: the
  app starts again and the plugin hands the result over as Capacitor's
  `appRestoredResult` (see listenForRestoredScan). But by then everything in
  memory is gone, including which item it was for, so that goes here first.
*/
const SCANNING_KEY = 'inv:scanning'

function rememberScanning(itemId: string | null) {
  try {
    if (itemId) localStorage.setItem(SCANNING_KEY, itemId)
    else localStorage.removeItem(SCANNING_KEY)
  } catch {
    // Private storage off: a restored scan can't be matched to its item,
    // and an ordinary one doesn't need this at all.
  }
}

function scanningFor(): string | null {
  try {
    return localStorage.getItem(SCANNING_KEY)
  } catch {
    return null
  }
}

/**
 * Open the scanner for an item. Resolves to the PDF it made, or null if the
 * person backed out.
 *
 * The scanner is a Play services module, downloaded the first time anything
 * asks for it. `onPreparing` is called if that download has to happen first,
 * so the screen can say why nothing has opened yet.
 */
export async function scanWithGoogle(itemId: string, onPreparing?: () => void): Promise<ScannedPdf | null> {
  const { DocumentScanner } = await import('@capacitor-mlkit/document-scanner')

  try {
    const { available } = await DocumentScanner.isGoogleDocumentScannerModuleAvailable()
    if (!available) {
      onPreparing?.()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Google’s scanner is taking a while to download — try again in a minute')), INSTALL_TIMEOUT_MS)
        void DocumentScanner.addListener('googleDocumentScannerModuleInstallProgress', (event) => {
          if (event.state === COMPLETED) {
            clearTimeout(timer)
            resolve()
          } else if (event.state === FAILED || event.state === CANCELED) {
            clearTimeout(timer)
            reject(new Error('Couldn’t download Google’s scanner'))
          }
        })
        void DocumentScanner.installGoogleDocumentScannerModule().catch(reject)
      })
      void DocumentScanner.removeAllListeners()
    }
  } catch (err) {
    // A failed check isn't the end: asking to scan makes Play services fetch
    // the module itself on most phones.
    console.warn('[scanner] module check', err)
  }

  rememberScanning(itemId)
  let result
  try {
    result = await DocumentScanner.scanDocument({
      resultFormats: 'PDF',
      // Everything Drive's scanner does: auto-capture, edges, straightening,
      // filters, wiping out fingers and stains, as many pages as there are.
      scannerMode: 'FULL',
      galleryImportAllowed: true,
      pageLimit: 100,
    })
  } catch (err) {
    if (/cancel/i.test(String((err as Error)?.message ?? err))) return null
    throw err
  } finally {
    rememberScanning(null)
  }
  return result.pdf?.uri ? { uri: result.pdf.uri, pages: result.pdf.pageCount } : null
}

/** The scan's PDF as base64, ready to send to Drive. */
export async function readScan(scan: ScannedPdf): Promise<string> {
  const { Filesystem } = await import('@capacitor/filesystem')
  const file = await Filesystem.readFile({ path: scan.uri })
  // Native always answers with a base64 string; a Blob only ever comes back
  // on the web, where this never runs.
  if (typeof file.data !== 'string') throw new Error('Unexpected scan result')
  return file.data
}

/**
 * A scan that finished after Android had shut the app down — delivered once
 * the app is back. `onScan` gets the item it was for and the PDF; a scan that
 * was backed out of, or can't be matched to an item, is dropped.
 */
export function listenForRestoredScan(onScan: (itemId: string, scan: ScannedPdf) => void): () => void {
  let removed = false
  let remove: (() => void) | null = null
  void import('@capacitor/app').then(({ App }) =>
    App.addListener('appRestoredResult', (event) => {
      if (event.pluginId !== 'DocumentScanner' || event.methodName !== 'scanDocument') return
      const itemId = scanningFor()
      rememberScanning(null)
      const pdf = (event.data as { pdf?: { uri?: string; pageCount?: number } } | undefined)?.pdf
      if (!event.success || !itemId || !pdf?.uri) return
      onScan(itemId, { uri: pdf.uri, pages: pdf.pageCount ?? 1 })
    }).then((handle) => {
      if (removed) void handle.remove()
      else remove = () => void handle.remove()
    }),
  )
  return () => {
    removed = true
    remove?.()
  }
}
