import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Icon, type IconName } from '@/components/primitives/Icon'
import { UrgencySpine } from '@/components/primitives/UrgencySpine'
import { ClaimChip, Avatar } from '@/components/primitives/ClaimChip'
import { CooldownRing } from '@/components/primitives/CooldownRing'
import { DesireMeter } from '@/components/primitives/DesireMeter'
import { describeRecurrence, cooldownProgress, readyIn } from '@/lib/time'
import { formatDeadline, isOverdue } from '@/lib/deadline'
import { formatPrice } from '@/lib/money'
import { domainOf } from '@/lib/unfurl'
import { googleEventUrl } from '@/lib/calendar'
import { dataActions } from '@/store/useData'
import type { Profile } from '@/data/types'
import type { RowModel } from './model'

/**
 * One row on the Things board.
 *
 * The phone row is a gesture surface — swipe right to finish, left to claim,
 * hold to edit — and every one of those is awkward with a trackpad. Here each
 * is a thing you can see and click: the circle finishes it, the avatar or the
 * Claim button claims it, and edit, calendar, link and delete appear when the
 * pointer is over the row or the keyboard is on it. A click selects the row
 * for the keyboard; a double-click opens it.
 */

export interface RowHandlers {
  onSelect: () => void
  onToggle: () => void
  onClaim: () => void
  onEdit: () => void
  onAskDelete: () => void
  onDelete: () => void
  onCancelDelete: () => void
}

export function DeskRow({
  model,
  selected,
  confirming,
  profiles,
  now,
  nameOf,
  handlers,
}: {
  model: RowModel
  selected: boolean
  confirming: boolean
  profiles: Profile[]
  now: number
  nameOf: (id: string) => string
  handlers: RowHandlers
}) {
  const { kind, row, done } = model
  const resting = model.kind === 'chore' && model.resting
  const claimable = !done && !resting && kind !== 'wish'
  const claimedBy = 'claimed_by' in row ? row.claimed_by : null
  const image = 'image_url' in row ? row.image_url : null
  const url = 'url' in row ? row.url : null

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
      data-row-id={model.id}
      data-selected={selected || undefined}
      onClick={handlers.onSelect}
      onDoubleClick={handlers.onEdit}
      className="desk-row relative flex cursor-default items-center gap-2.5 rounded-[14px] py-2 pl-3.5 pr-2"
      style={{
        background: resting || done ? 'var(--surface-2)' : 'var(--surface)',
        border: 'var(--card-border)',
        boxShadow: done || resting ? 'none' : 'var(--card-shadow)',
        opacity: done ? 0.72 : resting ? 0.85 : 1,
      }}
    >
      {kind !== 'wish' && !done && !resting && 'urgency' in row && <UrgencySpine urgency={row.urgency} />}

      {resting && model.kind === 'chore' ? (
        <CooldownRing progress={cooldownProgress(model.row, now)} size={22} stroke={2.5} />
      ) : (
        <CheckButton done={done} onClick={handlers.onToggle} label={doneLabel(model)} />
      )}

      {image && (
        <img
          src={image}
          alt=""
          loading="lazy"
          className="h-8 w-8 shrink-0 rounded-md object-cover"
          style={{ border: '1px solid var(--border)' }}
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      )}

      <div className="min-w-0 flex-1">
        <div
          className="row-title truncate text-[14px] font-medium leading-snug"
          title={row.title}
          style={{
            color: done || resting ? 'var(--text-dim)' : 'var(--text)',
            textDecoration: done ? 'line-through' : 'none',
          }}
        >
          {row.title}
        </div>
        <Meta model={model} now={now} nameOf={nameOf} />
      </div>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            autoFocus
            onClick={handlers.onDelete}
            className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-white"
            style={{ background: 'var(--danger)' }}
          >
            Delete
          </button>
          <button onClick={handlers.onCancelDelete} className="rounded-full px-2 py-1 text-[12px]" style={{ color: 'var(--text-dim)' }}>
            Keep
          </button>
        </span>
      ) : (
        // The trailing cluster — want meter, whose, who claimed it — keeps its
        // place; the hover actions float just to its left, over the end of the
        // title, so they never cost the title any width while hidden.
        <span className="relative flex shrink-0 items-center gap-1.5">
          <span
            className="desk-row-actions absolute right-full top-1/2 flex -translate-y-1/2 items-center py-1 pl-7 pr-1"
            style={{ background: `linear-gradient(to right, transparent, ${done || resting ? 'var(--surface-2)' : 'var(--surface)'} 24px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            {model.kind === 'chore' && !done && <CalendarAction model={model} />}
            {url && <RowAction icon="link" label="Open link (O)" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} />}
            <RowAction icon="pencil" label="Edit (E)" onClick={handlers.onEdit} />
            <RowAction icon="trash" label="Delete (Del)" onClick={handlers.onAskDelete} />
            {claimable && !claimedBy && (
              <button
                onClick={handlers.onClaim}
                title="Claim (C)"
                className="ml-0.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                style={{ background: 'var(--accent-soft)', border: 'var(--claim-border)', color: 'var(--accent-text)' }}
              >
                Claim
              </button>
            )}
          </span>
          {model.kind === 'wish' && <WishTrail model={model} profiles={profiles} />}
          {claimedBy && (
            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
              <ClaimChip claimedBy={claimedBy} profiles={profiles} onClick={claimable ? handlers.onClaim : undefined} size={24} compact />
            </span>
          )}
        </span>
      )}
    </motion.div>
  )
}

function doneLabel(m: RowModel): string {
  if (m.kind === 'shop' || m.kind === 'wish') return m.done ? 'Mark not bought' : 'Mark bought'
  return m.done ? 'Mark not done' : 'Mark done'
}

function CheckButton({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={label}
      title={`${label} (X)`}
      className="desk-hover grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full"
      style={{
        border: `2px solid ${done ? 'var(--ok)' : 'var(--border-strong)'}`,
        background: done ? 'var(--ok)' : 'transparent',
        color: '#fff',
      }}
    >
      {done && <Icon name="check" size={11} strokeWidth={3.4} />}
    </button>
  )
}

function RowAction({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="desk-hover grid h-7 w-7 place-items-center rounded-full"
      style={{ color: 'var(--text-faint)' }}
    >
      <Icon name={icon} size={14} />
    </button>
  )
}

function CalendarAction({ model }: { model: Extract<RowModel, { kind: 'chore' }> }) {
  const url = googleEventUrl(model.row)
  if (!url) return null
  return <RowAction icon="calendar" label="Add to Google Calendar" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} />
}

function Meta({ model, now, nameOf }: { model: RowModel; now: number; nameOf: (id: string) => string }) {
  const bits: ReactNode[] = []

  if (model.kind === 'todo') {
    const t = model.row
    if (model.done && t.completed_by) bits.push(<span key="by">Finished by {nameOf(t.completed_by)}</span>)
    else if (t.due_at)
      bits.push(
        <span key="due" className="flex items-center gap-1" style={{ color: isOverdue(t.due_at) ? 'var(--danger)' : undefined }}>
          <Icon name="clock" size={11} strokeWidth={2.4} />
          {formatDeadline(t.due_at)}
        </span>,
      )
    if (t.notes) bits.push(<span key="notes" className="truncate">{t.notes}</span>)
  }

  if (model.kind === 'chore') {
    const c = model.row
    if (model.resting) {
      bits.push(<span key="ready">Ready in {readyIn(c, now)}</span>)
      if (c.last_completed_by) bits.push(<span key="by">{nameOf(c.last_completed_by)} did it</span>)
    } else if (c.is_recurring) {
      bits.push(
        <span key="rec" className="flex items-center gap-1">
          <Icon name="repeat" size={11} strokeWidth={2.4} />
          {describeRecurrence(c.recurrence_count, c.recurrence_unit, c.recurrence_days)}
        </span>,
      )
    }
  }

  if (model.kind === 'shop') {
    const i = model.row
    if (i.quantity) bits.push(<span key="q">{i.quantity}</span>)
    if (model.done && model.store) bits.push(<span key="s">{model.store.name}</span>)
    if (i.url) bits.push(<span key="u">{domainOf(i.url)}</span>)
    if (i.price_cents != null) bits.push(<span key="p">{formatPrice(i.price_cents)}</span>)
  }

  if (model.kind === 'wish') {
    const w = model.row
    if (w.price_cents != null) bits.push(<span key="p" className="tabular-nums">{formatPrice(w.price_cents)}</span>)
    if (w.url) bits.push(<span key="u">{domainOf(w.url)}</span>)
  }

  if (bits.length === 0) return null
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-2 truncate text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
      {bits.map((b, i) => (
        <span key={i} className="flex min-w-0 items-center gap-2">
          {i > 0 && <span style={{ color: 'var(--text-faint)' }}>·</span>}
          {b}
        </span>
      ))}
    </div>
  )
}

/** How badly, and whose — the two things a wish has that a to-do doesn't. */
function WishTrail({ model, profiles }: { model: Extract<RowModel, { kind: 'wish' }>; profiles: Profile[] }) {
  const w = model.row
  const owner = profiles.find((p) => p.id === w.owner_id) ?? null
  return (
    <span className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <DesireMeter
        size="sm"
        value={w.desire_level}
        onChange={(next) => void dataActions.patchRow('wishlist_items', w.id, { desire_level: next })}
      />
      {owner ? (
        <span title={`For ${owner.display_name}`}>
          <Avatar profile={owner} size={22} />
        </span>
      ) : (
        <span title="For both of you" className="flex h-[22px] w-[22px] items-center justify-center" aria-label="For both of you">
          {profiles.slice(0, 2).map((p, i) => (
            <span
              key={p.id}
              className="block h-2.5 w-2.5 rounded-full"
              style={{ background: p.color_hex, marginLeft: i === 0 ? 0 : -3, border: '1px solid var(--surface)' }}
            />
          ))}
        </span>
      )}
    </span>
  )
}
