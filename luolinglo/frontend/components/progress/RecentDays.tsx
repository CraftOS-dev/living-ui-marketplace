import { useMemo } from 'react'
import type { DailyActivityData } from '../../types'

interface RecentDaysProps {
  activities: DailyActivityData[]
  count?: number
}

export function RecentDays({ activities, count = 10 }: RecentDaysProps) {
  const recent = useMemo(() => {
    const map = new Map<string, DailyActivityData>()
    for (const a of activities) map.set(a.date, a)

    const today = new Date()
    const rows: Array<{ date: string; label: string; weekday: string; activity: DailyActivityData | null }> = []
    for (let i = 0; i < count; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      rows.push({
        date: dateStr,
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        weekday: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short' }),
        activity: map.get(dateStr) || null,
      })
    }
    return rows
  }, [activities, count])

  return (
    <>
      <style>{`
        .recent-days {
          display: flex;
          flex-direction: column;
          padding: var(--space-3);
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          flex: 1;
          min-width: 0;
        }
        .recent-days-title {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          margin: 0 0 var(--space-2) 0;
        }
        .recent-days-list {
          display: flex;
          flex-direction: column;
        }
        .recent-days-row {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-2) 0;
          border-bottom: 1px solid var(--border-primary);
        }
        .recent-days-row:last-child { border-bottom: none; }
        .recent-days-row.empty { opacity: 0.55; }
        .recent-days-date {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 70px;
          flex-shrink: 0;
        }
        .recent-days-date-label {
          font-size: var(--font-size-sm);
          color: var(--text-primary);
          font-weight: var(--font-weight-medium);
        }
        .recent-days-weekday {
          font-size: 11px;
          color: var(--text-muted);
        }
        .recent-days-stats {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-3);
          flex: 1;
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          min-width: 0;
        }
        .recent-days-stat {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }
        .recent-days-stat strong {
          color: var(--text-primary);
          font-weight: var(--font-weight-semibold);
        }
        .recent-days-empty {
          font-size: var(--font-size-sm);
          color: var(--text-muted);
        }
        .recent-days-xp {
          color: var(--color-primary);
          font-weight: var(--font-weight-semibold);
        }
      `}</style>
      <div className="recent-days">
        <h4 className="recent-days-title">Recent days</h4>
        <div className="recent-days-list">
          {recent.map(row => {
            const a = row.activity
            const empty = !a || a.xpEarned === 0
            return (
              <div key={row.date} className={`recent-days-row ${empty ? 'empty' : ''}`}>
                <div className="recent-days-date">
                  <span className="recent-days-date-label">{row.label}</span>
                  <span className="recent-days-weekday">{row.weekday}</span>
                </div>
                {empty ? (
                  <span className="recent-days-empty">No activity</span>
                ) : (
                  <div className="recent-days-stats">
                    <span className="recent-days-stat recent-days-xp">+{a!.xpEarned} XP</span>
                    {a!.wordsLearned > 0 && (
                      <span className="recent-days-stat">📚 <strong>{a!.wordsLearned}</strong></span>
                    )}
                    {a!.cardsReviewed > 0 && (
                      <span className="recent-days-stat">🃏 <strong>{a!.cardsReviewed}</strong></span>
                    )}
                    {a!.quizzesCompleted > 0 && (
                      <span className="recent-days-stat">🧠 <strong>{a!.quizzesCompleted}</strong></span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
