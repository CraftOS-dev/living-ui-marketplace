import { Card } from './ui'
import type { ActivityLogEntry } from '../types'

interface ActivityLogProps {
  entries: ActivityLogEntry[]
}

const ACTION_ICONS: Record<string, string> = {
  hatch: '🥚',
  feed: '🍖',
  play: '🎮',
  sleep: '💤',
  wake: '☀️',
  clean: '🛁',
  medicine: '💊',
  evolve: '✨',
  retire: '🌟',
}

function getRelativeTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffSeconds = Math.floor((now - then) / 1000)

  if (diffSeconds < 60) return 'just now'
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`
  return `${Math.floor(diffSeconds / 86400)}d ago`
}

export function ActivityLog({ entries }: ActivityLogProps) {
  if (entries.length === 0) {
    return (
      <Card style={{ padding: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px 0' }}>
          Activity
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0', margin: 0 }}>
          No activity yet. Start caring for your pet!
        </p>
      </Card>
    )
  }

  return (
    <Card style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px 0' }}>
        Activity
        <span style={{
          marginLeft: '6px',
          fontSize: '11px',
          backgroundColor: '#6366f122',
          color: '#6366f1',
          padding: '1px 6px',
          borderRadius: '10px',
          fontWeight: 600,
        }}>
          {entries.length}
        </span>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '6px 8px',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-tertiary)',
            }}
          >
            <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>
              {ACTION_ICONS[entry.action] || '📝'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '12px', color: 'var(--text-primary)', margin: 0, lineHeight: '1.4' }}>
                {entry.description}
              </p>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', flexShrink: 0, marginTop: '2px' }}>
              {getRelativeTime(entry.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
