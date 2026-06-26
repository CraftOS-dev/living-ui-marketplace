import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { CropRect } from '../types'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

interface ImageCanvasProps {
  previewUrl: string
  naturalWidth: number
  naturalHeight: number
  crop: CropRect
  onCropChange: (crop: CropRect) => void
}

const MIN_SIZE = 20

function clampCrop(crop: CropRect, maxW: number, maxH: number): CropRect {
  let { x, y, width, height } = crop
  width = Math.max(MIN_SIZE, Math.min(width, maxW))
  height = Math.max(MIN_SIZE, Math.min(height, maxH))
  x = Math.max(0, Math.min(x, maxW - width))
  y = Math.max(0, Math.min(y, maxH - height))
  return { x, y, width, height }
}

export function ImageCanvas({
  previewUrl,
  naturalWidth,
  naturalHeight,
  crop,
  onCropChange,
}: ImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
  const dragRef = useRef<{
    handle: Handle
    startX: number
    startY: number
    startCrop: CropRect
  } | null>(null)

  const scale = displaySize.width > 0 ? displaySize.width / naturalWidth : 1

  const updateDisplaySize = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const maxW = el.clientWidth
    const maxH = Math.min(480, window.innerHeight * 0.5)
    const ratio = naturalWidth / naturalHeight
    let w = maxW
    let h = w / ratio
    if (h > maxH) {
      h = maxH
      w = h * ratio
    }
    setDisplaySize({ width: Math.round(w), height: Math.round(h) })
  }, [naturalWidth, naturalHeight])

  useEffect(() => {
    updateDisplaySize()
    window.addEventListener('resize', updateDisplaySize)
    return () => window.removeEventListener('resize', updateDisplaySize)
  }, [updateDisplaySize])

  const toNatural = (dx: number, dy: number) => ({
    dx: dx / scale,
    dy: dy / scale,
  })

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return

    const { dx, dy } = toNatural(e.clientX - drag.startX, e.clientY - drag.startY)
    const s = drag.startCrop
    let next = { ...s }

    switch (drag.handle) {
      case 'move':
        next.x = s.x + dx
        next.y = s.y + dy
        break
      case 'nw':
        next.x = s.x + dx
        next.y = s.y + dy
        next.width = s.width - dx
        next.height = s.height - dy
        break
      case 'n':
        next.y = s.y + dy
        next.height = s.height - dy
        break
      case 'ne':
        next.y = s.y + dy
        next.width = s.width + dx
        next.height = s.height - dy
        break
      case 'e':
        next.width = s.width + dx
        break
      case 'se':
        next.width = s.width + dx
        next.height = s.height + dy
        break
      case 's':
        next.height = s.height + dy
        break
      case 'sw':
        next.x = s.x + dx
        next.width = s.width - dx
        next.height = s.height + dy
        break
      case 'w':
        next.x = s.x + dx
        next.width = s.width - dx
        break
    }

    onCropChange(clampCrop(next, naturalWidth, naturalHeight))
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const boxStyle = {
    left: crop.x * scale,
    top: crop.y * scale,
    width: crop.width * scale,
    height: crop.height * scale,
  }

  const handleSize = 10
  const handles: { id: Handle; style: React.CSSProperties; cursor: string }[] = [
    { id: 'nw', style: { left: -handleSize / 2, top: -handleSize / 2 }, cursor: 'nwse-resize' },
    { id: 'n', style: { left: '50%', top: -handleSize / 2, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { id: 'ne', style: { right: -handleSize / 2, top: -handleSize / 2 }, cursor: 'nesw-resize' },
    { id: 'e', style: { right: -handleSize / 2, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
    { id: 'se', style: { right: -handleSize / 2, bottom: -handleSize / 2 }, cursor: 'nwse-resize' },
    { id: 's', style: { left: '50%', bottom: -handleSize / 2, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { id: 'sw', style: { left: -handleSize / 2, bottom: -handleSize / 2 }, cursor: 'nesw-resize' },
    { id: 'w', style: { left: -handleSize / 2, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
  ]

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        userSelect: 'none',
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div
        style={{
          position: 'relative',
          width: displaySize.width,
          height: displaySize.height,
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        <img
          src={previewUrl}
          alt="Preview"
          draggable={false}
          style={{
            width: displaySize.width,
            height: displaySize.height,
            display: 'block',
            objectFit: 'contain',
          }}
        />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            boxShadow: `0 0 0 9999px rgba(0,0,0,0.45) inset`,
            clipPath: `polygon(
              0 0, 100% 0, 100% 100%, 0 100%, 0 0,
              ${boxStyle.left}px ${boxStyle.top}px,
              ${boxStyle.left}px ${boxStyle.top + boxStyle.height}px,
              ${boxStyle.left + boxStyle.width}px ${boxStyle.top + boxStyle.height}px,
              ${boxStyle.left + boxStyle.width}px ${boxStyle.top}px,
              ${boxStyle.left}px ${boxStyle.top}px
            )`,
          }}
        />

        <div
          onPointerDown={onPointerDown('move')}
          style={{
            position: 'absolute',
            ...boxStyle,
            border: '2px solid var(--color-primary)',
            cursor: 'move',
            boxSizing: 'border-box',
          }}
        >
          {handles.map((h) => (
            <div
              key={h.id}
              onPointerDown={onPointerDown(h.id)}
              style={{
                position: 'absolute',
                width: handleSize,
                height: handleSize,
                backgroundColor: 'var(--color-primary)',
                border: '2px solid white',
                borderRadius: 2,
                cursor: h.cursor,
                ...h.style,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
