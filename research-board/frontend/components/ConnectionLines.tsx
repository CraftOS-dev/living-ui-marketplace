import type { BoardItem, Connection } from '../types'

const CARD_WIDTH = 180
const CARD_HEIGHT = 160 // approximate card height

interface ConnectionLinesProps {
  items: BoardItem[]
  connections: Connection[]
  onConnectionClick: (id: number, x: number, y: number) => void
}

function getItemCenter(item: BoardItem) {
  return {
    x: item.x + CARD_WIDTH / 2,
    y: item.y + CARD_HEIGHT / 2,
  }
}

export function ConnectionLines({ items, connections, onConnectionClick }: ConnectionLinesProps) {
  const itemMap = new Map(items.map(item => [item.id, item]))

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '6000px',
        height: '6000px',
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'visible',
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
            <line
              x1={s.x} y1={s.y}
              x2={t.x} y2={t.y}
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onConnectionClick(conn.id, e.clientX, e.clientY) }}
            />
            <line
              x1={s.x} y1={s.y}
              x2={t.x} y2={t.y}
              stroke={conn.color || '#ef4444'}
              strokeWidth={2}
              strokeLinecap="round"
              style={{ pointerEvents: 'none' }}
            />
            <circle
              cx={(s.x + t.x) / 2}
              cy={(s.y + t.y) / 2}
              r={4}
              fill={conn.color || '#ef4444'}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        )
      })}
    </svg>
  )
}
