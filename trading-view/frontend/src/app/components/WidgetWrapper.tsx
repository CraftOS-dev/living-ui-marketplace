import React, { useState } from 'react'

interface WidgetWrapperProps {
  title: string
  widgetId: string
  onClose?: () => void
  onMinimize?: () => void
  children: React.ReactNode
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 32,
    minHeight: 32,
    backgroundColor: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-primary)',
    padding: '0 8px',
    cursor: 'move',
    userSelect: 'none' as const,
  },
  titleLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dragHandle: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    cursor: 'grab',
    padding: '0 2px',
  },
  dragDot: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    backgroundColor: 'var(--text-secondary)',
  },
  title: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-primary)',
    letterSpacing: '0.02em',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    borderRadius: 3,
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    position: 'relative' as const,
  },
}

export function WidgetWrapper({ title, widgetId, onClose, onMinimize, children }: WidgetWrapperProps) {
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)

  return (
    <div style={styles.container} data-widget-id={widgetId}>
      <div className="drag-handle" style={styles.titleBar}>
        <div style={styles.titleLeft}>
          <div style={styles.dragHandle}>
            <div style={{ display: 'flex', gap: 2 }}>
              <span style={styles.dragDot} />
              <span style={styles.dragDot} />
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              <span style={styles.dragDot} />
              <span style={styles.dragDot} />
            </div>
          </div>
          <span style={styles.title}>{title}</span>
        </div>
        <div style={styles.actions}>
          {onMinimize && (
            <button
              style={{
                ...styles.actionBtn,
                ...(hoveredBtn === 'min' ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' } : {}),
              }}
              onClick={onMinimize}
              onMouseEnter={() => setHoveredBtn('min')}
              onMouseLeave={() => setHoveredBtn(null)}
              title="Minimize"
            >
              &#8211;
            </button>
          )}
          {onClose && (
            <button
              style={{
                ...styles.actionBtn,
                ...(hoveredBtn === 'close' ? { backgroundColor: 'var(--color-error)', color: '#fff' } : {}),
              }}
              onClick={onClose}
              onMouseEnter={() => setHoveredBtn('close')}
              onMouseLeave={() => setHoveredBtn(null)}
              title="Close"
            >
              &#215;
            </button>
          )}
        </div>
      </div>
      <div style={styles.content}>
        {children}
      </div>
    </div>
  )
}
