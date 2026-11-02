import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { appendPdf } from './pdfMerge'

/** A PDF whose pages are told apart by width. */
async function pdfOf(widths: number[]): Promise<string> {
  const doc = await PDFDocument.create()
  for (const w of widths) doc.addPage([w, 792])
  return doc.saveAsBase64()
}

describe('appendPdf', () => {
  it('puts the new pages after the old ones, in order', async () => {
    const { data, pages } = await appendPdf(await pdfOf([600]), await pdfOf([601, 602]))
    expect(pages).toBe(3)
    const joined = await PDFDocument.load(data)
    expect(joined.getPages().map((p) => p.getWidth())).toEqual([600, 601, 602])
  })

  it('can grow the same document more than once', async () => {
    const once = await appendPdf(await pdfOf([600]), await pdfOf([601]))
    const twice = await appendPdf(once.data, await pdfOf([602]))
    expect(twice.pages).toBe(3)
  })
})
