import { useState } from 'react'
import type { AppController } from '../AppController'
import type { Board, Card } from '../types'
import { ListColumn } from './ListColumn'
import { Button } from './ui'
import { toast } from 'react-toastify'

interface BoardViewProps {
  controller: AppController
  board: Board
  searchResults: Card[] | null
  onCardClick: (card: Card) => void
  onRefresh: () => void
}

export function BoardView({ controller, board, searchResults, onCardClick, onRefresh }: BoardViewProps) {
  const [addingList, setAddingList] = useState(false)
  const [newListTitle, setNewListTitle] = useState('')
  const [dragCardId, setDragCardId] = useState<number | null>(null)
  const [dragOverListId, setDragOverListId] = useState<number | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<number | null>(null)

  const handleAddList = async () => {
    if (!newListTitle.trim()) return
    try {
      await controller.createList(board.id, newListTitle.trim())
      setNewListTitle('')
      setAddingList(false)
      onRefresh()
      toast.success('List created')
    } catch {
      toast.error('Failed to create list')
    }
  }

  const handleDragStart = (cardId: number) => {
    setDragCardId(cardId)
  }

  const handleDragOver = (listId: number, position: number) => {
    setDragOverListId(listId)
    setDragOverPosition(position)
  }

  const handleDragEnd = async () => {
    if (dragCardId && dragOverListId !== null && dragOverPosition !== null) {
      try {
        await controller.moveCard(dragCardId, dragOverListId, dragOverPosition)
        onRefresh()
      } catch {
        toast.error('Failed to move card')
      }
    }
    setDragCardId(null)
    setDragOverListId(null)
    setDragOverPosition(null)
  }

  // Build a set of search result IDs for highlighting
  const searchCardIds = searchResults ? new Set(searchResults.map(c => c.id)) : null

  return (
    <div style={{
      display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)',
      height: '100%', overflowX: 'auto', overflowY: 'hidden',
      alignItems: 'flex-start',
    }}>
      {board.lists.map(list => (
        <ListColumn
          key={list.id}
          controller={controller}
          list={list}
          boardId={board.id}
          searchCardIds={searchCardIds}
          dragCardId={dragCardId}
          dragOverListId={dragOverListId}
          dragOverPosition={dragOverPosition}
          onCardClick={onCardClick}
          onRefresh={onRefresh}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        />
      ))}
      <div style={{ minWidth: 280, flexShrink: 0 }}>
        {addingList ? (
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-3)', border: '1px solid var(--border-primary)',
          }}>
            <input
              value={newListTitle}
              onChange={e => setNewListTitle(e.target.value)}
              placeholder="List title..."
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleAddList(); if (e.key === 'Escape') setAddingList(false) }}
              style={{
                width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)', padding: 'var(--space-2)', color: 'var(--text-primary)',
                fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-2)', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" size="sm" onClick={handleAddList}>Add</Button>
              <Button variant="ghost" size="sm" onClick={() => setAddingList(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingList(true)}
            style={{
              width: '100%', background: 'var(--bg-secondary)', border: '2px dashed var(--border-primary)',
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              fontWeight: 500, transition: 'var(--transition-base)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
            }}
            onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
            onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
          >
            + Add List
          </button>
        )}
      </div>
    </div>
  )
}
