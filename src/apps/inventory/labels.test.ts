import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import { PDFDocument } from 'pdf-lib'
import { itemIdFromUrl, itemUrl } from './links'
import { QUIET, qrMatrix, qrPath, type QrMatrix } from './qr'
import { MARGIN, PAGE_H, PAGE_W, PT_PER_IN, QR_MAX, QR_MIN, labelLayout, labelsPdf, wrapName } from './labels'

const ID = '7c2f9a10-1b2c-4d3e-8f40-0123456789ab'

/** Draw a matrix as pixels, the way a camera would see a printed label. */
function raster(m: QrMatrix, scale = 6) {
  const n = (m.size + 2 * QUIET + 4) * scale
  const px = new Uint8ClampedArray(n * n * 4).fill(255)
  const off = (QUIET + 2) * scale
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++) {
      if (!m.dark[y][x]) continue
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((off + y * scale + dy) * n + off + x * scale + dx) * 4
          px[i] = px[i + 1] = px[i + 2] = 0
        }
    }
  return { px, n }
}

describe('label links', () => {
  it('reads back the item it was made for', () => {
    expect(itemIdFromUrl(itemUrl(ID))).toBe(ID)
  })

  it('takes the dashed form too, and ignores anything that is not an id', () => {
    expect(itemIdFromUrl(`https://example.com/?item=${ID}`)).toBe(ID)
    expect(itemIdFromUrl('https://example.com/?item=../../etc')).toBeNull()
    expect(itemIdFromUrl('https://example.com/')).toBeNull()
  })

  it('is short enough for a small, easy-to-scan code', () => {
    // Version 5 is 37 squares a side; anything denser gets hard to read on a tiny label.
    expect(qrMatrix(itemUrl(ID)).size).toBeLessThanOrEqual(37)
  })
})

describe('QR codes', () => {
  it('scan back to the item link', () => {
    const url = itemUrl(ID)
    const { px, n } = raster(qrMatrix(url))
    expect(jsQR(px, n, n)?.data).toBe(url)
  })

  it('draw as an SVG path inside their quiet zone', () => {
    const m = qrMatrix(itemUrl(ID))
    const path = qrPath(m)
    expect(path.startsWith(`M${QUIET}`)).toBe(true)
    expect(path).not.toContain('NaN')
  })
})

describe('label layout', () => {
  it('fits more small labels than large ones on a page', () => {
    expect(labelLayout(0.75).perPage).toBeGreaterThan(labelLayout(2).perPage)
    expect(labelLayout(2).perPage).toBeGreaterThan(labelLayout(3).perPage)
  })

  it('keeps the QR the size asked for while it fits', () => {
    expect(labelLayout(1.25).qr).toBeCloseTo(1.25 * PT_PER_IN)
  })

  it('keeps every size on the printable page, one a page at the largest', () => {
    for (let inches = QR_MIN; inches <= QR_MAX; inches += 0.25) {
      const L = labelLayout(inches)
      expect(L.cols * L.cellW).toBeLessThanOrEqual(PAGE_W - 2 * MARGIN + 0.01)
      expect(L.rows * L.cellH).toBeLessThanOrEqual(PAGE_H - 2 * MARGIN + 0.01)
      expect(L.perPage).toBeGreaterThanOrEqual(1)
    }
    expect(labelLayout(QR_MAX).perPage).toBe(1)
  })

  it('grows the text with the code, within limits', () => {
    expect(labelLayout(3).fontSize).toBeGreaterThan(labelLayout(1).fontSize)
    expect(labelLayout(QR_MIN).fontSize).toBeGreaterThanOrEqual(6.5)
  })
})

describe('wrapName', () => {
  const measure = (s: string) => s.length * 6

  it('keeps a short name on one line', () => {
    expect(wrapName('Drill', 60, 2, measure)).toEqual(['Drill'])
  })

  it('wraps onto a second line', () => {
    expect(wrapName('Vevor evaporative cooler', 120, 2, measure)).toEqual(['Vevor evaporative', 'cooler'])
  })

  it('ends with an ellipsis when it runs out of lines', () => {
    const lines = wrapName('one two three four five six seven', 60, 2, measure)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(60)
  })

  it('cuts a single word too long for the label', () => {
    const [line] = wrapName('Supercalifragilistic', 60, 2, measure)
    expect(line.endsWith('…')).toBe(true)
    expect(measure(line)).toBeLessThanOrEqual(60)
  })
})

describe('labelsPdf', () => {
  it('makes a real PDF with as many pages as the size needs', async () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ id: ID.replace(/.$/, String(i % 10)), name: `Thing ${i} 🔧` }))
    const bytes = await labelsPdf(items, 2)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(Math.ceil(13 / labelLayout(2).perPage))
    expect(doc.getTitle()).toBe('Inventory labels')
  })

  it('puts one big label alone on its page', async () => {
    const doc = await PDFDocument.load(await labelsPdf([{ id: ID, name: 'Vevor evaporative cooler' }], QR_MAX))
    expect(doc.getPageCount()).toBe(1)
  })
})
