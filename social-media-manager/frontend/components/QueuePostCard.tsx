import { useState } from 'react'
import { Bird, Linkedin, Youtube, Pencil, Send, X, Trash2, AlertTriangle } from 'lucide-react'
import { Button, Badge } from './ui'
import type { AppController } from '../AppController'
import type { Post, Platform, PostStatus } from '../types'
import { toast } from 'react-toastify'

interface QueuePostCardProps {
  post: Post
  controller: AppController
  onEdit?: (post: Post) => void
}

const STATUS_VARIANT: Record<PostStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  draft: 'default',
  scheduled: 'info',
  publishing: 'warning',
  published: 'success',
  failed: 'error',
  cancelled: 'default',
}

const PLATFORM_ICONS: Record<Platform, React.ReactNode> = {
  twitter: <Bird size={14} />,
  linkedin: <Linkedin size={14} />,
  google_youtube: <Youtube size={14} />,
}

const PLATFORM_LABELS: Record<Platform, string> = {
  twitter: 'Twitter/X',
  linkedin: 'LinkedIn',
  google_youtube: 'YouTube',
}

function formatScheduled(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function QueuePostCard({ post, controller, onEdit }: QueuePostCardProps) {
  const [confirming, setConfirming] = useState<'delete' | 'cancel' | null>(null)
  const [loading, setLoading] = useState(false)

  const handlePublishNow = async () => {
    setLoading(true)
    try {
      const result = await controller.publishNow(post.id)
      if (result.status === 'ok') toast.success('Published!')
      else toast.error(result.message || 'Publish failed')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    setLoading(true)
    try {
      await controller.cancelPost(post.id)
      toast.success('Post cancelled')
    } finally {
      setLoading(false)
      setConfirming(null)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      await controller.deletePost(post.id)
      toast.success('Post deleted')
    } finally {
      setLoading(false)
      setConfirming(null)
    }
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{PLATFORM_ICONS[post.platform as Platform]}</span>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', fontWeight: 'var(--font-weight-medium)' as any }}>
            {PLATFORM_LABELS[post.platform as Platform]}
          </span>
          <Badge variant={STATUS_VARIANT[post.status as PostStatus]} size="sm">
            {post.status}
          </Badge>
        </div>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {formatScheduled(post.scheduledAt)}
        </span>
      </div>

      {/* Content preview */}
      <div
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-primary)',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical' as any,
          lineHeight: 'var(--line-height-normal)',
        }}
      >
        {post.effectiveContent || <em style={{ color: 'var(--text-muted)' }}>No content</em>}
      </div>

      {/* Actions */}
      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)', flex: 1 }}>
            Confirm {confirming}?
          </span>
          <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>No</Button>
          <Button
            variant="danger"
            size="sm"
            loading={loading}
            onClick={confirming === 'delete' ? handleDelete : handleCancel}
          >
            Yes
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {onEdit && (
            <Button variant="ghost" size="sm" icon={<Pencil size={12} />} onClick={() => onEdit(post)}>
              Edit
            </Button>
          )}
          <Button variant="secondary" size="sm" icon={<Send size={12} />} loading={loading} onClick={handlePublishNow}>
            Publish Now
          </Button>
          <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={() => setConfirming('cancel')}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => setConfirming('delete')}>
            Delete
          </Button>
        </div>
      )}
    </div>
  )
}
