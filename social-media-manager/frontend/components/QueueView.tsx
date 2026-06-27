import { Clock, PenSquare } from 'lucide-react'
import { Button, Badge, EmptyState } from './ui'
import { QueuePostCard } from './QueuePostCard'
import type { AppController } from '../AppController'
import type { AppState } from '../types'

interface QueueViewProps {
  controller: AppController
  state: AppState
}

export function QueueView({ controller, state }: QueueViewProps) {
  const { queue } = state

  return (
    <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Clock size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>
          Upcoming Posts
        </h2>
        <Badge variant="info" size="sm">{queue.length}</Badge>
      </div>

      {/* Content */}
      {queue.length === 0 ? (
        <EmptyState
          icon={<Clock size={40} />}
          title="No scheduled posts"
          message="Create your first post and schedule it for later."
          action={
            <Button
              variant="primary"
              icon={<PenSquare size={14} />}
              onClick={() => controller.setActiveSection('composer')}
            >
              Compose
            </Button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 720 }}>
          {queue.map((post) => (
            <QueuePostCard key={post.id} post={post} controller={controller} />
          ))}
        </div>
      )}
    </div>
  )
}
