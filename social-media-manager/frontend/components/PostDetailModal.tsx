import { useState } from 'react'
import { Bird, Linkedin, Youtube, Send, X, Trash2, AlertTriangle } from 'lucide-react'
import { Modal, Button, Badge, Alert } from './ui'
import type { AppController } from '../AppController'
import type { Post, PostAnalytics, Platform, PostStatus } from '../types'
import { toast } from 'react-toastify'

interface PostDetailModalProps {
  post: Post | null
  analytics?: PostAnalytics | null
  open: boolean
  onClose: () => void
  controller: AppController
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

function formatDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export function PostDetailModal({ post, analytics, open, onClose, controller }: PostDetailModalProps) {
  const [confirming, setConfirming] = useState<'delete' | 'cancel' | null>(null)
  const [loading, setLoading] = useState(false)

  if (!post) return null

  const handlePublishNow = async () => {
    setLoading(true)
    try {
      const result = await controller.publishNow(post.id)
      if (result.status === 'ok') {
        toast.success('Published!')
        onClose()
      } else {
        toast.error(result.message || 'Publish failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    setLoading(true)
    try {
      await controller.cancelPost(post.id)
      toast.success('Post cancelled')
      onClose()
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
      onClose()
    } finally {
      setLoading(false)
      setConfirming(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post Details"
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {confirming ? (
            <>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={14} /> Confirm?
              </span>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>No</Button>
              <Button
                variant="danger"
                size="sm"
                loading={loading}
                onClick={confirming === 'delete' ? handleDelete : handleCancel}
              >
                Yes, {confirming}
              </Button>
            </>
          ) : (
            <>
              {post.status !== 'published' && post.status !== 'cancelled' && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Send size={12} />}
                  loading={loading}
                  onClick={handlePublishNow}
                >
                  Publish Now
                </Button>
              )}
              {post.status === 'scheduled' && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<X size={12} />}
                  onClick={() => setConfirming('cancel')}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={12} />}
                onClick={() => setConfirming('delete')}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Platform + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            {PLATFORM_ICONS[post.platform as Platform]} {PLATFORM_LABELS[post.platform as Platform]}
          </span>
          <Badge variant={STATUS_VARIANT[post.status as PostStatus]} size="sm">
            {post.status}
          </Badge>
          {post.retryCount > 0 && (
            <Badge variant="warning" size="sm">Retry {post.retryCount}/3</Badge>
          )}
        </div>

        {/* Error */}
        {post.errorMessage && (
          <Alert variant="error" title="Error">
            {post.errorMessage}
          </Alert>
        )}

        {/* Content */}
        <div
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            fontSize: 'var(--font-size-base)',
            color: 'var(--text-primary)',
            lineHeight: 'var(--line-height-normal)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {post.effectiveContent || <em style={{ color: 'var(--text-muted)' }}>No content</em>}
        </div>

        {/* Times */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', fontSize: 'var(--font-size-sm)' }}>
          <div>
            <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Scheduled</div>
            <div style={{ color: 'var(--text-primary)' }}>{formatDt(post.scheduledAt)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Published</div>
            <div style={{ color: 'var(--text-primary)' }}>{formatDt(post.publishedAt)}</div>
          </div>
        </div>

        {/* Analytics */}
        {analytics && (
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', fontWeight: 'var(--font-weight-semibold)' as any, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Analytics
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)' }}>
              {[
                { label: 'Impressions', value: analytics.impressions },
                { label: 'Likes', value: analytics.likes },
                { label: 'Comments', value: analytics.comments },
                { label: 'Shares', value: analytics.shares },
              ].map(({ label, value }) => (
                <div key={label} style={{ textAlign: 'center', padding: 'var(--space-2)', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-primary)' }}>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--color-primary)' }}>{value}</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
