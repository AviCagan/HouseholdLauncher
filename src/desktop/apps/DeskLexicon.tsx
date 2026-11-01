import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import type { LexiconEntry } from '@/data/types'
import { EntrySheet, Reading, type SheetMode } from '@/apps/encyclopedia/EntrySheet'
import { removeEntry } from '@/apps/encyclopedia/actions'
import { ALPHABET, POS_ABBR, groupByLetter, initialOf, searchEntries, volumeLine, wordOfTheDay } from '@/apps/encyclopedia/lexicon'
import { useKeys } from '../keys'
import { Kbd } from '../ui'
import { useDeepLink } from '../useDeepLink'
import '@/apps/encyclopedia/encyclopedia.css'

/**
 * The A&J Encyclopedia on a laptop, laid out like a dictionary app: the
 * alphabet down the edge, the headwords in a column beside it, and the chosen
 * entry set in full on the facing page.
 *
 * The phone opens each entry over the list; here the list stays put and the
 * page changes as you move through it, which is how a dictionary is actually
 * browsed — one word leads to the next. Writing and revising use the phone's
 * own form, as a dialog.
 */
export function DeskLexicon() {
  const entries = useData((s) => s.lexicon_entries)
  const profiles = useData((s) => s.profiles)
  const profileId = useProfile((s) => s.profileId)

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ entry: LexiconEntry | null; mode: SheetMode; draftTerm?: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim()
  const shown = useMemo(() => (q ? searchEntries(entries, q) : entries), [entries, q])
  const groups = useMemo(() => groupByLetter(shown), [shown])
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups])
  const present = useMemo(() => new Set(entries.map((e) => initialOf(e.term))), [entries])
  const today = useMemo(() => wordOfTheDay(entries, new Date()), [entries])

  const selected = entries.find((e) => e.id === selectedId) ?? null
  const page = selected ?? (q ? flat[0] ?? null : today)
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? 'Someone'

  useEffect(() => setConfirmDelete(false), [page?.id])
  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector(`[data-entry="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // A word just written becomes the open page, so you see it as it will read.
  const known = useRef<Set<string>>(new Set(entries.map((e) => e.id)))
  useEffect(() => {
    const fresh = entries.filter((e) => !known.current.has(e.id) && e.created_by === profileId)
    known.current = new Set(entries.map((e) => e.id))
    if (fresh.length === 1) setSelectedId(fresh[0].id)
  }, [entries, profileId])

  const define = (term = '') => setSheet({ entry: null, mode: 'edit', draftTerm: term || undefined })
  const revise = (entry: LexiconEntry) => setSheet({ entry, mode: 'edit' })

  function move(by: 1 | -1) {
    if (flat.length === 0) return
    const i = page ? flat.findIndex((e) => e.id === page.id) : -1
    const next = flat[Math.min(flat.length - 1, Math.max(0, i < 0 ? 0 : i + by))]
    setSelectedId(next.id)
  }

  function remove() {
    if (!page) return
    if (!confirmDelete) {
      fire('warning')
      setConfirmDelete(true)
      return
    }
    const i = flat.findIndex((e) => e.id === page.id)
    removeEntry(page)
    setSelectedId(flat[i + 1]?.id ?? flat[i - 1]?.id ?? null)
  }

  function jump(letter: string) {
    const first = groups.find((g) => g.letter === letter)?.entries[0]
    if (!first) return
    setSelectedId(first.id)
    listRef.current?.querySelector(`[data-letter="${letter}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useKeys([
    { keys: ['j', 'arrowdown'], run: () => move(1), label: 'Next word', group: 'Encyclopedia' },
    { keys: ['k', 'arrowup'], run: () => move(-1), label: 'Previous word', group: 'Encyclopedia' },
    { keys: '/', run: () => searchRef.current?.focus(), label: 'Look up a word', group: 'Encyclopedia' },
    { keys: 'n', run: () => define(), label: 'Write a new entry', group: 'Encyclopedia' },
    { keys: ['e', 'enter'], run: () => page && revise(page), label: 'Revise this entry', group: 'Encyclopedia' },
    { keys: ['delete', 'backspace'], run: remove, label: 'Remove (press again to confirm)', group: 'Encyclopedia' },
    { keys: 'escape', run: () => setConfirmDelete(false) },
  ])

  useDeepLink('encyclopedia', (link) => {
    if (typeof link.id === 'string' && entries.some((e) => e.id === link.id)) {
      setQuery('')
      setSelectedId(link.id)
    }
    if (typeof link.define === 'string') {
      const existing = entries.find((e) => e.term.trim().toLowerCase() === (link.define as string).trim().toLowerCase())
      if (existing) setSelectedId(existing.id)
      else define(link.define)
    }
  })

  return (
    <div className="lex flex h-full flex-col">
      <header className="shrink-0 px-8 pb-3 pt-6">
        <div className="flex items-end gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="lex-serif text-[30px] font-bold leading-none tracking-tight">
              A<span style={{ color: 'var(--lex-ox)' }}>&amp;</span>J Encyclopedia
            </h1>
            <p className="lex-caps mt-2">{volumeLine(entries.length)}</p>
          </div>
          <div className="relative w-[320px]">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  e.currentTarget.blur()
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (flat.length === 0 && q) define(q)
                  else e.currentTarget.blur()
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  e.currentTarget.blur()
                  move(1)
                }
              }}
              placeholder="Look up a word…"
              aria-label="Look up a word"
              spellCheck={false}
              className="lex-input pr-14"
            />
            <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2">
              <Kbd combo="/" />
            </span>
          </div>
          <button onClick={() => define()} className="lex-stamp flex shrink-0 items-center gap-2 px-5 py-2.5 text-[14.5px]" title="Write a new entry (N)">
            <span aria-hidden>✒︎</span> Add an entry
          </button>
        </div>
        <div className="lex-rule-double mt-3" />
      </header>

      {entries.length === 0 ? (
        <div className="grid flex-1 place-items-center px-8">
          <div className="lex-page flex max-w-[460px] flex-col items-center gap-3 px-8 py-12 text-center">
            <span className="lex-ornament text-[18px]" aria-hidden>
              ❦
            </span>
            <span className="lex-serif text-[24px] font-bold">This volume is empty.</span>
            <p className="text-[15px] italic leading-snug" style={{ color: 'var(--lex-ink-dim)' }}>
              Every word in it will be one of yours — the ones only the two of you understand. The first entry is waiting to be defined.
            </p>
            <button onClick={() => define()} className="lex-outline mt-2 px-5 py-2.5 text-[14.5px]">
              Write the first entry
            </button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[40px_minmax(280px,360px)_1fr] gap-0 px-6 pb-6">
          <nav className="desk-scroll flex flex-col items-center overflow-y-auto py-2" aria-label="Index">
            {[...ALPHABET, '#'].map((letter) => {
              const has = present.has(letter)
              return (
                <button
                  key={letter}
                  onClick={() => has && jump(letter)}
                  disabled={!has}
                  aria-label={has ? `Jump to ${letter}` : undefined}
                  className="lex-serif w-full py-[3px] text-center text-[13px]"
                  style={{ color: has ? 'var(--lex-ink)' : 'var(--lex-ink-faint)', fontWeight: has ? 700 : 400, opacity: has ? 1 : 0.45 }}
                >
                  {letter}
                </button>
              )
            })}
          </nav>

          <div ref={listRef} className="desk-scroll min-h-0 overflow-y-auto pr-4" style={{ borderRight: '1px solid var(--lex-rule)' }}>
            {q && flat.length === 0 && (
              <div className="pt-8 text-center">
                <p className="text-[15px] italic" style={{ color: 'var(--lex-ink-dim)' }}>
                  No entry for “{q}”.
                </p>
                <button onClick={() => define(q)} className="lex-outline mt-3 px-4 py-2 text-[14px]">
                  Define “{q}”
                </button>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.letter} data-letter={g.letter} className="pt-3">
                <div className="flex items-end gap-2" style={{ borderBottom: '1px solid var(--lex-rule-strong)' }}>
                  <span className="lex-dropcap pb-0.5 !text-[30px]">{g.letter}</span>
                  <span className="lex-caps pb-1.5">{g.entries.length}</span>
                </div>
                {g.entries.map((entry) => {
                  const on = page?.id === entry.id
                  return (
                    <button
                      key={entry.id}
                      data-entry={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      onDoubleClick={() => revise(entry)}
                      aria-current={on ? 'true' : undefined}
                      className="block w-full rounded-md px-2 py-2 text-left"
                      style={{
                        borderBottom: '1px dotted var(--lex-rule)',
                        background: on ? 'var(--lex-ox-soft)' : 'transparent',
                      }}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="lex-headword text-[16.5px]">{entry.term}</span>
                        {POS_ABBR[entry.part_of_speech] && <span className="lex-pos text-[12.5px]">{POS_ABBR[entry.part_of_speech]}</span>}
                      </span>
                      <span className="block truncate text-[13.5px]" style={{ color: 'var(--lex-ink-dim)' }}>
                        {entry.definition}
                      </span>
                    </button>
                  )
                })}
              </section>
            ))}
          </div>

          <div className="desk-scroll min-h-0 overflow-y-auto pl-8 pt-2">
            <AnimatePresence mode="wait" initial={false}>
              {page && (
                <motion.article
                  key={page.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="lex-page max-w-[720px] px-10 py-8"
                >
                  {!selected && !q && today?.id === page.id && <p className="lex-caps pb-3">Word of the day</p>}
                  <Reading entry={page} nameOf={nameOf} onEdit={() => revise(page)} onDelete={remove} confirmDelete={confirmDelete} />
                  <p className="pt-5 text-[12px] italic" style={{ color: 'var(--lex-ink-faint)' }}>
                    ↑ ↓ to turn the page · E to revise · N for a new word
                  </p>
                </motion.article>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <EntrySheet
        open={sheet !== null}
        entry={sheet?.entry ?? null}
        mode={sheet?.mode ?? 'view'}
        draftTerm={sheet?.draftTerm}
        nameOf={nameOf}
        onEdit={() => setSheet((s) => (s ? { ...s, mode: 'edit' } : s))}
        onClose={() => setSheet(null)}
      />
    </div>
  )
}
