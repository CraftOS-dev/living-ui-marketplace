import { useState, type ReactNode } from 'react'
import { Badge } from './ui'
import {
  DashboardIcon, ContactIcon, CompanyIcon, DealsIcon, ActivityIcon,
  CalendarIcon, MailIcon, MegaphoneIcon, FormIcon,
  ChartIcon, FolderIcon, SettingsIcon, ChevronLeftIcon, ChevronRightIcon,
} from './Icons'

interface NavItem {
  id: string
  label: string
  icon: ReactNode
  section?: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon />, section: 'main' },
  { id: 'contacts', label: 'Contacts', icon: <ContactIcon />, section: 'main' },
  { id: 'companies', label: 'Companies', icon: <CompanyIcon />, section: 'main' },
  { id: 'deals', label: 'Deals', icon: <DealsIcon />, section: 'main' },
  { id: 'activities', label: 'Activities', icon: <ActivityIcon />, section: 'main' },
  { id: 'calendar', label: 'Calendar', icon: <CalendarIcon />, section: 'main' },
  { id: 'templates', label: 'Templates', icon: <MailIcon />, section: 'marketing' },
  { id: 'campaigns', label: 'Campaigns', icon: <MegaphoneIcon />, section: 'marketing' },
  { id: 'forms', label: 'Forms', icon: <FormIcon />, section: 'marketing' },
  { id: 'reports', label: 'Reports', icon: <ChartIcon />, section: 'analytics' },
  { id: 'import-export', label: 'Import/Export', icon: <FolderIcon />, section: 'data' },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon />, section: 'system' },
]

interface SidebarProps {
  collapsed: boolean
  currentView: string
  onNavigate: (view: string) => void
  onToggle: () => void
  counts?: Record<string, number>
}

export function Sidebar({ collapsed, currentView, onNavigate, onToggle, counts = {} }: SidebarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const sidebarWidth = collapsed ? 60 : 240

  const sectionLabels: Record<string, string> = {
    main: 'CRM',
    marketing: 'Marketing',
    analytics: 'Analytics',
    data: 'Data',
    system: 'System',
  }

  let lastSection = ''

  return (
    <nav
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        height: '100vh',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 200ms ease, min-width 200ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Header / Logo area */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '16px 0' : '16px 16px',
          borderBottom: '1px solid var(--border-primary)',
          height: 56,
          minHeight: 56,
        }}
      >
        {!collapsed && (
          <span
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-bold)' as any,
              color: 'var(--color-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            CRM
          </span>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-md)',
            transition: 'var(--transition-fast)',
          }}
        >
          {collapsed ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
        </button>
      </div>

      {/* Navigation items */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
        }}
      >
        {navItems.map((item) => {
          const isActive = currentView === item.id
          const isHovered = hoveredItem === item.id
          const count = counts[item.id]
          const showSection = !collapsed && item.section && item.section !== lastSection
          if (item.section) lastSection = item.section

          return (
            <div key={item.id}>
              {showSection && (
                <div
                  style={{
                    padding: '12px 16px 4px',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--font-weight-semibold)' as any,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {sectionLabels[item.section!] || item.section}
                </div>
              )}
              <button
                onClick={() => onNavigate(item.id)}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() => setHoveredItem(null)}
                title={collapsed ? item.label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: collapsed ? '10px 0' : '10px 16px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: isActive
                    ? 'var(--color-primary-light)'
                    : isHovered
                    ? 'var(--bg-tertiary)'
                    : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                  border: 'none',
                  borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isActive ? ('var(--font-weight-medium)' as any) : ('var(--font-weight-normal)' as any),
                  fontFamily: 'var(--font-sans)',
                  transition: 'var(--transition-fast)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
                {!collapsed && (
                  <>
                    <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                    {count !== undefined && count > 0 && (
                      <Badge variant="default" size="sm">
                        {count}
                      </Badge>
                    )}
                  </>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {!collapsed && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-primary)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          CRM System v1.0
        </div>
      )}
    </nav>
  )
}
