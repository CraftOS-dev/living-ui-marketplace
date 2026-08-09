import { CARD_WIDTH, CARD_HEIGHT } from './ItemCard'
import type { BoardItem, Connection } from '../types'

interface ConnectDragPreview {
  sourceId: number
  x: number
  y: number
}

interface ConnectionLinesProps {
  items: BoardItem[]
  connections: Connection[]
  canvasOffset: { x: number; y: number }
  onDeleteConnection: (id: number) => void
  connectDrag?: ConnectDragPreview | null
}

function getItemCenter(item: BoardItem) {
  return {
    x: item.x + CARD_WIDTH / 2,
    y: item.y + CARD_HEIGHT / 2,
  }
}

export function ConnectionLines({ items, connections, canvasOffset, onDeleteConnection, connectDrag }: ConnectionLinesProps) {
  const itemMap = new Map(items.map(item => [item.id, item]))
  const dragSource = connectDrag ? itemMap.get(connectDrag.sourceId) : null

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '3000px',
        height: '3000px',
        pointerEvents: 'none',
        zIndex: 0,
        transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px)`,
      }}
    >
      {dragSource && connectDrag && (
        <line
          x1={getItemCenter(dragSource).x}
          y1={getItemCenter(dragSource).y}
          x2={connectDrag.x}
          y2={connectDrag.y}
          stroke="#6366f1"
          strokeWidth={2}
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
      )}
      {connections.map(conn => {
        const source = itemMap.get(conn.sourceId)
        const target = itemMap.get(conn.targetId)
        if (!source || !target) return null

        const s = getItemCenter(source)
        const t = getItemCenter(target)

        return (
          <g key={conn.id}>
            {/* Invisible thick line for easier clicking */}
            <line
              x1={s.x} y1={s.y}
              x2={t.x} y2={t.y}
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={() => onDeleteConnection(conn.id)}
            />
            {/* Visible red line */}
            <line
              x1={s.x} y1={s.y}
              x2={t.x} y2={t.y}
              stroke="#ef4444"
              strokeWidth={2}
              strokeLinecap="round"
            />
            {/* Small dot at midpoint for visual feedback */}
            <circle
              cx={(s.x + t.x) / 2}
              cy={(s.y + t.y) / 2}
              r={4}
              fill="#ef4444"
              style={{ pointerEvents: 'none' }}
            />
          </g>
        )
      })}
    </svg>
  )
}
