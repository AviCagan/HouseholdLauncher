import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { addFiles, addItem } from './actions'
import { useDrive } from './drive'
import { categories, suggestions, yearsFrom } from './model'
import { draftOf, inputOf, priceProblem, type Draft } from './draft'

/**
 * The details of an item, as a form — used to receive a new one and to edit
 * one already on the shelf. Everything but the name is optional: a receipt
 * read out at the counter has some of it, the box has the rest, and
 * "Fan, Home Depot, $100" is already worth keeping.
 */

export function DetailsForm({ draft, onChange, withNotes = true }: { draft: Draft; onChange: (d: Draft) => void; withNotes?: boolean }) {
  const items = useData((s) => s.inventory_items)
  const lists = useMemo(
    () => ({
      category: categories(items),
      store: suggestions(items, 'store'),
      paid_by: suggestions(items, 'paid_by'),
      location: suggestions(items, 'location'),
      brand: suggestions(items, 'brand'),
    }),
    [items],
  )
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...draft, [k]: e.target.value })
  const problem = priceProblem(draft)

  return (
    <div className="flex flex-col gap-3">
      <Field label="What is it">
        <input value={draft.name} onChange={set('name')} placeholder="Evaporative cooler" aria-label="Name" className="inv-field !text-[17px] font-bold" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Brand">
          <input value={draft.brand} onChange={set('brand')} placeholder="Vevor" aria-label="Brand" list="inv-brand" className="inv-field" />
        </Field>
        <Field label="Model">
          <input value={draft.model} onChange={set('model')} placeholder="Optional" aria-label="Model" className="inv-field" />
        </Field>
        <Field label="Category">
          <input value={draft.category} onChange={set('category')} placeholder="Appliance" aria-label="Category" list="inv-category" className="inv-field" />
        </Field>
        <Field label="Kept in">
          <input value={draft.location} onChange={set('location')} placeholder="Garage" aria-label="Kept in" list="inv-location" className="inv-field" />
        </Field>
        <Field label="Bought at">
          <input value={draft.store} onChange={set('store')} placeholder="Home Depot" aria-label="Bought at" list="inv-store" className="inv-field" />
        </Field>
        <Field label="Price" hint={problem}>
          <input value={draft.price} onChange={set('price')} placeholder="0.00" inputMode="decimal" aria-label="Price" className="inv-field tabular-nums" />
        </Field>
        <Field label="Paid for by">
          <input value={draft.paid_by} onChange={set('paid_by')} placeholder="Who paid" aria-label="Paid for by" list="inv-paid" className="inv-field" />
        </Field>
        <Field label="Bought on">
          <input type="date" value={draft.purchased_on} onChange={set('purchased_on')} aria-label="Bought on" className="inv-field" />
        </Field>
      </div>

      <Field label="Warranty until">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={draft.warranty_until}
            onChange={set('warranty_until')}
            aria-label="Warranty until"
            className="inv-field !w-auto min-w-[160px] flex-1"
          />
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ ...draft, warranty_until: yearsFrom(draft.purchased_on || null, n) })}
              className="inv-btn inv-btn--quiet !px-2.5 !py-1.5 !text-[12px]"
              title={`${n} year${n === 1 ? '' : 's'} from when it was bought`}
            >
              +{n} yr
            </button>
          ))}
          {draft.warranty_until && (
            <button type="button" onClick={() => onChange({ ...draft, warranty_until: '' })} className="text-[12px] font-semibold" style={{ color: 'var(--text-faint)' }}>
              None
            </button>
          )}
        </div>
      </Field>

      {withNotes && (
        <Field label="Notes">
          <textarea
            value={draft.notes}
            onChange={set('notes')}
            rows={4}
            placeholder="What came with it, where the spare part is, who to call…"
            aria-label="Notes"
            className="inv-field resize-y leading-snug"
          />
        </Field>
      )}

      <datalist id="inv-brand">{lists.brand.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="inv-category">{lists.category.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="inv-store">{lists.store.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="inv-paid">{lists.paid_by.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="inv-location">{lists.location.map((v) => <option key={v} value={v} />)}</datalist>
    </div>
  )
}

/** A div, not a <label>: several controls share some rows, and each names itself. */
export function Field({ label, hint, children }: { label: string; hint?: string | null; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="inv-stencil text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[11.5px] font-semibold" style={{ color: 'var(--inv-bad)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

/**
 * Receive an item: its details, and the overall photo if there's one to take
 * right now. Everything else — parts, the manual, a scan of the warranty —
 * goes on from the item's own page, which opens as soon as this is done.
 */
export function ReceiveSheet({ open, onClose, onReceived }: { open: boolean; onClose: () => void; onReceived: (id: string) => void }) {
  const profileId = useProfile((s) => s.profileId)
  const connected = useDrive((s) => s.status?.connected === true)
  const [draft, setDraft] = useState<Draft>(() => draftOf(null))
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(draftOf(null))
    setPhoto(null)
  }, [open])

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const ready = draft.name.trim().length > 0 && !priceProblem(draft)

  function save() {
    if (!ready) return
    const row = addItem(inputOf(draft), profileId)
    if (!row) return
    if (photo) void addFiles(row.id, [photo], 'photo')
    onReceived(row.id)
  }

  return (
    <Sheet open={open} onClose={onClose} height="92vh" title={<span className="inv-stencil text-[16px]">Receive an item</span>}>
      <div className="flex flex-col gap-4 pb-4">
        <div className="flex items-center gap-3">
          <label
            className="inv-tile grid h-24 w-24 shrink-0 cursor-pointer place-items-center"
            title={connected ? 'Take or choose the overall photo' : 'Connect Google Drive to add photos'}
            style={{ opacity: connected ? 1 : 0.5 }}
          >
            {photoUrl ? (
              <img src={photoUrl} alt="Overall photo" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--text-faint)' }}>
                <Icon name="camera" size={22} />
                Photo
              </span>
            )}
            <input
              type="file"
              accept="image/*"
              disabled={!connected}
              className="sr-only"
              onChange={(e) => {
                setPhoto(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
          <p className="text-[12.5px] leading-snug" style={{ color: 'var(--text-dim)' }}>
            {connected
              ? 'A photo of the whole thing with everything that came with it. Parts, the manual and the warranty go on next.'
              : 'Photos and paperwork need Google Drive connected — the details can go in now and the rest later.'}
          </p>
        </div>

        <DetailsForm draft={draft} onChange={setDraft} />

        <button onClick={save} disabled={!ready} className="inv-btn inv-btn--orange w-full !py-3 !text-[15px]">
          <Icon name="box" size={17} /> Put it on the shelf
        </button>
      </div>
    </Sheet>
  )
}
