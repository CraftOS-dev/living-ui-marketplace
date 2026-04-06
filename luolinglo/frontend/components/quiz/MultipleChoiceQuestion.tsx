import React, { useState } from 'react'
import { Button, Card } from '../ui'
import type { QuizQuestion } from '../../types'

interface MultipleChoiceQuestionProps {
  question: QuizQuestion
  onAnswer: (correct: boolean) => void
}

export function MultipleChoiceQuestion({ question, onAnswer }: MultipleChoiceQuestionProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)

  const handleSelect = (option: string) => {
    if (answered) return
    setSelected(option)
    setAnswered(true)
    const isCorrect = option === question.correctAnswer
    onAnswer(isCorrect)
  }

  const getButtonStyle = (option: string): React.CSSProperties => {
    if (!answered) return {}
    if (option === question.correctAnswer) {
      return {
        backgroundColor: 'var(--color-success)',
        color: 'var(--color-white)',
        borderColor: 'var(--color-success)',
      }
    }
    if (option === selected && option !== question.correctAnswer) {
      return {
        backgroundColor: 'var(--color-error)',
        color: 'var(--color-white)',
        borderColor: 'var(--color-error)',
      }
    }
    return { opacity: 0.5 }
  }

  return (
    <Card padding="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h3 style={{
          margin: 0,
          fontSize: 'var(--font-size-lg)',
          color: 'var(--text-primary)',
          textAlign: 'center',
        }}>
          {question.question}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {(question.options || []).map((option, i) => (
            <Button
              key={i}
              variant="secondary"
              fullWidth
              onClick={() => handleSelect(option)}
              disabled={answered}
              style={{
                justifyContent: 'flex-start',
                textAlign: 'left',
                ...getButtonStyle(option),
              }}
            >
              {option}
            </Button>
          ))}
        </div>

        {answered && question.explanation && (
          <div style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
          }}>
            {question.explanation}
          </div>
        )}
      </div>
    </Card>
  )
}
