/**
 * One PDF made of two: the pages of `first`, then the pages of `more`.
 *
 * Google's scanner ends the scan when its big Next button is tapped — the
 * way to another page is the small + above it — so a scan often comes back
 * a page short. "Add pages" scans the rest and joins them on here, so the
 * item still has one document rather than a stack of one-page PDFs.
 *
 * Both sides are base64, as the scanner's file is read and as Drive is sent
 * it. pdf-lib is loaded only when this runs.
 */
export async function appendPdf(first: string, more: string): Promise<{ data: string; pages: number }> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(first)
  const extra = await PDFDocument.load(more)
  const copied = await doc.copyPages(extra, extra.getPageIndices())
  for (const page of copied) doc.addPage(page)
  return { data: await doc.saveAsBase64(), pages: doc.getPageCount() }
}
