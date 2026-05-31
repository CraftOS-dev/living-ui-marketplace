import { ReactNode } from 'react'

interface PanelProps {
  label?: string
  action?: ReactNode
  children: ReactNode
  /**
   * Tighten internal padding for content that already has its own padding
   * (e.g. a list with per-row hairlines that should run flush to the panel edges).
   */
  flush?: boolean
  style?: React.CSSProperties
}

/**
 * The single panel chrome used across every page.
 *
 * - 1 px border in --border-primary
 * - --bg-secondary fill
 * - var(--radius-md) corner
 * - var(--space-4) padding (12 px label area + 16 px content)
 * - Optional uppercase section label + right-aligned action
 *
 * Panels never nest. Tiles inside a panel use the same border + radius but
 * are explicitly nested only one level (e.g. Quick Start template tiles).
 */
export function Panel({ label, action, children, flush, style }: PanelProps) {
  const hasHeader = !!(label || action)
  return (
    <section
      style={{
        border: '1px solid var(--border-primary)',
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: flush ? 0 : 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: hasHeader ? 'var(--space-3)' : 0,
        minWidth: 0,
        ...style,
      }}
    >
      {hasHeader && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
            padding: flush ? 'var(--space-4) var(--space-4) 0' : 0,
          }}
        >
          {label && (
            <span
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                fontWeight: 600,
                color: 'var(--text-muted)',
              }}
            >
              {label}
            </span>
          )}
          {action}
        </header>
      )}
      {flush ? <div style={{ padding: 'var(--space-3) 0 0' }}>{children}</div> : children}
    </section>
  )
}
