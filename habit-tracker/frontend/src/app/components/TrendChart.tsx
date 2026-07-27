import type { TrendPoint } from '../types'
import { tintColor } from '../lib/dates'

interface TrendChartProps {
  points: TrendPoint[]
  color: string
  height?: number
}

/**
 * Compact sparkline showing intensity per day across the trend window.
 * Renders as bars (one per day) — easier to read than a line for sparse data.
 */
export function TrendChart({ points, color, height = 56 }: TrendChartProps) {
  if (points.length === 0) {
    return (
      <div style={{ height, fontSize: 12, color: 'var(--text-muted)' }}>
        No data yet.
      </div>
    )
  }

  const completed = points.filter((p) => p.completed).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          height,
          padding: '0 2px',
        }}
      >
        {points.map((p, i) => {
          const ratio = Math.max(p.completed ? 1 : p.intensity, 0)
          const barHeight = Math.max(2, Math.round(height * Math.max(ratio, 0.04)))
          return (
            <span
              key={i}
              title={`${p.date}: ${p.completed ? 'done' : p.value > 0 ? p.value : '—'}`}
              style={{
                flex: '1 1 auto',
                height: barHeight,
                background:
                  ratio > 0
                    ? tintColor(color, Math.max(0.3, ratio))
                    : 'var(--bg-tertiary)',
                borderRadius: 2,
                transition: 'height 120ms ease',
              }}
            />
          )
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--text-muted)',
        }}
      >
        <span>{points[0].date}</span>
        <span>
          {completed} / {points.length} days
        </span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </div>
  )
}
