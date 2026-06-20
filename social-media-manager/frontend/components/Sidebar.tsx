import { useState } from 'react'
import {
  LayoutDashboard,
  Bird,
  Linkedin,
  Youtube,
  PenSquare,
  CalendarDays,
  Clock,
  BarChart2,
  RefreshCw,
  Sparkles,
  Zap,
  Wand2,
  MessageSquare,
  ChevronDown,
  Lightbulb,
} from 'lucide-react'
import { Button } from './ui'
import type { AppController } from '../AppController'
import type { AppState, ActiveSection, Platform } from '../types'
import { toast } from 'react-toastify'

interface SidebarProps {
  controller: AppController
  state: AppState
}

const NAV_ITEMS: { section: ActiveSection; label: string; icon: React.ReactNode }[] = [
  { section: 'composer', label: 'Compose', icon: <PenSquare size={16} /> },
  { section: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
  { section: 'queue', label: 'Queue', icon: <Clock size={16} /> },
  { section: 'ideas', label: 'Ideas', icon: <Lightbulb size={16} /> },
  { section: 'analytics', label: 'Analytics', icon: <BarChart2 size={16} /> },
]

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

export function Sidebar({ controller, state }: SidebarProps) {
  const [syncing, setSyncing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [aiGroupOpen, setAiGroupOpen] = useState(true)

  const { activeSection, accounts, integrations } = state

  const getAccount = (platform: Platform) => accounts.find((a) => a.platform === platform)

  const isConnected = (platform: Platform) => {
    return integrations?.platforms?.[platform] ?? false
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const ok = await controller.syncAccounts()
      if (ok) {
        toast.success('Accounts synced')
      } else {
        toast.error('Could not reach bridge — check CraftBot connection')
      }
    } catch {
      toast.error('Could not reach bridge — check CraftBot connection')
    } finally {
      setSyncing(false)
    }
  }

  const sidebarWidth = collapsed ? 56 : 240

  return (
    <aside
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 150ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>
          <LayoutDashboard size={20} />
        </span>
        {!collapsed && (
          <span
            style={{
              fontWeight: 'var(--font-weight-semibold)' as any,
              fontSize: 'var(--font-size-base)',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            Social Media
          </span>
        )}
      </div>

      {/* Accounts section */}
      {!collapsed && (
        <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)' as any,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 'var(--space-2)',
            }}
          >
            Accounts
          </div>
          {(['twitter', 'linkedin', 'google_youtube'] as Platform[]).map((platform) => {
            const acct = getAccount(platform)
            const connected = isConnected(platform)
            return (
              <div
                key={platform}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) 0',
                }}
              >
                <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {PLATFORM_ICONS[platform]}
                </span>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {acct?.displayName || PLATFORM_LABELS[platform]}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {acct ? (acct.username ? `@${acct.username}` : 'Connected') : 'Not connected'}
                  </div>
                </div>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: connected ? 'var(--color-success)' : 'var(--color-gray-600)',
                    flexShrink: 0,
                  }}
                />
              </div>
            )
          })}
        </div>
      )}

      {collapsed && (
        <div style={{ padding: 'var(--space-2)' }}>
          {(['twitter', 'linkedin', 'google_youtube'] as Platform[]).map((platform) => {
            const connected = isConnected(platform)
            return (
              <div
                key={platform}
                title={PLATFORM_LABELS[platform]}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-2)',
                  position: 'relative',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>{PLATFORM_ICONS[platform]}</span>
                <span
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: connected ? 'var(--color-success)' : 'var(--color-gray-600)',
                  }}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: 'var(--border-primary)', margin: '0 var(--space-4)' }} />

      {/* Navigation */}
      <nav style={{ flex: 1, padding: 'var(--space-2)' }}>
        {NAV_ITEMS.map(({ section, label, icon }) => {
          const isActive = activeSection === section
          return (
            <button
              key={section}
              onClick={() => controller.setActiveSection(section)}
              title={collapsed ? label : undefined}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: collapsed ? 'var(--space-3)' : 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                backgroundColor: isActive ? 'var(--color-primary-light)' : 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: isActive ? ('var(--font-weight-medium)' as any) : 'normal',
                fontSize: 'var(--font-size-sm)',
                justifyContent: collapsed ? 'center' : 'flex-start',
                transition: 'var(--transition-fast)',
              }}
            >
              <span style={{ flexShrink: 0 }}>{icon}</span>
              {!collapsed && <span>{label}</span>}
            </button>
          )
        })}

        {/* AI Tools group */}
        <div style={{ marginTop: '8px' }}>
          {!collapsed && (
            <button
              onClick={() => setAiGroupOpen(!aiGroupOpen)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              <Sparkles size={13} />
              AI Tools
              <ChevronDown
                size={13}
                style={{
                  marginLeft: 'auto',
                  transform: aiGroupOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            </button>
          )}
          {(aiGroupOpen || collapsed) && (
            <>
              {([
                { section: 'hooks' as const, label: 'Hook Creator', icon: <Zap size={16} /> },
                { section: 'humanizer' as const, label: 'Humanizer', icon: <Wand2 size={16} /> },
                { section: 'insights' as const, label: 'Insights', icon: <MessageSquare size={16} /> },
              ] as { section: import('../types').ActiveSection; label: string; icon: React.ReactNode }[]).map(({ section, label, icon }) => {
                const isActive = activeSection === section
                return (
                  <button
                    key={section}
                    onClick={() => controller.setActiveSection(section)}
                    title={collapsed ? label : undefined}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: collapsed ? 'var(--space-3)' : 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      border: 'none',
                      backgroundColor: isActive ? 'var(--color-primary-light)' : 'transparent',
                      color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: isActive ? ('var(--font-weight-medium)' as any) : 'normal',
                      fontSize: 'var(--font-size-sm)',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      transition: 'var(--transition-fast)',
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{icon}</span>
                    {!collapsed && <span>{label}</span>}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </nav>

      {/* Sync accounts button */}
      <div style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border-primary)' }}>
        <Button
          variant="secondary"
          size="sm"
          fullWidth={!collapsed}
          loading={syncing}
          onClick={handleSync}
          icon={<RefreshCw size={14} />}
          title="Sync Accounts"
          style={{ justifyContent: collapsed ? 'center' : undefined }}
        >
          {!collapsed && 'Sync Accounts'}
        </Button>
      </div>
    </aside>
  )
}
