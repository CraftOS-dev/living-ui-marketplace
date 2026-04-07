import { Card, Badge } from '../ui'
import { Eye, ThumbsUp, MessageSquare } from 'lucide-react'
import type { YouTubeVideo } from '../../types'

interface VideoCardProps {
  video: YouTubeVideo
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function VideoCard({ video }: VideoCardProps) {
  return (
    <Card padding="none">
      {video.thumbnailUrl && (
        <div style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
          <img src={video.thumbnailUrl} alt={video.title} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      <div style={{ padding: 'var(--space-3)' }}>
        <p style={{
          fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {video.title}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-1)' }}>
          <Badge variant="default" size="sm"><Eye size={10} /> {formatCount(video.viewCount)}</Badge>
          <Badge variant="default" size="sm"><ThumbsUp size={10} /> {formatCount(video.likeCount)}</Badge>
          <Badge variant="default" size="sm"><MessageSquare size={10} /> {formatCount(video.commentCount)}</Badge>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {formatDate(video.publishedAt)}
        </p>
      </div>
    </Card>
  )
}
