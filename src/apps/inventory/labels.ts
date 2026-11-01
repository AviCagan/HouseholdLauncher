import type { InventoryItem } from '@/data/types'
import { stockCode } from './model'
import { itemUrl } from './links'
import { QUIET, darkRuns, qrMatrix } from './qr'

/**
 * Printable labels: a sheet of QR codes, each with the item's name and stock
 * code underneath, with cut lines between them.
 *
 * Sized by one number — how big the QR code is, in inches — because that is
 * the thing that has to fit: on the side of a toolbox, inside a lid, on a bag
 * of spare screws. Everything else follows from it: the text grows with the
 * code, and the sheet fits as many labels as that size allows on US Letter.
 */

export const PT_PER_IN = 72
export const PAGE_W = 8.5 * PT_PER_IN
export const PAGE_H = 11 * PT_PER_IN
/** Most home printers can't reach the last few millimetres of the page. */
export const MARGIN = 0.4 * PT_PER_IN

/** The slider's range and steps, in inches. */
export const QR_MIN = 0.5
export const QR_MAX = 6
export const QR_STEP = 0.125

export const QR_PRESETS: { label: string; inches: number }[] = [
  { label: 'Tiny', inches: 0.75 },
  { label: 'Small', inches: 1.25 },
  { label: 'Medium', inches: 2 },
  { label: 'Large', inches: 3 },
]

export interface LabelLayout {
  /** The QR code including its quiet zone, in points. */
  qr: number
  pad: number
  fontSize: number
  codeSize: number
  /** Most lines the name may wrap to before it's cut short. */
  nameLines: number
  cellW: number
  cellH: number
  cols: number
  rows: number
  perPage: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Where everything goes for a QR code of `inches`.
 *
 * Text scales with the code but within limits: never so small a printer
 * smudges it, never so big a name crowds the code. A label wider than the
 * printable width is clamped to it — one label a page, as big as fits.
 */
export function labelLayout(inches: number): LabelLayout {
  const usableW = PAGE_W - 2 * MARGIN
  const usableH = PAGE_H - 2 * MARGIN
  const fontSize = clamp(5 + inches * 4.5, 6.5, 22)
  const codeSize = clamp(fontSize * 0.72, 5.5, 14)
  const nameLines = 2
  const pad = clamp(inches * 0.1, 0.06, 0.3) * PT_PER_IN
  const textH = nameLines * fontSize * 1.18 + codeSize * 1.4 + pad * 0.5

  // Never larger than the page can hold, text and all.
  const qr = Math.min(inches * PT_PER_IN, usableW - 2 * pad, usableH - 2 * pad - textH)
  const cellW = Math.max(qr + 2 * pad, Math.min(usableW, qr * 1.25))
  const cellH = qr + 2 * pad + textH
  const cols = Math.max(1, Math.floor(usableW / cellW))
  const rows = Math.max(1, Math.floor(usableH / cellH))
  return { qr, pad, fontSize, codeSize, nameLines, cellW, cellH, cols, rows, perPage: cols * rows }
}

/** "1.25 in · 3.2 cm" — both, since a ruler might be either. */
export function sizeLabel(inches: number): string {
  const cm = inches * 2.54
  return `${Number(inches.toFixed(3))} in · ${cm.toFixed(1)} cm`
}

export interface LabelSource {
  id: string
  name: string
}

/**
 * Break a name into at most `lines` lines no wider than `width`, ending the
 * last with an ellipsis when the rest doesn't fit. `measure` gives a string's
 * width in points in the font being used.
 */
export function wrapName(name: string, width: number, lines: number, measure: (s: string) => number, ellipsis = '…'): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const shorten = (s: string) => {
    let t = s
    while (t && measure(`${t}${ellipsis}`) > width) t = t.slice(0, -1).trimEnd()
    return `${t}${ellipsis}`
  }
  const out: string[] = []
  let i = 0
  while (i < words.length && out.length < lines) {
    let line = words[i++]
    while (i < words.length && measure(`${line} ${words[i]}`) <= width) line += ` ${words[i++]}`
    // One word wider than the label on its own is cut, not overflowed.
    out.push(measure(line) <= width ? line : shorten(line))
  }
  if (i < words.length && out.length > 0) {
    const last = out[out.length - 1]
    out[out.length - 1] = shorten(last.endsWith(ellipsis) ? last.slice(0, -ellipsis.length) : last)
  }
  return out
}

/** The labels as a PDF, one per item, as many to a page as the size allows. */
export async function labelsPdf(items: LabelSource[], inches: number): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(items.length === 1 ? `${items[0].name} — label` : 'Inventory labels')
  doc.setCreator('Household — Inventory')
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)
  const L = labelLayout(inches)

  // The standard PDF fonts only know Latin-1-ish characters (WinAnsi); an
  // emoji or a curly quote they lack would throw, so anything outside their
  // set is dropped rather than failing the whole sheet.
  const known = new Set(bold.getCharacterSet())
  const printable = (s: string) => [...s].filter((ch) => known.has(ch.codePointAt(0)!)).join('').replace(/\s+/g, ' ').trim()

  const ink = rgb(0.08, 0.07, 0.06)
  const faint = rgb(0.6, 0.6, 0.6)
  const gridW = L.cols * L.cellW
  const gridH = L.rows * L.cellH
  const left = (PAGE_W - gridW) / 2
  const top = PAGE_H - (PAGE_H - gridH) / 2

  let page = doc.addPage([PAGE_W, PAGE_H])
  items.forEach((item, i) => {
    const slot = i % L.perPage
    if (i > 0 && slot === 0) page = doc.addPage([PAGE_W, PAGE_H])
    const col = slot % L.cols
    const row = Math.floor(slot / L.cols)
    const x0 = left + col * L.cellW
    const y0 = top - (row + 1) * L.cellH

    // Cut line.
    page.drawRectangle({ x: x0, y: y0, width: L.cellW, height: L.cellH, borderColor: faint, borderWidth: 0.4, borderDashArray: [2, 2.5] })

    // The code, square by square — vector, so it prints sharp at any size.
    const m = qrMatrix(itemUrl(item.id))
    const unit = L.qr / (m.size + 2 * QUIET)
    const qx = x0 + (L.cellW - L.qr) / 2
    const qyTop = y0 + L.cellH - L.pad
    for (const [r, c, w] of darkRuns(m)) {
      page.drawRectangle({
        x: qx + (c + QUIET) * unit,
        y: qyTop - (r + QUIET + 1) * unit,
        // A hair over, so neighbouring squares meet with no white seam.
        width: w * unit + 0.01,
        height: unit + 0.01,
        color: ink,
      })
    }

    // The name, centred under it, then the stock code.
    const textW = L.cellW - 2 * L.pad
    const lines = wrapName(
      printable(item.name) || 'Item',
      textW,
      L.nameLines,
      (s) => bold.widthOfTextAtSize(s, L.fontSize),
      known.has(0x2026) ? '…' : '...',
    )
    let y = qyTop - L.qr - L.fontSize * 1.05
    for (const line of lines) {
      const w = bold.widthOfTextAtSize(line, L.fontSize)
      page.drawText(line, { x: x0 + (L.cellW - w) / 2, y, size: L.fontSize, font: bold, color: ink })
      y -= L.fontSize * 1.18
    }
    const code = stockCode(item.id).replace('·', '-')
    const cw = mono.widthOfTextAtSize(code, L.codeSize)
    page.drawText(code, { x: x0 + (L.cellW - cw) / 2, y: y - L.codeSize * 0.15, size: L.codeSize, font: mono, color: faint })
  })

  return doc.save()
}

export const labelFileName = (items: Pick<InventoryItem, 'name'>[]): string =>
  items.length === 1
    ? `${items[0].name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'item'}-label.pdf`
    : `inventory-labels-${items.length}.pdf`
