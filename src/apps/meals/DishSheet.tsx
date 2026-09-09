import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useProfile } from '@/store/useProfile'
import { formatPrice, parsePrice, priceToInput } from '@/lib/money'
import { openExternal } from '@/apps/things/routing/deeplink'
import { fire } from '@/lib/haptics'
import { DISH_KINDS, NUTRITION_KEYS, type Dish, type DishKind, type Ingredient, type Nutrition } from '@/data/types'
import { addDish, removeDish, updateDish, type DishInput } from './actions'
import { NUTRITION_LABEL, guessEmoji, ingredientCostSum } from './nutrition'
import { useMealsUI } from './store'
import { BigButton, Chip, EmojiPicker, Field, KIND_META, POP, Stepper, TextArea, TextInput } from './ui'

/**
 * One dish, to look at or to change.
 *
 * View and edit are the same screen: every field is live, and Save is what
 * commits. That is simpler than a read-only card with an Edit button, and
 * it matches how a recipe actually gets used — you glance at the steps while
 * cooking and fix the quantity you got wrong last time in the same breath.
 */
export function DishSheet({
  dish,
  draft,
  note,
  open,
  onClose,
  onSaved,
}: {
  dish: Dish | null
  draft?: Partial<DishInput>
  note?: string
  open: boolean
  onClose: () => void
  /** Told about the saved row — how a meal gets the dish it asked for. */
  onSaved?: (dish: Dish) => void
}) {
  const profileId = useProfile((s) => s.profileId)
  const celebrate = useMealsUI((s) => s.celebrate)

  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [emojiTouched, setEmojiTouched] = useState(false)
  const [kind, setKind] = useState<DishKind>('main')
  const [servings, setServings] = useState(4)
  const [cost, setCost] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [steps, setSteps] = useState<string[]>([])
  const [nutrition, setNutrition] = useState<Record<keyof Nutrition, string>>(blankNutrition())
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceKind, setSourceKind] = useState<Dish['source_kind']>('manual')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  /*
    Reloaded when the sheet opens for a different dish or draft — keyed on
    identity, not on the row object, so a realtime echo of an unrelated field
    can't wipe half-typed edits.
  */
  useEffect(() => {
    if (!open) return
    const src: Partial<DishInput> = dish ?? draft ?? {}
    setName(src.name ?? '')
    setEmoji(src.emoji ?? '')
    setEmojiTouched(Boolean(src.emoji))
    setKind(src.kind ?? 'main')
    setServings(src.servings ?? 4)
    setCost(priceToInput(src.cost_cents ?? null))
    setIngredients(src.ingredients?.length ? src.ingredients : [blankIngredient()])
    setSteps(src.steps?.length ? src.steps : [''])
    setNutrition(nutritionToInputs(src.nutrition ?? {}))
    setSourceUrl(src.source_url ?? null)
    setSourceKind(src.source_kind ?? 'manual')
    setImageUrl(src.image_url ?? null)
    setNotes(src.notes ?? '')
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dish?.id, draft])

  // Guess an emoji from the name until someone picks one on purpose.
  useEffect(() => {
    if (!emojiTouched && name.trim()) setEmoji(guessEmoji(name, kind))
  }, [name, kind, emojiTouched])

  const costCents = parsePrice(cost)
  const ingredientTotal = useMemo(() => ingredientCostSum(ingredients), [ingredients])
  const valid = name.trim().length > 0 && (cost.trim() === '' || costCents !== null)

  function collect(): DishInput {
    return {
      name,
      emoji: emoji || guessEmoji(name, kind),
      kind,
      servings,
      cost_cents: cost.trim() === '' ? null : costCents,
      ingredients: ingredients.filter((i) => i.name.trim()),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      nutrition: inputsToNutrition(nutrition),
      source_url: sourceUrl,
      source_kind: sourceKind,
      image_url: imageUrl,
      notes: notes.trim() || null,
    }
  }

  // Closes at once: the dish is in the store before the network is touched
  // (see actions.ts), so there is nothing to wait for.
  function save() {
    if (!valid) return
    const input = collect()
    const saved = dish ? updateDish(dish, input, profileId) : addDish(input, profileId)
    if (!saved) return
    if (!dish) celebrate()
    onSaved?.(saved)
    onClose()
  }

  async function remove() {
    if (!dish) return
    if (!confirmDelete) {
      fire('warning')
      setConfirmDelete(true)
      return
    }
    await removeDish(dish)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<span className="m-title text-[18px]">{dish ? 'Edit dish' : 'New dish'}</span>}
      height="92vh"
    >
      <div className="meals -mx-4 -mb-4 flex flex-col gap-5 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        {note && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="m-card-flat flex items-start gap-2 px-3 py-2.5 text-[13px] font-semibold"
            style={{ background: 'var(--m-butter-soft)' }}
          >
            <span className="text-[16px]">🔍</span>
            <span>{note}</span>
          </motion.div>
        )}

        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="h-40 w-full rounded-[20px] object-cover"
            style={{ border: '2.5px solid var(--m-line)', boxShadow: 'var(--m-shadow)' }}
            onError={() => setImageUrl(null)}
          />
        )}

        <EmojiPicker
          value={emoji}
          onChange={(e) => {
            setEmojiTouched(true)
            setEmoji(e)
          }}
        />

        <Field label="What is it">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grandma's brisket"
            autoFocus={!dish && !draft?.name}
          />
        </Field>

        <Field label="On the table as">
          <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1">
            {DISH_KINDS.map((k) => (
              <Chip key={k} active={kind === k} color={KIND_META[k].color} onClick={() => setKind(k)}>
                {KIND_META[k].emoji} {KIND_META[k].label}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Serves">
            <Stepper value={servings} onChange={setServings} />
          </Field>
          <Field
            label="Costs to make"
            hint={
              cost.trim() === '' && ingredientTotal != null
                ? `Ingredients add up to ${formatPrice(ingredientTotal)}`
                : undefined
            }
          >
            <TextInput
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              placeholder={ingredientTotal != null ? priceToInput(ingredientTotal) : '$'}
            />
          </Field>
        </div>

        <Field label="Ingredients" hint="Amount, then the thing. Cost is optional and per line.">
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {ingredients.map((ing, i) => (
                <motion.div
                  key={i}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12, height: 0 }}
                  transition={POP}
                  className="flex items-center gap-1.5"
                >
                  <TextInput
                    value={ing.amount ?? ''}
                    onChange={(e) => patchIngredient(i, { amount: e.target.value || null })}
                    placeholder="2 cups"
                    className="w-[92px] shrink-0 !py-2 !text-[13.5px]"
                  />
                  <TextInput
                    value={ing.name}
                    onChange={(e) => patchIngredient(i, { name: e.target.value })}
                    placeholder="flour"
                    className="min-w-0 flex-1 !py-2 !text-[13.5px]"
                  />
                  <TextInput
                    value={priceToInput(ing.cost_cents)}
                    onChange={(e) =>
                      patchIngredient(i, { cost_cents: e.target.value.trim() === '' ? null : parsePrice(e.target.value) })
                    }
                    inputMode="decimal"
                    placeholder="$"
                    className="w-[64px] shrink-0 !py-2 !text-[13.5px]"
                  />
                  <button
                    onClick={() => {
                      fire('delete')
                      setIngredients((list) => (list.length === 1 ? [blankIngredient()] : list.filter((_, j) => j !== i)))
                    }}
                    aria-label="Remove ingredient"
                    className="shrink-0 p-1"
                    style={{ color: 'var(--m-ink-faint)' }}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            <AddRowButton
              label="Add an ingredient"
              onClick={() => setIngredients((list) => [...list, blankIngredient()])}
            />
          </div>
        </Field>

        <Field label="How to make it">
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {steps.map((step, i) => (
                <motion.div
                  key={i}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12, height: 0 }}
                  transition={POP}
                  className="flex items-start gap-2"
                >
                  <span
                    className="mt-2 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-black"
                    style={{ background: 'var(--m-mint)', border: '2px solid var(--m-line)' }}
                  >
                    {i + 1}
                  </span>
                  <TextArea
                    value={step}
                    onChange={(e) => setSteps((list) => list.map((s, j) => (j === i ? e.target.value : s)))}
                    placeholder="Preheat the oven to 180°…"
                    rows={2}
                    className="min-w-0 flex-1 !py-2 !text-[13.5px]"
                  />
                  <button
                    onClick={() => {
                      fire('delete')
                      setSteps((list) => (list.length === 1 ? [''] : list.filter((_, j) => j !== i)))
                    }}
                    aria-label="Remove step"
                    className="mt-2 shrink-0 p-1"
                    style={{ color: 'var(--m-ink-faint)' }}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            <AddRowButton label="Add a step" onClick={() => setSteps((list) => [...list, ''])} />
          </div>
        </Field>

        <Field label="Nutrition, per serving" hint="Leave blank what you don't know — blanks stay blank in the totals.">
          <div className="grid grid-cols-3 gap-2">
            {NUTRITION_KEYS.map((key) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="px-0.5 text-[11px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                  {NUTRITION_LABEL[key].label}
                </span>
                <TextInput
                  value={nutrition[key]}
                  onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))}
                  inputMode="decimal"
                  placeholder={key === 'calories' ? 'kcal' : key === 'sodium_mg' ? 'mg' : 'g'}
                  className="!py-2 !text-[13.5px]"
                />
              </label>
            ))}
          </div>
        </Field>

        {sourceUrl && (
          <button
            onClick={() => {
              fire('tap')
              void openExternal(sourceUrl)
            }}
            className="m-card-flat flex items-center gap-2.5 px-3 py-2.5 text-left"
            style={{ background: 'var(--m-sky-soft)' }}
          >
            <span className="text-[18px]">{sourceKind === 'instagram' ? '📸' : '🔗'}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{sourceUrl}</span>
            <Icon name="arrowRight" size={15} />
          </button>
        )}

        <Field label="Notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Jackie likes it with extra lemon" />
        </Field>

        <div className="flex flex-col gap-2 pt-1">
          <BigButton onClick={() => void save()} disabled={!valid}>
            {dish ? 'Save changes' : 'Add to my dishes'}
          </BigButton>
          {dish && (
            <BigButton onClick={() => void remove()} tone={confirmDelete ? '#ff4d4d' : 'var(--m-card)'} ink={confirmDelete ? '#fff' : 'var(--m-ink)'}>
              {confirmDelete ? 'Yes, delete it' : 'Delete this dish'}
            </BigButton>
          )}
        </div>
      </div>
    </Sheet>
  )

  function patchIngredient(i: number, patch: Partial<Ingredient>) {
    setIngredients((list) => list.map((ing, j) => (j === i ? { ...ing, ...patch } : ing)))
  }
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        fire('tap')
        onClick()
      }}
      className="m-chip self-start"
      style={{ background: 'var(--m-card-2)', borderStyle: 'dashed' }}
    >
      <Icon name="plus" size={13} strokeWidth={3} /> {label}
    </motion.button>
  )
}

const blankIngredient = (): Ingredient => ({ name: '', amount: null, cost_cents: null })

const blankNutrition = (): Record<keyof Nutrition, string> =>
  Object.fromEntries(NUTRITION_KEYS.map((k) => [k, ''])) as Record<keyof Nutrition, string>

function nutritionToInputs(n: Nutrition): Record<keyof Nutrition, string> {
  const out = blankNutrition()
  for (const k of NUTRITION_KEYS) {
    const v = n[k]
    if (v != null && Number.isFinite(v)) out[k] = String(v)
  }
  return out
}

function inputsToNutrition(inputs: Record<keyof Nutrition, string>): Nutrition {
  const out: Nutrition = {}
  for (const k of NUTRITION_KEYS) {
    const raw = inputs[k].trim().replace(',', '.')
    if (!raw) continue
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) out[k] = n
  }
  return out
}
