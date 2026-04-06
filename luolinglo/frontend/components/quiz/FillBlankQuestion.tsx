import React, { useState } from 'react'
import { Button, Card, Input } from '../ui'
import type { QuizQuestion } from '../../types'

interface FillBlankQuestionProps {
  question: QuizQuestion
  onAnswer: (correct: boolean) => void
}

export function FillBlankQuestion({ question, onAnswer }: FillBlankQuestionProps) {
  const [answer, setAnswer] = useState('')
  const [answered, setAnswered] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (answered || !answer.trim()) return

    const correct = answer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()
    setIsCorrect(correct)
    setAnswered(true)
    onAnswer(correct)
  }

  return (
    <Card padding="lg">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h3 style={{
          margin: 0,
          fontSize: 'var(--font-size-lg)',
          color: 'var(--text-primary)',
          textAlign: 'center',
        }}>
          {question.question}
        </h3>

        {question.hint && !answered && (
          <div style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-muted)',
            textAlign: 'center',
            fontStyle: 'italic',
          }}>
            Hint: {question.hint}
          </div>
        )}

        <Input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer..."
          disabled={answered}
          style={answered ? {
            borderColor: isCorrect ? 'var(--color-success)' : 'var(--color-error)',
          } : undefined}
        />

        {!answered && (
          <Button type="submit" disabled={!answer.trim()} fullWidth>
            Submit
          </Button>
        )}

        {answered && (
          <div style={{
            padding: 'var(--space-3)',
            backgroundColor: isCorrect ? 'var(--color-success-light)' : 'var(--color-error-light)',
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
          }}>
            <div style={{
              fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
              color: isCorrect ? 'var(--color-success)' : 'var(--color-error)',
              marginBottom: 'var(--space-1)',
            }}>
              {isCorrect ? 'Correct!' : 'Incorrect'}
            </div>
            {!isCorrect && (
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                Correct answer: <strong>{question.correctAnswer}</strong>
              </div>
            )}
            {question.explanation && (
              <div style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-secondary)',
                marginTop: 'var(--space-1)',
              }}>
                {question.explanation}
              </div>
            )}
          </div>
        )}
      </form>
    </Card>
  )
}
