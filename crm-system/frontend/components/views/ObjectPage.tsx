import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Download,
  Kanban as KanbanIcon,
  Plus,
  Search,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

import type { ColumnDef } from '@/lib/columns'
import { buildColumns, defaultVisibleColumns } from '@/lib/columns'
import { downloadTextFile } from '@/lib/format'
import type { Attribute, QueryResult, RecordRow, RecordType, SavedView, ViewFilter, ViewSort } from '@/types'
import { api } from '@/api'
import { useViewport } from '@/hooks/useViewport'
import { useUiActions } from '@/components/MainView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTable } from '@/components/views/DataTable'
import { FilterBar } from '@/components/views/FilterBar'
import { BulkBar } from '@/components/views/BulkBar'
import { ImportDialog } from '@/components/views/ImportDialog'
import { RecordPeek } from '@/components/views/RecordPeek'
import { KanbanBoard } from '@/components/board/KanbanBoard'

const TITLES: Record<RecordType, string> = { person: 'People', company: 'Companies', deal: 'Deals' }
const NEW_LABEL: Record<RecordType, string> = { person: 'New person', company: 'New company', deal: 'New deal' }

interface ObjectPageProps {
  recordType: RecordType
  listId?: number
}

/**
 * The primary browsing surface (U-2/U-3): saved views + toolbar + table or
 * kanban. Everything about a view is manipulated at the view.
 */
export function ObjectPage({ recordType, listId }: ObjectPageProps) {
  const viewport = useViewport()
  const { openCreate, lists } = useUiActions()
  const list = listId ? lists.find((candidate) => candidate.id === listId) : undefined

  const [views, setViews] = useState<SavedView[]>([])
  const [activeViewId, setActiveViewId] = useState<number | null>(null)
  const [attributes, setAttributes] = useState<Attribute[]>([])

  // Draft view state (diverges from the saved view until "Save")
  const [layout, setLayout] = useState<'table' | 'kanban'>('table')
  const [filters, setFilters] = useState<ViewFilter[]>([])
  const [sorts, setSorts] = useState<ViewSort[]>([])
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [peekId, setPeekId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const searchTimer = useRef<number>(0)

  const storageKey = listId ? `crm.lastView.list.${listId}` : `crm.lastView.${recordType}`

  const applyView = useCallback(
    (view: SavedView) => {
      setActiveViewId(view.id)
      setLayout(listId ? view.layout : 'table')
      setFilters(view.filters || [])
      setSorts(view.sorts || [])
      setVisibleColumns(view.visibleColumns?.length ? view.visibleColumns : defaultVisibleColumns(recordType))
      setDirty(false)
      setPage(1)
      localStorage.setItem(storageKey, String(view.id))
    },
    [listId, recordType, storageKey]
  )

  // Load views + attributes
  const loadMeta = useCallback(async () => {
    const [loadedViews, loadedAttributes] = await Promise.all([
      api.views.list(listId ? { listId } : { objectType: recordType }),
      api.attributes.list({ objectType: recordType }),
    ])
    setViews(loadedViews)
    setAttributes(loadedAttributes)
    const remembered = Number(localStorage.getItem(storageKey) || 0)
    const initial =
      loadedViews.find((view) => view.id === remembered) ||
      loadedViews.find((view) => view.isDefault) ||
      loadedViews[0]
    if (initial) applyView(initial)
    else {
      setVisibleColumns(defaultVisibleColumns(recordType))
      setActiveViewId(null)
    }
  }, [recordType, listId, storageKey, applyView])

  useEffect(() => {
    loadMeta().catch(() => toast.error('Could not load views'))
  }, [loadMeta])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.records.query(recordType, {
        filters,
        sorts,
        search,
        page,
        page_size: 50,
        list_id: listId || null,
      })
      setResult(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load records')
      setResult({ items: [], total: 0, page: 1, pageSize: 50 })
    } finally {
      setLoading(false)
    }
  }, [recordType, filters, sorts, search, page, listId])

  useEffect(() => {
    if (layout === 'table') fetchRows()
  }, [fetchRows, layout])

  // Refetch when records are created elsewhere (dialogs, agent actions)
  useEffect(() => {
    const onChanged = () => {
      if (layout === 'table') fetchRows()
    }
    window.addEventListener('crm:data-changed', onChanged)
    return () => window.removeEventListener('crm:data-changed', onChanged)
  }, [fetchRows, layout])

  const columns: ColumnDef[] = useMemo(() => {
    const allColumns = buildColumns(recordType, attributes, Boolean(listId))
    const visible = visibleColumns.length ? visibleColumns : defaultVisibleColumns(recordType)
    const ordered = visible
      .map((key) => allColumns.find((column) => column.key === key))
      .filter((column): column is ColumnDef => Boolean(column))
    // Name column is always first & present
    if (!ordered.find((column) => column.key === 'name')) {
      const name = allColumns.find((column) => column.key === 'name')
      if (name) ordered.unshift(name)
    }
    return ordered
  }, [recordType, attributes, visibleColumns, listId])

  const allColumnDefs = useMemo(() => buildColumns(recordType, attributes, Boolean(listId)), [recordType, attributes, listId])

  const onSort = (field: string, dir: 'asc' | 'desc') => {
    setSorts([{ field, dir }])
    setDirty(true)
    setPage(1)
  }

  const onHideColumn = (key: string) => {
    if (key === 'name') return
    setVisibleColumns((current) => current.filter((column) => column !== key))
    setDirty(true)
  }

  const onRowChanged = (row: RecordRow) => {
    setResult((current) =>
      current ? { ...current, items: current.items.map((item) => (item.id === row.id ? { ...item, ...row } : item)) } : current
    )
  }

  const saveView = async () => {
    if (!activeViewId) return
    try {
      const updated = await api.views.update(activeViewId, {
        filters,
        sorts,
        visible_columns: visibleColumns,
        layout,
      })
      setViews((current) => current.map((view) => (view.id === updated.id ? updated : view)))
      setDirty(false)
      toast.success('View saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save view')
    }
  }

  const saveViewAs = async () => {
    const name = window.prompt('Name for the new view:')
    if (!name?.trim()) return
    try {
      const created = await api.views.create({
        name: name.trim(),
        ...(listId ? { list_id: listId } : { object_type: recordType }),
        layout,
        filters,
        sorts,
        visible_columns: visibleColumns,
      })
      setViews((current) => [...current, created])
      applyView(created)
      toast.success(`View “${created.name}” created`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create view')
    }
  }

  const deleteView = async (view: SavedView) => {
    try {
      await api.views.remove(view.id)
      const remaining = views.filter((candidate) => candidate.id !== view.id)
      setViews(remaining)
      if (view.id === activeViewId && remaining[0]) applyView(remaining[0])
      toast.success('View deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete view')
    }
  }

  const exportCsv = async () => {
    try {
      const csv = await api.dataio.exportCsv(recordType, listId ? { listId } : {})
      downloadTextFile(`${list?.name || TITLES[recordType]}.csv`.toLowerCase().replace(/\s+/g, '-'), csv)
      toast.success('CSV exported')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed')
    }
  }

  const activeView = views.find((view) => view.id === activeViewId)
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1
  const title = list?.name || TITLES[recordType]

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar (U-3) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 pl-14 md:pl-4">
        <h1 className="text-[15px] font-semibold">{title}</h1>

        {/* View switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              {activeView?.name || 'Views'}
              {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Saved views</DropdownMenuLabel>
            {views.map((view) => (
              <DropdownMenuItem key={view.id} onClick={() => applyView(view)}>
                {view.layout === 'kanban' ? <KanbanIcon /> : <Table2 />}
                <span className="truncate">{view.name}</span>
                {view.id === activeViewId ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {dirty && activeViewId ? (
              <DropdownMenuItem onClick={saveView}>
                <Check /> Save changes to “{activeView?.name}”
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={saveViewAs}>
              <Plus /> Save as new view
            </DropdownMenuItem>
            {activeView && views.length > 1 ? (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteView(activeView)}>
                <Trash2 /> Delete “{activeView.name}”
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Layout toggle — kanban only exists for lists (they own stages) */}
        {listId ? (
          <div className="flex items-center rounded-md border border-border p-0.5">
            <button
              className={`rounded-sm px-1.5 py-1 ${layout === 'table' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => {
                setLayout('table')
                setDirty(true)
              }}
              aria-label="Table view"
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
            <button
              className={`rounded-sm px-1.5 py-1 ${layout === 'kanban' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => {
                setLayout('kanban')
                setDirty(true)
              }}
              aria-label="Board view"
            >
              <KanbanIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {layout === 'table' ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={`Search ${title.toLowerCase()}…`}
                className="h-7 w-40 pl-7 md:w-52"
                defaultValue={search}
                onChange={(event) => {
                  window.clearTimeout(searchTimer.current)
                  const value = event.target.value
                  searchTimer.current = window.setTimeout(() => {
                    setSearch(value)
                    setPage(1)
                  }, 250)
                }}
              />
            </div>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download /> Export
          </Button>
          <Button size="sm" onClick={() => openCreate(recordType, listId ? { list_id: listId } : undefined)}>
            <Plus /> {NEW_LABEL[recordType]}
          </Button>
        </div>
      </div>

      {/* Filter chips row */}
      {layout === 'table' ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
          <FilterBar
            columns={allColumnDefs}
            filters={filters}
            onChange={(next) => {
              setFilters(next)
              setDirty(true)
              setPage(1)
            }}
          />
          {result ? (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {result.total} {result.total === 1 ? 'record' : 'records'}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Content */}
      <div className="min-h-0 flex-1">
        {layout === 'kanban' && listId ? (
          <KanbanBoard listId={listId} />
        ) : (
          <DataTable
            recordType={recordType}
            rows={result?.items || []}
            columns={columns}
            loading={loading}
            sorts={sorts}
            onSort={onSort}
            onHideColumn={onHideColumn}
            onAttributeCreated={() => {
              api.attributes.list({ objectType: recordType }).then((loaded) => {
                setAttributes(loaded)
                const created = loaded[loaded.length - 1]
                if (created) {
                  setVisibleColumns((current) => [...current, created.slug])
                  setDirty(true)
                }
              })
            }}
            selection={selection}
            setSelection={setSelection}
            onRowChanged={onRowChanged}
            onPeek={(row) => setPeekId(row.id)}
            emptyAction={{ label: NEW_LABEL[recordType], onAction: () => openCreate(recordType, listId ? { list_id: listId } : undefined) }}
            isMobile={viewport.isMobile}
          />
        )}
      </div>

      {/* Pagination */}
      {layout === 'table' && result && result.total > result.pageSize ? (
        <div className="flex items-center justify-between border-t border-border px-4 py-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Page {result.page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {selection.size > 0 ? (
        <BulkBar
          recordType={recordType}
          selection={selection}
          clearSelection={() => setSelection(new Set())}
          columns={allColumnDefs}
          lists={lists}
          onDone={fetchRows}
        />
      ) : null}

      <ImportDialog
        recordType={recordType}
        listId={listId}
        open={importOpen}
        setOpen={setImportOpen}
        onImported={fetchRows}
      />
      <RecordPeek recordType={recordType} recordId={peekId} onClose={() => setPeekId(null)} />
    </div>
  )
}
