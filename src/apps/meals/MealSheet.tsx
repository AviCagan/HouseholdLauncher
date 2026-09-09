import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { formatPrice } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { DISH_KINDS, NUTRITION_KEYS, type Dish, type DishKind, type Meal, type MealCourse, type MealTemplate } from '@/data/types'
import { addMeal, removeMeal, updateMeal, type DishInput, type MealInput } from './actions'
import { DishSheet } from './DishSheet'
import { MissingSheet } from './MissingSheet'
import { DEFAULT_PEOPLE, NUTRITION_LABEL, batchesFor, lineText, shoppingList, shoppingListText, summariseMeal } from './nutrition'
import { cookable } from './shelf'
import { useMealsUI } from './store'
import { BigButton, Chip, EmojiPicker, Field, Headcount, KIND_META, OCCASION_META, POP, Stat, TextArea, TextInput, occasionEmoji } from './ui'

/**
 * Build a meal: pick a shape, fill the slots, see what it adds up to.
 *
 * The totals card at the bottom is the reason the app exists. It is
 * recomputed from the dishes on every change and it never presents a partial
 * sum as the answer — "2 of 5 dishes priced" is printed next to the number,
 * because a Shabbat dinner that "costs $14" is one where three dishes were
 * never priced, and the second reading is the one that matters.
 *
 * The headcount is the other half of it. A dinner for two and the same
 * dinner for twelve are the same courses and very different shopping, so the
 * slider scales every dish to as many batches as it takes, and the cost and
 * the shopping list follow it. Nutrition stays per plate: a bigger table
 * doesn't change what's on one.
 *
 * "New dish" inside a course opens the dish editor *over* this sheet rather
 * than instead of it, and the saved dish lands in the course that asked for
 * it. The draft meal — name, headcount, the other courses — stays exactly as
 * it was, because losing it was the one thing that flow must not do.
 */
export function MealSheet({
  meal,
  template,
  date = null,
  open,
  onClose,
}: {
  meal: Meal | null
  /** Shape to start from, for a new meal. */
  template?: MealTemplate | null
  /** The day to plan it for, when opened from the planner. */
  date?: string | null
  open: boolean
  onClose: () => void
}) {
  const profileId = useProfile((s) => s.profileId)
  const dishes = useData((s) => s.dishes)
  const templates = useData((s) => s.meal_templates)
  const celebrate = useMealsUI((s) => s.celebrate)

  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [occasion, setOccasion] = useState('dinner')
  const [customOccasion, setCustomOccasion] = useState('')
  const [plannedFor, setPlannedFor] = useState('')
  const [people, setPeople] = useState(DEFAULT_PEOPLE)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [courses, setCourses] = useState<MealCourse[]>([])
  const [notes, setNotes] = useState('')
  const [picking, setPicking] = useState<number | null>(null)
  /** Index of the course a new dish is being written for, while it is. */
  const [newFor, setNewFor] = useState<number | null>(null)
  const [missingOpen, setMissingOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    if (meal) {
      setName(meal.name)
      setEmoji(meal.emoji)
      setOccasion(meal.occasion)
      setPlannedFor(meal.planned_for ?? '')
      setPeople(meal.people > 0 ? meal.people : DEFAULT_PEOPLE)
      setTemplateId(meal.template_id)
      setCourses(meal.courses)
      setNotes(meal.notes ?? '')
    } else {
      applyTemplate(template ?? null)
      setPlannedFor(date ?? '')
      setNotes('')
    }
    setCustomOccasion('')
    setPicking(null)
    setNewFor(null)
    setMissingOpen(false)
    setAdding(false)
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meal?.id, template?.id, date])

  function applyTemplate(t: MealTemplate | null) {
    fire('snap')
    setTemplateId(t?.id ?? null)
    setName(t?.name ?? '')
    setEmoji(t?.emoji ?? '')
    setOccasion(t?.occasion ?? 'dinner')
    setPeople(t?.people ?? DEFAULT_PEOPLE)
    setCourses((t?.slots ?? []).map((s) => ({ ...s, dish_id: null })))
  }

  const summary = useMemo(() => summariseMeal({ courses, people }, dishes), [courses, people, dishes])
  const valid = name.trim().length > 0

  function collect(): MealInput {
    return {
      name,
      emoji: emoji || occasionEmoji(occasion),
      occasion: occasion === '__custom' ? customOccasion.trim().toLowerCase() || 'dinner' : occasion,
      template_id: templateId,
      planned_for: plannedFor || null,
      people,
      courses,
      notes: notes.trim() || null,
    }
  }

  // Closes at once: the meal is in the store before the network is touched
  // (see actions.ts), so there is nothing to wait for.
  function save() {
    if (!valid) return
    const input = collect()
    if (meal) updateMeal(meal, input, profileId)
    else if (!addMeal(input, profileId)) return
    if (!meal) celebrate()
    onClose()
  }

  async function remove() {
    if (!meal) return
    if (!confirmDelete) {
      fire('warning')
      setConfirmDelete(true)
      return
    }
    await removeMeal(meal)
    onClose()
  }

  const byId = new Map(dishes.map((d) => [d.id, d]))
  const isNewBlank = !meal && courses.length === 0

  // Keyed on the role, not the course object, so the dish editor's form isn't
  // reset by an unrelated re-render of this sheet while it is open.
  const newCourse = newFor != null ? courses[newFor] ?? null : null
  const newRole = newCourse?.role ?? null
  const newDraft = useMemo<Partial<DishInput> | undefined>(() => (newRole ? { kind: newRole, name: '' } : undefined), [newRole])

  // The draft as the missing-ingredients sheet sees it. Memoised so its
  // derived lists don't churn on every keystroke in the name field.
  const draftMeal = useMemo(
    () => [{ name: name.trim() || 'this meal', emoji: emoji || occasionEmoji(occasion), courses, people }],
    [name, emoji, occasion, courses, people],
  )

  return (
    <>
    <Sheet
      open={open}
      onClose={onClose}
      title={<span className="m-title text-[18px]">{meal ? 'Edit meal' : 'Plan a meal'}</span>}
      height="92vh"
    >
      <div className="meals -mx-4 -mb-4 flex flex-col gap-5 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        {isNewBlank && (
          <Field label="Start from" hint="Templates set the courses. You can add or remove them after.">
            <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1">
              {templates
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((t) => (
                  <Chip key={t.id} onClick={() => applyTemplate(t)}>
                    {t.emoji} {t.name}
                  </Chip>
                ))}
              <Chip
                onClick={() => {
                  setCourses([{ role: 'main', label: 'Main', dish_id: null }])
                  setAdding(false)
                }}
              >
                ✏️ Blank
              </Chip>
            </div>
          </Field>
        )}

        <EmojiPicker value={emoji || occasionEmoji(occasion)} onChange={setEmoji} />

        <Field label="Call it">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday night dinner" />
        </Field>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Occasion">
            <div className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
              {Object.entries(OCCASION_META).map(([key, m]) => (
                <Chip key={key} active={occasion === key} onClick={() => setOccasion(key)} small>
                  {m.emoji} {m.label}
                </Chip>
              ))}
              <Chip active={occasion === '__custom'} onClick={() => setOccasion('__custom')} small>
                ➕ Other
              </Chip>
            </div>
            {occasion === '__custom' && (
              <TextInput value={customOccasion} onChange={(e) => setCustomOccasion(e.target.value)} placeholder="birthday" className="mt-1 !py-2" />
            )}
          </Field>
          <Field label="When">
            <input
              type="date"
              value={plannedFor}
              onChange={(e) => setPlannedFor(e.target.value)}
              aria-label="Planned for"
              className="m-input w-full !py-2 !text-[13.5px]"
            />
          </Field>
        </div>

        <Field label="For how many" hint="Every dish gets made in as many batches as it takes. The cost and the shopping list follow.">
          <Headcount value={people} onChange={setPeople} />
        </Field>

        <Field label="Courses" hint="Tap a course to put a dish in it.">
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {courses.map((course, i) => {
                const dish = course.dish_id ? byId.get(course.dish_id) ?? null : null
                const missing = course.dish_id && !dish
                const batches = dish ? batchesFor(people, dish.servings) : 1
                const meta = KIND_META[course.role] ?? KIND_META.other
                return (
                  <motion.div
                    key={`${i}-${course.label}`}
                    layout
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12, height: 0 }}
                    transition={POP}
                    className="m-card-flat overflow-hidden"
                    style={{ background: picking === i ? 'var(--m-card-2)' : 'var(--m-card)' }}
                  >
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <button
                        onClick={() => {
                          fire('tap')
                          setPicking(picking === i ? null : i)
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[22px]"
                          style={{ background: meta.soft, border: '2px solid var(--m-line)' }}
                        >
                          {dish ? dish.emoji : meta.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10.5px] font-black uppercase tracking-wide" style={{ color: 'var(--m-ink-dim)' }}>
                            {course.label}
                          </span>
                          <span
                            className="flex items-center gap-1.5 text-[14.5px] font-extrabold"
                            style={{ color: dish ? 'var(--m-ink)' : missing ? '#ff4d4d' : 'var(--m-ink-faint)' }}
                          >
                            <span className="min-w-0 truncate">{dish ? dish.name : missing ? 'That dish was deleted' : 'Pick a dish'}</span>
                            {batches > 1 && <Batches n={batches} />}
                          </span>
                        </span>
                        <Icon name="chevron" size={15} />
                      </button>
                      <button
                        onClick={() => {
                          fire('delete')
                          setCourses((list) => list.filter((_, j) => j !== i))
                          if (picking === i) setPicking(null)
                        }}
                        aria-label={`Remove ${course.label}`}
                        className="shrink-0 p-1"
                        style={{ color: 'var(--m-ink-faint)' }}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </div>

                    <AnimatePresence initial={false}>
                      {picking === i && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <DishPicker
                            role={course.role}
                            dishes={cookable(dishes)}
                            current={course.dish_id}
                            onPick={(id) => {
                              fire('snap')
                              setCourses((list) => list.map((c, j) => (j === i ? { ...c, dish_id: id } : c)))
                              setPicking(null)
                            }}
                            onNew={() => {
                              fire('tap')
                              setPicking(null)
                              setNewFor(i)
                            }}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {adding ? (
              <AddCourse
                onAdd={(c) => {
                  setCourses((list) => [...list, c])
                  setAdding(false)
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button
                onClick={() => {
                  fire('tap')
                  setAdding(true)
                }}
                className="m-chip self-start"
                style={{ background: 'var(--m-card-2)', borderStyle: 'dashed' }}
              >
                <Icon name="plus" size={13} strokeWidth={3} /> Add a course
              </button>
            )}
          </div>
        </Field>

        {summary.dishes.length > 0 && (
          <>
            <Totals summary={summary} />
            <ShoppingCard name={name} people={people} courses={courses} dishes={dishes} />
            <BigButton
              onClick={() => {
                fire('tap')
                setMissingOpen(true)
              }}
              tone="var(--m-sky)"
              ink="var(--m-ink)"
              className="!py-3 !text-[14px]"
            >
              🛒 Missing ingredients?
            </BigButton>
          </>
        )}

        <Field label="Notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Nuri's coming — make extra rice" />
        </Field>

        <div className="flex flex-col gap-2 pt-1">
          <BigButton onClick={() => void save()} disabled={!valid}>
            {meal ? 'Save changes' : 'Save this meal'}
          </BigButton>
          {meal && (
            <BigButton onClick={() => void remove()} tone={confirmDelete ? '#ff4d4d' : 'var(--m-card)'} ink={confirmDelete ? '#fff' : 'var(--m-ink)'}>
              {confirmDelete ? 'Yes, delete it' : 'Delete this meal'}
            </BigButton>
          )}
        </div>
      </div>
    </Sheet>

    <DishSheet
      open={newFor != null}
      dish={null}
      draft={newDraft}
      note={newCourse ? `This will go in as ${newCourse.label.toLowerCase()} once you save it.` : undefined}
      onClose={() => setNewFor(null)}
      onSaved={(d) => {
        setCourses((list) => list.map((c, j) => (j === newFor ? { ...c, dish_id: d.id } : c)))
        setNewFor(null)
      }}
    />

    <MissingSheet open={missingOpen} meals={draftMeal} onClose={() => setMissingOpen(false)} />
    </>
  )
}

/**
 * Dishes that fit the slot first, then everything else, then a way to make
 * one on the spot — because "we need a soup and don't have one written down"
 * is the normal case, not the edge case.
 */
function DishPicker({
  role,
  dishes,
  current,
  onPick,
  onNew,
}: {
  role: DishKind
  dishes: Dish[]
  current: string | null
  onPick: (id: string | null) => void
  onNew: () => void
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const match = (d: Dish) => !query || d.name.toLowerCase().includes(query)
  const fits = dishes.filter((d) => d.kind === role && match(d)).sort((a, b) => a.name.localeCompare(b.name))
  const rest = dishes.filter((d) => d.kind !== role && match(d)).sort((a, b) => a.name.localeCompare(b.name))

  const Row = ({ d }: { d: Dish }) => (
    <button
      onClick={() => onPick(d.id)}
      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left"
      style={{ background: d.id === current ? 'var(--m-mint-soft)' : 'transparent' }}
    >
      <span className="text-[20px]">{d.emoji}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{d.name}</span>
      <span className="text-[11px] font-bold" style={{ color: 'var(--m-ink-faint)' }}>
        {KIND_META[d.kind].label}
      </span>
    </button>
  )

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-3" style={{ borderTop: '2px dashed var(--m-line)' }}>
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="mt-2.5 !py-1.5 !text-[13px]" />
      {fits.length > 0 && (
        <>
          <span className="px-2 pt-1 text-[10.5px] font-black uppercase tracking-wide" style={{ color: 'var(--m-ink-dim)' }}>
            {KIND_META[role].label}s
          </span>
          {fits.map((d) => <Row key={d.id} d={d} />)}
        </>
      )}
      {rest.length > 0 && (
        <>
          <span className="px-2 pt-1 text-[10.5px] font-black uppercase tracking-wide" style={{ color: 'var(--m-ink-dim)' }}>
            Everything else
          </span>
          {rest.slice(0, 30).map((d) => <Row key={d.id} d={d} />)}
        </>
      )}
      <div className="flex gap-1.5 pt-1">
        <button onClick={onNew} className="m-chip" style={{ background: 'var(--m-tomato-soft)' }}>
          ✨ New dish
        </button>
        {current && (
          <button onClick={() => onPick(null)} className="m-chip">
            Leave empty
          </button>
        )}
      </div>
    </div>
  )
}

function AddCourse({ onAdd, onCancel }: { onAdd: (c: MealCourse) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<DishKind>('side')
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="m-card-flat flex flex-col gap-2 p-3" style={{ background: 'var(--m-card-2)' }}>
      <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Call the course…" autoFocus className="!py-2" />
      <div className="scroll-x -mx-3 flex gap-1.5 px-3">
        {DISH_KINDS.map((k) => (
          <Chip key={k} active={role === k} color={KIND_META[k].color} onClick={() => setRole(k)} small>
            {KIND_META[k].emoji} {KIND_META[k].label}
          </Chip>
        ))}
      </div>
      <div className="flex gap-2">
        <BigButton
          onClick={() => onAdd({ role, label: label.trim() || KIND_META[role].label, dish_id: null })}
          tone="var(--m-mint)"
          ink="var(--m-ink)"
          className="!py-2.5 !text-[13.5px]"
        >
          Add course
        </BigButton>
        <BigButton onClick={onCancel} tone="var(--m-card)" ink="var(--m-ink)" className="!py-2.5 !text-[13.5px]">
          Cancel
        </BigButton>
      </div>
    </motion.div>
  )
}

/** A little "×3" for a dish that is made more than once. */
function Batches({ n }: { n: number }) {
  return (
    <motion.span
      key={n}
      initial={{ scale: 1.4 }}
      animate={{ scale: 1 }}
      transition={POP}
      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-black tabular-nums leading-none"
      style={{ background: 'var(--m-tomato-soft)', border: '1.5px solid var(--m-line)', color: 'var(--m-ink)' }}
    >
      ×{n}
    </motion.span>
  )
}

/** What the meal adds up to, with honesty about what was never filled in. */
function Totals({ summary }: { summary: ReturnType<typeof summariseMeal> }) {
  const n = summary.dishes.length
  const { totals, known } = summary.nutrition
  const repeated = summary.dishes.map((d, i) => [d, summary.batches[i]] as const).filter(([, b]) => b > 1)
  return (
    <motion.div layout className="m-card flex flex-col gap-3 p-4" style={{ background: 'var(--m-butter-soft)' }}>
      <div className="flex items-baseline justify-between">
        <span className="m-title text-[16px]">This meal</span>
        <span className="text-[12px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
          {n} {n === 1 ? 'dish' : 'dishes'}
          {summary.empty > 0 ? ` · ${summary.empty} to pick` : ''}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span className="m-title text-[30px] leading-none">{summary.cost != null ? formatPrice(summary.cost) : '—'}</span>
        <span className="pb-1 text-[12px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
          to make for {summary.people}
          {summary.costKnown < n ? ` · ${summary.costKnown} of ${n} priced` : ''}
        </span>
      </div>

      {repeated.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {repeated.map(([d, b]) => (
            <Stat key={d.id} tone="var(--m-tomato-soft)">
              {d.emoji} {d.name} ×{b}
            </Stat>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {NUTRITION_KEYS.filter((k) => k !== 'sodium_mg' && k !== 'fiber_g').map((key) => {
          const value = totals[key]
          const k = known[key]
          return (
            <div key={key} className="m-card-flat px-2.5 py-2" style={{ background: 'var(--m-card)' }}>
              <span className="block text-[10.5px] font-black uppercase tracking-wide" style={{ color: 'var(--m-ink-dim)' }}>
                {NUTRITION_LABEL[key].label}
              </span>
              <span className="block text-[16px] font-black tabular-nums">
                {value != null ? NUTRITION_LABEL[key].fmt(value) : '—'}
              </span>
              {k > 0 && k < n && (
                <span className="block text-[10px] font-bold" style={{ color: 'var(--m-ink-faint)' }}>
                  {k} of {n}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <span className="text-[11px] font-semibold" style={{ color: 'var(--m-ink-dim)' }}>
        Per plate — one serving of each dish. Blanks mean nobody has entered it yet.
      </span>
    </motion.div>
  )
}

/**
 * Everything to buy, at this headcount, dish by dish — and a Copy button,
 * because the place a shopping list is actually used is a messages thread or
 * a notes app in the aisle, not this sheet.
 */
function ShoppingCard({
  name,
  people,
  courses,
  dishes,
}: {
  name: string
  people: number
  courses: MealCourse[]
  dishes: Dish[]
}) {
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => shoppingList({ courses, people }, dishes), [courses, people, dishes])
  const lines = groups.reduce((sum, g) => sum + g.lines.length, 0)

  async function copy() {
    const text = shoppingListText({ name: name.trim() || 'Meal', people }, groups)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      fire('success')
      toast.success(`Shopping list for ${people} copied`)
    } catch {
      fire('error')
      toast.error("Couldn't copy here — open the list and read it off instead")
      setOpen(true)
    }
  }

  return (
    <motion.div layout className="m-card overflow-hidden" style={{ background: 'var(--m-mint-soft)' }}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={() => {
            fire('tap')
            setOpen((o) => !o)
          }}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="text-[22px]">🛒</span>
          <span className="min-w-0 flex-1">
            <span className="m-title block text-[16px]">Shopping list</span>
            <span className="block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
              for {people} · {lines} {lines === 1 ? 'thing' : 'things'} across {groups.length} {groups.length === 1 ? 'dish' : 'dishes'}
            </span>
          </span>
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={POP} className="grid place-items-center">
            <Icon name="chevron" size={15} />
          </motion.span>
        </button>
        <button onClick={() => void copy()} className="m-chip shrink-0" style={{ background: 'var(--m-card)' }}>
          📋 Copy
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="flex flex-col gap-3 px-4 pb-4" style={{ borderTop: '2px dashed var(--m-line)' }}>
              {groups.map((g) => (
                <div key={g.dish.id} className="flex flex-col gap-1 pt-3">
                  <span className="flex items-center gap-1.5 text-[13.5px] font-black">
                    <span>{g.dish.emoji}</span>
                    <span className="min-w-0 truncate">{g.dish.name}</span>
                    {g.batches > 1 && <Batches n={g.batches} />}
                    <span className="ml-auto shrink-0 text-[11px] font-bold" style={{ color: 'var(--m-ink-faint)' }}>
                      serves {g.dish.servings}
                    </span>
                  </span>
                  {g.lines.length === 0 ? (
                    <span className="text-[12.5px] font-semibold" style={{ color: 'var(--m-ink-faint)' }}>
                      No ingredients written down for this one.
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-0.5 text-[13px] font-semibold" style={{ color: 'var(--m-ink)' }}>
                      {g.lines.map((line, i) => (
                        <li key={i}>• {lineText(line)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
