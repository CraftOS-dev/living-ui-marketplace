
import { Card } from '../ui'
import type { ProgressStats } from '../../types'

interface PersonalBestsProps {
  stats: ProgressStats
}

interface BestItem {
  label: string
  value: string
  icon: string
}

export function PersonalBests({ stats }: PersonalBestsProps) {
  const bests: BestItem[] = [
    {
      label: 'Longest Streak',
      value: `${stats.longestStreak} day${stats.longestStreak !== 1 ? 's' : ''}`,
      icon: '🔥',
    },
    {
      label: 'Best Quiz Score',
      value: stats.bestQuizScore || 'N/A',
      icon: '🏆',
    },
    {
      label: 'Most XP in a Day',
      value: `${stats.maxDailyXp} XP`,
      icon: '⚡',
    },
  ]

  return (
    <>
      <style>{`
        .personal-bests {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }
        .personal-bests-title {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          margin: 0;
        }
        .personal-bests-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: var(--space-3);
        }
        .personal-best-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: var(--space-2);
        }
        .personal-best-icon {
          font-size: 28px;
          line-height: 1;
        }
        .personal-best-value {
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }
        .personal-best-label {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }
      `}</style>
      <div className="personal-bests">
        <h4 className="personal-bests-title">Personal Bests</h4>
        <div className="personal-bests-grid">
          {bests.map((best) => (
            <Card key={best.label} padding="md">
              <div className="personal-best-card">
                <span className="personal-best-icon">{best.icon}</span>
                <span className="personal-best-value">{best.value}</span>
                <span className="personal-best-label">{best.label}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  )
}
