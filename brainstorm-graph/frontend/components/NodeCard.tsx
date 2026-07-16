import { useState, useRef } from 'react'
import { Expand, MessageSquare, Trash2, Plus, Bot, User, Loader2 } from 'lucide-react'
import type { BrainstormNode } from '../types'

export const CARD_WIDTH = 240
export const CARD_HEIGHT = 130

const TYPE_COLORS: Record<string, string> = {
  question: 'var(--color-info, #3b82f6)',
  answer: 'var(--color-success, #22c55e)',
  idea: 'var(--color-primary, #FF4F18)',
}

interface Props {
  node: BrainstormNode
  scale: number
  isExpanding: boolean
  onExpand: () => void
  onAnswer: () => void
  onDelete: () => void
  onAddChild: () => void
  onEdit: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
}

export function NodeCard({ node, scale, isExpanding, onExpand, onAnswer, onDelete, onAddChild, onEdit, onDragMove, onDragEnd }: Props) {
  const [pos, setPos] = useState({ x: node.x, y: node.y })
  const dragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, nx: 0, ny: 0 })
  const moved = useRef(false)

  // Sync position when node prop changes (e.g. after server update)
  if (!dragging.current && (pos.x !== node.x || pos.y !== node.y)) {
    setPos({ x: node.x, y: node.y })
  }

  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    e.stopPropagation()
    dragging.current = true
    moved.current = false
    dragStart.current = { mx: e.clientX, my: e.clientY, nx: pos.x, ny: pos.y }
    const onMove = (ev: MouseEvent) => {
      // Drag deltas are raw screen pixels, but pos is in canvas coordinates —
      // at zoom level `scale`, one screen pixel equals 1/scale canvas pixels.
      const dx = (ev.clientX - dragStart.current.mx) / scale
      const dy = (ev.clientY - dragStart.current.my) / scale
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true
      const nx = dragStart.current.nx + dx
      const ny = dragStart.current.ny + dy
      setPos({ x: nx, y: ny })
      if (moved.current) onDragMove?.(nx, ny)
    }
    const onUp = (ev: MouseEvent) => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (moved.current) {
        const dx = (ev.clientX - dragStart.current.mx) / scale
        const dy = (ev.clientY - dragStart.current.my) / scale
        onDragEnd(dragStart.current.nx + dx, dragStart.current.ny + dy)
      } else {
        // click (not drag) — open editor
        onEdit()
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const color = TYPE_COLORS[node.nodeType] || TYPE_COLORS.idea
  const label = node.nodeType.charAt(0).toUpperCase() + node.nodeType.slice(1)

  return (
    <div
      className="node-card"
      style={{ left: pos.x, top: pos.y, '--node-color': color } as React.CSSProperties}
      onMouseDown={handleMouseDown}
      title="Click to view/edit · Drag to move"
    >
      <div className="node-header">
        <span className="node-badge" style={{ background: color }}>{label}</span>
        <span className="node-by" title={node.createdBy === 'agent' ? 'Created by AI' : 'Created by you'}>
          {node.createdBy === 'agent' ? <Bot size={10} /> : <User size={10} />}
        </span>
        {isExpanding && <Loader2 size={12} className="spin" />}
      </div>

      <p className="node-content">{node.content}</p>

      <div className="node-actions">
        <button className="node-btn" onClick={onExpand} title="Expand with AI" disabled={isExpanding}>
          <Expand size={11} /> Expand
        </button>
        {node.nodeType === 'question' && (
          <button className="node-btn" onClick={onAnswer} title="Answer with AI" disabled={isExpanding}>
            <MessageSquare size={11} /> Answer
          </button>
        )}
        <button className="node-btn" onClick={onAddChild} title="Add child manually">
          <Plus size={11} />
        </button>
        <button className="node-btn danger" onClick={onDelete} title="Delete node and subtree">
          <Trash2 size={11} />
        </button>
      </div>

      <style>{`
        .node-card {
          position: absolute;
          width: ${CARD_WIDTH}px;
          background: var(--bg-secondary);
          border: 1.5px solid var(--node-color);
          border-radius: var(--radius-lg, 8px);
          padding: 10px;
          cursor: pointer;
          user-select: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          transition: box-shadow 0.15s, transform 0.1s;
          z-index: 1;
        }
        .node-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.45); z-index: 10; transform: translateY(-1px); }
        .node-card:active { cursor: grabbing; z-index: 100; transform: translateY(0); }
        .node-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .node-badge {
          font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
          color: #fff; padding: 2px 6px; border-radius: 9999px;
        }
        .node-by { color: var(--text-muted); display: flex; align-items: center; margin-left: auto; }
        .node-content {
          font-size: 13.5px; line-height: 1.5; color: var(--text-primary);
          display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
          overflow: hidden; margin: 0 0 8px;
        }
        .node-actions {
          display: flex; gap: 3px; flex-wrap: wrap; opacity: 0; transition: opacity 0.15s;
        }
        .node-card:hover .node-actions { opacity: 1; }
        .node-btn {
          display: flex; align-items: center; gap: 3px; font-size: 10px;
          padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border-color, rgba(255,255,255,0.1));
          background: var(--bg-tertiary); color: var(--text-secondary); cursor: pointer;
          transition: all 0.15s;
        }
        .node-btn:hover { background: var(--node-color); color: #fff; border-color: var(--node-color); }
        .node-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .node-btn.danger:hover { background: var(--color-error, #ef4444); border-color: var(--color-error, #ef4444); }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
