import React, { useState, useMemo } from 'react'
import { Button, Card } from '../ui'
import type { QuizQuestion } from '../../types'

interface SentenceBuildQuestionProps {
  question: QuizQuestion
  onAnswer: (correct: boolean) => void
}

export function SentenceBuildQuestion({ question, onAnswer }: SentenceBuildQuestionProps) {
  const scrambled = useMemo(() => {
    if (question.scrambledWords && question.scrambledWords.length > 0) {
      return question.scrambledWords
    }
    const words = question.correctAnswer.split(' ')
    const shuffled = [...words]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }, [question])

  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [answered, setAnswered] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)

  const builtSentence = selectedIndices.map((i) => scrambled[i]).join(' ')

  const handleAddWord = (index: number) => {
    if (answered || selectedIndices.includes(index)) return
    setSelectedIndices((prev) => [...prev, index])
  }

  const handleRemoveWord = (posIndex: number) => {
    if (answered) return
    setSelectedIndices((prev) => prev.filter((_, i) => i !== posIndex))
  }

  const handleSubmit = () => {
    if (answered) return
    const correct = builtSentence.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()
    setIsCorrect(correct)
    setAnswered(true)
    onAnswer(correct)
  }

  const chipStyle = (used: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: 'var(--space-1) var(--space-3)',
    backgroundColor: used ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
    color: used ? 'var(--text-muted)' : 'var(--text-primary)',
    border: `1px solid ${used ? 'var(--border-primary)' : 'var(--color-primary)'}`,
    borderRadius: 'var(--radius-full)',
    cursor: used || answered ? 'default' : 'pointer',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)' as React.CSSProperties['fontWeight'],
    opacity: used ? 0.4 : 1,
    transition: 'var(--transition-fast)',
  })

  const answerChipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: 'var(--space-1) var(--space-3)',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-white)',
    borderRadius: 'var(--radius-full)',
    cursor: answered ? 'default' : 'pointer',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-medium)' as React.CSSProperties['fontWeight'],
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

        <div style={{
          minHeight: 48,
          padding: 'var(--space-3)',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          border: answered
            ? `2px solid ${isCorrect ? 'var(--color-success)' : 'var(--color-error)'}`
            : '1px solid var(--border-primary)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          alignItems: 'center',
        }}>
          {selectedIndices.length === 0 ? (
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              Click words below to build your sentence
            </span>
          ) : (
            selectedIndices.map((wordIndex, posIndex) => (
              <span
                key={posIndex}
                style={answerChipStyle}
                onClick={() => handleRemoveWord(posIndex)}
              >
                {scrambled[wordIndex]}
              </span>
            ))
          )}
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          justifyContent: 'center',
        }}>
          {scrambled.map((word, i) => (
            <span
              key={i}
              style={chipStyle(selectedIndices.includes(i))}
              onClick={() => handleAddWord(i)}
            >
              {word}
            </span>
          ))}
        </div>

        {!answered && (
          <Button
            onClick={handleSubmit}
            disabled={selectedIndices.length === 0}
            fullWidth
          >
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
          </div>
        )}
      </div>
    </Card>
  )
}
