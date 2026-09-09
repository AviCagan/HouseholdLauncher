import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useLauncher } from '@/store/useLauncher'
import { fire } from '@/lib/haptics'
import type { LexiconEntry } from '@/data/types'
import { EntrySheet, type SheetMode } from './EntrySheet'
import {
  ALPHABET,
  POS_ABBR,
  formatPronunciation,
  groupByLetter,
  initialOf,
  searchEntries,
  volumeLine,
  wordOfTheDay,
} from './lexicon'
import './encyclopedia.css'

/**
 * A&J Encyclopedia.
 *
 * A dictionary of the words only the two of them use, laid out like the real
 * thing: a title page, a running head, an alphabet down the side, drop-cap
 * letters between the sections, and every entry with its part of speech and
 * pronunciation. It starts empty. The empty page is the invitation.
 *
 * Styled under `.lex` — see encyclopedia.css for the reasoning.
 */
export function EncyclopediaApp() {
  const entries = useData((s) => s.lexicon_entries)
  const profiles = useData((s) => s.profiles)
  const goHome = useLauncher((s) => s.goHome)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)

  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState<{ entry: LexiconEntry | null; mode: SheetMode; draftTerm?: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // A notification tap lands on the entry it announced, if it still exists.
  useEffect(() => {
    const link = consumeDeepLink()
    const id = typeof link?.id === 'string' ? link.id : null
    if (!id) return
    const entry = entries.find((e) => e.id === id)
    if (entry) setSheet({ entry, mode: 'view' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeDeepLink])

  const q = query.trim()
  const shown = useMemo(() => (q ? searchEntries(entries, q) : entries), [entries, q])
  const groups = useMemo(() => groupByLetter(shown), [shown])
  const present = useMemo(() => new Set(entries.map((e) => initialOf(e.term))), [entries])
  const today = useMemo(() => wordOfTheDay(entries, new Date()), [entries])

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? 'Someone'
  const open = (entry: LexiconEntry) => {
    fire('tap')
    setSheet({ entry, mode: 'view' })
  }
  const define = (term = '') => {
    fire('tap')
    setSheet({ entry: null, mode: 'edit', draftTerm: term || undefined })
  }

  function jump(letter: string) {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`)
    if (!el) return
    fire('snap')
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="lex flex h-full flex-col">
      <header className="shrink-0 px-5 pb-3 pt-[max(var(--safe-top),0.75rem)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              fire('tap')
              goHome()
            }}
            aria-label="Back to the launcher"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
            style={{ border: '1px solid var(--lex-rule-strong)', color: 'var(--lex-ink)' }}
          >
            <Icon name="back" size={19} strokeWidth={2.2} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="lex-serif text-[25px] font-bold leading-none tracking-tight">
              A<span style={{ color: 'var(--lex-ox)' }}>&amp;</span>J Encyclopedia
            </h1>
            <p className="lex-caps mt-1.5">{volumeLine(entries.length)}</p>
          </div>
        </div>

        <div className="lex-rule-double mt-3" />

        <div className="relative mt-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Look up a word…"
            aria-label="Look up a word"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="lex-input pr-9"
          />
          {query && (
            <button
              onClick={() => {
                fire('tap')
                setQuery('')
              }}
              aria-label="Clear search"
              className="absolute right-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center"
              style={{ color: 'var(--lex-ink-faint)' }}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>

        {entries.length > 0 && (
          <div className="scroll-x -mx-5 mt-2 flex gap-0.5 px-5" aria-label="Index">
            {[...ALPHABET, '#'].map((letter) => {
              const has = present.has(letter)
              return (
                <button
                  key={letter}
                  onClick={() => has && jump(letter)}
                  disabled={!has}
                  aria-label={has ? `Jump to ${letter}` : undefined}
                  className="lex-serif min-w-[24px] shrink-0 py-1 text-center text-[13px]"
                  style={{ color: has ? 'var(--lex-ink)' : 'var(--lex-ink-faint)', fontWeight: has ? 700 : 400, opacity: has ? 1 : 0.5 }}
                >
                  {letter}
                </button>
              )
            })}
          </div>
        )}
      </header>

      <div ref={listRef} className="scroll-y min-h-0 flex-1 px-5 pb-[140px]">
        {entries.length === 0 ? (
          <EmptyVolume onAdd={() => define()} />
        ) : (
          <>
            {!q && today && <WordOfTheDay entry={today} onOpen={() => open(today)} />}

            {q && groups.length === 0 && (
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
              <section key={g.letter} data-letter={g.letter} className="pt-5">
                <motion.div
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-end gap-3"
                  style={{ borderBottom: '1px solid var(--lex-rule-strong)' }}
                >
                  <span className="lex-dropcap pb-1">{g.letter}</span>
                  <span className="lex-caps pb-2">
                    {g.entries.length} {g.entries.length === 1 ? 'entry' : 'entries'}
                  </span>
                </motion.div>
                <AnimatePresence initial={false}>
                  {g.entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} onOpen={() => open(entry)} />
                  ))}
                </AnimatePresence>
              </section>
            ))}

            {!q && (
              <p className="lex-ornament pt-8 text-center text-[14px]" aria-hidden>
                ❦
              </p>
            )}
          </>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-5 pb-[max(var(--safe-bottom),1rem)]">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => define()}
          className="lex-stamp pointer-events-auto flex items-center gap-2 px-6 py-3.5 text-[15px]"
        >
          <span aria-hidden>✒︎</span>
          Add an entry
        </motion.button>
      </div>

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

/** One entry, typeset the way the book would. */
function EntryRow({ entry, onOpen }: { entry: LexiconEntry; onOpen: () => void }) {
  const pron = formatPronunciation(entry.pronunciation)
  const abbr = POS_ABBR[entry.part_of_speech]
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onClick={onOpen}
      className="block w-full py-3 text-left"
      style={{ borderBottom: '1px dotted var(--lex-rule)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="lex-headword text-[18px]">{entry.term}</span>
        {pron && <span className="lex-pron text-[13.5px]">{pron}</span>}
        {abbr && <span className="lex-pos text-[13.5px]">{abbr}</span>}
      </div>
      <p className="mt-0.5 text-[15px] leading-snug">{entry.definition}</p>
      {entry.example && (
        <p className="mt-1 text-[13.5px] italic leading-snug" style={{ color: 'var(--lex-ink-dim)' }}>
          “{entry.example}”
        </p>
      )}
    </motion.button>
  )
}

function WordOfTheDay({ entry, onOpen }: { entry: LexiconEntry; onOpen: () => void }) {
  const abbr = POS_ABBR[entry.part_of_speech]
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onOpen}
      className="lex-page mt-4 block w-full px-4 py-3.5 text-left"
    >
      <span className="lex-caps">Word of the day</span>
      <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="lex-headword text-[22px]">{entry.term}</span>
        {abbr && <span className="lex-pos text-[14px]">{abbr}</span>}
      </span>
      <span className="mt-1 block text-[14.5px] leading-snug" style={{ color: 'var(--lex-ink-dim)' }}>
        {entry.definition}
      </span>
    </motion.button>
  )
}

function EmptyVolume({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="lex-page mt-6 flex flex-col items-center gap-3 px-6 py-10 text-center"
    >
      <span className="lex-ornament text-[18px]" aria-hidden>
        ❦
      </span>
      <span className="lex-serif text-[21px] font-bold">This volume is empty.</span>
      <p className="max-w-[260px] text-[14.5px] italic leading-snug" style={{ color: 'var(--lex-ink-dim)' }}>
        Every word in it will be one of yours — the ones only the two of you understand. The first entry is waiting to be
        defined.
      </p>
      <button onClick={onAdd} className="lex-outline mt-2 px-5 py-2.5 text-[14.5px]">
        Write the first entry
      </button>
    </motion.div>
  )
}
