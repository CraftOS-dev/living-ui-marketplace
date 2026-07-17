import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Star, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ColumnDef } from '@/lib/columns'
import { formatCurrency, formatDateShort, relativeTime } from '@/lib/format'
import type { RecordBrief, RecordRow } from '@/types'
import { api } from '@/api'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BriefAvatar } from '@/components/common/RecordAvatar'
import { Pill, DealStatusPill } from '@/components/common/Pill'

const DEAL_STATUS_OPTIONS = [
  { id: 'open', label: 'Open', color: '#7c9ce8' },
  { id: 'won', label: 'Won', color: '#4caf7d' },
  { id: 'lost', label: 'Lost', color: '#e08e8e' },
]

interface CellProps {
  row: RecordRow
  column: ColumnDef
  /** commit a new value; resolves when persisted (caller does optimistic UI) */
  onCommit: (value: unknown) => Promise<void> | void
}

/** Read rendering for any cell value. */
export function CellDisplay({ row, column }: { row: RecordRow; column: ColumnDef }) {
  const raw = column.attribute ? row.attributes?.[column.key] : (row as unknown as Record<string, unknown>)[column.key]

  switch (column.kind) {
    case 'currency': {
      const amount = typeof raw === 'number' ? raw : raw ? Number(raw) : null
      return amount === null || Number.isNaN(amount) ? (
        <Empty />
      ) : (
        <span className="tabular-nums">{formatCurrency(amount, row.currency)}</span>
      )
    }
    case 'number':
      return raw === null || raw === undefined || raw === '' ? <Empty /> : <span className="tabular-nums">{String(raw)}</span>
    case 'date':
      return raw ? <span>{formatDateShort(String(raw))}</span> : <Empty />
    case 'datetime':
      return raw ? <span className="text-muted-foreground">{relativeTime(String(raw))}</span> : <Empty />
    case 'checkbox':
      return raw ? <Check className="h-3.5 w-3.5 text-primary" /> : <Empty />
    case 'rating': {
      const rating = typeof raw === 'number' ? raw : Number(raw || 0)
      if (!rating) return <Empty />
      return (
        <span className="flex items-center gap-px" aria-label={`${rating} of 5`}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} className={cn('h-3 w-3', star <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
          ))}
        </span>
      )
    }
    case 'select': {
      const option = column.options?.find((opt) => opt.id === raw || opt.label === raw)
      return option ? <Pill label={option.label} color={option.color} /> : raw ? <span>{String(raw)}</span> : <Empty />
    }
    case 'multiselect': {
      const values = Array.isArray(raw) ? raw : raw ? [raw] : []
      if (values.length === 0) return <Empty />
      return (
        <span className="flex flex-wrap gap-1">
          {values.slice(0, 3).map((value) => {
            const option = column.options?.find((opt) => opt.id === value || opt.label === value)
            return <Pill key={String(value)} label={option?.label || String(value)} color={option?.color || '#8b8b94'} />
          })}
          {values.length > 3 ? <span className="text-xs text-muted-foreground">+{values.length - 3}</span> : null}
        </span>
      )
    }
    case 'deal-status':
      return raw ? <DealStatusPill status={String(raw)} /> : <Empty />
    case 'stage':
      return row.stage ? <Pill label={row.stage.name} color={row.stage.color} /> : <Empty />
    case 'company':
      return row.company ? (
        <button
          className="flex max-w-full items-center gap-1.5 truncate hover:underline"
          onClick={(event) => {
            event.stopPropagation()
            navigateTo(recordPath('company', row.company!.id))
          }}
        >
          <BriefAvatar brief={row.company} size="xs" />
          <span className="truncate">{row.company.name}</span>
        </button>
      ) : (
        <Empty />
      )
    case 'tags':
      return row.tags?.length ? (
        <span className="flex flex-wrap gap-1">
          {row.tags.slice(0, 3).map((tag) => (
            <Pill key={tag.id} label={tag.name} color={tag.color} />
          ))}
          {row.tags.length > 3 ? <span className="text-xs text-muted-foreground">+{row.tags.length - 3}</span> : null}
        </span>
      ) : (
        <Empty />
      )
    case 'email': {
      const email = Array.isArray(raw) ? raw[0] : raw
      return email ? <span className="truncate">{String(email)}</span> : <Empty />
    }
    case 'phone': {
      const phone = Array.isArray(raw) ? raw[0] : raw
      return phone ? <span className="truncate tabular-nums">{String(phone)}</span> : <Empty />
    }
    case 'url':
      return raw ? (
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{String(raw).replace(/^https?:\/\//, '')}</span>
          <a
            href={String(raw).startsWith('http') ? String(raw) : `https://${raw}`}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Open link"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>
      ) : (
        <Empty />
      )
    default:
      return raw ? <span className="truncate">{String(raw)}</span> : <Empty />
  }
}

function Empty() {
  return <span className="text-muted-foreground/50">—</span>
}

/**
 * Inline editor host (U-5): renders read state; on click switches to a
 * type-appropriate editor. Enter commits, Esc cancels.
 */
export function EditableCell({ row, column, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false)

  if (!column.editable) {
    return (
      <div className="flex min-h-[24px] items-center">
        <CellDisplay row={row} column={column} />
      </div>
    )
  }

  // Checkbox toggles directly without a popover
  if (column.kind === 'checkbox') {
    const raw = column.attribute ? row.attributes?.[column.key] : (row as unknown as Record<string, unknown>)[column.key]
    return (
      <div className="flex min-h-[24px] items-center" onClick={(event) => event.stopPropagation()}>
        <Checkbox checked={Boolean(raw)} onCheckedChange={(checked) => onCommit(checked === true)} />
      </div>
    )
  }

  // Picker-style editors render popovers over the read state
  if (['select', 'deal-status', 'multiselect', 'company', 'rating'].includes(column.kind)) {
    return <PickerCell row={row} column={column} onCommit={onCommit} />
  }

  if (!editing) {
    return (
      <div
        className="-mx-1 flex min-h-[24px] cursor-text items-center rounded px-1 hover:bg-accent/60"
        onClick={() => setEditing(true)}
      >
        <CellDisplay row={row} column={column} />
      </div>
    )
  }
  return <TextishEditor row={row} column={column} onCommit={onCommit} onDone={() => setEditing(false)} />
}

function TextishEditor({ row, column, onCommit, onDone }: CellProps & { onDone: () => void }) {
  const raw = column.attribute ? row.attributes?.[column.key] : (row as unknown as Record<string, unknown>)[column.key]
  const initial =
    column.kind === 'email' || column.kind === 'phone'
      ? String((Array.isArray(raw) ? raw[0] : raw) || '')
      : raw === null || raw === undefined
        ? ''
        : String(raw)
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = async () => {
    let parsed: unknown = value
    if (column.kind === 'number' || column.kind === 'currency') {
      parsed = value === '' ? null : Number(value)
      if (Number.isNaN(parsed)) parsed = null
    }
    if (!column.attribute && (column.kind === 'email' || column.kind === 'phone')) {
      // System emails/phones are arrays; replace the primary entry
      const list = Array.isArray(raw) ? [...raw] : []
      if (value) list[0] = value
      else list.shift()
      parsed = list
    }
    await onCommit(parsed)
    onDone()
  }

  const inputType =
    column.kind === 'number' || column.kind === 'currency' ? 'number' : column.kind === 'date' ? 'date' : 'text'

  return (
    <Input
      ref={inputRef}
      type={inputType}
      value={value}
      step={column.kind === 'currency' ? '0.01' : undefined}
      className="h-6 rounded border-primary px-1 text-[13px] shadow-none focus-visible:ring-1"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') onDone()
      }}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

function PickerCell({ row, column, onCommit }: CellProps) {
  const [open, setOpen] = useState(false)
  const [companyOptions, setCompanyOptions] = useState<RecordBrief[]>([])
  const [companyQuery, setCompanyQuery] = useState('')

  const raw = column.attribute ? row.attributes?.[column.key] : (row as unknown as Record<string, unknown>)[column.key]

  useEffect(() => {
    if (column.kind !== 'company' || !open) return
    const timer = window.setTimeout(() => {
      api
        .search(companyQuery || '', 8)
        .then((results) => setCompanyOptions(results.companies))
        .catch(() => setCompanyOptions([]))
    }, 150)
    return () => window.clearTimeout(timer)
  }, [companyQuery, open, column.kind])

  const options = column.kind === 'deal-status' ? DEAL_STATUS_OPTIONS : column.options || []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="-mx-1 flex min-h-[24px] cursor-pointer items-center rounded px-1 hover:bg-accent/60" onClick={(event) => event.stopPropagation()}>
          <CellDisplay row={row} column={column} />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5" onClick={(event) => event.stopPropagation()}>
        {column.kind === 'rating' ? (
          <div className="flex items-center gap-1 p-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                className="rounded p-0.5 hover:bg-accent"
                onClick={() => {
                  onCommit(star === raw ? null : star)
                  setOpen(false)
                }}
                aria-label={`${star} stars`}
              >
                <Star className={cn('h-4 w-4', star <= Number(raw || 0) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/50')} />
              </button>
            ))}
            <button
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent"
              onClick={() => {
                onCommit(null)
                setOpen(false)
              }}
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : column.kind === 'company' ? (
          <div>
            <Input
              autoFocus
              placeholder="Search companies…"
              className="mb-1.5 h-7"
              value={companyQuery}
              onChange={(event) => setCompanyQuery(event.target.value)}
            />
            <div className="max-h-52 overflow-y-auto">
              {companyOptions.map((brief) => (
                <button
                  key={brief.id}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                  onClick={() => {
                    onCommit(brief.id)
                    setOpen(false)
                  }}
                >
                  <BriefAvatar brief={brief} size="xs" />
                  <span className="truncate">{brief.name}</span>
                </button>
              ))}
              {companyOptions.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">No companies found</div>
              ) : null}
            </div>
          </div>
        ) : column.kind === 'multiselect' ? (
          <div className="max-h-56 overflow-y-auto">
            {options.map((option) => {
              const selected = Array.isArray(raw) && (raw as unknown[]).includes(option.id)
              return (
                <button
                  key={option.id}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                  onClick={() => {
                    const current = Array.isArray(raw) ? [...(raw as unknown[])] : []
                    onCommit(selected ? current.filter((v) => v !== option.id) : [...current, option.id])
                  }}
                >
                  <Checkbox checked={selected} className="pointer-events-none" />
                  <Pill label={option.label} color={option.color} />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.id}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                onClick={() => {
                  onCommit(option.id)
                  setOpen(false)
                }}
              >
                <Pill label={option.label} color={option.color} />
                {raw === option.id ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
              </button>
            ))}
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent"
              onClick={() => {
                onCommit(null)
                setOpen(false)
              }}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
