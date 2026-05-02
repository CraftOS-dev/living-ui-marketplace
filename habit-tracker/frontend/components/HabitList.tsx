import { useState } from 'react'
import { toast } from 'react-toastify'
import { Plus } from 'lucide-react'
import type { Habit, HeatmapCell } from '../types'
import { Button, EmptyState } from './ui'
import { HabitRow } from './HabitRow'
import type { AppController } from '../AppController'

interface HabitListProps {
  habits: Habit[]
  selectedId: number | null
  controller: AppController
  loadHeatmap: (habitId: number, days: number) => Promise<HeatmapCell[]>
  onSelect: (id: number | null) => void
  onCreate: () => void
}

export function HabitList({
  habits,
  selectedId,
  controller,
  loadHeatmap,
  onSelect,
  onCreate,
}: HabitListProps) {
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  if (habits.length === 0) {
    return (
      <EmptyState
        title="No habits yet"
        message="Add your first habit and check in today."
        action={
          <Button icon={<Plus size={14} />} onClick={onCreate}>
            New habit
          </Button>
        }
      />
    )
  }

  const handleDragStart = (id: number) => (e: React.DragEvent) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', String(id))
    } catch {
      /* ignore */
    }
  }

  const handleDragOver = (id: number) => (e: React.DragEvent) => {
    if (draggingId === null || draggingId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverId(id)
  }

  const handleDrop = (id: number) => async (e: React.DragEvent) => {
    e.preventDefault()
    if (draggingId === null || draggingId === id) {
      setDraggingId(null)
      setOverId(null)
      return
    }
    const ordered = reorderArray(habits.map((h) => h.id), draggingId, id)
    setDraggingId(null)
    setOverId(null)
    try {
      await controller.reorderHabits(ordered)
    } catch (err) {
      toast.error('Failed to reorder habits')
    }
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    setOverId(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {habits.map((h) => (
        <div
          key={h.id}
          style={{
            position: 'relative',
            paddingTop: overId === h.id && draggingId !== null ? 4 : 0,
          }}
        >
          {overId === h.id && draggingId !== null && (
            <div
              style={{
                position: 'absolute',
                top: -1,
                left: 8,
                right: 8,
                height: 2,
                borderRadius: 2,
                background: h.color,
              }}
            />
          )}
          <HabitRow
            habit={h}
            active={selectedId === h.id}
            loadHeatmap={loadHeatmap}
            onSelect={() => onSelect(selectedId === h.id ? null : h.id)}
            onToggle={async () => {
              try {
                await controller.toggleToday(h)
              } catch (err) {
                toast.error('Failed to update habit')
              }
            }}
            onIncrement={async (delta) => {
              const next = Math.max(0, (h.todayEntry?.value ?? 0) + delta)
              try {
                const todayStr = todayLocalIso()
                await controller.upsertEntry(h.id, todayStr, { value: next })
              } catch (err) {
                toast.error('Failed to update habit')
              }
            }}
            onSetDuration={async (mins) => {
              try {
                const todayStr = todayLocalIso()
                const current = h.todayEntry?.value ?? 0
                const next = current >= mins ? 0 : mins
                await controller.upsertEntry(h.id, todayStr, { value: next })
              } catch (err) {
                toast.error('Failed to update habit')
              }
            }}
            isDragging={draggingId === h.id}
            dragHandlers={{
              onDragStart: handleDragStart(h.id),
              onDragOver: handleDragOver(h.id),
              onDrop: handleDrop(h.id),
              onDragEnd: handleDragEnd,
            }}
          />
        </div>
      ))}
    </div>
  )
}

function reorderArray(ids: number[], dragId: number, dropId: number): number[] {
  const next = ids.filter((id) => id !== dragId)
  const dropIndex = next.indexOf(dropId)
  // Insert before the drop target.
  next.splice(dropIndex, 0, dragId)
  return next
}

function todayLocalIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
