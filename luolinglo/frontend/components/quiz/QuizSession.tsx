import { useState, useEffect, useRef } from 'react'
import { MultipleChoiceQuestion } from './MultipleChoiceQuestion'
import { FillBlankQuestion } from './FillBlankQuestion'
import { MatchPairsQuestion } from './MatchPairsQuestion'
import { SentenceBuildQuestion } from './SentenceBuildQuestion'
import type { QuizQuestion } from '../../types'

interface QuizSessionProps {
  questions: QuizQuestion[]
  quizType: string
  onComplete: (correct: number, total: number) => void
}

export function QuizSession({ questions, quizType, onComplete }: QuizSessionProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const progress = (currentIndex + 1) / questions.length

  const handleAnswer = (correct: boolean) => {
    if (correct) {
      setCorrectCount((prev) => prev + 1)
    }
    if (currentIndex + 1 >= questions.length) {
      if (timerRef.current) clearInterval(timerRef.current)
      onComplete(correctCount + (correct ? 1 : 0), questions.length)
    } else {
      setTimeout(() => {
        setCurrentIndex((prev) => prev + 1)
      }, 1500)
    }
  }

  const handleMatchComplete = (correct: number) => {
    setCorrectCount((prev) => prev + correct)
    if (timerRef.current) clearInterval(timerRef.current)
    onComplete(correctCount + correct, questions.length)
  }

  const currentQuestion = questions[currentIndex]

  const renderQuestion = () => {
    switch (quizType) {
      case 'multiple_choice':
        return (
          <MultipleChoiceQuestion
            key={currentIndex}
            question={currentQuestion}
            onAnswer={handleAnswer}
          />
        )
      case 'fill_blank':
        return (
          <FillBlankQuestion
            key={currentIndex}
            question={currentQuestion}
            onAnswer={handleAnswer}
          />
        )
      case 'match_pairs':
        return (
          <MatchPairsQuestion
            pairs={questions.map((q) => ({
              word: q.word || q.question,
              translation: q.translation || q.correctAnswer,
            }))}
            onComplete={handleMatchComplete}
          />
        )
      case 'sentence_building':
        return (
          <SentenceBuildQuestion
            key={currentIndex}
            question={currentQuestion}
            onAnswer={handleAnswer}
          />
        )
      default:
        return (
          <MultipleChoiceQuestion
            key={currentIndex}
            question={currentQuestion}
            onAnswer={handleAnswer}
          />
        )
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          Question {currentIndex + 1} / {questions.length}
        </span>
        <span style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-secondary)',
          fontFamily: 'monospace',
        }}>
          {formatTime(elapsed)}
        </span>
      </div>

      <div style={{
        width: '100%',
        height: 6,
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress * 100}%`,
          backgroundColor: 'var(--color-primary)',
          borderRadius: 'var(--radius-full)',
          transition: 'width 0.3s ease',
        }} />
      </div>

      {renderQuestion()}
    </div>
  )
}
