import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useLauncher } from '@/store/useLauncher'
import { useIsOwner } from '@/store/useMember'
import { useDesktop } from '@/lib/useDesktop'
import { isConfigured } from '@/lib/env'
import { fire } from '@/lib/haptics'
import { useInventoryBusy } from './actions'
import { useDrive } from './drive'
import { DriveSetupSheet, ImportSheet } from './DriveSheets'
import { useUnlinkedFolders } from './hooks'
import { ReceiveSheet } from './forms'
import { ItemSheet } from './ItemSheet'
import { categories, searchItems, sortItems, warranty, type InventorySort } from './model'
import { ItemBox } from './ui'
import './inventory.css'

/**
 * Inventory — the household's stockroom.
 *
 * Everything bought that's worth keeping track of, as boxes on a shelf: what
 * it is, where it came from and what it cost, how long it's covered, a photo
 * of the whole thing, its spare parts, and its paperwork. The photos and
 * paperwork live in Google Drive, one folder per item, so the folder is the
 * real record and the app is a better way to look at it.
 *
 * Styled under `.inv` — see inventory.css.
 */

const SORTS: { key: InventorySort; label: string }[] = [
  { key: 'recent', label: 'Newest' },
  { key: 'name', label: 'A–Z' },
  { key: 'warranty', label: 'Warranty' },
]

export function InventoryApp() {
  const items = useData((s) => s.inventory_items)
  const goHome = useLauncher((s) => s.goHome)
  const consumeDeepLink = useLauncher((s) => s.consumeDeepLink)
  const desktop = useDesktop()
  const owner = useIsOwner()
  const drive = useDrive()
  const busy = useInventoryBusy((s) => s.busy)
  const unlinked = useUnlinkedFolders()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<InventorySort>('recent')
  const [category, setCategory] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [receiving, setReceiving] = useState(false)
  const [setup, setSetup] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void useDrive.getState().refresh()
  }, [])

  // A deep link names an item by id; open it if it's still on the shelf.
  useEffect(() => {
    const link = consumeDeepLink()
    const id = typeof link?.id === 'string' ? link.id : null
    if (id && items.some((i) => i.id === id)) setOpenId(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeDeepLink])

  const cats = useMemo(() => categories(items), [items])
  const shown = useMemo(
    () => sortItems(searchItems(items, query), sort).filter((i) => !category || i.category === category),
    [items, query, sort, category],
  )
  const covered = items.filter((i) => warranty(i).state === 'active' || warranty(i).state === 'soon').length
  const ending = items.filter((i) => warranty(i).state === 'soon').length

  return (
    <div className="inv flex h-full flex-col">
      <header className="shrink-0 px-4 pb-2 pt-[max(var(--safe-top),0.75rem)] lg:px-8 lg:pt-6">
        <div className="flex items-center gap-3">
          {!desktop && (
            <button
              onClick={() => {
                fire('tap')
                goHome()
              }}
              aria-label="Back to the launcher"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <Icon name="back" size={19} strokeWidth={2.4} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="inv-stencil truncate text-[26px] leading-none lg:text-[32px]">Inventory</h1>
            <p className="mt-1 text-[12px] font-bold" style={{ color: 'var(--text-dim)' }}>
              {items.length} {items.length === 1 ? 'item' : 'items'}
              {covered > 0 && ` · ${covered} under warranty`}
              {ending > 0 && (
                <span style={{ color: 'var(--inv-warn)' }}>
                  {' '}
                  · {ending} ending soon
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => {
              fire('tap')
              setReceiving(true)
            }}
            className="inv-btn inv-btn--orange shrink-0"
          >
            <Icon name="plus" size={17} strokeWidth={2.8} />
            <span className={desktop ? '' : 'sr-only'}>Receive an item</span>
          </button>
        </div>
        <div className="inv-hazard mt-3" aria-hidden />
      </header>

      <div className="scroll-y min-h-0 flex-1 px-4 pb-10 lg:px-8">
        <DriveBar
          owner={owner}
          checking={drive.checking && !drive.status}
          connected={drive.status?.connected === true}
          error={drive.error}
          unlinked={unlinked.folders.length}
          onSetup={() => setSetup(true)}
          onImport={() => setImporting(true)}
        />

        {items.length > 0 && (
          <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-2 px-4 pb-3 pt-3 lg:-mx-8 lg:flex-row lg:items-center lg:px-8" style={{ background: 'var(--inv-floor)' }}>
            <div className="relative min-w-0 flex-1 lg:max-w-[420px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }}>
                <Icon name="search" size={15} />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find an item, a store, a stock code…"
                aria-label="Search inventory"
                className="inv-field !pl-9"
              />
            </div>
            <div className="scroll-x flex items-center gap-1.5">
              {SORTS.map((s) => (
                <Chip key={s.key} on={sort === s.key} onClick={() => setSort(s.key)}>
                  {s.label}
                </Chip>
              ))}
              {cats.length > 0 && <span className="mx-1 h-5 w-px shrink-0" style={{ background: 'var(--border-strong)' }} />}
              {cats.map((c) => (
                <Chip key={c} on={category === c} onClick={() => setCategory(category === c ? null : c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <EmptyShelf onReceive={() => setReceiving(true)} />
        ) : shown.length === 0 ? (
          <p className="py-14 text-center text-[14px] font-semibold" style={{ color: 'var(--text-faint)' }}>
            Nothing on the shelf matches that.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] lg:gap-4">
            <AnimatePresence initial={false}>
              {shown.map((item) => (
                <ItemBox
                  key={item.id}
                  item={item}
                  busy={busy[item.id]}
                  onOpen={() => {
                    fire('tap')
                    setOpenId(item.id)
                  }}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <ItemSheet itemId={openId} onClose={() => setOpenId(null)} />
      <ReceiveSheet
        open={receiving}
        onClose={() => setReceiving(false)}
        onReceived={(id) => {
          setReceiving(false)
          setOpenId(id)
        }}
      />
      <DriveSetupSheet open={setup} onClose={() => setSetup(false)} />
      <ImportSheet
        open={importing}
        onClose={() => {
          setImporting(false)
          unlinked.reload()
        }}
        folders={unlinked.folders}
        onImported={(id) => {
          setImporting(false)
          setOpenId(id)
        }}
      />
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={() => {
        fire('snap')
        onClick()
      }}
      aria-pressed={on}
      className="shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-bold"
      style={{
        background: on ? 'var(--inv-ink)' : 'var(--surface)',
        color: on ? 'var(--inv-floor)' : 'var(--text-dim)',
        border: `1px solid ${on ? 'var(--inv-ink)' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  )
}

/** What Drive is doing for the app, and the one thing to do about it if anything. */
function DriveBar({
  owner,
  checking,
  connected,
  error,
  unlinked,
  onSetup,
  onImport,
}: {
  owner: boolean
  checking: boolean
  connected: boolean
  error: string | null
  unlinked: number
  onSetup: () => void
  onImport: () => void
}) {
  if (checking) return null
  if (connected) {
    return (
      <div className="flex items-center gap-2 pt-3 text-[12px] font-semibold" style={{ color: 'var(--text-faint)' }}>
        <span className="h-2 w-2 rounded-full" style={{ background: 'var(--inv-ok)' }} />
        <button onClick={onSetup} className="underline-offset-2 hover:underline">
          Kept in Google Drive
        </button>
        {unlinked > 0 && (
          <button onClick={onImport} className="inv-btn ml-auto !px-3 !py-1.5 !text-[12.5px]">
            <Icon name="box" size={14} /> {unlinked} folder{unlinked === 1 ? '' : 's'} in Drive to bring in
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl p-3.5 lg:flex-row lg:items-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <span className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5" style={{ color: 'var(--inv-orange)' }}>
          <Icon name="link" size={18} />
        </span>
        <span className="text-[13px] leading-snug" style={{ color: 'var(--text-dim)' }}>
          <b style={{ color: 'var(--text)' }}>Photos and paperwork are kept in Google Drive.</b>{' '}
          {!isConfigured()
            ? 'This copy of the app is running on its own, so Drive is off — details still save.'
            : error && !/isn't connected/.test(error)
              ? error
              : owner
                ? 'Connect it once and every item gets a folder in Joint Stuff › Warranties, manuals, extra parts.'
                : 'Ask Avi or Jackie to connect it. Details can go in now; photos once it is.'}
        </span>
      </span>
      {owner && isConfigured() && (
        <button onClick={onSetup} className="inv-btn shrink-0">
          Connect Google Drive
        </button>
      )}
    </div>
  )
}

function EmptyShelf({ onReceive }: { onReceive: () => void }) {
  return (
    <div className="mx-auto mt-10 flex max-w-[420px] flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center" style={{ border: '2px dashed var(--border-strong)' }}>
      <span style={{ color: 'var(--inv-box-edge)' }}>
        <Icon name="box" size={52} strokeWidth={1.3} />
      </span>
      <span className="inv-stencil text-[18px]">The shelf is empty</span>
      <p className="text-[13.5px] leading-snug" style={{ color: 'var(--text-dim)' }}>
        Add the things worth keeping the paperwork for — the cooler, the vacuum, the drill — with a photo of each, its spare parts, and its warranty.
      </p>
      <button onClick={onReceive} className="inv-btn inv-btn--orange mt-1">
        <Icon name="plus" size={16} strokeWidth={2.8} /> Receive the first item
      </button>
    </div>
  )
}
