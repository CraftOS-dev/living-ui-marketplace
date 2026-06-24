import { useEffect, useRef, useState } from 'react'
import {
  THEME_META,
  THEME_ORDER,
  DEFAULT_CUSTOM_COLORS,
  applyThemeToDocument,
  loadCustomColors,
  loadStoredTheme,
  saveCustomColors,
  saveTheme,
  type CustomColors,
  type ThemeId,
} from '../theme/themes'

type Corner = 'bl' | 'br' | 'tl' | 'tr'
type PanelView = 'themes' | 'custom-edit'

const CORNER_KEY = 'living-ui-theme-corner'

function loadCorner(): Corner {
  try {
    const v = localStorage.getItem(CORNER_KEY)
    if (v === 'bl' || v === 'br' || v === 'tl' || v === 'tr') return v
  } catch {}
  return 'bl'
}

function saveCorner(c: Corner): void {
  try { localStorage.setItem(CORNER_KEY, c) } catch {}
}

function snapToNearestCorner(x: number, y: number): Corner {
  const isLeft = x < window.innerWidth / 2
  const isTop = y < window.innerHeight / 2
  return isTop ? (isLeft ? 'tl' : 'tr') : (isLeft ? 'bl' : 'br')
}

export function ThemeWidget() {
  const [open, setOpen] = useState(false)
  const [panelView, setPanelView] = useState<PanelView>('themes')
  const [activeTheme, setActiveTheme] = useState<ThemeId>('craftbot')
  const [customColors, setCustomColors] = useState<CustomColors>(loadCustomColors)
  const [corner, setCorner] = useState<Corner>(loadCorner)
  const [dragging, setDragging] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const didDragRef = useRef(false)
  const activeThemeRef = useRef<ThemeId>('craftbot')
  const customColorsRef = useRef<CustomColors>(DEFAULT_CUSTOM_COLORS)

  // Apply stored theme on mount; re-apply after CraftBot parent overrides
  useEffect(() => {
    const id = loadStoredTheme()
    const colors = loadCustomColors()
    activeThemeRef.current = id
    customColorsRef.current = colors
    setActiveTheme(id)
    setCustomColors(colors)
    applyThemeToDocument(id, colors)

    const onCraftBotTheme = (e: MessageEvent) => {
      if (e.data && e.data.type === 'craftbot-theme') {
        requestAnimationFrame(() =>
          applyThemeToDocument(activeThemeRef.current, customColorsRef.current)
        )
      }
    }
    window.addEventListener('message', onCraftBotTheme)
    return () => window.removeEventListener('message', onCraftBotTheme)
  }, [])

  // Click-outside closes panel
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setPanelView('themes')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  // ── Theme selection ──────────────────────────────────────────────────────

  function selectTheme(id: ThemeId) {
    activeThemeRef.current = id
    if (id === 'custom') {
      setActiveTheme('custom')
      saveTheme('custom')
      applyThemeToDocument('custom', customColors)
      setPanelView('custom-edit')
      return
    }
    setActiveTheme(id)
    saveTheme(id)
    applyThemeToDocument(id)
    setOpen(false)
    setPanelView('themes')
  }

  function updateCustomColor(field: keyof CustomColors, value: string) {
    const updated = { ...customColors, [field]: value }
    customColorsRef.current = updated
    setCustomColors(updated)
    saveCustomColors(updated)
    applyThemeToDocument('custom', updated)
    if (activeTheme !== 'custom') {
      setActiveTheme('custom')
      saveTheme('custom')
    }
  }

  // ── Drag logic ───────────────────────────────────────────────────────────

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    didDragRef.current = false

    function onMouseMove(ev: MouseEvent) {
      if (!dragStartRef.current) return
      const dx = ev.clientX - dragStartRef.current.x
      const dy = ev.clientY - dragStartRef.current.y
      if (!didDragRef.current && Math.hypot(dx, dy) < 5) return
      didDragRef.current = true
      setDragging(true)
      setDragPos({ x: ev.clientX - 18, y: ev.clientY - 18 })
    }

    function onMouseUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)

      if (didDragRef.current) {
        const snapped = snapToNearestCorner(ev.clientX, ev.clientY)
        setCorner(snapped)
        saveCorner(snapped)
        setDragging(false)
        setDragPos(null)
        setOpen(false)
        setPanelView('themes')
      } else {
        setOpen((v) => !v)
      }
      dragStartRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // ── Style helpers ────────────────────────────────────────────────────────

  function getContainerStyle(): React.CSSProperties {
    const base: React.CSSProperties = {
      position: 'fixed',
      zIndex: 600,
      userSelect: 'none',
    }
    if (dragging && dragPos) {
      return { ...base, left: dragPos.x, top: dragPos.y, cursor: 'grabbing' }
    }
    switch (corner) {
      case 'bl': return { ...base, bottom: 16, left: 16, cursor: 'grab' }
      case 'br': return { ...base, bottom: 16, right: 16, cursor: 'grab' }
      case 'tl': return { ...base, top: 16, left: 16, cursor: 'grab' }
      case 'tr': return { ...base, top: 16, right: 16, cursor: 'grab' }
    }
  }

  function getPanelStyle(): React.CSSProperties {
    const isBottom = corner === 'bl' || corner === 'br'
    const isLeft = corner === 'bl' || corner === 'tl'
    return {
      position: 'absolute',
      width: 224,
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden',
      animation: `${isBottom ? 'slideUp' : 'slideDown'} 0.12s ease`,
      ...(isBottom ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
      ...(isLeft ? { left: 0 } : { right: 0 }),
    }
  }

  // ── Custom swatches for the row ──────────────────────────────────────────

  const customSwatches: [string, string, string, string] = [
    customColors.bg,
    customColors.surface,
    customColors.text,
    customColors.accent,
  ]

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{slideDownKeyframe}</style>
      <div ref={containerRef} style={getContainerStyle()}>
        {open && (
          <div style={getPanelStyle()}>
            {panelView === 'themes' ? (
              <>
                <div style={panelHeaderStyle}>Appearance</div>
                {THEME_ORDER.map((id) => {
                  const isCustom = id === 'custom'
                  const meta = isCustom ? null : THEME_META[id as Exclude<ThemeId, 'custom'>]
                  const swatches = isCustom ? customSwatches : meta!.swatches
                  const label = isCustom ? 'Custom' : meta!.label
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
                        if (!isActive) (e.currentTarget).style.background = 'var(--bg-tertiary)'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget).style.background = isActive
                          ? 'var(--color-primary-subtle)'
                          : 'transparent'
                      }}
                    >
                      <span style={swatchStripStyle}>
                        {swatches.map((color, i) => (
                          <span
                            key={i}
                            style={{ ...swatchDotStyle, background: color }}
                            title={(['Background', 'Surface', 'Text', 'Accent'] as const)[i]}
                          />
                        ))}
                      </span>
                      <span style={{ flex: 1, textAlign: 'left', fontSize: 'var(--font-size-sm)' }}>
                        {label}
                      </span>
                      {isActive && (
                        <span style={checkStyle}><CheckIcon /></span>
                      )}
                      {isCustom && (
                        <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                          <ChevronRightIcon />
                        </span>
                      )}
                    </button>
                  )
                })}
              </>
            ) : (
              <>
                <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => setPanelView('themes')}
                    style={backButtonStyle}
                    title="Back to themes"
                  >
                    <ChevronLeftIcon />
                  </button>
                  <span>Custom</span>
                </div>
                {(
                  [
                    { field: 'bg' as const,      label: 'Background' },
                    { field: 'surface' as const,  label: 'Surface' },
                    { field: 'text' as const,     label: 'Text' },
                    { field: 'accent' as const,   label: 'Accent' },
                  ] as const
                ).map(({ field, label }) => (
                  <div key={field} style={colorRowStyle}>
                    <span style={{ flex: 1, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                      {label}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: 6 }}>
                      {customColors[field].toUpperCase()}
                    </span>
                    <input
                      type="color"
                      value={customColors[field]}
                      onChange={(e) => updateCustomColor(field, e.target.value)}
                      style={colorInputStyle}
                      title={`Pick ${label} color`}
                    />
                  </div>
                ))}
                <div style={{ padding: '8px 14px 10px', borderTop: '1px solid var(--border-secondary)' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {customSwatches.map((color, i) => (
                      <span
                        key={i}
                        style={{ ...swatchDotStyle, width: 14, height: 14, background: color }}
                        title={(['Background', 'Surface', 'Text', 'Accent'] as const)[i]}
                      />
                    ))}
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginLeft: 2 }}>Preview</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <button
          onMouseDown={handleMouseDown}
          style={{
            ...triggerStyle,
            background: open ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
            outline: open ? '2px solid var(--color-primary)' : 'none',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
          title="Appearance (drag to move)"
          aria-label="Open appearance settings"
          aria-expanded={open}
        >
          <PaletteIcon />
        </button>
      </div>
    </>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────

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

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const slideDownKeyframe = `
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`

const panelHeaderStyle: React.CSSProperties = {
  padding: '10px 14px 8px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border-secondary)',
}

const triggerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-primary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
  transition: 'background var(--transition-fast)',
  padding: 0,
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
  display: 'inline-block',
}

const checkStyle: React.CSSProperties = {
  color: 'var(--color-primary)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
}

const colorRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '7px 14px',
  gap: 4,
}

const colorInputStyle: React.CSSProperties = {
  width: 28,
  height: 22,
  padding: 1,
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-tertiary)',
  cursor: 'pointer',
  flexShrink: 0,
}

const backButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 2,
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  borderRadius: 'var(--radius-sm)',
}
