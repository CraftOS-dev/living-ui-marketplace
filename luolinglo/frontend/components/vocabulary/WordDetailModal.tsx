
import { Modal, Button } from '../ui'
import type { VocabularyWord } from '../../types'

interface WordDetailModalProps {
  word: VocabularyWord | null
  open: boolean
  onClose: () => void
  onAddToFlashcards?: (id: number) => void
}

export function WordDetailModal({ word, open, onClose, onAddToFlashcards }: WordDetailModalProps) {
  if (!word) return null

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-medium)' as React.CSSProperties['fontWeight'],
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 'var(--space-1)',
  }

  const valueStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-base)',
    color: 'var(--text-primary)',
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={word.word}
      size="md"
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {onAddToFlashcards && (
            <Button
              variant="primary"
              onClick={() => {
                onAddToFlashcards(word.id)
                onClose()
              }}
            >
              Add to Flashcards
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <div style={labelStyle}>Translation</div>
          <div style={valueStyle}>{word.translation}</div>
        </div>

        {word.pronunciation && (
          <div>
            <div style={labelStyle}>Pronunciation</div>
            <div style={{ ...valueStyle, fontStyle: 'italic', color: 'var(--text-secondary)' }}>
              {word.pronunciation}
            </div>
          </div>
        )}

        {word.partOfSpeech && (
          <div>
            <div style={labelStyle}>Part of Speech</div>
            <div style={valueStyle}>{word.partOfSpeech}</div>
          </div>
        )}

        {word.exampleSentence && (
          <div>
            <div style={labelStyle}>Example Sentence</div>
            <div style={{
              ...valueStyle,
              padding: 'var(--space-3)',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              borderLeft: '3px solid var(--color-primary)',
            }}>
              <div style={{ marginBottom: 'var(--space-1)' }}>{word.exampleSentence}</div>
              {word.exampleTranslation && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  {word.exampleTranslation}
                </div>
              )}
            </div>
          </div>
        )}

        {word.notes && (
          <div>
            <div style={labelStyle}>Notes</div>
            <div style={{ ...valueStyle, color: 'var(--text-secondary)' }}>{word.notes}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}
