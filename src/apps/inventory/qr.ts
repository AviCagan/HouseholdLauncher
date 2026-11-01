import { encode } from 'uqr'

/**
 * QR codes for Inventory's labels.
 *
 * Error correction M: about 15% of the code can be scuffed, taped over or
 * printed a little faint and it still reads, without making the code so dense
 * that a small label stops scanning. The quiet zone — the white border a
 * scanner needs to find the code — is not part of the matrix; whatever draws
 * it adds QUIET modules of white on every side.
 */

export const QUIET = 2

export interface QrMatrix {
  /** Squares a side, without the quiet zone. */
  size: number
  /** [row][column], true for a dark square. */
  dark: boolean[][]
}

export function qrMatrix(text: string): QrMatrix {
  const qr = encode(text, { ecc: 'M', border: 0 })
  return { size: qr.size, dark: qr.data }
}

/**
 * Each row's runs of dark squares, as [row, start, length] — one rectangle
 * per run instead of one per square, which is what keeps both the SVG on
 * screen and the PDF small.
 */
export function darkRuns(m: QrMatrix): [number, number, number][] {
  const runs: [number, number, number][] = []
  for (let y = 0; y < m.size; y++) {
    let x = 0
    while (x < m.size) {
      if (!m.dark[y][x]) {
        x++
        continue
      }
      const start = x
      while (x < m.size && m.dark[y][x]) x++
      runs.push([y, start, x - start])
    }
  }
  return runs
}

/** An SVG path of the dark squares, in square units, offset by the quiet zone. */
export function qrPath(m: QrMatrix): string {
  return darkRuns(m)
    .map(([y, x, w]) => `M${x + QUIET} ${y + QUIET}h${w}v1h-${w}z`)
    .join('')
}
