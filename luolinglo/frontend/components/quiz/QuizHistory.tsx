import React, { useState, useEffect } from 'react'
import { Table, Spinner } from '../ui'
import type { TableColumn } from '../ui'
import { ApiService } from '../../services/ApiService'
import { toast } from 'react-toastify'
import type { QuizAttemptData } from '../../types'

const QUIZ_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Multiple Choice',
  fill_blank: 'Fill in the Blank',
  match_pairs: 'Match Pairs',
  sentence_building: 'Sentence Building',
}

export function QuizHistory() {
  const [history, setHistory] = useState<QuizAttemptData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const result = await ApiService.getQuizHistory(20)
        setHistory(result)
      } catch {
        toast.error('Failed to load quiz history')
      } finally {
        setLoading(false)
      }
    }
    fetchHistory()
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <Spinner size={24} />
      </div>
    )
  }

  const columns: TableColumn<QuizAttemptData>[] = [
    {
      key: 'createdAt',
      header: 'Date',
      render: (item) => (
        <span>{new Date(item.createdAt).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'quizType',
      header: 'Type',
      render: (item) => (
        <span>{QUIZ_TYPE_LABELS[item.quizType] || item.quizType}</span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      render: (item) => (
        <span style={{
          fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
          color: (item.correctAnswers / item.totalQuestions) >= 0.8
            ? 'var(--color-success)'
            : (item.correctAnswers / item.totalQuestions) >= 0.5
            ? 'var(--color-warning)'
            : 'var(--color-error)',
        }}>
          {item.correctAnswers}/{item.totalQuestions}
        </span>
      ),
    },
    {
      key: 'xpEarned',
      header: 'XP',
      render: (item) => (
        <span style={{ color: 'var(--color-success)' }}>+{item.xpEarned}</span>
      ),
    },
  ]

  return (
    <Table<QuizAttemptData>
      columns={columns}
      data={history}
      rowKey={(item) => item.id}
      emptyMessage="No quiz history yet. Start a quiz to see your results here."
    />
  )
}
