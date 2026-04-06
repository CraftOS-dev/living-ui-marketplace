
import { Card } from '../ui'

interface StreakCardProps {
  currentStreak: number
  longestStreak: number
  streakFreezeCount: number
}

export function StreakCard({ currentStreak, longestStreak, streakFreezeCount }: StreakCardProps) {
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: '32px', lineHeight: 1 }} role="img" aria-label="fire">
            {'\uD83D\uDD25'}
          </span>
          <div>
            <div
              style={{
                fontSize: 'var(--font-size-xl, 1.5rem)',
                fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
                color: 'var(--text-primary)',
                lineHeight: 1.2,
              }}
            >
              {currentStreak} day{currentStreak !== 1 ? 's' : ''}
            </div>
            <div
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              Current Streak
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
          }}
        >
          <span>Best: {longestStreak} day{longestStreak !== 1 ? 's' : ''}</span>
          <span>
            {'\u2744\uFE0F'} {streakFreezeCount} freeze{streakFreezeCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </Card>
  )
}
