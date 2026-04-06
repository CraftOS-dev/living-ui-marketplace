import { useMemo } from 'react'
import type { DailyActivityData } from '../../types'

interface StreakCalendarProps {
  activities: DailyActivityData[]
}

export function StreakCalendar({ activities }: StreakCalendarProps) {
  const { cells, dayLabels } = useMemo(() => {
    const activityMap = new Map<string, number>()
    for (const a of activities) {
      activityMap.set(a.date, a.xpEarned)
    }

    const today = new Date()
    const days: Array<{ date: string; xp: number; dayOfWeek: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      days.push({
        date: dateStr,
        xp: activityMap.get(dateStr) || 0,
        dayOfWeek: d.getDay(),
      })
    }

    return {
      cells: days,
      dayLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    }
  }, [activities])

  return (
    <>
      <style>{`
        .streak-calendar {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }
        .streak-calendar-title {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          margin: 0;
        }
        .streak-calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 3px;
        }
        .streak-calendar-day-label {
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          padding-bottom: var(--space-1);
        }
        .streak-calendar-cell {
          aspect-ratio: 1;
          border-radius: 3px;
          min-width: 0;
          position: relative;
        }
        .streak-calendar-cell.active {
          background-color: var(--color-success);
        }
        .streak-calendar-cell.inactive {
          background-color: var(--bg-tertiary);
        }
        .streak-calendar-cell[title] {
          cursor: default;
        }
      `}</style>
      <div className="streak-calendar">
        <h4 className="streak-calendar-title">Practice Calendar (Last 30 Days)</h4>
        <div className="streak-calendar-grid">
          {dayLabels.map((label) => (
            <div key={label} className="streak-calendar-day-label">{label}</div>
          ))}
          {/* Fill empty cells for alignment to first day's weekday */}
          {cells.length > 0 && Array.from({ length: cells[0].dayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {cells.map((cell) => (
            <div
              key={cell.date}
              className={`streak-calendar-cell ${cell.xp > 0 ? 'active' : 'inactive'}`}
              title={`${cell.date}: ${cell.xp} XP`}
            />
          ))}
        </div>
      </div>
    </>
  )
}
