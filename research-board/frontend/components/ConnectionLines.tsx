import type { BoardItem, Connection } from '../types'

const CARD_WIDTH = 180
const CARD_HEIGHT = 160 // approximate card height

interface ConnectionLinesProps {
  items: BoardItem[]
  connections: Connection[]
  canvasOffset: { x: number; y: number }
  onDeleteConnection: (id: number) => void
}

function getItemCenter(item: BoardItem) {
  return {
    x: item.x + CARD_WIDTH / 2,
    y: item.y + CARD_HEIGHT / 2,
  }
}

export function ConnectionLines({ items, connections, canvasOffset, onDeleteConnection }: ConnectionLinesProps) {
  const itemMap = new Map(items.map(item => [item.id, item]))

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
