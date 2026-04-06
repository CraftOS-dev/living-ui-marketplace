
import { Card, Button, Badge } from '../ui'

interface FlashcardSummaryProps {
  totalReviewed: number
  correctCount: number
  xpEarned: number
  onDone: () => void
}

export function FlashcardSummary({ totalReviewed, correctCount, xpEarned, onDone }: FlashcardSummaryProps) {
  const accuracy = totalReviewed > 0 ? Math.round((correctCount / totalReviewed) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-6)', padding: 'var(--space-8) 0' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
        Session Complete!
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 'var(--space-3)',
        width: '100%',
        maxWidth: 480,
      }}>
        <Card padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Cards Reviewed</span>
            <span style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
              color: 'var(--text-primary)',
            }}>
              {totalReviewed}
            </span>
          </div>
        </Card>

        <Card padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Accuracy</span>
            <span style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
              color: accuracy >= 80 ? 'var(--color-success)' : accuracy >= 50 ? 'var(--color-warning)' : 'var(--color-error)',
            }}>
              {accuracy}%
            </span>
          </div>
        </Card>

        <Card padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>XP Earned</span>
            <Badge variant="success" size="md">+{xpEarned} XP</Badge>
          </div>
        </Card>
      </div>

      <Button size="lg" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}
