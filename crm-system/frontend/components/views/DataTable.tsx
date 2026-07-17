import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Expand, EyeOff, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import type { ColumnDef } from '@/lib/columns'
import type { RecordRow, RecordType, ViewSort } from '@/types'
import { api } from '@/api'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { RecordAvatar } from '@/components/common/RecordAvatar'
import { EmptyState } from '@/components/common/EmptyState'
import { EditableCell } from '@/components/views/CellEditor'

interface DataTableProps {
  recordType: RecordType
  rows: RecordRow[]
  columns: ColumnDef[]
  loading: boolean
  sorts: ViewSort[]
  onSort: (field: string, dir: 'asc' | 'desc') => void
  onHideColumn: (key: string) => void
  onAttributeCreated: () => void
  selection: Set<number>
  setSelection: (ids: Set<number>) => void
  onRowChanged: (row: RecordRow) => void
  onPeek: (row: RecordRow) => void
  emptyAction?: { label: string; onAction: () => void }
  isMobile: boolean
}

const ATTRIBUTE_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'currency', label: 'Currency' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Select' },
  { id: 'multiselect', label: 'Multi-select' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'rating', label: 'Rating' },
  { id: 'url', label: 'URL' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
]

export function DataTable({
  recordType,
  rows,
  columns,
  loading,
  sorts,
  onSort,
  onHideColumn,
  onAttributeCreated,
  selection,
  setSelection,
  onRowChanged,
  onPeek,
  emptyAction,
  isMobile,
}: DataTableProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const lastClickedIndex = useRef<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const toggleRow = useCallback(
    (row: RecordRow, index: number, shiftKey: boolean) => {
      const next = new Set(selection)
      if (shiftKey && lastClickedIndex.current >= 0) {
        const [from, to] = [Math.min(lastClickedIndex.current, index), Math.max(lastClickedIndex.current, index)]
        for (let i = from; i <= to; i++) {
          if (rows[i]) next.add(rows[i].id)
        }
      } else if (next.has(row.id)) {
        next.delete(row.id)
      } else {
        next.add(row.id)
      }
      lastClickedIndex.current = index
      setSelection(next)
    },
    [rows, selection, setSelection]
  )

  const allSelected = rows.length > 0 && rows.every((row) => selection.has(row.id))

  // Keyboard navigation (U-8): arrows move, Enter opens, Space peeks
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) return
      }
      if (event.key === 'ArrowDown' || (event.key === 'j' && !event.metaKey && !event.ctrlKey)) {
        event.preventDefault()
        setFocusedIndex((current) => Math.min(rows.length - 1, current + 1))
      } else if (event.key === 'ArrowUp' || (event.key === 'k' && !event.metaKey && !event.ctrlKey)) {
        event.preventDefault()
        setFocusedIndex((current) => Math.max(0, current - 1))
      } else if (event.key === 'Enter' && focusedIndex >= 0 && rows[focusedIndex]) {
        event.preventDefault()
        navigateTo(recordPath(recordType, rows[focusedIndex].id))
      } else if (event.key === ' ' && focusedIndex >= 0 && rows[focusedIndex]) {
        event.preventDefault()
        onPeek(rows[focusedIndex])
      }
    }
    container.addEventListener('keydown', onKeyDown)
    return () => container.removeEventListener('keydown', onKeyDown)
  }, [rows, focusedIndex, recordType, onPeek])

  const commitCell = async (row: RecordRow, column: ColumnDef, value: unknown) => {
    try {
      if (column.attribute) {
        await api.attributes.writeValue({
          attribute_id: column.attribute.id,
          record_type: recordType,
          record_id: row.id,
          value,
        })
        onRowChanged({ ...row, attributes: { ...row.attributes, [column.key]: value } })
      } else if (column.updateField) {
        const updated = await api.records.update(recordType, row.id, { [column.updateField]: value })
        onRowChanged({ ...row, ...updated })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed')
      onRowChanged({ ...row }) // force refresh of the stale cell
    }
  }

  if (loading) {
    return (
      <div className="space-y-px p-3">
        {Array.from({ length: 12 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No records here yet"
        description="Create your first record, adjust the filters, or import a CSV from the toolbar."
        actionLabel={emptyAction?.label}
        onAction={emptyAction?.onAction}
      />
    )
  }

  // Mobile: collapse to a card list (responsive spec §6.6)
  if (isMobile) {
    return (
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <button
            key={row.id}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent/60"
            onClick={() => navigateTo(recordPath(recordType, row.id))}
          >
            <RecordAvatar
              name={row.name}
              color={row.avatarColor || row.company?.avatarColor || '#8b8b94'}
              recordType={recordType}
              domain={row.domain}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{row.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {recordType === 'person' && (row.jobTitle || row.company?.name || (row.emails || [])[0] || '')}
                {recordType === 'company' && (row.industry || row.domain || '')}
                {recordType === 'deal' && `${row.stage?.name ?? row.status ?? ''}`}
              </div>
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div ref={containerRef} tabIndex={0} className="h-full overflow-auto outline-none">
      <table className="w-max min-w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border">
            <th className="sticky left-0 z-20 w-8 bg-background px-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => {
                  setSelection(checked === true ? new Set(rows.map((row) => row.id)) : new Set())
                }}
                aria-label="Select all"
              />
            </th>
            {columns.map((column, columnIndex) => {
              const activeSort = sorts.find((sort) => sort.field === column.key)
              return (
                <th
                  key={column.key}
                  style={{ minWidth: column.width }}
                  className={cn(
                    'h-8 border-b border-l border-border px-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                    columnIndex === 0 && 'sticky left-8 z-20 border-l-0 bg-background'
                  )}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex w-full items-center gap-1 hover:text-foreground">
                        <span className="truncate">{column.label}</span>
                        {activeSort ? (
                          activeSort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : null}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuItem onClick={() => onSort(column.key, 'asc')}>
                        <ArrowUp /> Sort ascending
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSort(column.key, 'desc')}>
                        <ArrowDown /> Sort descending
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onHideColumn(column.key)}>
                        <EyeOff /> Hide column
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </th>
              )
            })}
            <th className="w-9 border-b border-l border-border px-1">
              <NewAttributePopover recordType={recordType} onCreated={onAttributeCreated} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const selected = selection.has(row.id)
            const focused = rowIndex === focusedIndex
            return (
              <tr
                key={row.id}
                data-state={selected ? 'selected' : undefined}
                className={cn(
                  'group h-9 border-b border-border transition-colors hover:bg-accent/40',
                  selected && 'bg-accent/60',
                  focused && 'ring-1 ring-inset ring-ring'
                )}
                onClick={() => setFocusedIndex(rowIndex)}
              >
                <td className="sticky left-0 z-[5] w-8 bg-background px-2 group-hover:bg-accent/0">
                  <div className={cn('items-center', selected ? 'flex' : 'hidden group-hover:flex')}>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => {}}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleRow(row, rowIndex, (event as unknown as MouseEvent).shiftKey)
                      }}
                      aria-label={`Select ${row.name}`}
                    />
                  </div>
                </td>
                {columns.map((column, columnIndex) =>
                  columnIndex === 0 ? (
                    <td key={column.key} className="sticky left-8 z-[5] border-l-0 bg-background px-2.5">
                      <div className="flex items-center gap-2">
                        <RecordAvatar
                          name={row.name}
                          color={row.avatarColor || '#8b8b94'}
                          recordType={recordType}
                          domain={row.domain}
                          size="sm"
                        />
                        <button
                          className="truncate font-medium hover:underline"
                          onClick={(event) => {
                            event.stopPropagation()
                            navigateTo(recordPath(recordType, row.id))
                          }}
                        >
                          {row.name}
                        </button>
                        <button
                          className="ml-auto hidden shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:block"
                          onClick={(event) => {
                            event.stopPropagation()
                            onPeek(row)
                          }}
                          aria-label={`Peek ${row.name}`}
                        >
                          <Expand className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  ) : (
                    <td key={column.key} style={{ minWidth: column.width }} className="border-l border-border px-2.5">
                      <EditableCell row={row} column={column} onCommit={(value) => commitCell(row, column, value)} />
                    </td>
                  )
                )}
                <td className="border-l border-border" />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** "+ column" — create a custom attribute inline from the table header (F1.2). */
function NewAttributePopover({ recordType, onCreated }: { recordType: RecordType; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('text')
  const [optionsText, setOptionsText] = useState('')
  const [saving, setSaving] = useState(false)

  const create = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const options =
        type === 'select' || type === 'multiselect'
          ? optionsText.split(',').map((label) => ({ label: label.trim() })).filter((option) => option.label)
          : undefined
      await api.attributes.create({ name: name.trim(), object_type: recordType, type, options })
      toast.success(`Column “${name.trim()}” added`)
      setOpen(false)
      setName('')
      setOptionsText('')
      onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create column')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Add column">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2.5">
        <div className="text-sm font-semibold">New column</div>
        <Input autoFocus placeholder="Field name" value={name} onChange={(event) => setName(event.target.value)} />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATTRIBUTE_TYPES.map((attributeType) => (
              <SelectItem key={attributeType.id} value={attributeType.id}>
                {attributeType.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(type === 'select' || type === 'multiselect') && (
          <Input
            placeholder="Options, comma-separated"
            value={optionsText}
            onChange={(event) => setOptionsText(event.target.value)}
          />
        )}
        <Button size="sm" className="w-full" onClick={create} loading={saving} disabled={!name.trim()}>
          Add column
        </Button>
      </PopoverContent>
    </Popover>
  )
}
