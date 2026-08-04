import { useEffect, useRef, useState } from 'react'

const PRESET_COLORS = [
  '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#efefef','#f3f3f3','#ffffff',
  '#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff','#ff69b4',
  '#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3','#c9daf8','#cfe2f3','#d9d2e9','#ead1dc','#ffd966',
  '#990000','#b45309','#7f6000','#274e13','#0c343d','#1c4587','#073763','#20124d','#4a1942','#bf9000',
]

interface ColorPickerProps {
  icon: React.ReactNode
  label: string
  currentColor: string | null
  onChange: (color: string | null) => void
  customColors: string[]
  onAddCustomColor: (color: string) => void
}

export function ColorPicker({ icon, label, currentColor, onChange, customColors, onAddCustomColor }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [pendingColor, setPendingColor] = useState('#000000')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setShowCustomInput(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <button
        onClick={() => { setIsOpen(o => !o); setShowCustomInput(false) }}
        title={label}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 2, padding: '4px 6px', border: 'none', background: 'transparent',
          cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        }}
      >
        {icon}
        <div style={{
          width: 14, height: 3, borderRadius: 1,
          backgroundColor: currentColor ?? 'transparent',
          border: currentColor ? 'none' : '1px solid var(--border-primary)',
        }} />
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000,
          backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius-md)', padding: 'var(--space-2)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', minWidth: 220,
        }}>
          <button
            onClick={() => { onChange(null); setIsOpen(false); setShowCustomInput(false) }}
            style={{
              fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
              background: 'transparent', border: '1px solid var(--border-secondary)',
              borderRadius: 'var(--radius-sm)', padding: '2px 6px', cursor: 'pointer', marginBottom: 6,
            }}>
            ✕ None
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 18px)', gap: 2 }}>
            {PRESET_COLORS.map(color => (
              <button key={color} title={color}
                onClick={() => { onChange(color); setIsOpen(false); setShowCustomInput(false) }}
                style={{ width: 18, height: 18, backgroundColor: color,
                  border: '1px solid var(--border-secondary)', borderRadius: 2, cursor: 'pointer', padding: 0 }} />
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Custom</div>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              {customColors.map((color, i) => (
                <button key={i} title={color}
                  onClick={() => { onChange(color); setIsOpen(false); setShowCustomInput(false) }}
                  style={{ width: 18, height: 18, backgroundColor: color,
                    border: '1px solid var(--border-secondary)', borderRadius: 2, cursor: 'pointer', padding: 0 }} />
              ))}
              <button
                onClick={() => setShowCustomInput(v => !v)}
                title="Add custom color"
                style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px dashed var(--border-primary)', borderRadius: 2, cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 12, backgroundColor: 'transparent' }}>
                +
              </button>
            </div>
            {showCustomInput && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="color"
                  value={pendingColor}
                  onChange={(e) => setPendingColor(e.target.value)}
                  style={{ width: 32, height: 28, padding: 2, cursor: 'pointer',
                    border: '1px solid var(--border-primary)', borderRadius: 4 }}
                />
                <div style={{ width: 18, height: 18, borderRadius: 2, flexShrink: 0,
                  backgroundColor: pendingColor, border: '1px solid var(--border-secondary)' }} />
                <button
                  onClick={() => {
                    onAddCustomColor(pendingColor)
                    onChange(pendingColor)
                    setIsOpen(false)
                    setShowCustomInput(false)
                  }}
                  style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px', cursor: 'pointer',
                    background: 'var(--color-primary)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-sm)' }}>
                  Confirm
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
