import { Card, Badge } from '../ui'
import { Youtube, MessageCircle, Twitter, BookOpen } from 'lucide-react'
import type { IntegrationStatus, YouTubeChannel, YouTubeVideo } from '../../types'
import type { ReactNode } from 'react'

// Only show platforms relevant to content creators
const PLATFORM_INFO: Record<string, { label: string; icon: ReactNode; color: string }> = {
  google_workspace: { label: 'YouTube & Gmail', icon: <Youtube size={24} />, color: '#FF0000' },
  discord: { label: 'Discord', icon: <MessageCircle size={24} />, color: '#5865F2' },
  twitter: { label: 'Twitter / X', icon: <Twitter size={24} />, color: '#1DA1F2' },
  notion: { label: 'Notion', icon: <BookOpen size={24} />, color: '#000000' },
}

interface DashboardProps {
  integrationStatus: IntegrationStatus
  channels: YouTubeChannel[]
  videos: YouTubeVideo[]
  onViewYouTube: () => void
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

export function DashboardView({ integrationStatus, channels, videos, onViewYouTube }: DashboardProps) {
  const channel = channels[0]
  const recentVideos = videos.slice(0, 5)
  const totalLikes = videos.reduce((sum, v) => sum + v.likeCount, 0)

  return (
    <div>
      <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-4)' }}>
        Dashboard
      </h2>

      {/* Integration Status */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-3)' }}>
          Connected Platforms
        </h3>
        {!integrationStatus.bridgeAvailable ? (
          <Card>
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
              Integration bridge not available. Launch this app from CraftBot to connect platforms.
            </div>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
            {integrationStatus.integrations
              .filter(i => PLATFORM_INFO[i.id])
              .map(i => {
                const info = PLATFORM_INFO[i.id]
                return (
                  <Card key={i.id}>
                    <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', textAlign: 'center' }}>
                      <span style={{ color: info.color }}>{info.icon}</span>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>{info.label}</span>
                      <Badge variant={i.connected ? 'success' : 'default'} size="sm" dot>
                        {i.connected ? 'Connected' : 'Not connected'}
                      </Badge>
                    </div>
                  </Card>
                )
              })}
          </div>
        )}
      </div>

      {/* YouTube Summary */}
      {channel && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)' }}>YouTube Overview</h3>
            <button onClick={onViewYouTube} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontFamily: 'inherit' }}>
              View all →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <Card>
              <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>
                  {formatCount(channel.subscriberCount)}
                </p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Subscribers</p>
              </div>
            </Card>
            <Card>
              <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>
                  {formatCount(channel.viewCount)}
                </p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Total Views</p>
              </div>
            </Card>
            <Card>
              <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>
                  {channel.videoCount}
                </p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Videos</p>
              </div>
            </Card>
            <Card>
              <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>
                  {formatCount(totalLikes)}
                </p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Recent Likes</p>
              </div>
            </Card>
          </div>

          {/* Recent videos */}
          {recentVideos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {recentVideos.map(video => (
                <Card key={video.videoId}>
                  <div style={{ padding: 'var(--space-2) var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {video.thumbnailUrl && (
                      <img src={video.thumbnailUrl} alt="" referrerPolicy="no-referrer" style={{ width: 80, height: 45, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {video.title}
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        {formatCount(video.viewCount)} views · {formatCount(video.likeCount)} likes
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {!channel && integrationStatus.integrations.find(i => i.id === 'google_workspace' && i.connected) && (
        <Card>
          <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
            Google connected but no YouTube data yet. Go to the YouTube tab and click Sync.
          </div>
        </Card>
      )}
    </div>
  )
}
