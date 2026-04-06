
import { Table, Button, EmptyState } from '../ui'
import type { TableColumn } from '../ui'
import type { VocabularyWord } from '../../types'

interface WordTableProps {
  words: VocabularyWord[]
  onDelete?: (id: number) => void
  onAddToFlashcards?: (id: number) => void
  onViewDetail?: (word: VocabularyWord) => void
}

export function WordTable({ words, onDelete, onAddToFlashcards, onViewDetail }: WordTableProps) {
  if (words.length === 0) {
    return (
      <EmptyState
        title="No words yet"
        message="Generate vocabulary or add words manually to get started."
      />
    )
  }

  const columns: TableColumn<VocabularyWord>[] = [
    {
      key: 'word',
      header: 'Word',
      render: (item) => (
        <span
          style={{
            fontWeight: 'var(--font-weight-semibold)' as React.CSSProperties['fontWeight'],
            color: 'var(--color-primary)',
            cursor: onViewDetail ? 'pointer' : 'default',
          }}
          onClick={(e) => {
            e.stopPropagation()
            onViewDetail?.(item)
          }}
        >
          {item.word}
        </span>
      ),
    },
    {
      key: 'translation',
      header: 'Translation',
    },
    {
      key: 'partOfSpeech',
      header: 'Part of Speech',
      render: (item) => (
        <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          {item.partOfSpeech || '-'}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (item) => (
        <span style={{ color: 'var(--text-secondary)' }}>
          {item.category || '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      align: 'right',
      render: (item) => (
        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
          {onAddToFlashcards && (
            <Button
              size="sm"
              variant="ghost"
              title="Add to Flashcards"
              onClick={(e) => {
                e.stopPropagation()
                onAddToFlashcards(item.id)
              }}
              style={{ padding: '0 var(--space-1)', minWidth: 'auto' }}
            >
              +
            </Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="danger"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(item.id)
              }}
              style={{ padding: '0 var(--space-2)', minWidth: 'auto' }}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <Table<VocabularyWord>
      columns={columns}
      data={words}
      rowKey={(item) => item.id}
      onRowClick={onViewDetail}
      emptyMessage="No vocabulary words found"
    />
  )
}
