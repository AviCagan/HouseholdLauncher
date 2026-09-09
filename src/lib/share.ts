import { isNative } from './platform'

/**
 * Hand a piece of text to whatever the phone can send it with.
 *
 * Inside the APK that is the Android share sheet via the Capacitor plugin;
 * in a browser it is the Web Share API where there is one, and the clipboard
 * where there isn't. A cancelled share sheet counts as done — the person
 * changed their mind, which is not an error to toast about.
 */
export type ShareOutcome = 'shared' | 'copied' | 'unavailable'

export async function shareText(opts: { title: string; text: string; url?: string }): Promise<ShareOutcome> {
  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: opts.title })
      return 'shared'
    } catch (err) {
      if (/cancel/i.test(String((err as Error)?.message ?? err))) return 'shared'
      // Fall through to the browser paths: a plugin failure shouldn't leave
      // the person with nothing.
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url })
      return 'shared'
    } catch {
      return 'shared'
    }
  }
  try {
    await navigator.clipboard.writeText(opts.url ?? opts.text)
    return 'copied'
  } catch {
    return 'unavailable'
  }
}
