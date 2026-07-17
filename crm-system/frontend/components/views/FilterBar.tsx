import { useState } from 'react'
import { ListFilter, X } from 'lucide-react'

import type { ColumnDef } from '@/lib/columns'
import { filterableColumns } from '@/lib/columns'
import type { ViewFilter } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const OPERATORS: { id: string; label: string; needsValue: boolean }[] = [
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'not_contains', label: "doesn't contain", needsValue: true },
  { id: 'eq', label: 'is', needsValue: true },
  { id: 'neq', label: 'is not', needsValue: true },
  { id: 'gt', label: '>', needsValue: true },
  { id: 'lt', label: '<', needsValue: true },
  { id: 'gte', label: '≥', needsValue: true },
  { id: 'lte', label: '≤', needsValue: true },
  { id: 'is_empty', label: 'is empty', needsValue: false },
  { id: 'not_empty', label: 'is not empty', needsValue: false },
]

const DEFAULT_OPERATOR: Record<string, string> = {
  number: 'gt', currency: 'gt', date: 'gte', datetime: 'gte',
  select: 'eq', 'deal-status': 'eq', multiselect: 'has', checkbox: 'eq', rating: 'gte',
}

interface FilterBarProps {
  columns: ColumnDef[]
  filters: ViewFilter[]
  onChange: (filters: ViewFilter[]) => void
}

/** Filter chips + builder popover (F2.4). AND logic across chips. */
export function FilterBar({ columns, filters, onChange }: FilterBarProps) {
  const fields = filterableColumns(columns)

  const label = (filter: ViewFilter) => {
    const column = columns.find((col) => col.key === filter.field)
    const operator = OPERATORS.find((op) => op.id === filter.operator)
    const option = column?.options?.find((opt) => opt.id === filter.value)
    const valueText = option?.label ?? (filter.value === undefined || filter.value === '' ? '' : String(filter.value))
    return `${column?.label || filter.field} ${operator?.label || filter.operator}${valueText ? ` ${valueText}` : ''}`
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((filter, index) => (
        <span
          key={`${filter.field}-${index}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium"
        >
          {label(filter)}
          <button
            className="rounded-full p-px text-muted-foreground hover:text-foreground"
            onClick={() => onChange(filters.filter((_, filterIndex) => filterIndex !== index))}
            aria-label="Remove filter"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <AddFilterPopover fields={fields} onAdd={(filter) => onChange([...filters, filter])} hasFilters={filters.length > 0} />
      {filters.length > 1 ? (
        <button className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => onChange([])}>
          Clear all
        </button>
      ) : null}
    </div>
  )
}

function AddFilterPopover({
  fields,
  onAdd,
  hasFilters,
}: {
  fields: ColumnDef[]
  onAdd: (filter: ViewFilter) => void
  hasFilters: boolean
}) {
  const [open, setOpen] = useState(false)
  const [fieldKey, setFieldKey] = useState('')
  const [operator, setOperator] = useState('contains')
  const [value, setValue] = useState('')

  const field = fields.find((column) => column.key === fieldKey)
  const needsValue = OPERATORS.find((op) => op.id === operator)?.needsValue ?? true

  const add = () => {
    if (!field) return
    let parsed: unknown = value
    if (['number', 'currency', 'rating'].includes(field.kind)) parsed = Number(value)
    if (field.kind === 'checkbox') parsed = value === 'true'
    onAdd({ field: field.key, operator, ...(needsValue ? { value: parsed } : {}) })
    setOpen(false)
    setFieldKey('')
    setValue('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) {
          setFieldKey('')
          setValue('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 gap-1 rounded-full px-2 text-xs">
          <ListFilter className="h-3 w-3" />
          {hasFilters ? 'Add' : 'Filter'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2.5">
        <div className="text-sm font-semibold">Add filter</div>
        <Select
          value={fieldKey}
          onValueChange={(key) => {
            setFieldKey(key)
            const column = fields.find((col) => col.key === key)
            setOperator(DEFAULT_OPERATOR[column?.kind || ''] || 'contains')
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Field…" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((column) => (
              <SelectItem key={column.key} value={column.key}>
                {column.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field ? (
          <>
            <Select value={operator} onValueChange={setOperator}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((op) => (
                  <SelectItem key={op.id} value={op.id}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsValue &&
              (field.options && field.options.length > 0 ? (
                <Select value={String(value)} onValueChange={setValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Value…" />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.kind === 'deal-status' ? (
                <Select value={String(value)} onValueChange={setValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Value…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
              ) : field.kind === 'checkbox' ? (
                <Select value={String(value)} onValueChange={setValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Value…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Checked</SelectItem>
                    <SelectItem value="false">Unchecked</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={['number', 'currency', 'rating'].includes(field.kind) ? 'number' : field.kind === 'date' ? 'date' : 'text'}
                  placeholder="Value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && add()}
                />
              ))}
            <Button size="sm" className="w-full" onClick={add} disabled={needsValue && value === ''}>
              Apply filter
            </Button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
