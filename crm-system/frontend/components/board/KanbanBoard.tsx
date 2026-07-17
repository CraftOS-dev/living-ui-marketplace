import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  Clock,
  Kanban,
  MoreHorizontal,
  Plus,
  Trash2,
  Trophy,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { formatCompactCurrency } from '@/lib/format'
import type { BoardCard, BoardColumn, BoardPayload, Stage } from '@/types'
import { api } from '@/api'
import { navigateTo, recordPath } from '@/hooks/useHashRoute'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { BriefAvatar } from '@/components/common/RecordAvatar'
import { EmptyState } from '@/components/common/EmptyState'
import { useUiActions } from '@/components/MainView'

const STAGE_COLORS = ['#7c9ce8', '#6fbfbf', '#8fbf8f', '#b5a642', '#d9a662', '#c98bc9', '#e08e8e', '#4caf7d', '#8b8b94']

/** Drag-and-drop pipeline board (F2.2/F3): stages editable inline, never in Settings. */
export function KanbanBoard({ listId }: { listId: number }) {
  const { openCreate } = useUiActions()
  const [board, setBoard] = useState<BoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null)
  const [addingStage, setAddingStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [confirmDeleteStage, setConfirmDeleteStage] = useState<Stage | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } })
  )

  const load = useCallback(async () => {
    try {
      const payload = await api.lists.board(listId)
      setBoard(payload)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load board')
    } finally {
      setLoading(false)
    }
  }, [listId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useEffect(() => {
    const onChanged = () => load()
    window.addEventListener('crm:data-changed', onChanged)
    return () => window.removeEventListener('crm:data-changed', onChanged)
  }, [load])

  const cardById = useMemo(() => {
    const map = new Map<number, BoardCard>()
    board?.columns.forEach((column) => column.cards.forEach((card) => map.set(card.entry.id, card)))
    board?.unstaged.forEach((card) => map.set(card.entry.id, card))
    return map
  }, [board])

  const findColumnOfEntry = (entryId: number): BoardColumn | undefined =>
    board?.columns.find((column) => column.cards.some((card) => card.entry.id === entryId))

  /** Optimistically move a card into a stage (at optional index), then persist. */
  const moveCard = async (entryId: number, targetStageId: number, targetIndex?: number) => {
    if (!board) return
    const card = cardById.get(entryId)
    if (!card) return
    const previous = board

    const nextColumns = board.columns.map((column) => {
      let cards = column.cards.filter((existing) => existing.entry.id !== entryId)
      if (column.stage.id === targetStageId) {
        const moved = { ...card, entry: { ...card.entry, stageId: targetStageId }, daysInStage: 0 }
        const index = targetIndex === undefined ? cards.length : Math.min(targetIndex, cards.length)
        cards = [...cards.slice(0, index), moved, ...cards.slice(index)]
      }
      const totalValue = cards.reduce((sum, existing) => sum + (existing.record.value || 0), 0)
      return { ...column, cards, count: cards.length, totalValue }
    })
    setBoard({ ...board, columns: nextColumns, unstaged: board.unstaged.filter((existing) => existing.entry.id !== entryId) })

    try {
      const targetColumn = nextColumns.find((column) => column.stage.id === targetStageId)
      const index = targetColumn?.cards.findIndex((existing) => existing.entry.id === entryId) ?? 0
      await api.lists.moveEntry(entryId, { stage_id: targetStageId, position: index })
      const stage = board.columns.find((column) => column.stage.id === targetStageId)?.stage
      if (stage?.isWon) toast.success(`${card.record.name} marked Won 🎉`)
      else if (stage?.isLost) toast(`${card.record.name} marked Lost`)
      window.dispatchEvent(new CustomEvent('crm:record-moved'))
    } catch (error) {
      setBoard(previous)
      toast.error(error instanceof Error ? error.message : 'Move failed — rolled back')
    }
  }

  const onDragStart = (event: DragStartEvent) => {
    setActiveCard(cardById.get(Number(event.active.id)) || null)
  }

  const onDragOver = (_event: DragOverEvent) => {
    /* visual handled by droppable highlight */
  }

  const onDragEnd = (event: DragEndEvent) => {
    setActiveCard(null)
    const { active, over } = event
    if (!over || !board) return
    const entryId = Number(active.id)
    const overId = String(over.id)

    if (overId.startsWith('column-')) {
      const stageId = Number(overId.replace('column-', ''))
      const sourceColumn = findColumnOfEntry(entryId)
      if (sourceColumn?.stage.id !== stageId) moveCard(entryId, stageId)
      return
    }
    // Dropped over another card: insert at its index within its column
    const overEntryId = Number(overId)
    const targetColumn = findColumnOfEntry(overEntryId)
    if (!targetColumn) return
    const targetIndex = targetColumn.cards.findIndex((card) => card.entry.id === overEntryId)
    const sourceColumn = findColumnOfEntry(entryId)
    if (sourceColumn?.stage.id === targetColumn.stage.id) {
      const currentIndex = sourceColumn.cards.findIndex((card) => card.entry.id === entryId)
      if (currentIndex === targetIndex) return
    }
    moveCard(entryId, targetColumn.stage.id, targetIndex)
  }

  const addStage = async () => {
    if (!newStageName.trim()) {
      setAddingStage(false)
      return
    }
    try {
      await api.lists.createStage(listId, { name: newStageName.trim() })
      setNewStageName('')
      setAddingStage(false)
      load()
      toast.success('Stage added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add stage')
    }
  }

  const updateStage = async (stage: Stage, body: Record<string, unknown>) => {
    try {
      await api.lists.updateStage(stage.id, body)
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update stage')
    }
  }

  const reorderStage = async (stage: Stage, direction: -1 | 1) => {
    if (!board) return
    const ordered = board.columns.map((column) => column.stage.id)
    const index = ordered.indexOf(stage.id)
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    try {
      await api.lists.reorderStages(listId, ordered)
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not reorder stages')
    }
  }

  const deleteStage = async () => {
    if (!confirmDeleteStage) return
    try {
      await api.lists.removeStage(confirmDeleteStage.id)
      setConfirmDeleteStage(null)
      load()
      toast.success('Stage deleted — its cards moved to the first stage')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete stage')
    }
  }

  if (loading || !board) {
    return (
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="w-64 shrink-0 space-y-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (board.columns.length === 0) {
    return (
      <EmptyState
        icon={Kanban}
        title="This list has no stages yet"
        description="Add a first stage to start working the board."
        actionLabel="+ Add stage"
        onAction={() => setAddingStage(true)}
      />
    )
  }

  const parentObject = board.list?.parentObject || 'deal'

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden p-4 md:snap-none">
          {board.columns.map((column, columnIndex) => (
            <BoardColumnView
              key={column.stage.id}
              column={column}
              isFirst={columnIndex === 0}
              isLast={columnIndex === board.columns.length - 1}
              onRename={(name) => updateStage(column.stage, { name })}
              onRecolor={(color) => updateStage(column.stage, { color })}
              onToggleWon={() => updateStage(column.stage, { is_won: !column.stage.isWon, is_lost: false })}
              onToggleLost={() => updateStage(column.stage, { is_lost: !column.stage.isLost, is_won: false })}
              onMoveLeft={() => reorderStage(column.stage, -1)}
              onMoveRight={() => reorderStage(column.stage, 1)}
              onDelete={() => setConfirmDeleteStage(column.stage)}
              onAddRecord={() => openCreate(parentObject, { list_id: listId, stage_id: column.stage.id })}
              onMoveCardTo={(entryId, stageId) => moveCard(entryId, stageId)}
              allStages={board.columns.map((c) => c.stage)}
            />
          ))}

          {/* + Add stage — inline on the board (F3.1) */}
          <div className="w-56 shrink-0 snap-start">
            {addingStage ? (
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-card p-1.5">
                <Input
                  autoFocus
                  placeholder="Stage name"
                  className="h-7"
                  value={newStageName}
                  onChange={(event) => setNewStageName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addStage()
                    if (event.key === 'Escape') setAddingStage(false)
                  }}
                />
                <Button size="icon-sm" variant="secondary" onClick={addStage} aria-label="Confirm">
                  <Check />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setAddingStage(false)} aria-label="Cancel">
                  <X />
                </Button>
              </div>
            ) : (
              <button
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-[13px] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                onClick={() => setAddingStage(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Add stage
              </button>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="w-60 rotate-2 opacity-95">
              <CardBody card={activeCard} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AlertDialog open={confirmDeleteStage !== null} onOpenChange={(open) => !open && setConfirmDeleteStage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stage “{confirmDeleteStage?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Cards in this stage move to the first remaining stage. Records are never deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction destructive onClick={deleteStage}>
              Delete stage
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface ColumnProps {
  column: BoardColumn
  isFirst: boolean
  isLast: boolean
  onRename: (name: string) => void
  onRecolor: (color: string) => void
  onToggleWon: () => void
  onToggleLost: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
  onDelete: () => void
  onAddRecord: () => void
  onMoveCardTo: (entryId: number, stageId: number) => void
  allStages: Stage[]
}

function BoardColumnView({
  column,
  isFirst,
  isLast,
  onRename,
  onRecolor,
  onToggleWon,
  onToggleLost,
  onMoveLeft,
  onMoveRight,
  onDelete,
  onAddRecord,
  onMoveCardTo,
  allStages,
}: ColumnProps) {
  const { stage } = column
  const { setNodeRef, isOver } = useDroppable({ id: `column-${stage.id}` })
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(stage.name)

  const commitRename = () => {
    setRenaming(false)
    if (draftName.trim() && draftName.trim() !== stage.name) onRename(draftName.trim())
  }

  return (
    <div className="flex h-full w-64 shrink-0 snap-start flex-col">
      {/* Column header: name, count, value sum, inline editing (U-9/F3.1) */}
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
        {renaming ? (
          <Input
            autoFocus
            className="h-6 px-1 text-[13px] font-semibold"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button className="truncate text-[13px] font-semibold hover:underline" onDoubleClick={() => setRenaming(true)} onClick={() => setRenaming(true)}>
            {stage.name}
          </button>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">{column.count}</span>
        {column.totalValue > 0 ? (
          <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
            {formatCompactCurrency(column.totalValue)}
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn('shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground', column.totalValue === 0 && 'ml-auto')} aria-label="Stage options">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Stage</DropdownMenuLabel>
            <div className="flex flex-wrap gap-1 px-2 py-1">
              {STAGE_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn('h-4 w-4 rounded-full border border-border', stage.color === color && 'ring-2 ring-ring ring-offset-1 ring-offset-popover')}
                  style={{ backgroundColor: color }}
                  onClick={() => onRecolor(color)}
                  aria-label={`Color ${color}`}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleWon}>
              <Trophy /> {stage.isWon ? 'Unmark won stage' : 'Mark as won stage'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleLost}>
              <X /> {stage.isLost ? 'Unmark lost stage' : 'Mark as lost stage'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isFirst} onClick={onMoveLeft}>
              <ArrowLeft /> Move left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onClick={onMoveRight}>
              <ArrowRight /> Move right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 /> Delete stage
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-transparent bg-muted/40 p-2 transition-colors',
          isOver && 'border-ring bg-accent/60'
        )}
      >
        <SortableContext items={column.cards.map((card) => card.entry.id)} strategy={verticalListSortingStrategy}>
          {column.cards.map((card) => (
            <SortableCard key={card.entry.id} card={card} allStages={allStages} onMoveTo={(stageId) => onMoveCardTo(card.entry.id, stageId)} />
          ))}
        </SortableContext>
        {column.cards.length === 0 ? (
          <button
            className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md py-6 text-xs text-muted-foreground/70 hover:text-muted-foreground"
            onClick={onAddRecord}
          >
            <span>Drag a card here</span>
            <span className="font-medium text-primary">+ New {allStages.length ? '' : ''}record</span>
          </button>
        ) : (
          <button
            className="flex items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground [.group:hover_&]:opacity-100 hover:opacity-100"
            onClick={onAddRecord}
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        )}
      </div>
    </div>
  )
}

function SortableCard({ card, allStages, onMoveTo }: { card: BoardCard; allStages: Stage[]; onMoveTo: (stageId: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.entry.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
    >
      <CardBody card={card} allStages={allStages} onMoveTo={onMoveTo} />
    </div>
  )
}

function CardBody({ card, allStages, onMoveTo }: { card: BoardCard; allStages?: Stage[]; onMoveTo?: (stageId: number) => void }) {
  const { record } = card
  return (
    <div
      className="group cursor-grab rounded-md border border-border bg-card p-2.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
      onClick={() => navigateTo(recordPath(record.recordType, record.id))}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight">{record.name}</div>
          {card.company ? (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <BriefAvatar brief={card.company} size="xs" />
              <span className="truncate">{card.company.name}</span>
            </div>
          ) : null}
        </div>
        {allStages && onMoveTo ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                onClick={(event) => event.stopPropagation()}
                aria-label="Card options"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft /> Move to stage
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {allStages
                    .filter((stage) => stage.id !== card.entry.stageId)
                    .map((stage) => (
                      <DropdownMenuItem key={stage.id} onClick={() => onMoveTo(stage.id)}>
                        <span className="mr-1 h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => navigateTo(recordPath(record.recordType, record.id))}>
                Open record
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {record.recordType === 'deal' && (record.value || 0) > 0 ? (
          <span className="text-xs font-semibold tabular-nums">{formatCompactCurrency(record.value, record.currency)}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground" title="Days in stage">
          <Clock className="h-3 w-3" />
          {card.daysInStage}d
        </span>
        <BriefAvatar brief={record} size="xs" />
      </div>
    </div>
  )
}
