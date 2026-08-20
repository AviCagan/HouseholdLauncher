import { useState } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData, dataActions } from '@/store/useData'
import { useUI } from '@/store/useUI'
import { fire } from '@/lib/haptics'
import { AddressInput } from '@/components/primitives/AddressInput'
import { ColorPicker } from '@/components/primitives/ColorPicker'
import { ColorSwatchButton } from '@/components/primitives/ColorSwatchButton'
import { normalizeUrl, domainOf } from '@/lib/unfurl'
import { openExternal } from '@/apps/things/routing/deeplink'
import type { Store } from '@/data/types'

const PALETTE = [
  '#4a9d7e',
  '#7c5cff',
  '#ff6ea9',
  '#f5a524',
  '#3aa0ff',
  '#e0563c',
  '#9b8cff',
  '#2bb673',
]

export function StoresSheet() {
  const sheet = useUI((s) => s.sheet)
  const closeSheet = useUI((s) => s.closeSheet)
  const stores = useData((s) => s.stores)

  const [name, setName] = useState('')
  const [isOnline, setIsOnline] = useState(false)
  const [address, setAddress] = useState('')
  const [url, setUrl] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [color, setColor] = useState(PALETTE[0])
  const [wheelOpen, setWheelOpen] = useState(false)

  async function add() {
    if (!name.trim()) return
    await dataActions.addStore({
      name: name.trim(),
      is_online: isOnline,
      url: isOnline ? normalizeUrl(url) : null,
      // A DB constraint also forbids coordinates on online stores, so an
      // online shop can never leak into a driving route.
      address: isOnline ? null : address.trim() || null,
      // Coordinates from a picked suggestion are kept, so trip planning never
      // has to geocode this store at all.
      lat: isOnline ? null : (coords?.lat ?? null),
      lng: isOnline ? null : (coords?.lng ?? null),
      geocoded_at: !isOnline && coords ? new Date().toISOString() : null,
      geocode_source: !isOnline && coords ? 'photon' : null,
      color_hex: color,
      emoji: null,
    })
    setName('')
    setAddress('')
    setUrl('')
    setCoords(null)
    setIsOnline(false)
    setWheelOpen(false)
    const i = PALETTE.indexOf(color)
    setColor(PALETTE[(i < 0 ? 0 : i + 1) % PALETTE.length])
  }

  return (
    <Sheet open={sheet.kind === 'stores'} onClose={closeSheet} title="Stores">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5 rounded-2xl p-3.5" style={{ background: 'var(--surface-2)' }}>
          {/* Searching by name fills the address too, so a physical shop only
              has to be looked up once rather than typed here and searched
              again. An online store has no address at all, so it stays a plain
              name field — no lookup, no suggestions to dismiss. */}
          {isOnline ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Store name"
              className="rounded-xl px-3 py-2.5 text-[14px] outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            />
          ) : (
            <AddressInput
              value={name}
              onChange={setName}
              // Keep the name a name. Filling it with the full postal address is
              // what made stores show up as "Taster's Market, 330 Bradley
              // Avenue, New York…" in the shopping list.
              fillWith="name"
              onPick={(place) => {
                setAddress(place.address)
                setCoords({ lat: place.lat, lng: place.lng })
              }}
              placeholder="Store name — we'll find the address"
            />
          )}

          <label className="flex items-center gap-2.5 px-1 py-1">
            <button
              onClick={() => {
                fire(isOnline ? 'toggleOff' : 'toggleOn')
                setIsOnline((v) => {
                  // Drop anything a lookup already filled in. The insert
                  // nulls these for an online store anyway, but leaving them
                  // on screen suggests they'll be saved when they won't.
                  if (!v) {
                    setAddress('')
                    setCoords(null)
                  }
                  return !v
                })
              }}
              role="switch"
              aria-checked={isOnline}
              className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              style={{ background: isOnline ? 'var(--accent)' : 'var(--surface-3)' }}
            >
              <span
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
                style={{ left: 2, transform: `translateX(${isOnline ? 20 : 0}px)` }}
              />
            </button>
            <span className="text-[14px]">Online only</span>
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              excluded from trips
            </span>
          </label>

          {!isOnline && (
            <AddressInput
              value={address}
              onChange={(v) => {
                setAddress(v)
                setCoords(null)
              }}
              onPick={(place) => setCoords({ lat: place.lat, lng: place.lng })}
              placeholder="Address (optional — used for trip planning)"
            />
          )}

          {/* An online store's "address" is its website. Tapping an item filed
              under it opens this, and on a phone an https link hands off to
              the shop's own app when it's installed. */}
          {isOnline && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Website (optional — e.g. amazon.com)"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              className="rounded-xl px-3 py-2.5 text-[14px] outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
            <ColorSwatchButton
              value={color}
              open={wheelOpen}
              onClick={() => {
                fire('tap')
                setWheelOpen((v) => !v)
              }}
            />
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => {
                  fire('snap')
                  setColor(c)
                }}
                aria-label={`Colour ${c}`}
                className="h-[34px] w-[34px] shrink-0 rounded-full"
                style={{
                  background: c,
                  outline: color === c ? '2px solid var(--text)' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>

          {wheelOpen && (
            <div className="pt-2">
              <ColorPicker value={color} onChange={setColor} />
            </div>
          )}

          {!isOnline && (
            <p className="px-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              Double-check the address before your first trip — search results
              can land on the wrong branch of a chain.
            </p>
          )}

          <button
            onClick={add}
            disabled={!name.trim()}
            className="mt-1 rounded-xl py-3 text-[15px] font-semibold text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            Add store
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {stores.map((store) => (
            <StoreRow key={store.id} store={store} />
          ))}
          {stores.length === 0 && (
            <p className="px-1 py-4 text-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
              No stores yet. Add one above to start grouping your shopping list.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  )
}

function StoreRow({ store }: { store: Store }) {
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState(store.address ?? '')
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null)
  // Tap the name to rename. Without this, a store saved under a bad name — the
  // whole postal address, say — could only be fixed by deleting it and losing
  // every item filed under it.
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(store.name)
  const [url, setUrl] = useState(store.url ?? '')

  function saveName() {
    const next = name.trim()
    setRenaming(false)
    if (!next || next === store.name) {
      setName(store.name)
      return
    }
    void dataActions.patchRow('stores', store.id, { name: next })
    fire('success')
  }

  async function saveUrl() {
    const next = normalizeUrl(url)
    await dataActions.patchRow('stores', store.id, { url: next })
    // Reflect what was actually stored — "amazon.com" comes back as a full
    // URL, and a value that couldn't be parsed comes back empty rather than
    // sitting in the box looking saved.
    setUrl(next ?? '')
    setEditing(false)
    fire('success')
  }

  async function saveAddress() {
    await dataActions.patchRow('stores', store.id, {
      address: address.trim() || null,
      // Keep coordinates when they came from a picked suggestion; otherwise
      // clear them so the new text gets resolved on the next trip.
      lat: picked?.lat ?? null,
      lng: picked?.lng ?? null,
      geocoded_at: picked ? new Date().toISOString() : null,
      geocode_source: picked ? 'photon' : null,
    })
    setEditing(false)
    fire('success')
  }

  return (
    <div
      className="flex flex-col gap-2.5 rounded-2xl p-3.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: store.color_hex }} />
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
              if (e.key === 'Escape') {
                setName(store.name)
                setRenaming(false)
              }
            }}
            enterKeyHint="done"
            className="min-w-0 flex-1 rounded-lg px-2 py-1 text-[15px] font-medium outline-none"
            style={{ background: 'var(--surface)', border: '1px solid var(--accent-muted)' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              fire('tap')
              setRenaming(true)
            }}
            aria-label={`Rename ${store.name}`}
            className="min-w-0 flex-1 truncate py-1 text-left text-[15px] font-medium"
          >
            {store.name}
          </button>
        )}
        {store.is_online ? (
          <button
            onClick={() => setEditing((e) => !e)}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
            style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
          >
            <Icon name="globe" size={11} strokeWidth={2.4} />
            {store.url ? 'Edit link' : 'Add link'}
          </button>
        ) : (
          <button
            onClick={() => setEditing((e) => !e)}
            className="rounded-full px-2 py-1 text-[11px]"
            style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}
          >
            {store.address ? 'Edit address' : 'Add address'}
          </button>
        )}
        <button
          onClick={() => void dataActions.remove('stores', store.id)}
          aria-label={`Delete ${store.name}`}
          className="grid h-7 w-7 place-items-center rounded-full"
          style={{ color: 'var(--text-faint)' }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      {!store.is_online && store.address && !editing && (
        <p className="pl-6 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {store.address}
        </p>
      )}

      {store.is_online && store.url && !editing && (
        <button
          onClick={() => {
            fire('tap')
            openExternal(store.url!)
          }}
          className="flex items-center gap-1 self-start pl-6 text-[12px]"
          style={{ color: 'var(--accent-text)' }}
        >
          <Icon name="link" size={11} strokeWidth={2.4} />
          {domainOf(store.url)}
        </button>
      )}

      {editing && (
        <div className="flex gap-2">
          <div className="flex-1">
            {store.is_online ? (
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="amazon.com"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveUrl()
                }}
                enterKeyHint="done"
                className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              />
            ) : (
              <AddressInput
                value={address}
                onChange={(v) => {
                  setAddress(v)
                  setPicked(null)
                }}
                onPick={(place) => setPicked({ lat: place.lat, lng: place.lng })}
                placeholder="Street, city"
                className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              />
            )}
          </div>
          <button
            onClick={() => void (store.is_online ? saveUrl() : saveAddress())}
            className="rounded-xl px-3 text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}
