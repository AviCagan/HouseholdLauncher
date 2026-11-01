import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { DISH_KINDS, type MealTemplate, type TemplateSlot } from '@/data/types'
import { addTemplate, removeTemplate, updateTemplate, type TemplateInput } from './actions'
import { ClipboardDoodle } from './doodles'
import { Empty } from './DishesTab'
import { useMealsUI } from './store'
import { DEFAULT_PEOPLE } from './nutrition'
import { BigButton, Chip, EmojiPicker, Field, Headcount, KIND_META, MCard, OCCASION_META, POP, TextInput, occasionLabel } from './ui'

/**
 * The shapes meals come in.
 *
 * A template is a list of named slots and nothing else — "Shabbat dinner" is
 * challah, fish, soup, main, two sides, dessert, with no opinion about which
 * ones. Planning from it gives you those slots to fill. The built-ins cover
 * Shabbat and the holidays; anything can be edited, and new ones added.
 *
 * Each one also carries the number it is usually for — the headcount a meal
 * planned from it starts at, before the slider on the meal moves it.
 */
export function TemplatesTab() {
  const templates = useData((s) => s.meal_templates)
  const openSheet = useMealsUI((s) => s.openSheet)
  const sorted = [...templates].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="flex flex-col gap-3 pb-2">
      <MCard onClick={() => openSheet({ kind: 'template', template: null })} className="flex items-center gap-3 px-3.5 py-3" tone="var(--m-berry-soft)">
        <span className="grid h-11 w-11 place-items-center rounded-[14px] text-[22px]" style={{ background: 'var(--m-card)', border: '2px solid var(--m-line)' }}>
          ➕
        </span>
        <span className="text-[15px] font-extrabold">Make a new template</span>
      </MCard>

      {sorted.length === 0 ? (
        <Empty doodle={<ClipboardDoodle />} title="No templates" hint="Templates set the courses for an occasion, so planning a meal is filling in blanks." />
      ) : (
        <AnimatePresence initial={false}>
          {sorted.map((t) => (
            <MCard key={t.id} layout className="flex flex-col gap-2.5 px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] text-[26px]" style={{ background: 'var(--m-butter-soft)', border: '2px solid var(--m-line)' }}>
                  {t.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-extrabold leading-tight">{t.name}</span>
                  <span className="mt-0.5 block text-[11.5px] font-bold" style={{ color: 'var(--m-ink-dim)' }}>
                    {occasionLabel(t.occasion)} · {t.slots.length} courses
                    {t.people > 0 ? ` · usually for ${t.people}` : ''}
                    {t.is_builtin ? ' · built in' : ''}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {t.slots.slice(0, 6).map((s, i) => (
                  <Chip key={i} small>
                    {KIND_META[s.role]?.emoji ?? '✨'} {s.label}
                  </Chip>
                ))}
                {t.slots.length > 6 && (
                  <Chip small>
                    +{t.slots.length - 6}
                  </Chip>
                )}
              </div>

              <div className="flex gap-2">
                <BigButton onClick={() => openSheet({ kind: 'meal', meal: null, template: t })} className="!py-2.5 !text-[13.5px]">
                  Plan this
                </BigButton>
                <BigButton onClick={() => openSheet({ kind: 'template', template: t })} tone="var(--m-card)" ink="var(--m-ink)" className="!w-auto !px-4 !py-2.5 !text-[13.5px]">
                  Edit
                </BigButton>
              </div>
            </MCard>
          ))}
        </AnimatePresence>
      )}
    </div>
  )
}

export function TemplateSheet({ template, open, onClose }: { template: MealTemplate | null; open: boolean; onClose: () => void }) {
  const profileId = useProfile((s) => s.profileId)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [occasion, setOccasion] = useState('dinner')
  const [customOccasion, setCustomOccasion] = useState('')
  const [people, setPeople] = useState(DEFAULT_PEOPLE)
  const [slots, setSlots] = useState<TemplateSlot[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(template?.name ?? '')
    setEmoji(template?.emoji ?? '')
    const occ = template?.occasion ?? 'dinner'
    setOccasion(OCCASION_META[occ] ? occ : '__custom')
    setCustomOccasion(OCCASION_META[occ] ? '' : occ)
    setPeople(template && template.people > 0 ? template.people : DEFAULT_PEOPLE)
    setSlots(template?.slots.length ? template.slots : [{ role: 'main', label: 'Main' }])
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id])

  const valid = name.trim().length > 0 && slots.some((s) => s.label.trim())

  // Closes at once — the template is in the store before the network is
  // touched (see actions.ts).
  function save() {
    if (!valid) return
    const input: TemplateInput = {
      name,
      emoji: emoji || '📋',
      occasion: occasion === '__custom' ? customOccasion.trim().toLowerCase() || 'dinner' : occasion,
      people,
      slots,
    }
    if (template) updateTemplate(template, input, profileId)
    else if (!addTemplate(input, profileId)) return
    onClose()
  }

  async function remove() {
    if (!template) return
    if (!confirmDelete) {
      fire('warning')
      setConfirmDelete(true)
      return
    }
    await removeTemplate(template)
    onClose()
  }

  const cycleRole = (i: number) => {
    const current = slots[i].role
    const next = DISH_KINDS[(DISH_KINDS.indexOf(current) + 1) % DISH_KINDS.length]
    fire('snap')
    setSlots((list) => list.map((s, j) => (j === i ? { ...s, role: next } : s)))
  }

  return (
    <Sheet open={open} onClose={onClose} title={<span className="m-title text-[18px]">{template ? 'Edit template' : 'New template'}</span>} height="92vh">
      <div className="meals -mx-4 -mb-4 flex flex-col gap-5 rounded-t-[26px] px-4 pb-8 pt-2" style={{ background: 'var(--m-paper)' }}>
        <EmojiPicker value={emoji || '📋'} onChange={setEmoji} />

        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday brunch" />
        </Field>

        <Field label="Occasion">
          <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1">
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

        <Field label="Usually for" hint="Where the slider starts when a meal is planned from this.">
          <Headcount value={people} onChange={setPeople} />
        </Field>

        <Field label="Courses" hint="Tap the little picture to change what kind of dish goes there.">
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {slots.map((slot, i) => (
                <motion.div
                  key={i}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12, height: 0 }}
                  transition={POP}
                  className="flex items-center gap-2"
                >
                  <button
                    onClick={() => cycleRole(i)}
                    aria-label={`Kind: ${KIND_META[slot.role].label}. Tap to change.`}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[20px]"
                    style={{ background: KIND_META[slot.role].soft, border: '2px solid var(--m-line)' }}
                  >
                    {KIND_META[slot.role].emoji}
                  </button>
                  <TextInput
                    value={slot.label}
                    onChange={(e) => setSlots((list) => list.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)))}
                    placeholder={KIND_META[slot.role].label}
                    className="min-w-0 flex-1 !py-2 !text-[13.5px]"
                  />
                  <button
                    onClick={() => {
                      fire('delete')
                      setSlots((list) => list.filter((_, j) => j !== i))
                    }}
                    aria-label="Remove course"
                    className="shrink-0 p-1"
                    style={{ color: 'var(--m-ink-faint)' }}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            <button
              onClick={() => {
                fire('tap')
                setSlots((list) => [...list, { role: 'side', label: '' }])
              }}
              className="m-chip self-start"
              style={{ background: 'var(--m-card-2)', borderStyle: 'dashed' }}
            >
              <Icon name="plus" size={13} strokeWidth={3} /> Add a course
            </button>
          </div>
        </Field>

        <div className="flex flex-col gap-2 pt-1">
          <BigButton onClick={() => void save()} disabled={!valid}>
            {template ? 'Save changes' : 'Save template'}
          </BigButton>
          {template && (
            <BigButton onClick={() => void remove()} tone={confirmDelete ? '#ff4d4d' : 'var(--m-card)'} ink={confirmDelete ? '#fff' : 'var(--m-ink)'}>
              {confirmDelete ? 'Yes, delete it' : 'Delete this template'}
            </BigButton>
          )}
        </div>
      </div>
    </Sheet>
  )
}
