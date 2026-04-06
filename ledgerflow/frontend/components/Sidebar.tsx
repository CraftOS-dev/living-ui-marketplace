import { useState } from 'react'
import type { ActiveView } from '../types'

interface SidebarProps {
  activeView: ActiveView
  onNavigate: (view: ActiveView) => void
  isOpen: boolean
  onClose: () => void
}

const navItems: { view: ActiveView; label: string }[] = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'transactions', label: 'Transactions' },
  { view: 'accounts', label: 'Accounts' },
  { view: 'invoices', label: 'Invoices' },
  { view: 'bills', label: 'Bills' },
  { view: 'contacts', label: 'Contacts' },
  { view: 'reports', label: 'Reports' },
  { view: 'settings', label: 'Settings' },
]

export function Sidebar({ activeView, onNavigate, isOpen, onClose }: SidebarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const handleNav = (view: ActiveView) => {
    onNavigate(view)
    onClose()
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--overlay-color)',
            zIndex: 49,
            display: 'none',
          }}
          className="sidebar-overlay"
        />
      )}
      <nav
        style={{
          width: 200,
          minWidth: 200,
          height: '100%',
          backgroundColor: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-primary)',
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--space-2) 0',
          overflowY: 'auto',
        }}
      >
        {navItems.map((item) => {
          const isActive = activeView === item.view || (item.view === 'accounts' && activeView === 'accountLedger')
          const isHovered = hoveredItem === item.view
          return (
            <button
              key={item.view}
              onClick={() => handleNav(item.view)}
              onMouseEnter={() => setHoveredItem(item.view)}
              onMouseLeave={() => setHoveredItem(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: 'var(--space-2) var(--space-4)',
                border: 'none',
                background: isActive
                  ? 'var(--color-primary-light)'
                  : isHovered
                  ? 'var(--bg-tertiary)'
                  : 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: isActive ? 'var(--font-weight-semibold)' as any : 'var(--font-weight-normal)' as any,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'var(--transition-fast)',
                borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
              }}
            >
              {item.label}
            </button>
          )
        })}
      </nav>
      <style>{`
        @media (max-width: 768px) {
          .sidebar-overlay { display: block !important; }
        }
      `}</style>
    </>
  )
}
