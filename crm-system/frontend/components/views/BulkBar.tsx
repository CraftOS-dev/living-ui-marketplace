import { useState } from 'react'
import { Download, ListPlus, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import type { ColumnDef } from '@/lib/columns'
import { downloadTextFile } from '@/lib/format'
import type { ListInfo, RecordType, Tag } from '@/types'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Pill } from '@/components/common/Pill'

interface BulkBarProps {
  recordType: RecordType
  selection: Set<number>
  clearSelection: () => void
  columns: ColumnDef[]
  lists: ListInfo[]
  onDone: () => void
}

/** Floating bottom bulk-action bar (F2.5). */
export function BulkBar({ recordType, selection, clearSelection, columns, lists, onDone }: BulkBarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const ids = Array.from(selection)

  const editableColumns = columns.filter(
    (column) => column.editable && !['company', 'tags', 'stage', 'name'].includes(column.kind)
  )
  const compatibleLists = lists.filter((list) => list.parentObject === recordType)

  const bulkEdit = async (column: ColumnDef, value: unknown) => {
    setBusy(true)
    try {
      for (const id of ids) {
        if (column.attribute) {
          await api.attributes.writeValue({ attribute_id: column.attribute.id, record_type: recordType, record_id: id, value })
        } else if (column.updateField) {
          await api.records.update(recordType, id, { [column.updateField]: value })
        }
      }
      toast.success(`Updated ${ids.length} record${ids.length === 1 ? '' : 's'}`)
      clearSelection()
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bulk edit failed')
    } finally {
      setBusy(false)
    }
  }

  const bulkTag = async (tag: Tag) => {
    setBusy(true)
    try {
      for (const id of ids) await api.tags.assign(tag.id, recordType, id)
      toast.success(`Tagged ${ids.length} record${ids.length === 1 ? '' : 's'} with “${tag.name}”`)
      clearSelection()
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tagging failed')
    } finally {
      setBusy(false)
    }
  }

  const bulkAddToList = async (list: ListInfo) => {
    setBusy(true)
    try {
      for (const id of ids) await api.lists.addEntry(list.id, { record_type: recordType, record_id: id })
      toast.success(`Added ${ids.length} record${ids.length === 1 ? '' : 's'} to ${list.name}`)
      clearSelection()
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add to list')
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async () => {
    setBusy(true)
    try {
      const csv = await api.dataio.exportCsv(recordType, { ids })
      downloadTextFile(`${recordType}-selection.csv`, csv)
      toast.success('CSV exported')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const bulkDelete = async () => {
    setBusy(true)
    try {
      for (const id of ids) await api.records.remove(recordType, id)
      toast.success(`Deleted ${ids.length} record${ids.length === 1 ? '' : 's'}`)
      clearSelection()
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed')
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
          <span className="mr-1 text-[13px] font-semibold tabular-nums">{ids.length} selected</span>

          <BulkEditPopover columns={editableColumns} onApply={bulkEdit} disabled={busy} />
          <BulkTagPopover onPick={bulkTag} disabled={busy} />
          {compatibleLists.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  <ListPlus /> Add to list
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1.5">
                {compatibleLists.map((list) => (
                  <button
                    key={list.id}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                    onClick={() => bulkAddToList(list)}
                  >
                    {list.name}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={busy}>
            <Download /> Export
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={clearSelection} aria-label="Clear selection">
            <X />
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {ids.length} record{ids.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected records along with their notes, timeline, and list entries. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction destructive onClick={bulkDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function BulkEditPopover({
  columns,
  onApply,
  disabled,
}: {
  columns: ColumnDef[]
  onApply: (column: ColumnDef, value: unknown) => void
  disabled: boolean
}) {
  const [fieldKey, setFieldKey] = useState('')
  const [value, setValue] = useState('')
  const column = columns.find((col) => col.key === fieldKey)

  const apply = () => {
    if (!column) return
    let parsed: unknown = value
    if (['number', 'currency', 'rating'].includes(column.kind)) parsed = Number(value)
    if (column.kind === 'checkbox') parsed = value === 'true'
    onApply(column, parsed)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Pencil /> Edit
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-2.5">
        <div className="text-sm font-semibold">Set a field on all selected</div>
        <Select value={fieldKey} onValueChange={setFieldKey}>
          <SelectTrigger>
            <SelectValue placeholder="Field…" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((col) => (
              <SelectItem key={col.key} value={col.key}>
                {col.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {column ? (
          column.options && column.options.length > 0 ? (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger>
                <SelectValue placeholder="Value…" />
              </SelectTrigger>
              <SelectContent>
                {column.options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : column.kind === 'deal-status' ? (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger>
                <SelectValue placeholder="Value…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              type={['number', 'currency', 'rating'].includes(column.kind) ? 'number' : column.kind === 'date' ? 'date' : 'text'}
              placeholder="New value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )
        ) : null}
        <Button size="sm" className="w-full" onClick={apply} disabled={!column}>
          Apply to selection
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function BulkTagPopover({ onPick, disabled }: { onPick: (tag: Tag) => void; disabled: boolean }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [newTag, setNewTag] = useState('')

  const load = () => api.tags.all().then(setTags).catch(() => setTags([]))

  const createAndPick = async () => {
    if (!newTag.trim()) return
    const tag = await api.tags.create({ name: newTag.trim() })
    setNewTag('')
    onPick(tag)
  }

  return (
    <Popover onOpenChange={(open) => open && load()}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <TagIcon /> Tag
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2 p-2">
        <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
          {tags.map((tag) => (
            <Pill key={tag.id} label={tag.name} color={tag.color} onClick={() => onPick(tag)} />
          ))}
          {tags.length === 0 ? <span className="text-xs text-muted-foreground">No tags yet</span> : null}
        </div>
        <div className="flex gap-1.5">
          <Input
            placeholder="New tag…"
            className="h-7"
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && createAndPick()}
          />
          <Button size="sm" variant="secondary" onClick={createAndPick} disabled={!newTag.trim()}>
            Add
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
