
import type { WeeklyXp } from '../../types'

interface WeeklyXPChartProps {
  data: WeeklyXp[]
}

export function WeeklyXPChart({ data }: WeeklyXPChartProps) {
  const maxXp = Math.max(...data.map((w) => w.totalXp), 1)
  const chartHeight = 180

  const isCurrentWeek = (weekStart: string, weekEnd: string): boolean => {
    const now = new Date()
    return now >= new Date(weekStart) && now <= new Date(weekEnd)
  }

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <>
      <style>{`
        .weekly-xp-chart {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }
        .weekly-xp-chart-title {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          margin: 0;
        }
        .weekly-xp-bars {
          display: flex;
          align-items: flex-end;
          gap: var(--space-2);
          height: ${chartHeight}px;
          padding: var(--space-2) 0;
        }
        .weekly-xp-bar-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-1);
          min-width: 0;
        }
        .weekly-xp-bar-value {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          white-space: nowrap;
        }
        .weekly-xp-bar {
          width: 100%;
          max-width: 40px;
          border-radius: var(--radius-md) var(--radius-md) 0 0;
          transition: height 0.3s ease;
          min-height: 4px;
        }
        .weekly-xp-bar.current {
          background-color: var(--color-primary);
        }
        .weekly-xp-bar.past {
          background-color: var(--bg-tertiary);
        }
        .weekly-xp-bar-label {
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
      `}</style>
      <div className="weekly-xp-chart">
        <h4 className="weekly-xp-chart-title">Weekly XP</h4>
        <div className="weekly-xp-bars">
          {data.map((week) => {
            const isCurrent = isCurrentWeek(week.weekStart, week.weekEnd)
            const barHeight = Math.max((week.totalXp / maxXp) * (chartHeight - 40), 4)
            return (
              <div key={week.weekStart} className="weekly-xp-bar-col">
                <span className="weekly-xp-bar-value">{week.totalXp}</span>
                <div
                  className={`weekly-xp-bar ${isCurrent ? 'current' : 'past'}`}
                  style={{ height: barHeight }}
                />
                <span className="weekly-xp-bar-label">{formatDate(week.weekStart)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
