import { useRef, useState, useEffect } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { NodeCard, CARD_WIDTH, CARD_HEIGHT } from './NodeCard'
import type { BrainstormNode } from '../types'

const CANVAS_SIZE = 3000
const INITIAL_OFFSET = { x: -800, y: -100 }
const MIN_SCALE = 0.25
const MAX_SCALE = 2
const WHEEL_STEP = 1.1
const BUTTON_STEP = 1.2

interface Props {
  nodes: BrainstormNode[]
  activeSessionId: number | null
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

export function GraphView({ nodes, activeSessionId, expandingNodeId, onExpand, onAnswer, onDelete, onAddChild, onEdit, onUpdatePosition }: Props) {
  const [offset, setOffset] = useState(INITIAL_OFFSET)
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Zoom by `factor` about a focal point given in container-relative pixels,
  // keeping the canvas point under the focal point fixed on screen. Uses the
  // functional setState form (not a ref mirror) so rapid-fire wheel ticks —
  // several dispatched before React re-renders — each chain off the true
  // latest pending scale/offset instead of a stale snapshot.
  function zoomAt(factor: number, focalX: number, focalY: number) {
    setScale(s0 => {
      const s1 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s0 * factor))
      if (s1 !== s0) {
        const ratio = s1 / s0
        setOffset(o0 => ({
          x: focalX - ratio * (focalX - o0.x),
          y: focalY - ratio * (focalY - o0.y),
        }))
      }
      return s1
    })
  }

  // Mouse-wheel zoom centered on the cursor. Must be a native listener with
  // { passive: false } — React's synthetic onWheel can't reliably
  // preventDefault() since it's registered passive at the root.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top)
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // Center the viewport on the loaded session's nodes and reset zoom.
  // Shared by the session-change effect and the "reset & fit" button.
  function centerView() {
    if (nodes.length === 0) return
    const container = containerRef.current
    const viewportW = container?.clientWidth || 1200
    const viewportH = container?.clientHeight || 800
    const minX = Math.min(...nodes.map(n => n.x))
    const maxX = Math.max(...nodes.map(n => n.x)) + CARD_WIDTH
    const minY = Math.min(...nodes.map(n => n.y))
    const maxY = Math.max(...nodes.map(n => n.y)) + CARD_HEIGHT
    setScale(1)
    setOffset({
      x: viewportW / 2 - (minX + maxX) / 2,
      y: viewportH / 2 - (minY + maxY) / 2,
    })
  }

  // Re-center the viewport on the loaded session's nodes whenever the active
  // session changes — otherwise nodes render relative to whatever pan offset
  // was left over from the previous session (or the static initial offset,
  // which only happens to cover the default root-node position).
  useEffect(() => {
    centerView()
  }, [activeSessionId])

  const edges = buildEdges(nodes)

  return (
    <div
      className="graph-container"
      ref={containerRef}
      onMouseDown={handleCanvasMouseDown}
      style={{ cursor: panning.current ? 'grabbing' : 'grab' }}
    >
      <div
        className="canvas-content"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
        }}
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
            scale={scale}
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

      {/* Zoom controls */}
      <div
        className="zoom-controls"
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', right: 16, bottom: 16, zIndex: 50,
          display: 'flex', gap: 4, padding: 4,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
          borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        <button
          className="zoom-btn"
          title="Zoom out"
          onClick={() => {
            const c = containerRef.current
            zoomAt(1 / BUTTON_STEP, (c?.clientWidth || 0) / 2, (c?.clientHeight || 0) / 2)
          }}
        >
          <ZoomOut size={16} />
        </button>
        <button
          className="zoom-btn"
          title="Zoom in"
          onClick={() => {
            const c = containerRef.current
            zoomAt(BUTTON_STEP, (c?.clientWidth || 0) / 2, (c?.clientHeight || 0) / 2)
          }}
        >
          <ZoomIn size={16} />
        </button>
        <button className="zoom-btn" title="Reset & fit" onClick={centerView}>
          <Maximize size={16} />
        </button>
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
        .zoom-btn {
          display: flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 6px;
          background: var(--bg-tertiary); color: var(--text-secondary);
          border: 1px solid var(--border-color, rgba(255,255,255,0.1)); cursor: pointer;
          transition: all 0.15s;
        }
        .zoom-btn:hover { background: var(--color-primary, #FF4F18); color: #fff; }
      `}</style>
    </div>
  )
}
