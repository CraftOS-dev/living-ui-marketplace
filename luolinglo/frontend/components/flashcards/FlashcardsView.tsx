import React, { useState, useEffect, useCallback } from 'react'
import { Card, Button, Badge, Spinner } from '../ui'
import { FlashcardSession } from './FlashcardSession'
import { FlashcardSummary } from './FlashcardSummary'
import { ApiService } from '../../services/ApiService'
import { toast } from 'react-toastify'
import type { FlashcardStats, FlashcardCard } from '../../types'

export function FlashcardsView() {
  const [stats, setStats] = useState<FlashcardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<FlashcardCard[]>([])
  const [inSession, setInSession] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [sessionResults, setSessionResults] = useState({ reviewed: 0, correct: 0, xp: 0 })

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const result = await ApiService.getFlashcardStats()
      setStats(result)
    } catch {
      toast.error('Failed to load flashcard stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const startSession = async () => {
    try {
      const result = await ApiService.getDueFlashcards(20)
      if (result.cards.length === 0) {
        toast.info('No cards due for review')
        return
      }
      setCards(result.cards)
      setInSession(true)
    } catch {
      toast.error('Failed to load flashcards')
    }
  }

  const handleSessionComplete = (reviewed: number, correct: number) => {
    const xp = correct * 5 + (reviewed - correct) * 2
    setSessionResults({ reviewed, correct, xp })
    setInSession(false)
    setShowSummary(true)
  }

  const handleDone = () => {
    setShowSummary(false)
    fetchStats()
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <Spinner size={32} />
      </div>
    )
  }

  if (showSummary) {
    return (
      <FlashcardSummary
        totalReviewed={sessionResults.reviewed}
        correctCount={sessionResults.correct}
        xpEarned={sessionResults.xp}
        onDone={handleDone}
      />
    )
  }

  if (inSession) {
    return <FlashcardSession cards={cards} onComplete={handleSessionComplete} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
        Flashcards
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <Card padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Badge variant="warning" size="md">Due</Badge>
            <span style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
              color: 'var(--text-primary)',
            }}>
              {stats?.due ?? 0}
            </span>
          </div>
        </Card>

        <Card padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Badge variant="primary" size="md">Total</Badge>
            <span style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
              color: 'var(--text-primary)',
            }}>
              {stats?.total ?? 0}
            </span>
          </div>
        </Card>

        <Card padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Badge variant="success" size="md">Learned</Badge>
            <span style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-bold)' as React.CSSProperties['fontWeight'],
              color: 'var(--text-primary)',
            }}>
              {stats?.learned ?? 0}
            </span>
          </div>
        </Card>
      </div>

      <Button
        size="lg"
        onClick={startSession}
        disabled={!stats || stats.due === 0}
        fullWidth
      >
        Start Review ({stats?.due ?? 0} cards due)
      </Button>
    </div>
  )
}
