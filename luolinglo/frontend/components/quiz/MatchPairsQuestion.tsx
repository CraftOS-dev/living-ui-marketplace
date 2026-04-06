import React, { useState, useMemo } from 'react'
import { Card, Button } from '../ui'

interface MatchPairsQuestionProps {
  pairs: Array<{ word: string; translation: string }>
  onComplete: (correct: number) => void
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function MatchPairsQuestion({ pairs, onComplete }: MatchPairsQuestionProps) {
  const shuffledTranslations = useMemo(() => shuffleArray(pairs.map((p) => p.translation)), [pairs])

  const [selectedWord, setSelectedWord] = useState<number | null>(null)
  const [matches, setMatches] = useState<Map<number, number>>(new Map())
  const [correctIndices, setCorrectIndices] = useState<Set<number>>(new Set())
  const [incorrectPair, setIncorrectPair] = useState<{ word: number; trans: number } | null>(null)

  const handleWordClick = (index: number) => {
    if (correctIndices.has(index)) return
    setSelectedWord(index)
    setIncorrectPair(null)
  }

  const handleTranslationClick = (transIndex: number) => {
    if (selectedWord === null) return
    const translationAlreadyMatched = Array.from(matches.values()).includes(transIndex)
    if (translationAlreadyMatched) return

    const correctTranslation = pairs[selectedWord].translation
    const selectedTranslation = shuffledTranslations[transIndex]

    if (correctTranslation === selectedTranslation) {
      const newCorrect = new Set(correctIndices)
      newCorrect.add(selectedWord)
      setCorrectIndices(newCorrect)

      const newMatches = new Map(matches)
      newMatches.set(selectedWord, transIndex)
      setMatches(newMatches)
      setSelectedWord(null)
      setIncorrectPair(null)

      if (newCorrect.size === pairs.length) {
        onComplete(pairs.length)
      }
    } else {
      setIncorrectPair({ word: selectedWord, trans: transIndex })
      setTimeout(() => {
        setIncorrectPair(null)
        setSelectedWord(null)
      }, 800)
    }
  }

  const getWordStyle = (index: number): React.CSSProperties => {
    if (correctIndices.has(index)) {
      return {
        backgroundColor: 'var(--color-success)',
        color: 'var(--color-white)',
        borderColor: 'var(--color-success)',
      }
    }
    if (incorrectPair?.word === index) {
      return {
        backgroundColor: 'var(--color-error)',
        color: 'var(--color-white)',
        borderColor: 'var(--color-error)',
      }
    }
    if (selectedWord === index) {
      return {
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-white)',
        borderColor: 'var(--color-primary)',
      }
    }
    return {}
  }

  const getTransStyle = (index: number): React.CSSProperties => {
    const matchedWordIndex = Array.from(matches.entries()).find(([, v]) => v === index)?.[0]
    if (matchedWordIndex !== undefined && correctIndices.has(matchedWordIndex)) {
      return {
        backgroundColor: 'var(--color-success)',
        color: 'var(--color-white)',
        borderColor: 'var(--color-success)',
      }
    }
    if (incorrectPair?.trans === index) {
      return {
        backgroundColor: 'var(--color-error)',
        color: 'var(--color-white)',
        borderColor: 'var(--color-error)',
      }
    }
    return {}
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
          Match the pairs
        </h3>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
          {correctIndices.size} / {pairs.length} matched
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {pairs.map((pair, i) => (
              <Button
                key={`word-${i}`}
                variant="secondary"
                fullWidth
                onClick={() => handleWordClick(i)}
                disabled={correctIndices.has(i)}
                style={getWordStyle(i)}
              >
                {pair.word}
              </Button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {shuffledTranslations.map((trans, i) => {
              const isMatched = Array.from(matches.values()).includes(i)
              return (
                <Button
                  key={`trans-${i}`}
                  variant="secondary"
                  fullWidth
                  onClick={() => handleTranslationClick(i)}
                  disabled={isMatched}
                  style={getTransStyle(i)}
                >
                  {trans}
                </Button>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}
