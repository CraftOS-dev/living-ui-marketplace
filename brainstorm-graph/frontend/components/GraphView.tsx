import { useRef, useState, useEffect } from 'react'
import { NodeCard, CARD_WIDTH, CARD_HEIGHT } from './NodeCard'
import type { BrainstormNode } from '../types'

const CANVAS_SIZE = 3000
const INITIAL_OFFSET = { x: -800, y: -100 }

interface Props {
  nodes: BrainstormNode[]
  expandingNodeId: number | null
  onExpand: (id: number) => void
  onAnswer: (id: number) => void
  onDelete: (id: number) => void
  onAddChild: (parentId: number) => void
  onEdit: (id: number) => void
  onUpdatePosition: (id: number, x: number, y: number) => void
}

interface Edge {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

function buildEdges(nodes: BrainstormNode[]): Edge[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  return nodes
    .filter(n => n.parentId !== null)
    .map(n => {
      const parent = nodeMap.get(n.parentId!)
      if (!parent) return null
      return {
        id: `${parent.id}-${n.id}`,
        x1: parent.x + CARD_WIDTH / 2,
        y1: parent.y + CARD_HEIGHT,
        x2: n.x + CARD_WIDTH / 2,
        y2: n.y,
      }
    })
    .filter(Boolean) as Edge[]
}

export function GraphView({ nodes, expandingNodeId, onExpand, onAnswer, onDelete, onAddChild, onEdit, onUpdatePosition }: Props) {
  const [offset, setOffset] = useState(INITIAL_OFFSET)
  const panning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.node-card')) return
    panning.current = true
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panning.current) return
      setOffset({
        x: panStart.current.ox + (e.clientX - panStart.current.x),
        y: panStart.current.oy + (e.clientY - panStart.current.y),
      })
    }
    const onUp = () => { panning.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const edges = buildEdges(nodes)

  return (
    <div
      className="graph-container"
      onMouseDown={handleCanvasMouseDown}
      style={{ cursor: panning.current ? 'grabbing' : 'grab' }}
    >
      <div
        className="canvas-content"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)`, width: CANVAS_SIZE, height: CANVAS_SIZE }}
      >
        {/* SVG edge layer */}
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: CANVAS_SIZE, height: CANVAS_SIZE, pointerEvents: 'none', overflow: 'visible' }}
        >
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.2)" />
            </marker>
          </defs>
          {edges.map(e => {
            const mid = (e.y1 + e.y2) / 2
            const d = `M ${e.x1} ${e.y1} C ${e.x1} ${mid} ${e.x2} ${mid} ${e.x2} ${e.y2}`
            return (
              <path
                key={e.id}
                d={d}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1.5}
                fill="none"
                strokeDasharray="none"
              />
            )
          })}
        </svg>

        {/* Node cards */}
        {nodes.map(node => (
          <NodeCard
            key={node.id}
            node={node}
            isExpanding={expandingNodeId === node.id}
            onExpand={() => onExpand(node.id)}
            onAnswer={() => onAnswer(node.id)}
            onDelete={() => onDelete(node.id)}
            onAddChild={() => onAddChild(node.id)}
            onEdit={() => onEdit(node.id)}
            onDragEnd={(x, y) => onUpdatePosition(node.id, x, y)}
          />
        ))}

        {nodes.length === 0 && (
          <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            <p style={{ fontSize: 14 }}>Create a session to start brainstorming</p>
          </div>
        )}
      </div>

      <style>{`
        .graph-container {
          flex: 1;
          overflow: hidden;
          position: relative;
          background:
            radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 24px 24px;
          background-color: var(--bg-primary);
        }
        .canvas-content {
          position: absolute;
          top: 0;
          left: 0;
        }
      `}</style>
    </div>
  )
}
