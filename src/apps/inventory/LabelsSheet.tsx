import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useData } from '@/store/useData'
import { fire } from '@/lib/haptics'
import { MARGIN, PAGE_H, PAGE_W, PT_PER_IN, QR_MAX, QR_MIN, QR_PRESETS, QR_STEP, labelFileName, labelLayout, labelsPdf, sizeLabel } from './labels'
import { itemUrl } from './links'
import { stockCode } from './model'
import { QrCode } from './QrCode'
import { savePdf } from './savePdf'

/**
 * Print labels: pick the items, drag the size, get a PDF.
 *
 * The size is the QR code's, in inches, because that is what has to fit on
 * the thing it's stuck to. Dragging the slider redraws the label and the page
 * at once, so "will a sheet of these fit on the bins" is answered before
 * anything is printed. The last size used is remembered on this device.
 */

const SIZE_KEY = 'inv:label-inches'

function readSize(): number {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY))
    return v >= QR_MIN && v <= QR_MAX ? v : 1.25
  } catch {
    return 1.25
  }
}

const snap = (n: number) => Math.min(QR_MAX, Math.max(QR_MIN, Math.round(n / QR_STEP) * QR_STEP))

export function LabelsSheet({ open, onClose, only }: { open: boolean; onClose: () => void; only: string[] | null }) {
  const items = useData((s) => s.inventory_items)
  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items])
  const [inches, setInches] = useState(readSize)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPicked(new Set(only ?? items.map((i) => i.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const setSize = (n: number) => {
    const v = snap(n)
    setInches(v)
    try {
      localStorage.setItem(SIZE_KEY, String(v))
    } catch {
      /* private mode: forgotten next time, which is fine */
    }
  }

  const L = labelLayout(inches)
  const chosen = sorted.filter((i) => picked.has(i.id))
  const pages = Math.max(1, Math.ceil(chosen.length / L.perPage))
  const sample = chosen[0] ?? sorted[0]
  const fitted = Math.abs(L.qr - inches * PT_PER_IN) > 0.5

  async function make() {
    if (chosen.length === 0) return
    setBusy(true)
    try {
      const pdf = await labelsPdf(chosen, inches)
      await savePdf(pdf, labelFileName(chosen))
      fire('success')
    } catch (err) {
      fire('error')
      toast.error("Couldn't make the labels", { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} height="94vh" title={<span className="inv-stencil text-[16px]">Print labels</span>}>
      <div className="flex flex-col gap-4 pb-6">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="inv-stencil text-[11px]" style={{ color: 'var(--text-faint)' }}>
              QR code size
            </span>
            <span className="text-[17px] font-black tabular-nums">{sizeLabel(inches)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => setSize(inches - QR_STEP)} aria-label="Smaller" className="inv-btn inv-btn--quiet !h-10 !w-10 !p-0 text-[20px]">
              −
            </button>
            <input
              type="range"
              min={QR_MIN}
              max={QR_MAX}
              step={QR_STEP}
              value={inches}
              onChange={(e) => setSize(Number(e.target.value))}
              aria-label="QR code size in inches"
              className="h-10 min-w-0 flex-1 cursor-pointer"
              style={{ accentColor: 'var(--inv-orange)' }}
            />
            <button onClick={() => setSize(inches + QR_STEP)} aria-label="Bigger" className="inv-btn inv-btn--quiet !h-10 !w-10 !p-0 text-[20px]">
              +
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QR_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setSize(p.inches)}
                aria-pressed={inches === p.inches}
                className="rounded-full px-3 py-1.5 text-[12.5px] font-bold"
                style={{
                  background: inches === p.inches ? 'var(--inv-ink)' : 'var(--surface)',
                  color: inches === p.inches ? 'var(--inv-floor)' : 'var(--text-dim)',
                  border: `1px solid ${inches === p.inches ? 'var(--inv-ink)' : 'var(--border)'}`,
                }}
              >
                {p.label} · {p.inches}″
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] font-semibold" style={{ color: 'var(--text-dim)' }}>
            {L.perPage} {L.perPage === 1 ? 'label' : 'labels'} a page
            {chosen.length > 0 && ` · ${pages} ${pages === 1 ? 'page' : 'pages'} for ${chosen.length}`}
            {fitted && ' · shrunk to fit the page'}
          </p>
        </div>

        <div className="flex items-start gap-4">
          {/* The page, to scale: how many fit, and how they sit. */}
          <PagePreview inches={inches} count={Math.min(chosen.length || 1, L.perPage)} />
          {/* One label, at about real size on a laptop screen (CSS inches). */}
          <div className="min-w-0 flex-1 overflow-hidden">
            {sample && (
              <div
                className="mx-auto flex flex-col items-center rounded-md bg-white px-[6%] pb-2 pt-[6%] text-center"
                style={{ width: `min(100%, ${L.cellW / PT_PER_IN}in)`, border: '1px dashed #999', color: '#111' }}
              >
                <QrCode value={itemUrl(sample.id)} size="100%" label={`QR code for ${sample.name}`} />
                <span className="mt-1 line-clamp-2 font-bold leading-tight" style={{ fontSize: `${(L.fontSize / PT_PER_IN) * 96}px` }}>
                  {sample.name}
                </span>
                <span className="whitespace-nowrap font-mono" style={{ fontSize: `${(L.codeSize / PT_PER_IN) * 96}px`, color: '#888' }}>
                  {stockCode(sample.id).replace('·', '-')}
                </span>
              </div>
            )}
            <p className="mt-1.5 text-center text-[11px]" style={{ color: 'var(--text-faint)' }}>
              About actual size on a laptop screen
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 pb-1.5">
            <span className="inv-stencil text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Items · {chosen.length} of {sorted.length}
            </span>
            <button
              onClick={() => setPicked(new Set(picked.size === sorted.length ? [] : sorted.map((i) => i.id)))}
              className="ml-auto text-[12.5px] font-bold"
              style={{ color: 'var(--inv-orange)' }}
            >
              {picked.size === sorted.length ? 'None' : 'All'}
            </button>
          </div>
          <div className="flex max-h-[34vh] flex-col overflow-y-auto rounded-xl" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            {sorted.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-center gap-3 px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <input
                  type="checkbox"
                  checked={picked.has(item.id)}
                  onChange={() =>
                    setPicked((p) => {
                      const next = new Set(p)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      return next
                    })
                  }
                  className="h-4 w-4"
                  style={{ accentColor: 'var(--inv-orange)' }}
                />
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{item.name}</span>
                <span className="inv-code shrink-0">{stockCode(item.id)}</span>
              </label>
            ))}
          </div>
        </div>

        <button onClick={() => void make()} disabled={chosen.length === 0 || busy} className="inv-btn inv-btn--orange w-full !py-3 !text-[15px]">
          <Icon name="file" size={16} />
          {busy ? 'Making the PDF…' : `Make a PDF of ${chosen.length} ${chosen.length === 1 ? 'label' : 'labels'}`}
        </button>
        <p className="-mt-2 text-center text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          Print at 100% (“Actual size”), not “Fit to page”, so the codes come out the size chosen. Scanning one with a phone camera opens that item.
        </p>
      </div>
    </Sheet>
  )
}

/** A US Letter page in miniature, with the labels laid out on it. */
function PagePreview({ inches, count }: { inches: number; count: number }) {
  const L = labelLayout(inches)
  const scale = 112 / PAGE_W
  const left = (PAGE_W - L.cols * L.cellW) / 2
  const top = (PAGE_H - L.rows * L.cellH) / 2
  return (
    <svg width={PAGE_W * scale} height={PAGE_H * scale} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} className="shrink-0 rounded-sm" style={{ background: '#fff', boxShadow: '0 1px 4px rgb(0 0 0 / 0.25)' }} aria-hidden>
      <rect x={MARGIN} y={MARGIN} width={PAGE_W - 2 * MARGIN} height={PAGE_H - 2 * MARGIN} fill="none" stroke="#ddd" strokeWidth={2} strokeDasharray="6 6" />
      {Array.from({ length: L.perPage }, (_, i) => {
        const x = left + (i % L.cols) * L.cellW
        const y = top + Math.floor(i / L.cols) * L.cellH
        const filled = i < count
        return (
          <g key={i}>
            <rect x={x} y={y} width={L.cellW} height={L.cellH} fill="none" stroke="#bbb" strokeWidth={2} />
            <rect x={x + (L.cellW - L.qr) / 2} y={y + L.pad} width={L.qr} height={L.qr} fill={filled ? '#222' : '#eee'} />
          </g>
        )
      })}
    </svg>
  )
}
