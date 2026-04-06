import React, { useState } from 'react'
import { Button, Card } from '../ui'
import { ApiService } from '../../services/ApiService'
import { toast } from 'react-toastify'
import type { FlashcardCard } from '../../types'

interface FlashcardSessionProps {
  cards: FlashcardCard[]
  onComplete: (reviewed: number, correct: number) => void
}

export function FlashcardSession({ cards, onComplete }: FlashcardSessionProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const currentCard = cards[currentIndex]
  const progress = currentIndex / cards.length

  const handleRate = async (quality: number) => {
    if (submitting) return
    setSubmitting(true)

    try {
      await ApiService.reviewFlashcard(currentCard.word.id, quality)
    } catch {
      toast.error('Failed to save review')
    }

    const isCorrect = quality >= 3
    if (isCorrect) {
      setCorrectCount((prev) => prev + 1)
    }

    setSubmitting(false)
    setFlipped(false)

    if (currentIndex + 1 >= cards.length) {
      onComplete(cards.length, correctCount + (isCorrect ? 1 : 0))
    } else {
      setCurrentIndex((prev) => prev + 1)
    }
  }

  const progressBarStyle: React.CSSProperties = {
    width: '100%',
    height: 6,
    backgroundColor: 'var(--bg-tertiary)',
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
    marginBottom: 'var(--space-4)',
  }

  const progressFillStyle: React.CSSProperties = {
    height: '100%',
    width: `${progress * 100}%`,
    backgroundColor: 'var(--color-primary)',
    borderRadius: 'var(--radius-full)',
    transition: 'width 0.3s ease',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 500, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {currentIndex + 1} / {cards.length}
        </span>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {correctCount} correct
        </span>
      </div>

      <div style={progressBarStyle}>
        <div style={progressFillStyle} />
      </div>

      <Card
        padding="lg"
        style={{
          minHeight: 240,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: !flipped ? 'pointer' : 'default',
          textAlign: 'center',
        }}
      >
        {!flipped ? (
          <div onClick={() => setFlipped(true)} style={{ width: '100%' }}>
            <span style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
              color: 'var(--text-primary)',
            }}>
              {currentCard.word.word}
            </span>
            <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
              Tap to reveal
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
            <span style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
              color: 'var(--color-primary)',
            }}>
              {currentCard.word.translation}
            </span>
            {currentCard.word.pronunciation && (
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                {currentCard.word.pronunciation}
              </span>
            )}
            {currentCard.word.exampleSentence && (
              <div style={{
                padding: 'var(--space-2) var(--space-3)',
                backgroundColor: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-secondary)',
              }}>
                {currentCard.word.exampleSentence}
              </div>
            )}
          </div>
        )}
      </Card>

      {flipped && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)' }}>
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleRate(0)}
            disabled={submitting}
          >
            Again
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleRate(3)}
            disabled={submitting}
          >
            Hard
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleRate(4)}
            disabled={submitting}
          >
            Good
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleRate(5)}
            disabled={submitting}
            style={{ backgroundColor: 'var(--color-success)', color: 'var(--color-white)' }}
          >
            Easy
          </Button>
        </div>
      )}
    </div>
  )
}
