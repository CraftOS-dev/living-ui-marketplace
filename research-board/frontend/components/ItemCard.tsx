import { useState } from 'react'
import type { BoardItem } from '../types'

const BACKEND_URL = 'http://localhost:{{BACKEND_PORT}}'

interface ItemCardProps {
  item: BoardItem
  onClick: () => void
  onDragEnd: (id: number, x: number, y: number) => void
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
        <span className="preview-icon">🖼️</span>
      </div>
    )
  }

  if (item.type === 'video') {
    const src = item.filePath ? getFileUrl(item.filePath) : item.url || ''
    if (src && item.filePath) {
      return (
        <div className="item-preview video-preview">
          <video src={src} muted />
          <div className="play-overlay">▶</div>
        </div>
      )
    }
    return (
      <div className="item-preview icon-preview">
        <span className="preview-icon">🎬</span>
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
          <div className="youtube-badge">▶ YouTube</div>
        </div>
      )
    }
    return (
      <div className="item-preview icon-preview">
        <span className="preview-icon">📺</span>
      </div>
    )
  }

  if (item.type === 'doc') {
    return (
      <div className="item-preview icon-preview">
        <span className="preview-icon">📄</span>
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

  return <div className="item-preview icon-preview"><span className="preview-icon">📌</span></div>
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

export function ItemCard({ item, onClick, onDragEnd }: ItemCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.item-card-action')) return
    e.preventDefault()
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - item.x,
      y: e.clientY - item.y,
    })

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x
      const newY = e.clientY - dragOffset.y
      const card = document.getElementById(`item-card-${item.id}`)
      if (card) {
        card.style.left = `${newX}px`
        card.style.top = `${newY}px`
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false)
      const newX = Math.max(0, e.clientX - dragOffset.x)
      const newY = Math.max(0, e.clientY - dragOffset.y)
      onDragEnd(item.id, newX, newY)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const typeColor = TYPE_COLORS[item.type] || '#6366f1'
  const typeLabel = TYPE_LABELS[item.type] || item.type

  return (
    <div
      id={`item-card-${item.id}`}
      className={`item-card ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'absolute',
        left: item.x,
        top: item.y,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onClick={() => {
        if (!isDragging) onClick()
      }}
    >
      <div className="item-card-type-badge" style={{ backgroundColor: typeColor }}>
        {typeLabel}
      </div>
      <ItemPreview item={item} />
      <div className="item-card-title">{item.title}</div>

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
          font-size: 36px;
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
