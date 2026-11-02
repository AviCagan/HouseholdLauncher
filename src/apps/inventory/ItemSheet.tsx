import { useEffect, useRef, useState } from 'react'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { useProfile } from '@/store/useProfile'
import { formatPrice } from '@/lib/money'
import { openExternal } from '@/apps/things/routing/deeplink'
import type { InventoryFile, InventoryFileKind, InventoryItem } from '@/data/types'
import { addFiles, ensureItemFolder, removeFile, removeItem, scanIntoItem, setCover, setKind, syncItem, updateItem, useInventoryBusy } from './actions'
import { hasGoogleScanner } from './scanner'
import { useDesktop } from '@/lib/useDesktop'
import { toast } from 'sonner'
import { useDrive } from './drive'
import { DetailsForm } from './forms'
import { draftOf, inputOf, priceProblem, type Draft } from './draft'
import { KIND_LABEL, isImage, shortDate, stockCode } from './model'
import { FileTile, PhotoButtons, PickButton, SectionHead, WarrantyBadge } from './ui'
import { QrCode } from './QrCode'
import { itemUrl } from './links'
import { usePreview } from './hooks'

/**
 * One item, everything about it: the overall photo, the extra parts, the
 * paperwork, the details and the notes. Files are added straight into the
 * item's Drive folder; the page shows what's there.
 */
export function ItemSheet({ itemId, onClose, onPrintLabel }: { itemId: string | null; onClose: () => void; onPrintLabel: (id: string) => void }) {
  const live = useData((s) => (itemId ? s.inventory_items.find((i) => i.id === itemId) ?? null : null))
  // Held for the closing animation, which plays after the row is gone when
  // the item has just been removed.
  const last = useRef<InventoryItem | null>(null)
  if (live) last.current = live
  const item = live ?? last.current

  return (
    <Sheet open={itemId !== null && live !== null} onClose={onClose} height="94vh" title={item ? <Title item={item} /> : null}>
      {item && <ItemBody key={item.id} item={item} onClose={onClose} onPrintLabel={() => onPrintLabel(item.id)} />}
    </Sheet>
  )
}

function Title({ item }: { item: InventoryItem }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate text-[17px] font-extrabold">{item.name}</span>
      <span className="inv-code shrink-0">{stockCode(item.id)}</span>
    </span>
  )
}

function ItemBody({ item, onClose, onPrintLabel }: { item: InventoryItem; onClose: () => void; onPrintLabel: () => void }) {
  const profileId = useProfile((s) => s.profileId)
  const connected = useDrive((s) => s.status?.connected === true)
  const busy = useInventoryBusy((s) => s.busy[item.id])
  const [fileId, setFileId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => draftOf(item))
  const [notes, setNotes] = useState(item.notes ?? '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const hero = usePreview(item.cover_file_id, 1000, item.cover_thumb)
  const desktop = useDesktop()
  const googleScanner = hasGoogleScanner()

  // Opening an item checks its folder once, so anything added in Drive
  // directly — or by the other phone — is here without a manual refresh.
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current || !connected || !item.drive_folder_id) return
    synced.current = true
    void syncItem(item.id, true)
  }, [connected, item.id, item.drive_folder_id])

  /*
    Coming back to the app — from the Drive app after scanning there, or from
    anywhere — checks the folder again, so the new scan is on the page by the
    time you look.
  */
  useEffect(() => {
    if (!connected || !item.drive_folder_id) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncItem(item.id, true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [connected, item.id, item.drive_folder_id])

  /**
   * Scan paperwork with Google's scanner. In the Android app it opens right
   * here; anywhere else it opens the item's folder in the Drive app, where
   * the same scanner is behind + → Scan and the PDF lands in this folder.
   */
  function scan() {
    if (googleScanner) {
      void scanIntoItem(item.id)
      return
    }
    const howTo = { description: 'In Drive, tap + then Scan. It saves into this item’s folder, and shows up here when you come back.', duration: 9000 }
    if (item.drive_folder_url) {
      // Opened within the tap, or iPhone treats it as a pop-up and blocks it.
      openExternal(item.drive_folder_url)
      toast('Opening the item’s folder in Google Drive', howTo)
      return
    }
    void ensureItemFolder(item.id).then(() => {
      const url = useData.getState().inventory_items.find((i) => i.id === item.id)?.drive_folder_url
      if (url) toast('The item’s Drive folder is ready', { ...howTo, action: { label: 'Open Drive', onClick: () => openExternal(url) } })
    })
  }

  // Someone else's edit to the notes shows up, unless you're mid-sentence.
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setNotes(item.notes ?? '')
  }, [item.notes])

  const saveNotes = () => {
    typing.current = false
    if ((item.notes ?? '') !== notes) updateItem(item.id, { notes }, profileId)
  }

  const byKind = (kind: InventoryFileKind) => item.files.filter((f) => f.kind === kind)
  const photos = byKind('photo')
  const parts = byKind('part')
  const docs = byKind('doc')
  const open = item.files.find((f) => f.id === fileId) ?? null

  return (
    <div className="flex flex-col pb-6">
      <div className="relative -mx-5 overflow-hidden" style={{ background: 'var(--inv-box-shade)' }}>
        {hero ? (
          <button onClick={() => item.cover_file_id && setFileId(item.cover_file_id)} className="block w-full">
            <img src={hero} alt={item.name} className="max-h-[360px] w-full object-contain" />
          </button>
        ) : (
          <div className="grid h-[180px] place-items-center" style={{ color: 'var(--inv-box-edge)' }}>
            <span className="flex flex-col items-center gap-2 text-[12.5px] font-bold">
              <Icon name="box" size={54} strokeWidth={1.3} />
              No overall photo yet
            </span>
          </div>
        )}
        <div className="inv-hazard absolute inset-x-0 bottom-0 !rounded-none" aria-hidden />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3">
        <WarrantyBadge item={item} />
        {item.location && (
          <span className="inv-badge" data-state="none">
            <Icon name="pin" size={11} strokeWidth={2.6} />
            {item.location}
          </span>
        )}
        {busy && (
          <span className="text-[12px] font-bold" style={{ color: 'var(--inv-orange)' }}>
            {busy}
          </span>
        )}
      </div>

      {!connected && (
        <p className="mt-3 rounded-xl px-3 py-2.5 text-[12.5px] leading-snug" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}>
          Photos, parts and paperwork are kept in Google Drive. Once Drive is connected (from the Inventory screen), they go on here.
        </p>
      )}

      <SectionHead title="Overall" count={photos.length}>
        <PhotoButtons label="Add photo" multiple disabled={!connected} onPick={(f) => void addFiles(item.id, f, 'photo')} />
      </SectionHead>
      <Tiles files={photos} coverId={item.cover_file_id} onOpen={setFileId} empty="The whole thing, with everything that came with it." />

      <SectionHead title="Extra parts" count={parts.length}>
        <PhotoButtons label="Add part" multiple disabled={!connected} onPick={(f) => void addFiles(item.id, f, 'part')} />
      </SectionHead>
      <Tiles files={parts} coverId={item.cover_file_id} onOpen={setFileId} empty="Spares, accessories, the bits in the bag — so you know what you have and what it looks like." />

      <SectionHead title="Paperwork" count={docs.length}>
        {!desktop && (
          <button
            onClick={scan}
            disabled={!connected}
            className="inv-btn inv-btn--quiet !px-2.5 !py-1.5 !text-[12.5px]"
            title={googleScanner ? "Google's document scanner — the one in Google Drive" : 'Scan in the Google Drive app'}
          >
            <Icon name="camera" size={14} strokeWidth={2.4} /> {googleScanner ? 'Scan' : 'Scan in Drive'}
          </button>
        )}
        <PickButton icon="file" label="Add file" accept="application/pdf,image/*" multiple disabled={!connected} onPick={(f) => void addFiles(item.id, f, 'doc')} />
      </SectionHead>
      <Tiles files={docs} coverId={null} onOpen={setFileId} empty="The manual, the warranty, the receipt — scan the paper ones, add PDFs as they are." />

      <SectionHead title="Label">
        <button onClick={onPrintLabel} className="inv-btn inv-btn--quiet !px-2.5 !py-1.5 !text-[12.5px]">
          <Icon name="file" size={14} /> Print label
        </button>
      </SectionHead>
      <div className="flex items-center gap-4">
        <div className="shrink-0 rounded-lg bg-white p-1.5" style={{ border: '1px solid var(--border)' }}>
          <QrCode value={itemUrl(item.id)} size={112} label={`QR code for ${item.name}`} />
        </div>
        <p className="text-[12.5px] leading-snug" style={{ color: 'var(--text-dim)' }}>
          Scan this with a phone camera to open <b style={{ color: 'var(--text)' }}>{item.name}</b> here. Print it as a label for the item, its box or its bag of spare parts — any
          size, with the name underneath.
          <span className="inv-code mt-1 block">{stockCode(item.id)}</span>
        </p>
      </div>

      <SectionHead title="Details">
        {editing ? (
          <>
            <button onClick={() => setEditing(false)} className="inv-btn inv-btn--quiet !px-2.5 !py-1.5 !text-[12.5px]">
              Cancel
            </button>
            <button
              onClick={() => {
                const input = inputOf(draft)
                delete (input as Partial<typeof input>).notes
                updateItem(item.id, input, profileId)
                setEditing(false)
              }}
              disabled={!draft.name.trim() || !!priceProblem(draft)}
              className="inv-btn !px-3 !py-1.5 !text-[12.5px]"
            >
              Save
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              setDraft(draftOf(item))
              setEditing(true)
            }}
            className="inv-btn inv-btn--quiet !px-2.5 !py-1.5 !text-[12.5px]"
          >
            <Icon name="pencil" size={13} /> Edit
          </button>
        )}
      </SectionHead>
      {editing ? <DetailsForm draft={draft} onChange={setDraft} withNotes={false} /> : <Facts item={item} />}

      <SectionHead title="Notes" />
      <textarea
        value={notes}
        onChange={(e) => {
          typing.current = true
          setNotes(e.target.value)
        }}
        onBlur={saveNotes}
        rows={5}
        aria-label="Notes"
        className="inv-field resize-y leading-snug"
      />
      <p className="pt-1 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
        Saved when you leave the box{connected ? ', and copied to a doc in the item’s Drive folder' : ''}.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {item.drive_folder_url && (
          <button onClick={() => openExternal(item.drive_folder_url!)} className="inv-btn inv-btn--quiet">
            <Icon name="link" size={14} /> Open folder in Drive
          </button>
        )}
        {connected && item.drive_folder_id && (
          <button onClick={() => void syncItem(item.id)} className="inv-btn inv-btn--quiet">
            <Icon name="repeat" size={14} /> Check Drive
          </button>
        )}
        <button
          onClick={() => {
            if (!confirmRemove) {
              setConfirmRemove(true)
              return
            }
            onClose()
            removeItem(item)
          }}
          className="inv-btn inv-btn--quiet ml-auto"
          style={confirmRemove ? { background: 'var(--inv-bad)', color: '#fff', borderColor: 'transparent' } : undefined}
        >
          <Icon name="trash" size={14} /> {confirmRemove ? 'Yes — the folder stays in Drive' : 'Remove'}
        </button>
      </div>

      <FileSheet item={item} file={open} onClose={() => setFileId(null)} />
    </div>
  )
}

function Tiles({ files, coverId, onOpen, empty }: { files: InventoryFile[]; coverId: string | null; onOpen: (id: string) => void; empty: string }) {
  if (files.length === 0) {
    return (
      <p className="rounded-xl px-3 py-3 text-[12.5px] leading-snug" style={{ border: '1.5px dashed var(--border-strong)', color: 'var(--text-faint)' }}>
        {empty}
      </p>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {files.map((f) => (
        <FileTile key={f.id} file={f} isCover={f.id === coverId} onOpen={() => onOpen(f.id)} />
      ))}
    </div>
  )
}

function Facts({ item }: { item: InventoryItem }) {
  const rows: [string, string | null][] = [
    ['Brand', [item.brand, item.model].filter(Boolean).join(' · ') || null],
    ['Category', item.category],
    ['Bought at', item.store],
    ['Price', item.price_cents != null ? formatPrice(item.price_cents) : null],
    ['Paid for by', item.paid_by],
    ['Bought on', item.purchased_on ? shortDate(item.purchased_on) : null],
    ['Warranty', item.warranty_lifetime ? 'Lifetime' : item.warranty_until ? `Until ${shortDate(item.warranty_until)}` : null],
    ['Kept in', item.location],
  ]
  const filled = rows.filter(([, v]) => v)
  if (filled.length === 0) {
    return (
      <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
        Nothing filled in yet.
      </p>
    )
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
      {filled.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="inv-stencil pt-0.5 text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
            {k}
          </dt>
          <dd className="min-w-0 break-words font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One file, large, with what can be done to it. */
function FileSheet({ item, file, onClose }: { item: InventoryItem; file: InventoryFile | null; onClose: () => void }) {
  const last = useRef<InventoryFile | null>(null)
  if (file) last.current = file
  const shown = file ?? last.current
  const picture = usePreview(shown?.id ?? null, 1600)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => setConfirm(false), [file?.id])

  return (
    <Sheet open={file !== null} onClose={onClose} title={<span className="truncate text-[15px] font-bold">{shown?.name}</span>}>
      {shown && (
        <div className="flex flex-col gap-4 pb-4">
          <div className="grid min-h-[200px] place-items-center overflow-hidden rounded-xl" style={{ background: 'var(--surface-2)' }}>
            {picture ? (
              <img src={picture} alt={shown.name} className="max-h-[60vh] w-full object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-2 p-8 text-[12.5px] font-semibold" style={{ color: 'var(--text-faint)' }}>
                <Icon name="file" size={36} />
                No preview — open it in Drive
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="inv-stencil text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
              Filed under
            </span>
            <div className="flex gap-1.5">
              {(['photo', 'part', 'doc'] as InventoryFileKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(item.id, shown.id, k)}
                  aria-pressed={shown.kind === k}
                  className="inv-btn !px-3 !py-1.5 !text-[12.5px]"
                  style={shown.kind === k ? undefined : { background: 'var(--surface)', boxShadow: 'none', borderColor: 'var(--border)' }}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {isImage(shown.mime) && item.cover_file_id !== shown.id && (
              <button onClick={() => void setCover(item.id, shown.id)} className="inv-btn">
                <Icon name="star" size={14} /> Make this the overall photo
              </button>
            )}
            <button onClick={() => openExternal(shown.url)} className="inv-btn inv-btn--quiet">
              <Icon name="link" size={14} /> Open in Drive
            </button>
            <button
              onClick={() => {
                if (!confirm) {
                  setConfirm(true)
                  return
                }
                onClose()
                void removeFile(item.id, shown.id)
              }}
              className="inv-btn inv-btn--quiet ml-auto"
              style={confirm ? { background: 'var(--inv-bad)', color: '#fff', borderColor: 'transparent' } : undefined}
            >
              <Icon name="trash" size={14} /> {confirm ? 'Move to Drive’s trash' : 'Remove'}
            </button>
          </div>
          <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            Added {shortDate(shown.added_at.slice(0, 10))}
            {shown.size ? ` · ${(shown.size / 1024 / 1024).toFixed(shown.size > 1024 * 1024 ? 1 : 2)} MB` : ''}. Removing it moves it to Drive’s trash, where it stays for 30 days.
          </p>
        </div>
      )}
    </Sheet>
  )
}
