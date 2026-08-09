interface PanelDividerProps {
  onDrag: (deltaX: number) => void
  disabled?: boolean
}

export function PanelDivider({ onDrag, disabled }: PanelDividerProps) {
  function handleMouseDown(e: React.MouseEvent) {
    if (disabled) return
    e.preventDefault()
    let lastX = e.clientX

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - lastX
      lastX = ev.clientX
      onDrag(dx)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className={`panel-divider ${disabled ? 'panel-divider-disabled' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <style>{`
        .panel-divider {
          width: 4px;
          background-color: var(--border-primary);
          cursor: col-resize;
          flex-shrink: 0;
          transition: background-color var(--transition-fast);
          position: relative;
        }
        .panel-divider::after {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: -3px;
          right: -3px;
        }
        .panel-divider:hover:not(.panel-divider-disabled) {
          background-color: var(--color-primary);
        }
        .panel-divider-disabled {
          cursor: default;
          opacity: 0.3;
        }
      `}</style>
    </div>
  )
}
