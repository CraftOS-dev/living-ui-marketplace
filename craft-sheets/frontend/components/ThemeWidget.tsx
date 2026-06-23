import { useEffect, useRef, useState } from 'react'
import {
  THEME_META,
  THEME_ORDER,
  applyThemeToDocument,
  loadStoredTheme,
  saveTheme,
  type ThemeId,
} from '../theme/themes'

export function ThemeWidget() {
  const [open, setOpen] = useState(false)
  const [activeTheme, setActiveTheme] = useState<ThemeId>('craftbot')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = loadStoredTheme()
    setActiveTheme(id)
    applyThemeToDocument(id)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function selectTheme(id: ThemeId) {
    setActiveTheme(id)
    saveTheme(id)
    applyThemeToDocument(id)
    setOpen(false)
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      {open && (
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Appearance</div>
          {THEME_ORDER.map((id) => {
            const meta = THEME_META[id]
            const isActive = id === activeTheme
            return (
              <button
                key={id}
                onClick={() => selectTheme(id)}
                style={{
                  ...rowStyle,
                  background: isActive ? 'var(--color-primary-subtle)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tertiary)'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = isActive
                    ? 'var(--color-primary-subtle)'
                    : 'transparent'
                }}
              >
                <span style={swatchStripStyle}>
                  {meta.swatches.map((color, i) => (
                    <span
                      key={i}
                      style={{ ...swatchDotStyle, background: color }}
                      title={['Background', 'Surface', 'Text', 'Accent'][i]}
                    />
                  ))}
                </span>
                <span style={{ flex: 1, textAlign: 'left', fontSize: 'var(--font-size-sm)' }}>
                  {meta.label}
                </span>
                {isActive && (
                  <span style={checkStyle}>
                    <CheckIcon />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          ...triggerStyle,
          background: open ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
          outline: open ? '2px solid var(--color-primary)' : 'none',
        }}
        title="Appearance"
        aria-label="Open appearance settings"
        aria-expanded={open}
      >
        <PaletteIcon />
      </button>
    </div>
  )
}

function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: 16,
  zIndex: 'var(--z-modal)' as unknown as number,
}

const triggerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-primary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
  transition: 'background var(--transition-fast), color var(--transition-fast)',
  padding: 0,
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  width: 220,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  overflow: 'hidden',
  animation: 'slideUp 0.12s ease',
}

const panelHeaderStyle: React.CSSProperties = {
  padding: '10px 14px 8px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)' as unknown as number,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border-secondary)',
}

const rowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 14px',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-primary)',
  transition: 'background var(--transition-fast)',
}

const swatchStripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 3,
  flexShrink: 0,
}

const swatchDotStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  border: '1px solid rgba(0,0,0,0.12)',
  flexShrink: 0,
}

const checkStyle: React.CSSProperties = {
  color: 'var(--color-primary)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
}
