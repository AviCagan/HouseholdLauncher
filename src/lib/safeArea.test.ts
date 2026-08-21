import { describe, expect, it } from 'vitest'
import { fallbackBottomInset, fallbackTopInset, needsFallback } from './safeArea'

/**
 * The fallback only ever runs on a device iOS has lied to, which makes it
 * exactly the code least likely to be exercised by hand — hence a table test
 * against real screen sizes.
 */

describe('fallbackTopInset', () => {
  it('clears the Dynamic Island on the phones that have one', () => {
    // 14 Pro, 16 Pro, 15/16 Plus and Pro Max.
    for (const height of [852, 874, 932, 956]) {
      expect(fallbackTopInset(height)).toBe(59)
    }
  })

  it('clears the notch on the phones that have one', () => {
    // X/XS/11 Pro (812), 12/13/14 (844), XR/11/XS Max (896), 12/13 Pro Max (926).
    for (const height of [812, 844, 896, 926]) {
      expect(fallbackTopInset(height)).toBe(47)
    }
  })

  /*
    The case the exact list exists for: 896 and 926 are TALLER than the 852 and
    874 Dynamic Island phones, so any "taller than X means Island" rule gets
    these two wrong and over-pads a notch device by 12px.
  */
  it('does not mistake a tall notch phone for a Dynamic Island one', () => {
    expect(fallbackTopInset(896)).toBe(47)
    expect(fallbackTopInset(926)).toBe(47)
  })

  it('gives a home-button phone an ordinary status bar', () => {
    for (const height of [568, 667, 736]) {
      expect(fallbackTopInset(height)).toBe(20)
    }
  })

  it('handles an unknown or missing height without returning nonsense', () => {
    expect(fallbackTopInset(0)).toBe(20)
    // A future phone taller than anything listed should still clear a notch
    // rather than fall through to 20.
    expect(fallbackTopInset(1100)).toBe(47)
  })
})

describe('fallbackBottomInset', () => {
  it('leaves room for the home indicator where there is one', () => {
    expect(fallbackBottomInset(852)).toBe(34)
    expect(fallbackBottomInset(812)).toBe(34)
  })

  it('leaves none on a phone with a home button', () => {
    expect(fallbackBottomInset(667)).toBe(0)
  })
})

describe('needsFallback', () => {
  it('substitutes for an installed iOS app reporting zero', () => {
    expect(needsFallback({ ios: true, standalone: true, measuredTop: 0 })).toBe(true)
  })

  it('trusts a non-zero value even on iOS', () => {
    expect(needsFallback({ ios: true, standalone: true, measuredTop: 59 })).toBe(false)
  })

  /*
    The important negative. In a Safari TAB the browser chrome already sits
    above the page, so zero is the correct answer — padding it would leave a
    band of dead space under the address bar on every screen.
  */
  it('leaves a Safari tab alone', () => {
    expect(needsFallback({ ios: true, standalone: false, measuredTop: 0 })).toBe(false)
  })

  it('leaves Android and desktop alone', () => {
    expect(needsFallback({ ios: false, standalone: true, measuredTop: 0 })).toBe(false)
    expect(needsFallback({ ios: false, standalone: false, measuredTop: 0 })).toBe(false)
  })
})
