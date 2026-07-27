import { useEffect, useRef, useState } from 'react'

interface ResizablePanelProps {
  /** Initial width in px. Persisted to localStorage under `storageKey`. */
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  storageKey?: string
  children: React.ReactNode
}

/**
 * Wraps the right-hand side panel and exposes a 4-px drag handle on its
 * left edge. Drag horizontally to resize. Width is persisted to
 * localStorage so it survives reloads.
 */
export function ResizablePanel({
  defaultWidth = 480,
  minWidth = 280,
  maxWidth = 900,
  storageKey = 'habit-tracker.panelWidth',
  children,
}: ResizablePanelProps) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth
    const stored = window.localStorage.getItem(storageKey)
    if (!stored) return defaultWidth
    const n = Number(stored)
    if (!Number.isFinite(n)) return defaultWidth
    return clamp(n, minWidth, maxWidth)
  })
  const [dragging, setDragging] = useState(false)
  const startRef = useRef<{ x: number; w: number } | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, String(width))
    }
  }, [width, storageKey])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return
      const dx = startRef.current.x - e.clientX
      setWidth(clamp(startRef.current.w + dx, minWidth, maxWidth))
    }
    const onUp = () => {
      startRef.current = null
      setDragging(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // Disable text selection while dragging
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = prev
      document.body.style.cursor = ''
    }
  }, [dragging, minWidth, maxWidth])

  const onHandleDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startRef.current = { x: e.clientX, w: width }
    setDragging(true)
  }

  const onDoubleClick = () => {
    setWidth(defaultWidth)
  }

  return (
    <div
      style={{
        position: 'relative',
        width,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel (double-click to reset)"
        title="Drag to resize. Double-click to reset."
        onMouseDown={onHandleDown}
        onDoubleClick={onDoubleClick}
        style={{
          position: 'absolute',
          top: 0,
          left: -3,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
          background: dragging ? 'var(--color-gray-500)' : 'transparent',
          transition: dragging ? 'none' : 'background 120ms ease',
        }}
        onMouseEnter={(e) => {
          if (!dragging) (e.currentTarget as HTMLDivElement).style.background = 'var(--border-primary)'
        }}
        onMouseLeave={(e) => {
          if (!dragging) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
        }}
      />
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex' }}>
        {children}
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
