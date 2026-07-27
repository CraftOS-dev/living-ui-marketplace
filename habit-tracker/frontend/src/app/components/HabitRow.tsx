import { useState } from 'react'
import { Check, Flame, Minus, Plus, Ban, GripVertical } from 'lucide-react'
import type { Habit, HeatmapCell } from '../types'
import { getIcon } from '../lib/icons'
import { tintColor } from '../lib/dates'
import { useViewport } from '../lib/hooks'
import { MiniHeatmap } from './MiniHeatmap'

interface HabitRowProps {
  habit: Habit
  active: boolean
  loadHeatmap: (habitId: number, days: number) => Promise<HeatmapCell[]>
  onSelect: () => void
  onToggle: () => Promise<void>
  onIncrement: (delta: number) => Promise<void>
  onSetDuration: (minutes: number) => Promise<void>
  isDragging: boolean
  dragHandlers: {
    onDragStart: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
    onDragEnd: (e: React.DragEvent) => void
  }
}

export function HabitRow({
  habit,
  active,
  loadHeatmap,
  onSelect,
  onToggle,
  onIncrement,
  onSetDuration,
  isDragging,
  dragHandlers,
}: HabitRowProps) {
  const Icon = getIcon(habit.icon)
  const [hovered, setHovered] = useState(false)
  const [busy, setBusy] = useState(false)
  const { isMobile, width } = useViewport()
  // Hide mini-heatmap when there's not enough room for it without crowding
  // the action controls. Width threshold is in addition to the discrete
  // mobile breakpoint so it also degrades gracefully on narrow tablets.
  const showHeatmap = !isMobile && width >= 720

  const today = habit.todayEntry
  const completed = !!today?.completed
  const value = today?.value ?? 0

  const click = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect()
      }}
      draggable
      {...dragHandlers}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 8 : 12,
        // Reserve room on the left for the active accent stripe so the row
        // doesn't shift sideways when toggled. The accent is rendered as a
        // border on the inner padding edge.
        padding: isMobile ? '8px 8px 8px 5px' : '6px 10px 6px 7px',
        height: isMobile ? 52 : 40,
        borderRadius: 6,
        cursor: 'pointer',
        // Active row uses a subtle tint of the habit's own color rather than
        // the global --bg-tertiary, so empty heatmap cells (which use
        // --bg-tertiary) remain visible against it.
        background: active
          ? tintColor(habit.color, 0.12)
          : hovered
            ? tintColor(habit.color, 0.06)
            : 'transparent',
        // Left accent stripe on the active row.
        borderLeft: active
          ? `3px solid ${habit.color}`
          : '3px solid transparent',
        opacity: isDragging ? 0.4 : 1,
        transition: 'background 120ms ease, opacity 120ms ease',
        userSelect: 'none',
      }}
    >
      {/* Drag handle — hidden on mobile (drag-and-drop reorder is desktop-only) */}
      {!isMobile && (
        <span
          aria-hidden
          style={{
            color: 'var(--text-muted)',
            opacity: hovered ? 0.7 : 0,
            transition: 'opacity 120ms ease',
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <GripVertical size={14} />
        </span>
      )}

      {/* Icon */}
      <span
        style={{
          width: isMobile ? 32 : 26,
          height: isMobile ? 32 : 26,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: tintColor(habit.color, 0.16),
          color: habit.color,
          flexShrink: 0,
        }}
      >
        <Icon size={isMobile ? 18 : 15} />
      </span>

      {/* Name + meta */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textDecoration: habit.archived ? 'line-through' : 'none',
          }}
        >
          {habit.name}
        </span>
        {(habit.type === 'count' || habit.type === 'duration') && habit.target ? (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {value}/{habit.target} {habit.unit ?? ''}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {habit.type === 'binary' && (habit.category?.name || 'binary')}
            {habit.type === 'negative' && (habit.category?.name || 'avoid')}
          </span>
        )}
      </div>

      {/* Mini heatmap (last 30). Cells are display-only — clicks bubble to
           the row, which selects the habit; they never modify the count.
           To backfill a past day, use the full heatmap in the side panel.
           Hidden on narrow viewports to keep room for the action controls. */}
      {showHeatmap && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <MiniHeatmap
            habit={habit}
            days={30}
            cellSize={9}
            loadCells={loadHeatmap}
          />
        </div>
      )}

      {/* Streak badge */}
      <span
        title="current streak"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 6px',
          borderRadius: 999,
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          color: (habit.currentStreak ?? 0) > 0 ? habit.color : 'var(--text-muted)',
          background:
            (habit.currentStreak ?? 0) > 0 ? tintColor(habit.color, 0.12) : 'transparent',
          minWidth: 38,
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Flame size={11} />
        {habit.currentStreak ?? 0}d
      </span>

      {/* Action area — type-specific. Bigger tap targets on mobile. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 4, flexShrink: 0 }}
      >
        {habit.type === 'binary' || habit.type === 'negative' ? (
          <button
            onClick={() => click(onToggle)}
            disabled={busy}
            aria-label={completed ? 'Mark as not done' : 'Mark as done'}
            style={{
              width: isMobile ? 36 : 28,
              height: isMobile ? 36 : 28,
              borderRadius: 6,
              border: completed ? 'none' : `1px solid var(--border-primary)`,
              background: completed ? habit.color : 'transparent',
              color: completed ? '#fff' : 'var(--text-secondary)',
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 120ms ease',
            }}
          >
            {habit.type === 'negative' ? (
              completed ? <Check size={isMobile ? 17 : 14} /> : <Ban size={isMobile ? 17 : 14} />
            ) : (
              completed ? <Check size={isMobile ? 17 : 14} /> : null
            )}
          </button>
        ) : habit.type === 'count' ? (
          <>
            <button
              onClick={() => click(() => onIncrement(-1))}
              aria-label="Decrement"
              disabled={busy || value <= 0}
              style={iconButton(habit.color, false, isMobile)}
            >
              <Minus size={isMobile ? 16 : 13} />
            </button>
            <button
              onClick={() => click(() => onIncrement(1))}
              aria-label="Increment"
              disabled={busy}
              style={iconButton(habit.color, completed, isMobile)}
            >
              <Plus size={isMobile ? 16 : 13} />
            </button>
          </>
        ) : (
          // duration
          <button
            onClick={() => click(() => onSetDuration(habit.target ?? 30))}
            aria-label={completed ? 'Reset duration' : 'Mark target reached'}
            disabled={busy}
            style={{
              padding: isMobile ? '8px 12px' : '4px 10px',
              borderRadius: 6,
              border: completed ? 'none' : `1px solid var(--border-primary)`,
              background: completed ? habit.color : 'transparent',
              color: completed ? '#fff' : 'var(--text-secondary)',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: isMobile ? 12 : 11,
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {completed ? '✓ ' : ''}
            {habit.target ?? 30} {habit.unit ?? 'min'}
          </button>
        )}
      </div>
    </div>
  )
}

function iconButton(color: string, completed: boolean, mobile: boolean): React.CSSProperties {
  const size = mobile ? 36 : 26
  return {
    width: size,
    height: size,
    borderRadius: 6,
    border: completed ? 'none' : '1px solid var(--border-primary)',
    background: completed ? color : 'transparent',
    color: completed ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  }
}
