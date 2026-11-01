import { isNative } from '@/lib/platform'

/**
 * Hand a PDF to the person: a download in a browser, the share sheet in the
 * Android app — where "Print", Drive and email all live, and where a browser
 * download link would do nothing at all, because a WebView has no downloads.
 */
export async function savePdf(bytes: Uint8Array, fileName: string): Promise<void> {
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const { uri } = await Filesystem.writeFile({ path: fileName, data: btoa(binary), directory: Directory.Cache })
    await Share.share({ title: fileName, files: [uri], dialogTitle: 'Print or save the labels' })
    return
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Long enough for the browser to start the download, then let it go.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
