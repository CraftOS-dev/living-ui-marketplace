import { useEffect, useState } from 'react'
import type { Habit, HeatmapCell } from '../types'
import { tintColor } from '../lib/dates'

interface MiniHeatmapProps {
  habit: Habit
  /** Last N days. Default 30. */
  days?: number
  /** Pixel size of each cell. */
  cellSize?: number
  /** Loader function — receives habitId and days, returns cells. */
  loadCells: (habitId: number, days: number) => Promise<HeatmapCell[]>
  onCellClick?: (cell: HeatmapCell) => void
}

/**
 * 30-day mini-heatmap rendered inline on a habit row.
 *
 * Borderless, single horizontal row of small squares. Today is the rightmost.
 * Empty days are an extremely subtle dot; completed days use the habit's color
 * with intensity-driven opacity.
 */
export function MiniHeatmap({
  habit,
  days = 30,
  cellSize = 10,
  loadCells,
  onCellClick,
}: MiniHeatmapProps) {
  const [cells, setCells] = useState<HeatmapCell[] | null>(null)

  useEffect(() => {
    let mounted = true
    setCells(null)
    loadCells(habit.id, days)
      .then((c) => {
        if (mounted) setCells(c)
      })
      .catch(() => {
        if (mounted) setCells([])
      })
    return () => {
      mounted = false
    }
  }, [habit.id, days, loadCells])

  if (cells === null) {
    return (
      <div
        aria-label="Loading heatmap"
        style={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          opacity: 0.4,
        }}
      >
        {Array.from({ length: days }).map((_, i) => (
          <span
            key={i}
            style={{
              width: cellSize,
              height: cellSize,
              borderRadius: 2,
              background: 'var(--bg-tertiary)',
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      role="img"
      aria-label={`${habit.name} last ${days} days`}
      style={{ display: 'flex', gap: 2, alignItems: 'center' }}
    >
      {cells.map((cell) => {
        const filled = cell.completed || cell.intensity > 0
        const bg = filled
          ? tintColor(habit.color, Math.max(0.25, cell.intensity || 0))
          : 'var(--bg-tertiary)'
        return (
          <span
            key={cell.date}
            onClick={onCellClick ? () => onCellClick(cell) : undefined}
            title={`${cell.date}${
              cell.completed ? ' • done' : cell.value > 0 ? ` • ${cell.value}` : ' • —'
            }`}
            style={{
              width: cellSize,
              height: cellSize,
              borderRadius: 2,
              background: bg,
              cursor: onCellClick ? 'pointer' : 'default',
              transition: 'background 120ms ease',
            }}
          />
        )
      })}
    </div>
  )
}
