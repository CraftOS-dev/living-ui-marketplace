import { useState } from 'react'
import { BarChart2, RefreshCw, Bird, Linkedin, Youtube } from 'lucide-react'
import { Button, Card, Badge, EmptyState } from './ui'
import type { AppController } from '../AppController'
import type { AppState, Platform, Post, AnalyticsSummary } from '../types'
import { toast } from 'react-toastify'

interface AnalyticsViewProps {
  controller: AppController
  state: AppState
}

const PLATFORM_ICONS: Record<Platform, React.ReactNode> = {
  twitter: <Bird size={16} />,
  linkedin: <Linkedin size={16} />,
  google_youtube: <Youtube size={16} />,
}

const PLATFORM_LABELS: Record<Platform, string> = {
  twitter: 'Twitter/X',
  linkedin: 'LinkedIn',
  google_youtube: 'YouTube',
}

const PLATFORM_COLORS: Record<Platform, string> = {
  twitter: 'var(--color-twitter, #1DA1F2)',
  linkedin: 'var(--color-linkedin, #0A66C2)',
  google_youtube: 'var(--color-youtube, #FF0000)',
}

function SummaryCard({ summary }: { summary: AnalyticsSummary }) {
  return (
    <Card style={{ minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <span style={{ color: PLATFORM_COLORS[summary.platform] }}>
          {PLATFORM_ICONS[summary.platform]}
        </span>
        <span style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
          {PLATFORM_LABELS[summary.platform]}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
        {[
          { label: 'Posts', value: summary.totalPosts },
          { label: 'Impressions', value: summary.totalImpressions },
          { label: 'Likes', value: summary.totalLikes },
          { label: 'Comments', value: summary.totalComments },
          { label: 'Shares', value: summary.totalShares },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)' as any, color: 'var(--text-primary)' }}>
              {value.toLocaleString()}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{label}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function PostRow({ post, controller }: { post: Post; controller: AppController }) {
  const [syncing, setSyncing] = useState(false)

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await controller.syncPostAnalytics(post.id)
      if (result) toast.success('Analytics synced')
      else toast.info('Analytics unavailable (bridge not connected)')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        borderBottom: '1px solid var(--border-primary)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ color: PLATFORM_COLORS[post.platform as Platform], flexShrink: 0 }}>
        {PLATFORM_ICONS[post.platform as Platform]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {post.effectiveContent || '(no content)'}
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : '—'}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        loading={syncing}
        icon={<RefreshCw size={12} />}
        onClick={handleSync}
      >
        Sync
      </Button>
    </div>
  )
}

export function AnalyticsView({ controller, state }: AnalyticsViewProps) {
  const { analyticsSummary, posts } = state
  const publishedPosts = posts.filter((p) => p.status === 'published')

  return (
    <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <BarChart2 size={20} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', color: 'var(--text-primary)' }}>Analytics</h2>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={14} />}
          onClick={() => controller.refreshAnalyticsSummary()}
        >
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div>
        <h3 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', fontWeight: 'normal' as any }}>
          Summary
        </h3>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          {analyticsSummary.map((s) => (
            <SummaryCard key={s.platform} summary={s} />
          ))}
        </div>
      </div>

      {/* Published posts */}
      <div>
        <h3 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', fontWeight: 'normal' as any, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          Published Posts
          <Badge variant="default" size="sm">
            {publishedPosts.length}
          </Badge>
        </h3>
        {publishedPosts.length === 0 ? (
          <EmptyState
            icon={<BarChart2 size={32} />}
            title="No published posts"
            message="Publish your first post to see analytics here."
          />
        ) : (
          <Card padding="none">
            {publishedPosts.map((post) => (
              <PostRow key={post.id} post={post} controller={controller} />
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
