import { describe, expect, it } from 'vitest'
import { comboKeys, comboLabel, normKey, parseCombo, stepMatches, type KeyLike } from './keys'

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('parseCombo', () => {
  it('reads modifiers and a key', () => {
    expect(parseCombo('mod+k')).toEqual([{ key: 'k', mod: true, alt: false, shift: false }])
  })

  it('splits a two-key sequence', () => {
    expect(parseCombo('g t').map((s) => s.key)).toEqual(['g', 't'])
  })

  it('accepts aliases and the plus key itself', () => {
    expect(parseCombo('esc')[0].key).toBe('escape')
    expect(parseCombo('mod++')[0]).toMatchObject({ key: '+', mod: true })
  })
})

describe('stepMatches', () => {
  const [x] = parseCombo('x')
  const [shiftX] = parseCombo('shift+x')
  const [modK] = parseCombo('mod+k')
  const [question] = parseCombo('?')
  const [enter] = parseCombo('enter')

  it('matches a plain letter, case-insensitively', () => {
    expect(stepMatches(x, press('x'))).toBe(true)
  })

  it('keeps shift meaningful for letters', () => {
    expect(stepMatches(x, press('X', { shiftKey: true }))).toBe(false)
    expect(stepMatches(shiftX, press('X', { shiftKey: true }))).toBe(true)
  })

  it('never fires a plain letter under a browser chord', () => {
    expect(stepMatches(x, press('x', { ctrlKey: true }))).toBe(false)
    expect(stepMatches(x, press('x', { metaKey: true }))).toBe(false)
    expect(stepMatches(x, press('x', { altKey: true }))).toBe(false)
  })

  it('takes ⌘ or Ctrl for mod, on any machine', () => {
    expect(stepMatches(modK, press('k', { metaKey: true }))).toBe(true)
    expect(stepMatches(modK, press('k', { ctrlKey: true }))).toBe(true)
    expect(stepMatches(modK, press('k'))).toBe(false)
  })

  it('ignores shift for a symbol it takes shift to type', () => {
    expect(stepMatches(question, press('?', { shiftKey: true }))).toBe(true)
  })

  it('keeps shift meaningful for named keys', () => {
    expect(stepMatches(enter, press('Enter'))).toBe(true)
    expect(stepMatches(enter, press('Enter', { shiftKey: true }))).toBe(false)
  })
})

describe('display', () => {
  it('normalises the names browsers give keys', () => {
    expect(normKey(' ')).toBe('space')
    expect(normKey('ArrowDown')).toBe('arrowdown')
    expect(normKey('Esc')).toBe('escape')
  })

  it('draws mod as ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(comboKeys('mod+k', true)).toEqual([['⌘', 'K']])
    expect(comboKeys('mod+k', false)).toEqual([['Ctrl', 'K']])
  })

  it('says a sequence the way it is typed', () => {
    expect(comboLabel('g t', false)).toBe('G then T')
    expect(comboLabel('arrowdown', false)).toBe('↓')
  })
})
