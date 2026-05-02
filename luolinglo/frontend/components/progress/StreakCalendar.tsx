import { useMemo } from 'react'
import type { DailyActivityData } from '../../types'

interface StreakCalendarProps {
  activities: DailyActivityData[]
}

// XP buckets for intensity coloring
function intensity(xp: number): 0 | 1 | 2 | 3 | 4 {
  if (xp <= 0) return 0
  if (xp < 25) return 1
  if (xp < 75) return 2
  if (xp < 150) return 3
  return 4
}

export function StreakCalendar({ activities }: StreakCalendarProps) {
  const { cells, dayLabels } = useMemo(() => {
    const activityMap = new Map<string, DailyActivityData>()
    for (const a of activities) activityMap.set(a.date, a)

    const today = new Date()
    const days: Array<{ date: string; xp: number; level: number; dayOfWeek: number; activity: DailyActivityData | null }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const a = activityMap.get(dateStr) || null
      const xp = a?.xpEarned ?? 0
      days.push({
        date: dateStr,
        xp,
        level: intensity(xp),
        dayOfWeek: d.getDay(),
        activity: a,
      })
    }

    return {
      cells: days,
      dayLabels: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    }
  }, [activities])

  const tooltipText = (cell: typeof cells[number]): string => {
    const date = new Date(cell.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    if (!cell.activity || cell.xp === 0) return `${date}: no activity`
    const parts: string[] = [`${cell.xp} XP`]
    if (cell.activity.wordsLearned) parts.push(`${cell.activity.wordsLearned} word${cell.activity.wordsLearned === 1 ? '' : 's'}`)
    if (cell.activity.cardsReviewed) parts.push(`${cell.activity.cardsReviewed} review${cell.activity.cardsReviewed === 1 ? '' : 's'}`)
    if (cell.activity.quizzesCompleted) parts.push(`${cell.activity.quizzesCompleted} quiz${cell.activity.quizzesCompleted === 1 ? '' : 'zes'}`)
    return `${date} — ${parts.join(', ')}`
  }

  return (
    <>
      <style>{`
        .streak-calendar {
          display: inline-flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-3);
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          width: fit-content;
        }
        .streak-calendar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
        }
        .streak-calendar-title {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          margin: 0;
        }
        .streak-calendar-subtitle {
          font-size: 11px;
          color: var(--text-muted);
        }
        .streak-calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 14px);
          grid-auto-rows: 14px;
          gap: 3px;
        }
        .streak-calendar-day-label {
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          line-height: 14px;
        }
        .streak-calendar-cell {
          width: 14px;
          height: 14px;
          border-radius: 3px;
          cursor: default;
        }
        .streak-calendar-cell-l0 { background-color: var(--bg-tertiary); }
        .streak-calendar-cell-l1 { background-color: rgba(255, 79, 24, 0.25); }
        .streak-calendar-cell-l2 { background-color: rgba(255, 79, 24, 0.5); }
        .streak-calendar-cell-l3 { background-color: rgba(255, 79, 24, 0.75); }
        .streak-calendar-cell-l4 { background-color: var(--color-primary); }
        .streak-calendar-legend {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          font-size: 10px;
          color: var(--text-muted);
        }
        .streak-calendar-legend-cell {
          width: 10px;
          height: 10px;
          border-radius: 2px;
        }
      `}</style>
      <div className="streak-calendar">
        <div className="streak-calendar-header">
          <h4 className="streak-calendar-title">Practice Calendar</h4>
          <span className="streak-calendar-subtitle">Last 30 days</span>
        </div>
        <div className="streak-calendar-grid">
          {dayLabels.map((label, i) => (
            <div key={`d-${i}`} className="streak-calendar-day-label">{label}</div>
          ))}
          {cells.length > 0 && Array.from({ length: cells[0].dayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {cells.map((cell) => (
            <div
              key={cell.date}
              className={`streak-calendar-cell streak-calendar-cell-l${cell.level}`}
              title={tooltipText(cell)}
            />
          ))}
        </div>
        <div className="streak-calendar-legend">
          <span>Less</span>
          <span className="streak-calendar-legend-cell streak-calendar-cell-l0" />
          <span className="streak-calendar-legend-cell streak-calendar-cell-l1" />
          <span className="streak-calendar-legend-cell streak-calendar-cell-l2" />
          <span className="streak-calendar-legend-cell streak-calendar-cell-l3" />
          <span className="streak-calendar-legend-cell streak-calendar-cell-l4" />
          <span>More</span>
        </div>
      </div>
    </>
  )
}
