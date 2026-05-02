import { useMemo } from 'react'
import type { DailyActivityData } from '../../types'

interface ActivitySummaryProps {
  activities: DailyActivityData[]
  windowDays?: number
}

export function ActivitySummary({ activities, windowDays = 30 }: ActivitySummaryProps) {
  const totals = useMemo(() => {
    const activeDays = activities.filter(a => a.xpEarned > 0).length
    const xp = activities.reduce((s, a) => s + a.xpEarned, 0)
    const words = activities.reduce((s, a) => s + a.wordsLearned, 0)
    const cards = activities.reduce((s, a) => s + a.cardsReviewed, 0)
    const quizzes = activities.reduce((s, a) => s + a.quizzesCompleted, 0)
    return { activeDays, xp, words, cards, quizzes }
  }, [activities])

  const items: Array<{ label: string; value: string; emoji: string }> = [
    { label: 'Active days', value: `${totals.activeDays} / ${windowDays}`, emoji: '📅' },
    { label: 'XP earned', value: totals.xp.toLocaleString(), emoji: '⚡' },
    { label: 'Words learned', value: totals.words.toLocaleString(), emoji: '📚' },
    { label: 'Cards reviewed', value: totals.cards.toLocaleString(), emoji: '🃏' },
    { label: 'Quizzes', value: totals.quizzes.toLocaleString(), emoji: '🧠' },
  ]

  return (
    <>
      <style>{`
        .activity-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: var(--space-2);
        }
        .activity-summary-tile {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: var(--space-3);
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
        }
        .activity-summary-row {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }
        .activity-summary-emoji {
          font-size: 18px;
          line-height: 1;
        }
        .activity-summary-label {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .activity-summary-value {
          font-size: var(--font-size-xl);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          line-height: 1.1;
        }
      `}</style>
      <div className="activity-summary">
        {items.map(item => (
          <div key={item.label} className="activity-summary-tile">
            <div className="activity-summary-row">
              <span className="activity-summary-emoji">{item.emoji}</span>
              <span className="activity-summary-label">{item.label}</span>
            </div>
            <span className="activity-summary-value">{item.value}</span>
          </div>
        ))}
      </div>
    </>
  )
}
