import { useState, useRef } from 'react'
import type { AppController } from '../AppController'
import type { BoardList, Card } from '../types'
import { CardItem } from './CardItem'
import { Button } from './ui'
import { toast } from 'react-toastify'

interface ListColumnProps {
  controller: AppController
  list: BoardList
  boardId?: number
  searchCardIds: Set<number> | null
  dragCardId: number | null
  dragOverListId: number | null
  dragOverPosition: number | null
  onCardClick: (card: Card) => void
  onRefresh: () => void
  onDragStart: (cardId: number) => void
  onDragOver: (listId: number, position: number) => void
  onDragEnd: () => void
}

export function ListColumn({
  controller, list, searchCardIds,
  dragCardId, dragOverListId, dragOverPosition,
  onCardClick, onRefresh, onDragStart, onDragOver, onDragEnd,
}: ListColumnProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(list.title)
  const [addingCard, setAddingCard] = useState(false)
  const [newCardTitle, setNewCardTitle] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const cards = list.cards || []

  const handleRename = async () => {
    if (title.trim() && title !== list.title) {
      try {
        await controller.updateList(list.id, title.trim())
        onRefresh()
      } catch {
        toast.error('Failed to rename list')
      }
    }
    setEditing(false)
  }

  const handleDelete = async () => {
    try {
      await controller.deleteList(list.id)
      onRefresh()
      toast.success('List deleted')
    } catch {
      toast.error('Failed to delete list')
    }
    setMenuOpen(false)
  }

  const handleAddCard = async () => {
    if (!newCardTitle.trim()) return
    try {
      await controller.createCard(list.id, newCardTitle.trim())
      setNewCardTitle('')
      setAddingCard(false)
      onRefresh()
      toast.success('Card created')
    } catch {
      toast.error('Failed to create card')
    }
  }

  const handleListDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const cardHeight = 80
    const position = Math.min(Math.floor(y / cardHeight), cards.length)
    onDragOver(list.id, position)
  }

  const isDropTarget = dragCardId !== null && dragOverListId === list.id

  return (
    <div style={{
      minWidth: 280, maxWidth: 320, width: 280, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
      border: isDropTarget ? '2px solid var(--color-primary)' : '1px solid var(--border-primary)',
      maxHeight: '100%', transition: 'border-color var(--transition-base)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-3)', borderBottom: '1px solid var(--border-primary)',
      }}>
        {editing ? (
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setTitle(list.title); setEditing(false) } }}
            autoFocus
            style={{
              flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-sm)', padding: '2px 6px', color: 'var(--text-primary)',
              fontWeight: 600, fontSize: 'var(--font-size-sm)',
            }}
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            style={{
              fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)',
              cursor: 'pointer', flex: 1,
            }}
          >
            {list.title}
            <span style={{
              marginLeft: 'var(--space-2)', fontSize: 'var(--font-size-xs)',
              color: 'var(--text-secondary)', fontWeight: 400,
            }}>
              {cards.length}
            </span>
          </span>
        )}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', padding: '2px 6px', fontSize: 16, lineHeight: 1,
            }}
          >&#8943;</button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 100,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden', minWidth: 140,
            }}>
              <button onClick={() => { setEditing(true); setMenuOpen(false) }} style={{
                display: 'block', width: '100%', padding: 'var(--space-2) var(--space-3)',
                background: 'none', border: 'none', color: 'var(--text-primary)',
                cursor: 'pointer', textAlign: 'left', fontSize: 'var(--font-size-sm)',
              }}>Rename</button>
              <button onClick={handleDelete} style={{
                display: 'block', width: '100%', padding: 'var(--space-2) var(--space-3)',
                background: 'none', border: 'none', color: 'var(--color-error)',
                cursor: 'pointer', textAlign: 'left', fontSize: 'var(--font-size-sm)',
              }}>Delete List</button>
            </div>
          )}
        </div>
      </div>

      {/* Card stack */}
      <div
        style={{
          flex: 1, overflowY: 'auto', padding: 'var(--space-2)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          minHeight: 40,
        }}
        onDragOver={handleListDragOver}
        onDrop={e => { e.preventDefault(); onDragEnd() }}
      >
        {cards.length === 0 && !addingCard && (
          <div style={{
            textAlign: 'center', padding: 'var(--space-4)', color: 'var(--text-secondary)',
            fontSize: 'var(--font-size-xs)',
          }}>
            No cards
          </div>
        )}
        {cards.map((card, idx) => {
          const dimmed = searchCardIds !== null && !searchCardIds.has(card.id)
          const showDropIndicator = isDropTarget && dragOverPosition === idx
          return (
            <div key={card.id}>
              {showDropIndicator && (
                <div style={{ height: 3, background: 'var(--color-primary)', borderRadius: 2, marginBottom: 'var(--space-1)' }} />
              )}
              <CardItem
                card={card}
                dimmed={dimmed}
                onCardClick={onCardClick}
                onDragStart={onDragStart}
              />
            </div>
          )
        })}
        {isDropTarget && dragOverPosition === cards.length && (
          <div style={{ height: 3, background: 'var(--color-primary)', borderRadius: 2 }} />
        )}
      </div>

      {/* Add card */}
      <div style={{ padding: 'var(--space-2)', borderTop: '1px solid var(--border-primary)' }}>
        {addingCard ? (
          <div>
            <input
              value={newCardTitle}
              onChange={e => setNewCardTitle(e.target.value)}
              placeholder="Card title..."
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleAddCard(); if (e.key === 'Escape') setAddingCard(false) }}
              style={{
                width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)', padding: 'var(--space-2)', color: 'var(--text-primary)',
                fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-2)', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" size="sm" onClick={handleAddCard}>Add</Button>
              <Button variant="ghost" size="sm" onClick={() => setAddingCard(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingCard(true)}
            style={{
              width: '100%', background: 'none', border: 'none',
              color: 'var(--text-secondary)', cursor: 'pointer',
              padding: 'var(--space-1)', fontSize: 'var(--font-size-sm)',
              textAlign: 'left', borderRadius: 'var(--radius-md)',
            }}
            onMouseOver={e => { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseOut={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            + Add Card
          </button>
        )}
      </div>
    </div>
  )
}
