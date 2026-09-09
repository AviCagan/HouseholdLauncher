import { useEffect, useState } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { useProfile } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { PARTS_OF_SPEECH, type LexiconEntry, type PartOfSpeech } from '@/data/types'
import { addEntry, removeEntry, updateEntry, type EntryInput } from './actions'
import { POS_ABBR, POS_LABEL, citation, formatPronunciation } from './lexicon'

export type SheetMode = 'view' | 'edit'

/**
 * One entry, on its own page.
 *
 * Two faces: the entry typeset as it will read, and the form that writes it.
 * They are one sheet rather than two so that "fix the example" is a single
 * tap from reading it, and so a new word is previewed in the same type it
 * will be printed in.
 */
export function EntrySheet({
  open,
  entry,
  mode,
  draftTerm,
  nameOf,
  onEdit,
  onClose,
}: {
  open: boolean
  entry: LexiconEntry | null
  mode: SheetMode
  /** What was searched for and not found — the new entry starts with it. */
  draftTerm?: string
  nameOf: (id: string) => string
  onEdit: () => void
  onClose: () => void
}) {
  const profileId = useProfile((s) => s.profileId)
  const [term, setTerm] = useState('')
  const [pronunciation, setPronunciation] = useState('')
  const [pos, setPos] = useState<PartOfSpeech>('noun')
  const [definition, setDefinition] = useState('')
  const [example, setExample] = useState('')
  const [origin, setOrigin] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTerm(entry?.term ?? draftTerm ?? '')
    setPronunciation(entry?.pronunciation ?? '')
    setPos(entry?.part_of_speech ?? 'noun')
    setDefinition(entry?.definition ?? '')
    setExample(entry?.example ?? '')
    setOrigin(entry?.origin ?? '')
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id, mode])

  const valid = term.trim().length > 0 && definition.trim().length > 0

  async function save() {
    if (!valid || busy) return
    setBusy(true)
    const input: EntryInput = {
      term,
      pronunciation: pronunciation || null,
      part_of_speech: pos,
      definition,
      example: example || null,
      origin: origin || null,
    }
    const ok = entry ? await updateEntry(entry, input, profileId) : Boolean(await addEntry(input, profileId))
    setBusy(false)
    if (ok) onClose()
  }

  async function remove() {
    if (!entry) return
    if (!confirmDelete) {
      fire('warning')
      setConfirmDelete(true)
      return
    }
    await removeEntry(entry)
    onClose()
  }

  const title =
    mode === 'view' && entry ? (
      <span className="lex-serif text-[17px] font-bold">{entry.term}</span>
    ) : (
      <span className="lex-serif text-[17px] font-bold">{entry ? 'Revise the entry' : 'A new entry'}</span>
    )

  return (
    <Sheet open={open} onClose={onClose} title={title} height={mode === 'edit' ? '92vh' : undefined}>
      <div className="lex -mx-5 -mb-8 px-5 pb-10 pt-1" style={{ backgroundImage: 'none', background: 'var(--lex-page)' }}>
        {mode === 'view' && entry ? (
          <Reading entry={entry} nameOf={nameOf} onEdit={onEdit} onDelete={() => void remove()} confirmDelete={confirmDelete} />
        ) : (
          <div className="flex flex-col gap-5">
            <Field label="Headword">
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="schlumpy"
                aria-label="Headword"
                autoCapitalize="off"
                autoFocus={!entry}
                className="lex-input lex-headword text-[20px]"
              />
            </Field>

            <div className="grid grid-cols-[1fr_auto] gap-4">
              <Field label="Pronunciation" hint="Optional. However you'd say it out loud.">
                <input
                  value={pronunciation}
                  onChange={(e) => setPronunciation(e.target.value)}
                  placeholder="SHLUM-pee"
                  aria-label="Pronunciation"
                  autoCapitalize="off"
                  className="lex-input"
                />
              </Field>
            </div>

            <Field label="Part of speech">
              <div className="scroll-x -mx-5 flex gap-1.5 px-5 pb-1">
                {PARTS_OF_SPEECH.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      fire('snap')
                      setPos(p)
                    }}
                    data-on={pos === p}
                    className="lex-chip"
                  >
                    {POS_LABEL[p]}
                    {POS_ABBR[p] && (
                      <span className="ml-1 opacity-60">{POS_ABBR[p]}</span>
                    )}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Definition">
              <textarea
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                rows={3}
                placeholder="Looking as though one has been rained on, emotionally."
                aria-label="Definition"
                className="lex-input resize-none leading-snug"
              />
            </Field>

            <Field label="In a sentence" hint="Optional.">
              <textarea
                value={example}
                onChange={(e) => setExample(e.target.value)}
                rows={2}
                placeholder="You've gone all schlumpy since the call."
                aria-label="In a sentence"
                className="lex-input resize-none italic leading-snug"
              />
            </Field>

            <Field label="Origin" hint="Optional. Where it came from — usually a story.">
              <textarea
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                rows={2}
                placeholder="Coined by Jackie, March 2024, after the incident with the soup."
                aria-label="Origin"
                className="lex-input resize-none leading-snug"
              />
            </Field>

            {term.trim() && definition.trim() && (
              <div className="lex-page px-4 py-3">
                <span className="lex-caps">As it will read</span>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="lex-headword text-[18px]">{term.trim()}</span>
                  {formatPronunciation(pronunciation) && (
                    <span className="lex-pron text-[13.5px]">{formatPronunciation(pronunciation)}</span>
                  )}
                  {POS_ABBR[pos] && <span className="lex-pos text-[13.5px]">{POS_ABBR[pos]}</span>}
                </div>
                <p className="mt-0.5 text-[15px] leading-snug">{definition.trim()}</p>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button onClick={() => void save()} disabled={!valid || busy} className="lex-stamp w-full py-3.5 text-[15px]">
                {busy ? 'Saving…' : entry ? 'Save the revision' : 'Add to the encyclopedia'}
              </button>
              {entry && (
                <button
                  onClick={() => void remove()}
                  className="lex-outline w-full py-3 text-[14px]"
                  style={confirmDelete ? { background: 'var(--lex-ox)', borderColor: 'var(--lex-ox)', color: '#fff' } : undefined}
                >
                  {confirmDelete ? 'Yes, strike it from the record' : 'Remove this entry'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function Reading({
  entry,
  nameOf,
  onEdit,
  onDelete,
  confirmDelete,
}: {
  entry: LexiconEntry
  nameOf: (id: string) => string
  onEdit: () => void
  onDelete: () => void
  confirmDelete: boolean
}) {
  const pron = formatPronunciation(entry.pronunciation)
  const abbr = POS_ABBR[entry.part_of_speech]
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="lex-headword text-[30px] leading-tight">{entry.term}</span>
          {pron && <span className="lex-pron text-[15px]">{pron}</span>}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          {abbr && <span className="lex-pos text-[15px]">{abbr}</span>}
          <span className="lex-caps">{POS_LABEL[entry.part_of_speech]}</span>
        </div>
      </div>

      <div className="lex-rule-double" />

      <p className="text-[17px] leading-relaxed">{entry.definition}</p>

      {entry.example && (
        <p className="text-[15.5px] italic leading-relaxed" style={{ color: 'var(--lex-ink-dim)' }}>
          “{entry.example}”
        </p>
      )}

      {entry.origin && (
        <div>
          <span className="lex-caps">Origin</span>
          <p className="mt-0.5 text-[15px] leading-relaxed">{entry.origin}</p>
        </div>
      )}

      <p className="text-[12.5px] italic" style={{ color: 'var(--lex-ink-faint)' }}>
        {citation(entry, nameOf)}
      </p>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => {
            fire('tap')
            onEdit()
          }}
          className="lex-outline flex-1 py-3 text-[14.5px]"
        >
          Revise
        </button>
        <button
          onClick={onDelete}
          className="lex-outline flex-1 py-3 text-[14.5px]"
          style={confirmDelete ? { background: 'var(--lex-ox)', borderColor: 'var(--lex-ox)', color: '#fff' } : undefined}
        >
          {confirmDelete ? 'Yes, strike it' : 'Remove'}
        </button>
      </div>
    </div>
  )
}

/**
 * A div, not a <label>: a button is a labelable element, so a label wrapped
 * around the part-of-speech chips would quietly become the accessible name of
 * the first chip. Each control names itself instead.
 */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="lex-caps">{label}</span>
      {children}
      {hint && (
        <span className="text-[12px] italic" style={{ color: 'var(--lex-ink-faint)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}
