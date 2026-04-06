
import { Card, Badge } from '../ui'
import type { ProgressStats } from '../../types'

interface StatsCardsProps {
  stats: ProgressStats
}

interface StatCardItem {
  label: string
  value: string | number
  badge?: string
  badgeVariant?: 'primary' | 'success' | 'warning' | 'info'
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards: StatCardItem[] = [
    { label: 'Total Words', value: stats.totalWords, badge: 'Vocabulary', badgeVariant: 'primary' },
    { label: 'Total Quizzes', value: stats.totalQuizzes, badge: 'Quizzes', badgeVariant: 'info' },
    { label: 'Average Accuracy', value: `${Math.round(stats.averageAccuracy)}%`, badge: 'Accuracy', badgeVariant: 'success' },
    { label: 'Longest Streak', value: `${stats.longestStreak} days`, badge: 'Streak', badgeVariant: 'warning' },
    { label: 'Best Quiz', value: stats.bestQuizScore || 'N/A', badge: 'Record', badgeVariant: 'success' },
    { label: 'Most XP in a Day', value: `${stats.maxDailyXp} XP`, badge: 'Daily Best', badgeVariant: 'primary' },
  ]

  return (
    <>
      <style>{`
        .stats-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: var(--space-3);
        }
        .stats-card-inner {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }
        .stats-card-label {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .stats-card-value {
          font-size: var(--font-size-2xl);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }
      `}</style>
      <div className="stats-cards-grid">
        {cards.map((card) => (
          <Card key={card.label} padding="md">
            <div className="stats-card-inner">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="stats-card-label">{card.label}</span>
                {card.badge && (
                  <Badge variant={card.badgeVariant} size="sm">{card.badge}</Badge>
                )}
              </div>
              <span className="stats-card-value">{card.value}</span>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
