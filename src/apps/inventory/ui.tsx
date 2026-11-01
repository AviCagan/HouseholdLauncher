import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { formatPrice } from '@/lib/money'
import type { InventoryFile, InventoryItem } from '@/data/types'
import { usePreview } from './hooks'
import { QrCode } from './QrCode'
import { itemUrl } from './links'
import { GOOGLE_DOC, isImage, stockCode, warranty } from './model'

export function WarrantyBadge({ item, short = false }: { item: Pick<InventoryItem, 'warranty_until'>; short?: boolean }) {
  const w = warranty(item)
  if (short && w.state === 'none') return null
  const text = short
    ? w.state === 'active'
      ? 'Covered'
      : w.state === 'soon'
        ? `${w.daysLeft}d left`
        : 'Expired'
    : w.label
  return (
    <span className="inv-badge" data-state={w.state}>
      <Icon name={w.state === 'expired' ? 'close' : w.state === 'none' ? 'clock' : 'checkCircle'} size={11} strokeWidth={2.6} />
      {text}
    </span>
  )
}

/** One item, as a box on the shelf. */
export function ItemBox({ item, onOpen, busy }: { item: InventoryItem; onOpen: () => void; busy?: string }) {
  const photo = usePreview(item.cover_file_id, 360, item.cover_thumb)
  const counts = {
    parts: item.files.filter((f) => f.kind === 'part').length,
    docs: item.files.filter((f) => f.kind === 'doc').length,
  }
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      onClick={onOpen}
      className="inv-box"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: 'var(--inv-box-shade)' }}>
        {photo ? (
          <img src={photo} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center" style={{ color: 'var(--inv-box-edge)' }}>
            <Icon name="box" size={46} strokeWidth={1.4} />
          </span>
        )}
        <span className="absolute right-2 top-2 z-[4]">
          <WarrantyBadge item={item} short />
        </span>
      </div>
      <div className="inv-label">
        <span className="block truncate text-[14.5px] font-extrabold leading-tight">{item.name}</span>
        <span className="block truncate text-[11.5px]" style={{ color: 'var(--inv-ink-dim)' }}>
          {[item.brand, item.store, item.price_cents != null ? formatPrice(item.price_cents) : null].filter(Boolean).join(' · ') || ' '}
        </span>
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <QrCode value={itemUrl(item.id)} size={30} label={`QR code for ${item.name}`} className="shrink-0" />
            <span className="inv-code">{stockCode(item.id)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--inv-ink-faint)' }}>
            {counts.parts > 0 && (
              <span title={`${counts.parts} extra part${counts.parts === 1 ? '' : 's'}`} className="flex items-center gap-0.5">
                <Icon name="sparkle" size={11} /> {counts.parts}
              </span>
            )}
            {counts.docs > 0 && (
              <span title={`${counts.docs} paper${counts.docs === 1 ? '' : 's'}`} className="flex items-center gap-0.5">
                <Icon name="file" size={11} /> {counts.docs}
              </span>
            )}
          </span>
        </div>
        {busy && (
          <span className="mt-1 block truncate text-[11px] font-semibold" style={{ color: 'var(--inv-orange)' }}>
            {busy}
          </span>
        )}
      </div>
    </motion.button>
  )
}

/** A file in an item's grid: its picture, or a glyph for what it is. */
export function FileTile({ file, onOpen, isCover = false }: { file: InventoryFile; onOpen: () => void; isCover?: boolean }) {
  const picture = usePreview(file.id, 240)
  const glyph: IconName = file.mime === 'application/pdf' || file.mime === GOOGLE_DOC ? 'file' : isImage(file.mime) ? 'camera' : 'file'
  return (
    <button onClick={onOpen} className="inv-tile text-left" title={file.name}>
      {picture ? (
        <img src={picture} alt={file.name} loading="lazy" />
      ) : (
        <span className="grid h-full w-full place-items-center p-2 text-center" style={{ color: 'var(--text-faint)' }}>
          <span className="flex flex-col items-center gap-1">
            <Icon name={glyph} size={22} />
            <span className="line-clamp-2 text-[10.5px] font-semibold leading-tight">{file.name}</span>
          </span>
        </span>
      )}
      {!isImage(file.mime) && picture && (
        <span className="absolute inset-x-0 bottom-0 truncate px-1.5 py-1 text-[10px] font-bold text-white" style={{ background: 'rgb(0 0 0 / 0.55)' }}>
          {file.name}
        </span>
      )}
      {isCover && (
        <span className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-black uppercase" style={{ background: 'var(--inv-yellow)', color: '#1d1b18' }}>
          Overall
        </span>
      )}
    </button>
  )
}

export function SectionHead({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pb-2 pt-5">
      <h3 className="inv-stencil text-[13px]" style={{ color: 'var(--text-dim)' }}>
        {title}
      </h3>
      {count !== undefined && count > 0 && (
        <span className="text-[12px] font-bold" style={{ color: 'var(--text-faint)' }}>
          {count}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">{children}</span>
    </div>
  )
}

/** A small button that opens the phone's camera or file picker. */
export function PickButton({
  icon,
  label,
  accept,
  multiple = false,
  capture,
  onPick,
  disabled,
}: {
  icon: IconName
  label: string
  accept: string
  multiple?: boolean
  capture?: 'environment'
  onPick: (files: File[]) => void
  disabled?: boolean
}) {
  return (
    <label
      className={`inv-btn inv-btn--quiet !px-2.5 !py-1.5 !text-[12.5px] ${disabled ? 'pointer-events-none opacity-45' : 'cursor-pointer'}`}
      aria-disabled={disabled || undefined}
    >
      <Icon name={icon} size={14} strokeWidth={2.4} />
      {label}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          // Clear it, so picking the same file twice in a row still fires.
          e.target.value = ''
          if (files.length) onPick(files)
        }}
      />
    </label>
  )
}
