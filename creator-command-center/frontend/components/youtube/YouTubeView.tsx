import { useState } from 'react'
import { Button, Card, Badge, EmptyState } from '../ui'
import { VideoCard } from './VideoCard'
import type { AppController } from '../../AppController'
import type { YouTubeChannel, YouTubeVideo } from '../../types'

interface YouTubeViewProps {
  controller: AppController
  channels: YouTubeChannel[]
  videos: YouTubeVideo[]
  isConnected: boolean
  onDataChange: () => void
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

export function YouTubeView({ controller, channels, videos, isConnected, onDataChange }: YouTubeViewProps) {
  const [syncing, setSyncing] = useState(false)
  const channel = channels[0]

  const handleSync = async () => {
    setSyncing(true)
    await controller.syncYouTube()
    await onDataChange()
    setSyncing(false)
  }

  if (!isConnected) {
    return (
      <div>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-4)' }}>YouTube</h2>
        <EmptyState
          title="Google not connected"
          message="Connect your Google account in CraftBot settings to see YouTube data."
        />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semibold)', margin: 0 }}>YouTube</h2>
        <Button variant="primary" onClick={handleSync} loading={syncing}>
          {syncing ? 'Syncing...' : '🔄 Sync YouTube'}
        </Button>
      </div>

      {/* Channel stats */}
      {channel && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <Card>
            <div style={{ padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              {channel.thumbnailUrl && (
                <img src={channel.thumbnailUrl} alt="" style={{ width: 64, height: 64, borderRadius: '50%' }} />
              )}
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', margin: 0 }}>{channel.title}</h3>
                {channel.description && (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 'var(--space-1) 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {channel.description}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)', textAlign: 'center' }}>
                <div>
                  <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>
                    {formatCount(channel.subscriberCount)}
                  </p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Subscribers</p>
                </div>
                <div>
                  <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>
                    {formatCount(channel.viewCount)}
                  </p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Views</p>
                </div>
                <div>
                  <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>
                    {channel.videoCount}
                  </p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Videos</p>
                </div>
              </div>
            </div>
          </Card>
          {channel.syncedAt && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              Last synced: {new Date(channel.syncedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Video grid */}
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-3)' }}>
        Recent Videos ({videos.length})
      </h3>
      {videos.length === 0 ? (
        <EmptyState
          title="No videos cached"
          message="Click 'Sync YouTube' to pull your latest videos."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
          {videos.map(v => <VideoCard key={v.videoId} video={v} />)}
        </div>
      )}
    </div>
  )
}
