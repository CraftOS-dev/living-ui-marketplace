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
    justifyContent: 'center',
    maxWidth: 480,
    margin: '0 auto',
  },
  searchInput: {
    width: '100%',
    maxWidth: 360,
    height: 32,
    padding: '0 12px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 4,
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  kbdHint: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    marginLeft: 4,
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
          onKeyDown={(e) => { if (e.key === 'Enter') onSearchOpen() }}
        >
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Search symbol...
            <span style={styles.kbdHint}>Ctrl+K</span>
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
