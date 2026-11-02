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

/**
 * Open the scanner. Resolves to the PDF as base64 and its page count, or null
 * if the person backed out.
 *
 * The scanner is a Play services module, downloaded the first time anything
 * asks for it. `onPreparing` is called if that download has to happen first,
 * so the screen can say why nothing has opened yet.
 */
export async function scanWithGoogle(onPreparing?: () => void): Promise<{ data: string; pages: number } | null> {
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

  let result
  try {
    result = await DocumentScanner.scanDocument({
      resultFormats: 'PDF',
      scannerMode: 'FULL',
      galleryImportAllowed: true,
      pageLimit: 50,
    })
  } catch (err) {
    if (/cancel/i.test(String((err as Error)?.message ?? err))) return null
    throw err
  }
  if (!result.pdf?.uri) return null

  const { Filesystem } = await import('@capacitor/filesystem')
  const file = await Filesystem.readFile({ path: result.pdf.uri })
  // Native always answers with a base64 string; a Blob only ever comes back
  // on the web, where this never runs.
  if (typeof file.data !== 'string') throw new Error('Unexpected scan result')
  return { data: file.data, pages: result.pdf.pageCount }
}
