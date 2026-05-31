import { ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FiX } from 'react-icons/fi'
import { useViewport } from '../hooks/useViewport'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  width?: number
  children: ReactNode
  footer?: ReactNode
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 520,
  children,
  footer,
}: DrawerProps) {
  const viewport = useViewport()
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const drawerWidth = viewport.size === 'mobile' ? '100%' : `min(${width}px, 92vw)`
  const radius = viewport.size === 'mobile' ? '12px 12px 0 0' : '12px 0 0 12px'
  const top = viewport.size === 'mobile' ? 'auto' : 0
  const bottom = viewport.size === 'mobile' ? 0 : 0
  const right = 0

  return createPortal(
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top,
          right,
          bottom,
          width: drawerWidth,
          maxHeight: viewport.size === 'mobile' ? '92vh' : '100vh',
          background: 'var(--bg-primary)',
          borderRadius: radius,
          boxShadow: '-12px 0 32px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          animation: viewport.size === 'mobile' ? 'slideUp 0.18s ease-out' : 'slideInRight 0.18s ease-out',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid var(--border-primary)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 'var(--font-size-lg)',
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
                wordBreak: 'break-word',
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 6,
            }}
          >
            <FiX size={18} />
          </button>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-5)',
          }}
        >
          {children}
        </div>

        {footer && (
          <footer
            style={{
              borderTop: '1px solid var(--border-primary)',
              padding: 'var(--space-3) var(--space-5)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              gap: 'var(--space-2)',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            {footer}
          </footer>
        )}
      </aside>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>,
    document.body,
  )
}
