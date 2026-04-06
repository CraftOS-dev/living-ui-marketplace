
import { Card } from '../ui'
import type { AchievementBadge } from '../../types'

interface AchievementGridProps {
  badges: AchievementBadge[]
  earnedCount: number
  totalCount: number
}

export function AchievementGrid({ badges, earnedCount, totalCount }: AchievementGridProps) {
  return (
    <>
      <style>{`
        .achievement-header {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          margin-bottom: var(--space-4);
        }
        .achievement-header strong {
          color: var(--color-primary);
        }
        .achievement-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: var(--space-3);
        }
        .achievement-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: var(--space-2);
          position: relative;
        }
        .achievement-icon {
          font-size: 40px;
          line-height: 1;
        }
        .achievement-card.locked .achievement-icon {
          filter: grayscale(1);
          opacity: 0.4;
        }
        .achievement-lock-overlay {
          position: absolute;
          top: 8px;
          right: 8px;
          font-size: 14px;
          opacity: 0.6;
        }
        .achievement-name {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
        }
        .achievement-card.locked .achievement-name {
          color: var(--text-muted);
        }
        .achievement-desc {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          line-height: 1.4;
        }
        .achievement-date {
          font-size: var(--font-size-xs);
          color: var(--color-success);
        }
      `}</style>
      <div>
        <p className="achievement-header">
          <strong>{earnedCount}</strong> of {totalCount} badges earned
        </p>
        <div className="achievement-grid">
          {badges.map((badge) => (
            <Card key={badge.badgeId} padding="md">
              <div className={`achievement-card${badge.earned ? '' : ' locked'}`}>
                {!badge.earned && <span className="achievement-lock-overlay">🔒</span>}
                <span className="achievement-icon">{badge.icon}</span>
                <span className="achievement-name">{badge.name}</span>
                <span className="achievement-desc">{badge.description}</span>
                {badge.earned && badge.earnedAt && (
                  <span className="achievement-date">
                    Earned {new Date(badge.earnedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  )
}
