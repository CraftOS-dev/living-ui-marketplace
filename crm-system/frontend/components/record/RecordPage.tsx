import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CheckSquare,
  ListPlus,
  Mail,
  SquarePen,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { buildColumns, type ColumnDef } from '@/lib/columns'
import { formatCurrency, relativeTime } from '@/lib/format'
import type { Attribute, RecordRow, RecordType, Tag } from '@/types'
import { api } from '@/api'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { useViewport } from '@/hooks/useViewport'
import { useUiActions } from '@/components/MainView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { RecordAvatar, BriefAvatar } from '@/components/common/RecordAvatar'
import { Pill, DealStatusPill } from '@/components/common/Pill'
import { EditableCell } from '@/components/views/CellEditor'
import { EmptyState } from '@/components/common/EmptyState'
import { TimelinePanel } from '@/components/record/TimelinePanel'
import { NotesTab } from '@/components/record/NotesTab'
import { TasksTab } from '@/components/record/TasksTab'
import { EmailsTab } from '@/components/record/EmailsTab'
import { FilesTab } from '@/components/record/FilesTab'
import { AiSummaryDialog } from '@/components/record/AiSummaryDialog'
import { ComposeEmailDialog } from '@/components/record/ComposeEmailDialog'
import { OverviewTab } from '@/components/record/OverviewTab'

interface RecordPageProps {
  recordType: RecordType
  recordId: number
}

/** Full record page (F4): details | tabbed center | related. */
export function RecordPage({ recordType, recordId }: RecordPageProps) {
  const viewport = useViewport()
  const { openNewTask } = useUiActions()
  const [record, setRecord] = useState<RecordRow | null>(null)
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState('overview')
  const [timelineNonce, setTimelineNonce] = useState(0)
  const [composeOpen, setComposeOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  const reload = useCallback(async () => {
    try {
      const [detail, loadedAttributes] = await Promise.all([
        api.records.get(recordType, recordId),
        api.attributes.list({ objectType: recordType }),
      ])
      if (!detail.record) {
        setNotFound(true)
      } else {
        setRecord(detail.record)
        setAttributes(loadedAttributes)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load record')
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [recordType, recordId])

  useEffect(() => {
    reload()
  }, [reload])

  const bumpTimeline = () => setTimelineNonce((nonce) => nonce + 1)

  const commitField = async (column: ColumnDef, value: unknown) => {
    if (!record) return
    try {
      if (column.attribute) {
        await api.attributes.writeValue({
          attribute_id: column.attribute.id,
          record_type: recordType,
          record_id: recordId,
          value,
        })
        setRecord({ ...record, attributes: { ...record.attributes, [column.key]: value } })
      } else if (column.updateField) {
        const updated = await api.records.update(recordType, recordId, { [column.updateField]: value })
        setRecord({ ...record, ...updated, memberships: record.memberships, related: record.related })
      }
      bumpTimeline()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed')
    }
  }

  const commitName = async () => {
    setRenaming(false)
    if (!record || !draftName.trim() || draftName.trim() === record.name) return
    const body =
      recordType === 'person'
        ? (() => {
            const [first, ...rest] = draftName.trim().split(/\s+/)
            return { first_name: first, last_name: rest.join(' ') }
          })()
        : { name: draftName.trim() }
    try {
      const updated = await api.records.update(recordType, recordId, body)
      setRecord({ ...record, ...updated, memberships: record.memberships, related: record.related })
      bumpTimeline()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rename failed')
    }
  }

  const deleteRecord = async () => {
    try {
      await api.records.remove(recordType, recordId)
      toast.success('Record deleted')
      window.dispatchEvent(new CustomEvent('crm:data-changed', { detail: { recordType } }))
      navigateTo(recordType === 'person' ? 'people' : recordType === 'company' ? 'companies' : 'deals')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed')
    }
  }

  const detailColumns = useMemo(
    () => buildColumns(recordType, attributes, false).filter((column) => !['name', 'tags', 'stage'].includes(column.key)),
    [recordType, attributes]
  )

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-6 w-56" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-72 w-72" />
          <Skeleton className="h-72 flex-1" />
        </div>
      </div>
    )
  }

  if (notFound || !record) {
    return (
      <EmptyState
        icon={X}
        title="Record not found"
        description="It may have been deleted."
        actionLabel="Back to list"
        onAction={() => navigateTo(recordType === 'person' ? 'people' : recordType === 'company' ? 'companies' : 'deals')}
      />
    )
  }

  const stacked = viewport.isMobile
  const collapseRight = viewport.isNarrow

  const header = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 pl-14 md:pl-4">
      <button
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => window.history.back()}
        aria-label="Back"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <RecordAvatar name={record.name} color={record.avatarColor} recordType={recordType} domain={record.domain} size="lg" />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <Input
            autoFocus
            className="h-8 max-w-md text-lg font-semibold"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button
            className="block max-w-full truncate text-left text-lg font-semibold leading-tight hover:underline"
            onClick={() => {
              setDraftName(record.name)
              setRenaming(true)
            }}
            title="Rename"
          >
            {record.name}
          </button>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {recordType === 'deal' && record.status ? <DealStatusPill status={record.status} /> : null}
          {record.memberships?.map((membership) =>
            membership.stage ? (
              <button key={membership.entry.id} onClick={() => navigateTo(`lists/${membership.list.id}`)}>
                <Pill label={`${membership.list.name} · ${membership.stage.name}`} color={membership.stage.color} />
              </button>
            ) : null
          )}
          {record.lastInteractionAt ? (
            <span className="text-xs text-muted-foreground">Last touched {relativeTime(record.lastInteractionAt)}</span>
          ) : null}
        </div>
      </div>

      {/* Quick actions (F4.3) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={() => setTab('notes')}>
          <SquarePen /> Note
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openNewTask({ recordType, recordId, recordName: record.name })}
        >
          <CheckSquare /> Task
        </Button>
        <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
          <Mail /> Email
        </Button>
        <AddToListButton record={record} recordType={recordType} onDone={reload} />
        <Button variant="outline" size="sm" onClick={() => setAiOpen(true)}>
          <Sparkles /> AI summary
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete record"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )

  const details = (
    <DetailsPanel
      record={record}
      recordType={recordType}
      columns={detailColumns}
      onCommit={commitField}
      onTagsChanged={reload}
      className={stacked ? '' : 'w-72 shrink-0 border-r border-border xl:w-80'}
    />
  )

  const related = <RelatedPanel record={record} className={collapseRight ? '' : 'w-64 shrink-0 border-l border-border xl:w-72'} />

  const tabs = (
    <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TabsList className="shrink-0 px-4">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="emails">Emails</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        {collapseRight && !stacked ? <TabsTrigger value="related">Related</TabsTrigger> : null}
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <TabsContent value="overview">
          <OverviewTab record={record} recordType={recordType} nonce={timelineNonce} onOpenActivity={() => setTab('activity')} />
        </TabsContent>
        <TabsContent value="activity">
          <TimelinePanel recordType={recordType} recordId={recordId} nonce={timelineNonce} onLogged={bumpTimeline} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab recordType={recordType} recordId={recordId} onChanged={bumpTimeline} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksTab recordType={recordType} recordId={recordId} recordName={record.name} onChanged={bumpTimeline} />
        </TabsContent>
        <TabsContent value="emails">
          <EmailsTab recordType={recordType} recordId={recordId} record={record} onCompose={() => setComposeOpen(true)} nonce={timelineNonce} />
        </TabsContent>
        <TabsContent value="files">
          <FilesTab recordType={recordType} recordId={recordId} />
        </TabsContent>
        {collapseRight && !stacked ? <TabsContent value="related">{related}</TabsContent> : null}
      </div>
    </Tabs>
  )

  return (
    <div className="flex h-full flex-col">
      {header}
      {stacked ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {details}
          <div className="border-t border-border">{tabs}</div>
          <div className="border-t border-border p-4">{related}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {details}
          {tabs}
          {!collapseRight ? related : null}
        </div>
      )}

      <ComposeEmailDialog
        open={composeOpen}
        setOpen={setComposeOpen}
        record={record}
        recordType={recordType}
        onSent={bumpTimeline}
      />
      <AiSummaryDialog open={aiOpen} setOpen={setAiOpen} record={record} recordType={recordType} onSaved={bumpTimeline} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {record.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the record with its timeline, notes, and list entries. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction destructive onClick={deleteRecord}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Details panel (left) ────────────────────────────────────────────────────

function DetailsPanel({
  record,
  recordType,
  columns,
  onCommit,
  onTagsChanged,
  className,
}: {
  record: RecordRow
  recordType: RecordType
  columns: ColumnDef[]
  onCommit: (column: ColumnDef, value: unknown) => Promise<void>
  onTagsChanged: () => void
  className?: string
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? columns : columns.slice(0, 8)

  return (
    <div className={cn('overflow-y-auto p-4', className)}>
      <p className="label-caps mb-3">Details</p>
      <div className="space-y-2.5">
        {visible.map((column) => (
          <div key={column.key} className="group">
            <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{column.label}</div>
            <div className="text-[13px]">
              <EditableCell row={record} column={column} onCommit={(value) => onCommit(column, value)} />
            </div>
          </div>
        ))}
      </div>
      {columns.length > 8 ? (
        <button className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${columns.length} fields`}
        </button>
      ) : null}

      <div className="mt-5">
        <p className="label-caps mb-2">Tags</p>
        <TagEditor record={record} recordType={recordType} onChanged={onTagsChanged} />
      </div>
    </div>
  )
}

function TagEditor({ record, recordType, onChanged }: { record: RecordRow; recordType: RecordType; onChanged: () => void }) {
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [newTag, setNewTag] = useState('')

  const assigned = record.tags || []

  const load = () => api.tags.all().then(setAllTags).catch(() => setAllTags([]))

  const toggle = async (tag: Tag, isAssigned: boolean) => {
    try {
      if (isAssigned) await api.tags.unassign(tag.id, recordType, record.id)
      else await api.tags.assign(tag.id, recordType, record.id)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tag change failed')
    }
  }

  const createTag = async () => {
    if (!newTag.trim()) return
    const tag = await api.tags.create({ name: newTag.trim() })
    setNewTag('')
    await toggle(tag, false)
    load()
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((tag) => (
        <span key={tag.id} className="group/tag inline-flex items-center">
          <Pill label={tag.name} color={tag.color} />
          <button
            className="-ml-1 hidden rounded-full bg-muted p-px text-muted-foreground group-hover/tag:block"
            onClick={() => toggle(tag, true)}
            aria-label={`Remove ${tag.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Popover onOpenChange={(open) => open && load()}>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-px text-[11px] font-medium text-muted-foreground hover:border-ring hover:text-foreground">
            <TagIcon className="h-3 w-3" /> Add
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 space-y-2 p-2">
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {allTags
              .filter((tag) => !assigned.some((existing) => existing.id === tag.id))
              .map((tag) => (
                <Pill key={tag.id} label={tag.name} color={tag.color} onClick={() => toggle(tag, false)} />
              ))}
          </div>
          <div className="flex gap-1.5">
            <Input
              placeholder="New tag…"
              className="h-7"
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && createTag()}
            />
            <Button size="sm" variant="secondary" onClick={createTag} disabled={!newTag.trim()}>
              Add
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// ── Related panel (right) ───────────────────────────────────────────────────

function RelatedPanel({ record, className }: { record: RecordRow; className?: string }) {
  const related = record.related || { people: [], companies: [], deals: [] }
  const sections: { title: string; items: typeof related.people }[] = [
    { title: 'Companies', items: related.companies },
    { title: 'People', items: related.people },
    { title: 'Deals', items: related.deals },
  ].filter((section) => section.items.length > 0)

  return (
    <div className={cn('overflow-y-auto p-4', className)}>
      <p className="label-caps mb-3">Related</p>
      {sections.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing linked yet. Set a company or link people from the details panel.</p>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{section.title}</p>
              <div className="space-y-1">
                {section.items.map((brief) => (
                  <button
                    key={`${brief.recordType}-${brief.id}`}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                    onClick={() => navigateTo(recordPath(brief.recordType, brief.id))}
                  >
                    <BriefAvatar brief={brief} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{brief.name}</span>
                      {brief.recordType === 'deal' ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {formatCurrency(brief.value, brief.currency)} · {brief.status}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {record.memberships && record.memberships.length > 0 ? (
        <div className="mt-5">
          <p className="label-caps mb-2">Lists</p>
          <div className="space-y-1">
            {record.memberships.map((membership) => (
              <button
                key={membership.entry.id}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                onClick={() => navigateTo(`lists/${membership.list.id}`)}
              >
                <span className="truncate text-[13px]">{membership.list.name}</span>
                {membership.stage ? <Pill label={membership.stage.name} color={membership.stage.color} /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Add to list ─────────────────────────────────────────────────────────────

function AddToListButton({ record, recordType, onDone }: { record: RecordRow; recordType: RecordType; onDone: () => void }) {
  const { lists } = useUiActions()
  const memberListIds = new Set((record.memberships || []).map((membership) => membership.list.id))
  const candidates = lists.filter((list) => list.parentObject === recordType && !memberListIds.has(list.id))

  const add = async (listId: number) => {
    try {
      await api.lists.addEntry(listId, { record_type: recordType, record_id: record.id })
      toast.success('Added to list')
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add to list')
    }
  }

  if (candidates.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ListPlus /> Add to list
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1.5" align="end">
        {candidates.map((list) => (
          <button
            key={list.id}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            onClick={() => add(list.id)}
          >
            {list.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
