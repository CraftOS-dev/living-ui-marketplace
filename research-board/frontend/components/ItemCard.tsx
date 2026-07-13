import { useRef, useState } from 'react'
import { Image, Film, Youtube, FileText, Pin, Play, Link2 } from 'lucide-react'
import type { BoardItem } from '../types'

const BACKEND_URL = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}')

export const CARD_WIDTH = 180
export const CARD_HEIGHT = 160 // approximate — preview is fixed 120px but the title row can wrap

interface ItemCardProps {
  item: BoardItem
  onClick: () => void
  onDrag?: (id: number, x: number, y: number) => void
  onDragEnd: (id: number, x: number, y: number) => void
  onConnectorMouseDown?: (id: number, e: React.MouseEvent) => void
  isConnectHoverTarget?: boolean
}

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
  return match ? match[1] : null
}

function getFileUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return `${BACKEND_URL}${path}`
}

function ItemPreview({ item }: { item: BoardItem }) {
  const [imgError, setImgError] = useState(false)

  if (item.type === 'image') {
    const src = item.filePath ? getFileUrl(item.filePath) : item.url || ''
    if (src && !imgError) {
      return (
        <div className="item-preview image-preview">
          <img
            src={src}
            alt={item.title}
            onError={() => setImgError(true)}
          />
        </div>
      )
    }
    return (
      <div className="item-preview icon-preview">
        <Image size={36} className="preview-icon" />
      </div>
    )
  }

  if (item.type === 'video') {
    const src = item.filePath ? getFileUrl(item.filePath) : item.url || ''
    if (src && item.filePath) {
      return (
        <div className="item-preview video-preview">
          <video src={src} muted />
          <div className="play-overlay"><Play size={16} fill="currentColor" /></div>
        </div>
      )
    }
    return (
      <div className="item-preview icon-preview">
        <Film size={36} className="preview-icon" />
        {item.url && <span className="preview-url">{item.url.slice(0, 30)}...</span>}
      </div>
    )
  }

  if (item.type === 'youtube') {
    const videoId = item.url ? getYouTubeId(item.url) : null
    if (videoId) {
      return (
        <div className="item-preview youtube-preview">
          <img
            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
            alt={item.title}
            onError={() => {}}
          />
          <div className="youtube-badge"><Play size={10} fill="currentColor" /> YouTube</div>
        </div>
      )
    }
    return (
      <div className="item-preview icon-preview">
        <Youtube size={36} className="preview-icon" />
      </div>
    )
  }

  if (item.type === 'doc') {
    return (
      <div className="item-preview icon-preview">
        <FileText size={36} className="preview-icon" />
        {item.url && <span className="preview-url">{item.url.slice(0, 30)}...</span>}
      </div>
    )
  }

  if (item.type === 'note') {
    return (
      <div className="item-preview note-preview">
        <p>{item.content ? item.content.slice(0, 80) + (item.content.length > 80 ? '...' : '') : 'No content'}</p>
      </div>
    )
  }

  return <div className="item-preview icon-preview"><Pin size={36} className="preview-icon" /></div>
}

const TYPE_COLORS: Record<string, string> = {
  image: '#6366f1',
  video: '#8b5cf6',
  youtube: '#ef4444',
  doc: '#06b6d4',
  note: '#f59e0b',
}

const TYPE_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  youtube: 'YouTube',
  doc: 'Doc',
  note: 'Note',
}

export function ItemCard({ item, onClick, onDrag, onDragEnd, onConnectorMouseDown, isConnectHoverTarget }: ItemCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  // Track whether this gesture actually moved, so a plain click doesn't open the editor.
  const movedRef = useRef(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.item-card-action')) return
    e.preventDefault()
    // Capture the grab offset and start point in locals — reading drag state back
    // inside the move handler would be stale (state updates are async).
    const offsetX = e.clientX - item.x
    const offsetY = e.clientY - item.y
    const startX = e.clientX
    const startY = e.clientY
    movedRef.current = false
    setIsDragging(true)

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - offsetX
      const newY = e.clientY - offsetY
      if (!movedRef.current && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 4) {
        movedRef.current = true
      }
      const card = document.getElementById(`item-card-${item.id}`)
      if (card) {
        card.style.left = `${newX}px`
        card.style.top = `${newY}px`
      }
      // Push the live position into state so connection lines follow the card.
      if (movedRef.current) onDrag?.(item.id, newX, newY)
    }

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (movedRef.current) {
        const newX = Math.max(0, e.clientX - offsetX)
        const newY = Math.max(0, e.clientY - offsetY)
        onDragEnd(item.id, newX, newY)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const typeColor = TYPE_COLORS[item.type] || '#6366f1'
  const typeLabel = TYPE_LABELS[item.type] || item.type

  return (
    <div
      id={`item-card-${item.id}`}
      className={`item-card ${isDragging ? 'dragging' : ''} ${isConnectHoverTarget ? 'connect-hover-target' : ''}`}
      style={{
        position: 'absolute',
        left: item.x,
        top: item.y,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onClick={() => {
        // Suppress the click that fires at the end of a drag.
        if (movedRef.current) {
          movedRef.current = false
          return
        }
        onClick()
      }}
    >
      <div className="item-card-type-badge" style={{ backgroundColor: typeColor }}>
        {typeLabel}
      </div>
      <ItemPreview item={item} />
      <div className="item-card-title">{item.title}</div>

      <button
        className="item-card-action connector-handle"
        onMouseDown={e => onConnectorMouseDown?.(item.id, e)}
        onClick={e => e.stopPropagation()}
        title="Drag to connect to another item"
      >
        <Link2 size={12} />
      </button>

      <style>{`
        .item-card {
          width: 180px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          transition: box-shadow 0.2s, transform 0.1s;
          user-select: none;
          z-index: 1;
        }
        .item-card:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
          z-index: 10;
        }
        .item-card.dragging {
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
          z-index: 100;
          transform: scale(1.02);
        }
        .item-card.connect-hover-target {
          outline: 2px solid #6366f1;
          outline-offset: 2px;
        }
        .connector-handle {
          position: absolute;
          top: 50%;
          right: 6px;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          padding: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-tertiary, #1a1a2e);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          cursor: crosshair;
          opacity: 0;
          transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
          z-index: 5;
        }
        .item-card:hover .connector-handle {
          opacity: 1;
        }
        .connector-handle:hover {
          background: #6366f1;
          border-color: #6366f1;
          color: white;
        }
        .item-card-type-badge {
          font-size: 10px;
          font-weight: 600;
          color: white;
          padding: 2px 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .item-preview {
          width: 100%;
          height: 120px;
          overflow: hidden;
          background: var(--bg-tertiary, #1a1a2e);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .item-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .item-preview video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .play-overlay {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0,0,0,0.6);
          color: white;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
        }
        .youtube-badge {
          position: absolute;
          bottom: 4px;
          right: 4px;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          background: rgba(239,68,68,0.9);
          color: white;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .icon-preview {
          flex-direction: column;
          gap: 4px;
        }
        .preview-icon {
          color: var(--text-secondary);
        }
        .preview-url {
          font-size: 10px;
          color: var(--text-secondary);
          text-align: center;
          padding: 0 8px;
          word-break: break-all;
        }
        .note-preview {
          padding: 8px;
          align-items: flex-start;
          justify-content: flex-start;
        }
        .note-preview p {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
          margin: 0;
        }
        .item-card-title {
          padding: 8px 10px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border-top: 1px solid var(--border-color);
        }
      `}</style>
    </div>
  )
}
