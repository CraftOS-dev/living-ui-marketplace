import { useState } from 'react'
import {
  FiCalendar,
  FiHome,
  FiMail,
  FiMenu,
  FiSend,
  FiSettings,
  FiUsers,
  FiX,
  FiZap,
} from 'react-icons/fi'
import type { IconType } from 'react-icons'
import type { Section } from '../types'

interface SidebarProps {
  active: Section
  onChange: (section: Section) => void
  isMobile: boolean
  collapsed: boolean
  onToggle: () => void
  llmConnected: boolean
  gmailConnected: boolean
}

interface NavItem {
  id: Section
  label: string
  icon: IconType
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: FiHome },
  { id: 'campaigns', label: 'Campaigns', icon: FiSend },
  { id: 'subscribers', label: 'Subscribers', icon: FiUsers },
  { id: 'templates', label: 'Templates', icon: FiMail },
  { id: 'schedule', label: 'Schedule', icon: FiCalendar },
  { id: 'settings', label: 'Settings', icon: FiSettings },
]

export function Sidebar({
  active,
  onChange,
  isMobile,
  collapsed,
  onToggle,
  llmConnected,
  gmailConnected,
}: SidebarProps) {
  if (isMobile) return <MobileBottomBar active={active} onChange={onChange} />
  return (
    <DesktopSidebar
      active={active}
      onChange={onChange}
      collapsed={collapsed}
      onToggle={onToggle}
      llmConnected={llmConnected}
      gmailConnected={gmailConnected}
    />
  )
}

function DesktopSidebar({
  active,
  onChange,
  collapsed,
  onToggle,
  llmConnected,
  gmailConnected,
}: {
  active: Section
  onChange: (s: Section) => void
  collapsed: boolean
  onToggle: () => void
  llmConnected: boolean
  gmailConnected: boolean
}) {
  const width = collapsed ? 64 : 232
  return (
    <aside
      style={{
        width,
        minWidth: width,
        height: '100vh',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        transition: 'width var(--transition-base)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            background: 'var(--bg-tertiary)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            flexShrink: 0,
            border: '1px solid var(--border-primary)',
          }}
          aria-hidden
        >
          <FiSend size={16} />
        </div>
        {!collapsed && (
          <div
            style={{
              fontWeight: 700,
              fontSize: 'var(--font-size-lg)',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            Newsletter
          </div>
        )}
        <button
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 4,
            display: collapsed ? 'none' : 'inline-flex',
          }}
        >
          <FiX size={16} />
        </button>
      </div>

      {collapsed && (
        <button
          onClick={onToggle}
          aria-label="Expand sidebar"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 'var(--space-3)',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <FiMenu size={16} />
        </button>
      )}

      <nav style={{ flex: 1, padding: 'var(--space-3) var(--space-2)' }}>
        {NAV.map((item) => (
          <NavLink
            key={item.id}
            label={item.label}
            Icon={item.icon}
            isActive={active === item.id}
            collapsed={collapsed}
            onClick={() => onChange(item.id)}
          />
        ))}
      </nav>

      <div
        style={{
          padding: 'var(--space-3)',
          borderTop: '1px solid var(--border-primary)',
          display: collapsed ? 'none' : 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-muted)',
        }}
      >
        <StatusRow label="AI generator" connected={llmConnected} icon={FiZap} />
        <StatusRow label="Gmail send" connected={gmailConnected} icon={FiMail} />
      </div>
    </aside>
  )
}

function NavLink({
  label,
  Icon,
  isActive,
  collapsed,
  onClick,
}: {
  label: string
  Icon: IconType
  isActive: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-current={isActive ? 'page' : undefined}
      title={collapsed ? label : undefined}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '10px 12px',
        marginBottom: 2,
        background: isActive
          ? 'var(--bg-tertiary)'
          : hover
          ? 'var(--bg-tertiary)'
          : 'transparent',
        color: 'var(--text-primary)',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: isActive ? 600 : 500,
        transition: 'var(--transition-fast)',
        justifyContent: collapsed ? 'center' : 'flex-start',
        opacity: isActive || hover ? 1 : 0.78,
      }}
    >
      <Icon size={16} />
      {!collapsed && <span>{label}</span>}
    </button>
  )
}

function StatusRow({
  label,
  connected,
  icon: Icon,
}: {
  label: string
  connected: boolean
  icon: IconType
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={12} />
      <span style={{ flex: 1 }}>{label}</span>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: connected ? 'var(--color-success)' : 'var(--color-gray-500)',
        }}
        aria-label={connected ? 'connected' : 'not connected'}
      />
    </div>
  )
}

function MobileBottomBar({
  active,
  onChange,
}: {
  active: Section
  onChange: (s: Section) => void
}) {
  return (
    <nav
      role="navigation"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        gap: 0,
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-primary)',
        padding: 4,
        zIndex: 50,
        overflowX: 'auto',
      }}
    >
      {NAV.map((item) => {
        const Icon = item.icon
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-current={isActive ? 'page' : undefined}
            style={{
              flex: '1 0 64px',
              minHeight: 56,
              padding: '6px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              border: 'none',
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: isActive ? 600 : 500,
              borderRadius: 6,
            }}
          >
            <Icon size={18} />
            <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
