import { Bird, Linkedin, Youtube } from 'lucide-react'
import type { Platform, PlatformAccount } from '../types'

interface PlatformPreviewProps {
  platform: Platform
  content: string
  account: PlatformAccount | null
}

const CHAR_LIMITS: Record<Platform, number> = {
  twitter: 280,
  linkedin: 3000,
  google_youtube: 10000,
}

const PLATFORM_LABEL: Record<Platform, string> = {
  twitter: 'Twitter/X',
  linkedin: 'LinkedIn',
  google_youtube: 'YouTube',
}

function Avatar({ url, name, size = 36 }: { url?: string | null; name: string; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
      />
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: 'var(--color-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 'bold' as any,
        fontSize: size * 0.4,
      }}
    >
      {name.charAt(0).toUpperCase() || '?'}
    </div>
  )
}

export function PlatformPreview({ platform, content, account }: PlatformPreviewProps) {
  const limit = CHAR_LIMITS[platform]
  const charCount = content.length
  const overLimit = charCount > limit

  const displayName = account?.displayName || PLATFORM_LABEL[platform]
  const username = account?.username

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  }

  if (platform === 'twitter') {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <Avatar url={account?.avatarUrl} name={displayName} />
          <div>
            <div style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
              {displayName}
            </div>
            {username && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>@{username}</div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#1DA1F2' }}><Bird size={16} /></span>
          </div>
        </div>
        <div style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-primary)', lineHeight: 'var(--line-height-normal)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Start typing to preview...</span>}
        </div>
        <div style={{ marginTop: 'var(--space-2)', textAlign: 'right' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: overLimit ? 'var(--color-error)' : 'var(--text-muted)' }}>
            {charCount}/{limit}
          </span>
        </div>
      </div>
    )
  }

  if (platform === 'linkedin') {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <Avatar url={account?.avatarUrl} name={displayName} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
              {displayName}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>LinkedIn Member</div>
          </div>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#0A66C2',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Linkedin size={10} /> in
          </span>
        </div>
        <div style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-primary)', lineHeight: 'var(--line-height-normal)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Start typing to preview...</span>}
        </div>
        <div style={{ marginTop: 'var(--space-2)', textAlign: 'right' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: overLimit ? 'var(--color-error)' : 'var(--text-muted)' }}>
            {charCount}/{limit}
          </span>
        </div>
      </div>
    )
  }

  // YouTube
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Avatar url={account?.avatarUrl} name={displayName} size={32} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
            {displayName}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Youtube size={10} style={{ color: '#FF0000' }} /> Community Post
          </div>
        </div>
      </div>
      <div style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-primary)', lineHeight: 'var(--line-height-normal)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {content || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Start typing to preview...</span>}
      </div>
    </div>
  )
}
