import React, { useState } from 'react'
import { Card, Button, Select, Tabs, TabList, Tab, TabPanel } from '../ui'
import { QuizSession } from './QuizSession'
import { QuizResults } from './QuizResults'
import { QuizHistory } from './QuizHistory'
import { ApiService } from '../../services/ApiService'
import { toast } from 'react-toastify'
import { VOCABULARY_CATEGORIES } from '../../types'
import type { QuizQuestion } from '../../types'

interface QuizTypeOption {
  id: string
  label: string
  description: string
}

const QUIZ_TYPES: QuizTypeOption[] = [
  { id: 'multiple_choice', label: 'Multiple Choice', description: 'Pick the correct answer from 4 options' },
  { id: 'fill_blank', label: 'Fill in the Blank', description: 'Type the missing word' },
  { id: 'match_pairs', label: 'Match Pairs', description: 'Match words with translations' },
  { id: 'sentence_building', label: 'Sentence Building', description: 'Build sentences from scrambled words' },
]

export function QuizView() {
  const [selectedType, setSelectedType] = useState<string>('')
  const [category, setCategory] = useState('')
  const [questionCount, setQuestionCount] = useState('5')
  const [loading, setLoading] = useState(false)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [inSession, setInSession] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [results, setResults] = useState({ correct: 0, total: 0, xp: 0 })

  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...VOCABULARY_CATEGORIES.map((cat) => ({ value: cat, label: cat })),
  ]

  const countOptions = [
    { value: '5', label: '5 questions' },
    { value: '10', label: '10 questions' },
    { value: '15', label: '15 questions' },
  ]

  const startQuiz = async () => {
    if (!selectedType) {
      toast.error('Please select a quiz type')
      return
    }
    setLoading(true)
    try {
      const result = await ApiService.generateQuiz(selectedType, category || undefined, Number(questionCount))
      setQuestions(result.questions)
      setInSession(true)
    } catch {
      toast.error('Failed to generate quiz')
    } finally {
      setLoading(false)
    }
  }

  const handleComplete = async (correct: number, total: number) => {
    try {
      const submission = await ApiService.submitQuiz({
        quizType: selectedType,
        category: category || undefined,
        totalQuestions: total,
        correctAnswers: correct,
        questionsData: questions,
      })
      setResults({ correct, total, xp: submission.xpEarned })
    } catch {
      setResults({ correct, total, xp: correct * 10 })
    }
    setInSession(false)
    setShowResults(true)
  }

  const handleRetry = () => {
    setShowResults(false)
    startQuiz()
  }

  const handleDone = () => {
    setShowResults(false)
    setSelectedType('')
    setQuestions([])
  }

  if (showResults) {
    return (
      <QuizResults
        quizType={selectedType}
        totalQuestions={results.total}
        correctAnswers={results.correct}
        xpEarned={results.xp}
        onDone={handleDone}
        onRetry={handleRetry}
      />
    )
  }

  if (inSession) {
    return (
      <QuizSession
        questions={questions}
        quizType={selectedType}
        onComplete={handleComplete}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
        Quizzes
      </h2>

      <Tabs defaultTab="new-quiz">
        <TabList>
          <Tab id="new-quiz">New Quiz</Tab>
          <Tab id="history">History</Tab>
        </TabList>

        <TabPanel id="new-quiz">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-3)',
            }}>
              {QUIZ_TYPES.map((qt) => (
                <Card
                  key={qt.id}
                  padding="md"
                  style={{
                    cursor: 'pointer',
                    border: selectedType === qt.id
                      ? '2px solid var(--color-primary)'
                      : '1px solid var(--border-primary)',
                    transition: 'var(--transition-base)',
                  }}
                >
                  <div
                    onClick={() => setSelectedType(qt.id)}
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
                  >
                    <span style={{
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
                      color: selectedType === qt.id ? 'var(--color-primary)' : 'var(--text-primary)',
                    }}>
                      {qt.label}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                      {qt.description}
                    </span>
                  </div>
                </Card>
              ))}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
            }}>
              <Select
                label="Category"
                options={categoryOptions}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <Select
                label="Questions"
                options={countOptions}
                value={questionCount}
                onChange={(e) => setQuestionCount(e.target.value)}
              />
            </div>

            <Button
              size="lg"
              onClick={startQuiz}
              loading={loading}
              disabled={!selectedType}
              fullWidth
            >
              Start Quiz
            </Button>
          </div>
        </TabPanel>

        <TabPanel id="history">
          <QuizHistory />
        </TabPanel>
      </Tabs>
    </div>
  )
}
