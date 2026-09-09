import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { formatPrice } from '@/lib/money'
import { fire } from '@/lib/haptics'
import { DISH_KINDS, NUTRITION_KEYS, type Dish, type DishKind, type Meal, type MealCourse, type MealTemplate } from '@/data/types'
import { addMeal, removeMeal, updateMeal, type MealInput } from './actions'
import { NUTRITION_LABEL, summariseMeal } from './nutrition'
import { useMealsUI } from './store'
import { BigButton, Chip, EmojiPicker, Field, KIND_META, OCCASION_META, POP, TextArea, TextInput, occasionEmoji } from './ui'

/**
 * Build a meal: pick a shape, fill the slots, see what it adds up to.
 *
 * The totals card at the bottom is the reason the app exists. It is
 * recomputed from the dishes on every change and it never presents a partial
 * sum as the answer — "2 of 5 dishes priced" is printed next to the number,
 * because a Shabbat dinner that "costs $14" is one where three dishes were
 * never priced, and the second reading is the one that matters.
 */
export function MealSheet({
  meal,
  template,
  open,
  onClose,
}: {
  meal: Meal | null
  /** Shape to start from, for a new meal. */
  template?: MealTemplate | null
  open: boolean
  onClose: () => void
}) {
  const profileId = useProfile((s) => s.profileId)
  const dishes = useData((s) => s.dishes)
  const templates = useData((s) => s.meal_templates)
  const celebrate = useMealsUI((s) => s.celebrate)
  const openSheet = useMealsUI((s) => s.openSheet)

  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [occasion, setOccasion] = useState('dinner')
  const [customOccasion, setCustomOccasion] = useState('')
  const [plannedFor, setPlannedFor] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [courses, setCourses] = useState<MealCourse[]>([])
  const [notes, setNotes] = useState('')
  const [picking, setPicking] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    if (meal) {
      setName(meal.name)
      setEmoji(meal.emoji)
      setOccasion(meal.occasion)
      setPlannedFor(meal.planned_for ?? '')
      setTemplateId(meal.template_id)
      setCourses(meal.courses)
      setNotes(meal.notes ?? '')
    } else {
      applyTemplate(template ?? null)
      setPlannedFor('')
      setNotes('')
    }
    setCustomOccasion('')
    setPicking(null)
    setAdding(false)
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meal?.id, template?.id])

  function applyTemplate(t: MealTemplate | null) {
    fire('snap')
    setTemplateId(t?.id ?? null)
    setName(t?.name ?? '')
    setEmoji(t?.emoji ?? '')
    setOccasion(t?.occasion ?? 'dinner')
    setCourses((t?.slots ?? []).map((s) => ({ ...s, dish_id: null })))
  }

  const summary = useMemo(
    () => summariseMeal({ courses } as Meal, dishes),
    [courses, dishes],
  )
  const valid = name.trim().length > 0

  function collect(): MealInput {
    return {
      name,
      emoji: emoji || occasionEmoji(occasion),
      occasion: occasion === '__custom' ? customOccasion.trim().toLowerCase() || 'dinner' : occasion,
      template_id: templateId,
      planned_for: plannedFor || null,
      courses,
      notes: notes.trim() || null,
    }
  }

  async function save() {
    if (!valid || busy) return
    setBusy(true)
    const input = collect()
    const ok = meal ? await updateMeal(meal, input, profileId) : Boolean(await addMeal(input, profileId))
    setBusy(false)
    if (!ok) return
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

  return (
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

        <Field label="Courses" hint="Tap a course to put a dish in it.">
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {courses.map((course, i) => {
                const dish = course.dish_id ? byId.get(course.dish_id) ?? null : null
                const missing = course.dish_id && !dish
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
                            className="block truncate text-[14.5px] font-extrabold"
                            style={{ color: dish ? 'var(--m-ink)' : missing ? '#ff4d4d' : 'var(--m-ink-faint)' }}
                          >
                            {dish ? dish.name : missing ? 'That dish was deleted' : 'Pick a dish'}
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
                            dishes={dishes}
                            current={course.dish_id}
                            onPick={(id) => {
                              fire('snap')
                              setCourses((list) => list.map((c, j) => (j === i ? { ...c, dish_id: id } : c)))
                              setPicking(null)
                            }}
                            onNew={() =>
                              openSheet({
                                kind: 'dish',
                                dish: null,
                                draft: { kind: course.role, name: '' },
                                note: `This will go in as ${course.label.toLowerCase()} once you save it.`,
                              })
                            }
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

        {summary.dishes.length > 0 && <Totals summary={summary} />}

        <Field label="Notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Nuri's coming — make extra rice" />
        </Field>

        <div className="flex flex-col gap-2 pt-1">
          <BigButton onClick={() => void save()} disabled={!valid} busy={busy}>
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

/** What the meal adds up to, with honesty about what was never filled in. */
function Totals({ summary }: { summary: ReturnType<typeof summariseMeal> }) {
  const n = summary.dishes.length
  const { totals, known } = summary.nutrition
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
          to make
          {summary.costKnown < n ? ` · ${summary.costKnown} of ${n} priced` : ''}
        </span>
      </div>

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
