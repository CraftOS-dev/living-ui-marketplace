
import { Card, Button, EmptyState } from '../ui'

interface DueCardsCardProps {
  dueCount: number
  onStartReview: () => void
}

export function DueCardsCard({ dueCount, onStartReview }: DueCardsCardProps) {
  return (
    <Card>
      {dueCount === 0 ? (
        <EmptyState
          message="No flashcards due for review. Great job!"
          icon={'\u2705'}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-2) 0',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
                color: 'var(--color-primary)',
                lineHeight: 1.2,
              }}
            >
              {dueCount}
            </div>
            <div
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              card{dueCount !== 1 ? 's' : ''} due for review
            </div>
          </div>
          <Button variant="primary" onClick={onStartReview}>
            Start Review
          </Button>
        </div>
      )}
    </Card>
  )
}
