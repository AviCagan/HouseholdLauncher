import { describe, expect, it } from 'vitest'
import { LAPTOP_MIN_WIDTH, shouldUseDesktop, type Device } from './layoutChoice'

const laptop: Device = { native: false, standalone: false, finePointer: true, width: 1440, chosen: null }

describe('shouldUseDesktop', () => {
  it('sends a laptop browser to the laptop page', () => {
    expect(shouldUseDesktop(laptop)).toBe(true)
  })

  it('respects choosing the phone layout', () => {
    expect(shouldUseDesktop({ ...laptop, chosen: 'phone' })).toBe(false)
  })

  it('never moves the APK or an installed web app', () => {
    expect(shouldUseDesktop({ ...laptop, native: true })).toBe(false)
    expect(shouldUseDesktop({ ...laptop, standalone: true })).toBe(false)
  })

  it('leaves phones and narrow windows alone', () => {
    expect(shouldUseDesktop({ ...laptop, finePointer: false })).toBe(false)
    expect(shouldUseDesktop({ ...laptop, width: LAPTOP_MIN_WIDTH - 1 })).toBe(false)
  })

  it('does not force the laptop page on a narrow window just because it was chosen once', () => {
    expect(shouldUseDesktop({ ...laptop, width: 700, chosen: 'desktop' })).toBe(false)
  })
})
