/**
 * Turn a picked photo into a small square data URI.
 *
 * Downscaling in the browser before saving is what makes storing the avatar
 * directly in the database reasonable — a phone camera JPEG is several MB, and
 * this lands around 20–40 KB.
 */

const SIZE = 256
const QUALITY = 0.82

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)

  // Centre-crop to a square so faces don't end up stretched.
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that image')

  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE)
  bitmap.close?.()

  return canvas.toDataURL('image/jpeg', QUALITY)
}

/** Rough byte size of a data URI, for guarding against oversized rows. */
export const dataUrlBytes = (url: string): number =>
  Math.round((url.length - (url.indexOf(',') + 1)) * 0.75)
