import type { Email } from '../types'

interface EmailCardProps {
  email: Email
}

function senderInitial(name: string, email: string): string {
  return (name || email || '?').charAt(0).toUpperCase()
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffH = diffMs / 3_600_000
    if (diffH < 24) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    if (diffH < 168) {
      return d.toLocaleDateString([], { weekday: 'short' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

export function EmailCard({ email }: EmailCardProps) {
  const initial = senderInitial(email.fromName, email.fromEmail)
  const displayName = email.fromName || email.fromEmail || email.from

  return (
    <div className={`email-card${email.isUnread ? ' email-card--unread' : ''}`}>
      <div className="email-avatar" aria-hidden="true">
        {initial}
      </div>
      <div className="email-body">
        <div className="email-header-row">
          <span className="email-sender" title={email.from}>{displayName}</span>
          <span className="email-date">{formatDate(email.date)}</span>
        </div>
        <p className="email-subject">{email.subject || '(no subject)'}</p>
        {email.snippet && (
          <p className="email-snippet">{email.snippet}</p>
        )}
      </div>

      <style>{`
        .email-card {
          display: flex;
          gap: var(--space-3);
          padding: var(--space-3);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-primary);
          background: var(--bg-secondary);
          cursor: pointer;
          transition: background var(--transition-base), border-color var(--transition-base);
          min-height: 36px;
        }

        .email-card:hover {
          background: var(--bg-tertiary);
          border-color: var(--color-accent);
        }

        .email-card--unread {
          border-left: 3px solid var(--color-accent);
        }

        .email-avatar {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          background: var(--color-primary);
          color: var(--color-white);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-semibold);
        }

        .email-body {
          flex: 1;
          min-width: 0;
        }

        .email-header-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: var(--space-2);
          margin-bottom: var(--space-1);
        }

        .email-sender {
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .email-date {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .email-subject {
          font-size: var(--font-size-sm);
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: var(--space-1);
        }

        .email-card--unread .email-subject {
          font-weight: var(--font-weight-semibold);
        }

        .email-snippet {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          line-height: var(--line-height-normal);
        }
      `}</style>
    </div>
  )
}
