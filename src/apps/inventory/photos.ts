/**
 * Getting pictures and files ready to send to Drive.
 *
 * A phone photo is 3–5 MB and 4000px across. Drive would take it, but every
 * byte goes phone → household server → Apps Script → Drive, and on a phone
 * signal that is slow and fragile. Downscaling to 2400px first keeps a photo
 * sharp enough to read a serial number off and brings it to well under a
 * megabyte. PDFs and anything else go as they are.
 */

export interface Prepared {
  name: string
  mime: string
  /** Base64, no data: prefix. */
  data: string
}

/** Long side of a photo sent to Drive. */
export const PHOTO_MAX = 2400
/** Long side of a scanned page — legible print, a smaller PDF. */
export const PAGE_MAX = 1800
/** Long side of the cover thumbnail kept in the database. */
export const THUMB_MAX = 360

/** Biggest file the app will send in one go (the server caps a little higher). */
export const MAX_FILE_BYTES = 18 * 1024 * 1024

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function drawScaled(source: Blob, maxSide: number, quality: number): Promise<string> {
  // createImageBitmap honours the photo's EXIF orientation, so a portrait
  // shot doesn't arrive in Drive lying on its side.
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that image')
  // White under transparent PNGs, which would otherwise turn black as JPEG.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', quality)
}

const stripDataUrl = (url: string): string => url.slice(url.indexOf(',') + 1)

/** A photo's name for Drive, ending in .jpg once it has been re-encoded. */
function jpegName(name: string, fallback: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || fallback
  return `${base}.jpg`
}

/** A picked file, ready to upload: photos downscaled, everything else as is. */
export async function prepareFile(file: File, label: string, maxSide = PHOTO_MAX): Promise<Prepared> {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml' && file.type !== 'image/gif') {
    try {
      const url = await drawScaled(file, maxSide, 0.86)
      return { name: jpegName(file.name, label), mime: 'image/jpeg', data: stripDataUrl(url) }
    } catch {
      // A format the browser can't decode (HEIC on some desktops): send it
      // untouched and let Drive deal with it.
    }
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is over ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB — too big to send from here`)
  }
  return {
    name: file.name || label,
    mime: file.type || 'application/octet-stream',
    data: base64FromBuffer(await file.arrayBuffer()),
  }
}

/** The small picture kept with the item so the list draws instantly. */
export async function thumbFromBlob(blob: Blob): Promise<string> {
  return drawScaled(blob, THUMB_MAX, 0.72)
}

export function blobFromBase64(data: string, mime: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
