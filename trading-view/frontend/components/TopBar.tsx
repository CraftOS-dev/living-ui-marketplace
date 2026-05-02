import { useEffect } from 'react'
import { Button } from './ui'
import type { AppController } from '../AppController'

interface TopBarProps {
  controller: AppController
  onSearchOpen: () => void
  onSaveLayout: () => void
  onResetLayout: () => void
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    minHeight: 48,
    backgroundColor: 'var(--bg-primary)',
    borderBottom: '1px solid var(--border-primary)',
    padding: '0 16px',
    zIndex: 200,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
    letterSpacing: '-0.01em',
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    minWidth: 0,
  },
  searchInput: {
    width: '100%',
    maxWidth: 360,
    height: 32,
    boxSizing: 'border-box' as const,
    padding: '0 8px 0 12px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 4,
    color: 'var(--text-secondary)',
    fontSize: 13,
    lineHeight: '30px',  // height (32) - top/bottom border (1+1) — keeps text vertically centered if flex fails
    outline: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    transition: 'border-color 120ms, background-color 120ms',
  },
  searchIconRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    overflow: 'hidden',
    height: '100%',
  },
  searchPlaceholder: {
    fontSize: 13,
    lineHeight: 1,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    margin: 0,
    padding: 0,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  kbdHint: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-muted, #6b7280)',
    opacity: 0.7,
    marginLeft: 6,
    flexShrink: 0,
    lineHeight: 1,
    letterSpacing: '0.02em',
  },
}

export function TopBar({ controller: _controller, onSearchOpen, onSaveLayout, onResetLayout }: TopBarProps) {
  // Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        onSearchOpen()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onSearchOpen])

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <span style={styles.logo}>
          Trading View
        </span>
      </div>

      <div style={styles.center}>
        <div
          style={styles.searchInput}
          onClick={onSearchOpen}
          role="button"
          tabIndex={0}
          aria-label="Search symbols (Ctrl+K)"
          onKeyDown={(e) => { if (e.key === 'Enter') onSearchOpen() }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-primary)'
          }}
        >
          <span style={styles.searchIconRow}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                 style={{ flexShrink: 0, opacity: 0.7 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span style={styles.searchPlaceholder}>
              Search symbol...
              <span style={styles.kbdHint}>Ctrl+K</span>
            </span>
          </span>
        </div>
      </div>

      <div style={styles.right}>
        <Button
          size="sm"
          variant="ghost"
          onClick={onSaveLayout}
          style={{ color: 'var(--text-secondary)', fontSize: 12 }}
        >
          Save Layout
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onResetLayout}
          style={{ color: 'var(--text-secondary)', fontSize: 12 }}
        >
          Reset
        </Button>
      </div>
    </div>
  )
}
