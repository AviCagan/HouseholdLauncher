import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { fire } from '@/lib/haptics'
import { importFromText, importFromUrl, type ImportedRecipe } from '@/lib/recipe'
import { isUrl } from '@/lib/unfurl'
import { WhiskSpinner } from './doodles'
import { toast } from 'sonner'
import { useProfile } from '@/store/useProfile'
import { addDish } from './actions'
import { draftFromImport, guessEmoji, hasNutrition } from './nutrition'
import { SHELF_TAG, linkOnly } from './shelf'
import { useMealsUI } from './store'
import { BigButton, Field, POP, Stat, TextArea, TextInput } from './ui'

/**
 * Paste a link, get a dish.
 *
 * The preview step exists so what the page said can be seen before it is
 * saved. A recipe card read from JSON-LD is usually right; a caption sorted
 * by heuristics is usually *nearly* right, and the banner says which of the
 * two happened so the person knows how hard to look.
 *
 * Instagram is the awkward one. A public post normally serves its caption in
 * the page's own metadata, which is enough. When it decides to serve a login
 * wall instead, there is nothing a server can do about it — so the sheet
 * turns into a box to paste the caption into, which is the same parser run on
 * text you copied yourself.
 */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openSheet = useMealsUI((s) => s.openSheet)
  const profileId = useProfile((s) => s.profileId)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'link' | 'text'>('link')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportedRecipe | null>(null)

  const reset = () => {
    setUrl('')
    setText('')
    setMode('link')
    setBusy(false)
    setError(null)
    setResult(null)
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText()
      if (isUrl(clip)) {
        fire('snap')
        setUrl(clip.trim())
      }
    } catch {
      // No clipboard permission — the field is right there to type into.
    }
  }

  async function run() {
    if (busy) return
    setError(null)
    setResult(null)
    setBusy(true)
    fire('tap')
    const res = mode === 'link' ? await importFromUrl(url) : await importFromText(text)
    setBusy(false)

    if (!res.ok) {
      fire('error')
      /*
        A 4xx from the site itself is almost always a bot block — Allrecipes
        and its stablemates refuse any fetch that isn't a browser — and there
        is nothing a server can do about that. The recipe is still right there
        on the person's screen, so the honest next step is the paste box, and
        the sheet moves them to it rather than leaving a dead end.
      */
      const blocked = mode === 'link' && /answered 4\d\d/.test(res.error)
      setError(
        blocked
          ? `${res.error} — that site blocks automated readers. Copy the recipe text from the page and paste it here instead.`
          : res.error,
      )
      if (blocked) setMode('text')
      return
    }
    const r = res.recipe
    if (r.problem === 'login-wall') {
      fire('warning')
      setMode('text')
      setError("Instagram wouldn't show us that post. Copy the caption from the app and paste it below.")
      return
    }
    if (r.problem === 'nothing-found') {
      fire('warning')
      setError(
        mode === 'link'
          ? "That page didn't have a recipe we could find. If it's in the caption or comments, paste the text instead."
          : "Couldn't find ingredients or steps in that. Try pasting just the recipe part.",
      )
      if (mode === 'link') setMode('text')
      return
    }
    fire('success')
    setResult(r)
  }

  function useIt() {
    if (!result) return
    const draft = draftFromImport(result, mode === 'link' ? url.trim() : null)
    const note =
      result.confidence === 'heuristic'
        ? 'Guessed from the text rather than a recipe card — worth a look at the amounts.'
        : undefined
    reset()
    openSheet({ kind: 'dish', dish: null, draft, note })
  }

  /*
    Onto the shelf as-is: everything the page gave up, tagged want-to-try, so
    it stays out of "my dishes" until it's actually been made. No form to fill
    in — the whole point is that it takes one tap to not lose it.
  */
  function saveForLater() {
    if (!result) return
    const draft = draftFromImport(result, mode === 'link' ? url.trim() : null)
    const name = draft.name || (url.trim() ? linkOnly(url.trim()).name : 'Recipe to try')
    const saved = addDish(
      { ...draft, name, emoji: guessEmoji(name, 'main'), kind: 'main', cost_cents: null, notes: null, tags: [SHELF_TAG] },
      profileId,
    )
    if (!saved) return
    toast.success(`⭐ ${saved.name} is on the shelf`)
    reset()
    onClose()
  }

  /** The link alone, for a page the reader couldn't get into. */
  function saveLink() {
    const u = url.trim()
    if (!isUrl(u)) return
    const saved = addDish(linkOnly(u), profileId)
    if (!saved) return
    toast.success('⭐ The link is on the shelf')
    reset()
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={<span className="m-title text-[18px]">Import a recipe</span>}
    >
      <div className="meals -mx-4 -mb-4 flex flex-col gap-4 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        <div className="flex gap-1.5">
          {(['link', 'text'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                fire('snap')
                setMode(m)
                setError(null)
                setResult(null)
              }}
              className="m-chip flex-1 justify-center !py-2"
              style={{
                background: mode === m ? 'var(--m-tomato)' : 'var(--m-card)',
                color: mode === m ? '#fff' : 'var(--m-ink)',
                borderColor: mode === m ? 'var(--m-tomato)' : 'var(--m-line)',
              }}
            >
              {m === 'link' ? '🔗 From a link' : '📋 Paste text'}
            </button>
          ))}
        </div>

        {mode === 'link' ? (
          <Field
            label="Link"
            hint="A recipe site, a food blog, or an Instagram post."
            right={
              <button onClick={() => void pasteFromClipboard()} className="text-[12px] font-extrabold" style={{ color: 'var(--m-tomato)' }}>
                Paste
              </button>
            }
          >
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </Field>
        ) : (
          <Field label="Recipe text" hint="The caption, the comment, the whole thing — it sorts ingredients from steps itself.">
            <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={'2 cups flour\n3 eggs\n…\nMix everything and bake at 180 for 30 minutes.'} />
          </Field>
        )}

        <AnimatePresence mode="wait">
          {busy && (
            <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid place-items-center gap-2 py-4">
              <WhiskSpinner />
              <span className="text-[13px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                Reading the recipe…
              </span>
            </motion.div>
          )}

          {!busy && error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="m-card-flat flex flex-col gap-2 px-3 py-2.5 text-[13px] font-semibold"
              style={{ background: 'var(--m-butter-soft)' }}
            >
              <span>{error}</span>
              {isUrl(url) && (
                <button onClick={saveLink} className="m-chip self-start" style={{ background: 'var(--m-card)' }}>
                  ⭐ Save the link for later anyway
                </button>
              )}
            </motion.div>
          )}

          {!busy && result && (
            <motion.div key="result" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={POP} className="m-card flex flex-col gap-3 overflow-hidden">
              {result.image && <img src={result.image} alt="" className="h-36 w-full object-cover" style={{ borderBottom: '2.5px solid var(--m-line)' }} />}
              <div className="flex flex-col gap-2 px-4 pb-4 pt-1">
                <span className="m-title text-[18px] leading-tight">{result.name || 'Untitled recipe'}</span>
                <div className="flex flex-wrap gap-1">
                  <Stat>{result.ingredients.length} ingredients</Stat>
                  <Stat tone="var(--m-mint-soft)">{result.steps.length} steps</Stat>
                  {result.servings && <Stat tone="var(--m-sky-soft)">serves {result.servings}</Stat>}
                  <Stat tone={hasNutrition(result.nutrition) ? 'var(--m-berry-soft)' : 'var(--m-card-2)'}>
                    {hasNutrition(result.nutrition) ? 'nutrition ✓' : 'no nutrition'}
                  </Stat>
                </div>
                <span className="text-[12px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                  {result.confidence === 'structured'
                    ? '✅ Read straight from the page’s recipe card.'
                    : '🔍 Sorted out of the text — check it before saving.'}
                </span>
                {result.ingredients.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-[13px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
                    {result.ingredients.slice(0, 5).map((line, i) => (
                      <li key={i} className="truncate">
                        • {line}
                      </li>
                    ))}
                    {result.ingredients.length > 5 && <li>… and {result.ingredients.length - 5} more</li>}
                  </ul>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {result ? (
          <div className="flex flex-col gap-2">
            <BigButton onClick={useIt}>Looks right — edit & save</BigButton>
            <BigButton onClick={saveForLater} tone="var(--m-butter)" ink="var(--m-ink)">
              ⭐ Save for later
            </BigButton>
          </div>
        ) : (
          <BigButton onClick={() => void run()} busy={busy} disabled={mode === 'link' ? !isUrl(url) : text.trim().length < 10}>
            {mode === 'link' ? 'Read the recipe' : 'Sort it out'}
          </BigButton>
        )}
      </div>
    </Sheet>
  )
}
