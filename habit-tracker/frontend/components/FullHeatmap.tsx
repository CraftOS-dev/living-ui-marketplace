import { useEffect, useMemo, useRef, useState } from 'react'
import type { HeatmapCell } from '../types'
import { fromIso, formatLong, tintColor } from '../lib/dates'

interface FullHeatmapProps {
  cells: HeatmapCell[]
  color: string
  /** Hard upper bound on cell size. The component shrinks below this to fit. */
  cellSize?: number
  onCellClick?: (cell: HeatmapCell) => void
  loading?: boolean
}

const MIN_CELL = 4
const MAX_CELL = 14

/**
 * GitHub-style year heatmap. Always fits its container — no scrollbars.
 * Cell size, gap, and label column all shrink dynamically as the panel
 * narrows. When the panel is very narrow, weekday labels collapse.
 */
export function FullHeatmap({
  cells,
  color,
  cellSize: maxCell = MAX_CELL,
  onCellClick,
  loading,
}: FullHeatmapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout>(() => ({
    cellSize: Math.min(maxCell, 11),
    gap: 3,
    labelCol: 32,
    showWeekdayLabels: true,
  }))

  const weeks = useMemo(() => groupIntoWeeks(cells), [cells])
  const monthLabels = useMemo(() => buildMonthLabels(weeks), [weeks])

  // Recompute on resize. The layout always satisfies:
  //   labelCol + labelGap(if labels) + weeks*(cellSize+gap) - gap <= width
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || weeks.length === 0) return
    const compute = (width: number) => setLayout(fitLayout(width, weeks.length, maxCell))
    compute(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => compute(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [weeks.length, maxCell])

  if (loading) {
    return (
      <div style={{ height: 100, opacity: 0.5, fontSize: 12, color: 'var(--text-muted)' }}>
        Loading heatmap…
      </div>
    )
  }

  if (cells.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No data yet.</div>
  }

  const { cellSize, gap, labelCol, showWeekdayLabels } = layout
  const labelGap = showWeekdayLabels ? 6 : 0

  return (
    <div ref={wrapperRef} style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Month labels — pitch must match cell columns:
            each label's width = cellSize, parent gap = gap, so label[i]
            sits at i * (cellSize + gap) from the start of the cell area. */}
        <div
          style={{
            display: 'flex',
            gap,
            paddingLeft: labelCol + labelGap,
            color: 'var(--text-muted)',
            fontSize: 10,
          }}
        >
          {monthLabels.map((label, i) => (
            <span
              key={i}
              style={{
                width: cellSize,
                flexShrink: 0,
                whiteSpace: 'nowrap',
                overflow: 'visible',
              }}
            >
              {label}
            </span>
          ))}
        </div>

        <div style={{ display: 'flex', gap: labelGap }}>
          {/* Weekday legend */}
          {showWeekdayLabels && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap,
                fontSize: 10,
                color: 'var(--text-muted)',
                width: labelCol,
                flexShrink: 0,
              }}
            >
              {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((label, idx) => (
                <span key={idx} style={{ height: cellSize, lineHeight: `${cellSize}px` }}>
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Cell grid */}
          <div style={{ display: 'flex', gap }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap }}>
                {week.map((cell, di) =>
                  cell ? (
                    <button
                      key={cell.date}
                      onClick={onCellClick ? () => onCellClick(cell) : undefined}
                      title={`${formatLong(cell.date)}${
                        cell.completed
                          ? ' • completed'
                          : cell.value > 0
                            ? ` • ${cell.value}`
                            : ' • —'
                      }`}
                      aria-label={cell.date}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        borderRadius: 2,
                        border: 'none',
                        padding: 0,
                        background:
                          cell.completed || cell.intensity > 0
                            ? tintColor(color, Math.max(0.25, cell.intensity || 0))
                            : 'var(--bg-tertiary)',
                        cursor: onCellClick ? 'pointer' : 'default',
                      }}
                    />
                  ) : (
                    <span
                      key={`pad-${wi}-${di}`}
                      style={{ width: cellSize, height: cellSize }}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginTop: 4,
            fontSize: 10,
            color: 'var(--text-muted)',
          }}
        >
          <span>Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((i) => (
            <span
              key={i}
              style={{
                width: Math.max(8, cellSize),
                height: Math.max(8, cellSize),
                borderRadius: 2,
                background: i === 0 ? 'var(--bg-tertiary)' : tintColor(color, Math.max(0.25, i)),
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------- layout solver

interface Layout {
  cellSize: number
  gap: number
  labelCol: number
  showWeekdayLabels: boolean
}

/**
 * Pick the largest valid (cellSize, gap, labelCol) that satisfies:
 *   labelCol + labelGap + weeks*cellSize + (weeks-1)*gap <= width
 * Tries (cellSize, gap) tiers from largest to smallest. Drops weekday
 * labels and label column entirely if even the smallest cell with no
 * label still doesn't fit.
 */
function fitLayout(width: number, weeks: number, maxCell: number): Layout {
  const tiers: Array<{ cell: number; gap: number; labelCol: number }> = [
    { cell: Math.min(maxCell, 14), gap: 3, labelCol: 32 },
    { cell: 12, gap: 3, labelCol: 32 },
    { cell: 11, gap: 3, labelCol: 32 },
    { cell: 10, gap: 3, labelCol: 30 },
    { cell: 9, gap: 2, labelCol: 28 },
    { cell: 8, gap: 2, labelCol: 26 },
    { cell: 7, gap: 2, labelCol: 24 },
    { cell: 6, gap: 1, labelCol: 22 },
    { cell: 5, gap: 1, labelCol: 20 },
    { cell: MIN_CELL, gap: 1, labelCol: 18 },
  ]

  for (const t of tiers) {
    if (t.cell > maxCell) continue
    const labelGap = 6
    const need = t.labelCol + labelGap + weeks * t.cell + (weeks - 1) * t.gap
    if (need <= width) {
      return {
        cellSize: t.cell,
        gap: t.gap,
        labelCol: t.labelCol,
        showWeekdayLabels: true,
      }
    }
  }

  // Even the smallest tier with labels doesn't fit — drop labels entirely.
  for (const t of tiers) {
    const need = weeks * t.cell + (weeks - 1) * t.gap
    if (need <= width) {
      return {
        cellSize: t.cell,
        gap: t.gap,
        labelCol: 0,
        showWeekdayLabels: false,
      }
    }
  }

  // As a final fallback, force-fit MIN_CELL with gap=0 and no labels.
  const cell = Math.max(2, Math.floor(width / weeks))
  return {
    cellSize: cell,
    gap: 0,
    labelCol: 0,
    showWeekdayLabels: false,
  }
}

// --------------------------------------------------------- helpers

function groupIntoWeeks(cells: HeatmapCell[]): (HeatmapCell | null)[][] {
  if (cells.length === 0) return []

  const firstDate = fromIso(cells[0].date)
  const firstDow = firstDate.getDay()
  const dowToRow = (dow: number) => (dow + 6) % 7

  const weeks: (HeatmapCell | null)[][] = []
  let current: (HeatmapCell | null)[] = []

  const startPadding = dowToRow(firstDow)
  for (let i = 0; i < startPadding; i++) current.push(null)

  for (const cell of cells) {
    current.push(cell)
    const dow = fromIso(cell.date).getDay()
    if (dowToRow(dow) === 6) {
      weeks.push(current)
      current = []
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null)
    weeks.push(current)
  }
  return weeks
}

function buildMonthLabels(weeks: (HeatmapCell | null)[][]): string[] {
  const labels: string[] = []
  let prevMonth = -1
  for (const week of weeks) {
    const firstCell = week.find((c): c is HeatmapCell => !!c)
    if (!firstCell) {
      labels.push('')
      continue
    }
    const month = fromIso(firstCell.date).getMonth()
    if (month !== prevMonth) {
      labels.push(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month])
      prevMonth = month
    } else {
      labels.push('')
    }
  }
  return labels
}
