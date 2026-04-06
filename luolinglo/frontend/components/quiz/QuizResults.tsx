
import { Card, Button, Badge } from '../ui'

interface QuizResultsProps {
  quizType: string
  totalQuestions: number
  correctAnswers: number
  xpEarned: number
  onDone: () => void
  onRetry: () => void
}

const QUIZ_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Multiple Choice',
  fill_blank: 'Fill in the Blank',
  match_pairs: 'Match Pairs',
  sentence_building: 'Sentence Building',
}

export function QuizResults({ quizType, totalQuestions, correctAnswers, xpEarned, onDone, onRetry }: QuizResultsProps) {
  const accuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-6)',
      padding: 'var(--space-8) 0',
    }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
        Quiz Complete!
      </h2>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
        {QUIZ_TYPE_LABELS[quizType] || quizType}
      </span>

      <div style={{
        fontSize: '64px',
        fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
        color: 'var(--text-primary)',
        lineHeight: 1,
      }}>
        {correctAnswers}/{totalQuestions}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-3)',
        width: '100%',
        maxWidth: 320,
      }}>
        <Card padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Accuracy</span>
            <span style={{
              fontSize: 'var(--font-size-xl)',
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

      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <Button variant="secondary" size="lg" onClick={onRetry}>
          Try Again
        </Button>
        <Button size="lg" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
