import type { ReactNode } from 'react'
import { Maximize2, GripVertical } from 'lucide-react'

interface WidgetCardProps {
  title: string
  icon: ReactNode
  onExpand: () => void
  children: ReactNode
  dragHandleProps?: Record<string, any>
}

export function WidgetCard({ title, icon, onExpand, children, dragHandleProps }: WidgetCardProps) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-md)',
      display: 'flex',
      flexDirection: 'column',
      height: 300,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-3)',
        borderBottom: '1px solid var(--border-primary)',
        backgroundColor: 'var(--bg-tertiary)',
      }}>
        {/* Drag handle */}
        <span
          {...dragHandleProps}
          style={{ color: 'var(--text-muted)', cursor: 'grab', display: 'flex', touchAction: 'none' }}
        >
          <GripVertical size={14} />
        </span>
        <span style={{ color: 'var(--color-primary)', display: 'flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{
          flex: 1,
          fontWeight: 'var(--font-weight-semibold)' as any,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-primary)',
        }}>
          {title}
        </span>
        <button
          onClick={onExpand}
          title="Open full view"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-sm)',
            transition: 'var(--transition-fast)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 'var(--space-3)', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}
