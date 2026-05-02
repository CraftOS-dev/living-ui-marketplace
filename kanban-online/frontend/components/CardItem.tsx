import type { Card } from '../types'

const PRIORITY_COLORS: Record<string, string> = {
  none: 'transparent',
  low: '#22C55E',
  medium: '#EAB308',
  high: '#FF4F18',
  urgent: '#EF4444',
}

interface CardItemProps {
  card: Card
  dimmed: boolean
  onCardClick: (card: Card) => void
  onDragStart: (cardId: number) => void
}

export function CardItem({ card, dimmed, onCardClick, onDragStart }: CardItemProps) {
  const priorityColor = PRIORITY_COLORS[card.priority] || 'transparent'
  const hasChecklist = card.checklistTotal > 0
  const hasDueDate = !!card.dueDate
  const isOverdue = hasDueDate && new Date(card.dueDate!) < new Date()
  const isUpcoming = hasDueDate && !isOverdue && (new Date(card.dueDate!).getTime() - Date.now()) < 3 * 24 * 60 * 60 * 1000

  const formatDueDate = (dateStr: string): string => {
    const d = new Date(dateStr)
    const month = d.toLocaleString('default', { month: 'short' })
    return `${month} ${d.getDate()}`
  }

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(card.id)
      }}
      onClick={() => onCardClick(card)}
      style={{
        background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-primary)', cursor: 'pointer',
        borderLeft: priorityColor !== 'transparent' ? `3px solid ${priorityColor}` : '1px solid var(--border-primary)',
        padding: 'var(--space-2) var(--space-3)',
        opacity: dimmed ? 0.3 : 1,
        transition: 'box-shadow var(--transition-base), opacity var(--transition-base)',
      }}
      onMouseOver={e => { if (!dimmed) e.currentTarget.style.boxShadow = 'var(--shadow-md)' }}
      onMouseOut={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      {/* Labels */}
      {card.labels.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--space-1)' }}>
          {card.labels.map(label => (
            <span key={label.id} style={{
              display: 'inline-block', width: 32, height: 6,
              borderRadius: 3, background: label.color,
            }} title={label.name} />
          ))}
        </div>
      )}

      {/* Title */}
      <div style={{
        fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--text-primary)',
        lineHeight: 'var(--line-height-normal)', wordBreak: 'break-word',
      }}>
        {card.title}
      </div>

      {/* Badges row */}
      {(hasDueDate || hasChecklist || card.description) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginTop: 'var(--space-2)', flexWrap: 'wrap',
        }}>
          {/* Due date badge */}
          {hasDueDate && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 11, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
              background: isOverdue ? 'rgba(239,68,68,0.2)' : isUpcoming ? 'rgba(234,179,8,0.2)' : 'var(--bg-tertiary)',
              color: isOverdue ? '#EF4444' : isUpcoming ? '#EAB308' : 'var(--text-secondary)',
              fontWeight: 500,
            }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm0 2a6 6 0 100 12A6 6 0 008 2zm0 2a.75.75 0 01.75.75v3.5l2.1 1.26a.75.75 0 01-.76 1.3l-2.47-1.49A.75.75 0 017.25 8V4.75A.75.75 0 018 4z"/>
              </svg>
              {formatDueDate(card.dueDate!)}
            </span>
          )}

          {/* Description indicator */}
          {card.description && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }} title="Has description">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 3h12v1.5H2V3zm0 4h8v1.5H2V7zm0 4h10v1.5H2V11z"/>
              </svg>
            </span>
          )}

          {/* Checklist progress */}
          {hasChecklist && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 11, color: card.checklistCompleted === card.checklistTotal ? '#22C55E' : 'var(--text-secondary)',
              fontWeight: 500,
            }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 1h12a1 1 0 011 1v12a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1zm4.5 9.5l5-5-1-1-4 4-2-2-1 1 3 3z"/>
              </svg>
              {card.checklistCompleted}/{card.checklistTotal}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
