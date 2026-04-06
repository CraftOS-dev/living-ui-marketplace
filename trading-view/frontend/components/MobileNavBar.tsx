export type MobileTab = 'chart' | 'watchlist' | 'screener' | 'alerts'

interface MobileNavBarProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
}

const tabs: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'chart', label: 'Chart', icon: '\u{1F4C8}' },       // chart icon
  { id: 'watchlist', label: 'Watchlist', icon: '\u{2B50}' }, // star icon
  { id: 'screener', label: 'Screener', icon: '\u{1F50D}' }, // search icon
  { id: 'alerts', label: 'Alerts', icon: '\u{1F514}' },     // bell icon
]

const styles = {
  bar: {
    position: 'fixed' as const,
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 56,
    backgroundColor: 'var(--bg-primary)',
    borderTop: '1px solid var(--border-primary)',
    zIndex: 200,
  },
  tab: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flex: 1,
    height: '100%',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0,
  },
  icon: {
    fontSize: 18,
  },
  label: {
    fontSize: 10,
    fontWeight: 500,
  },
}

export function MobileNavBar({ activeTab, onTabChange }: MobileNavBarProps) {
  return (
    <div style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            style={styles.tab}
            onClick={() => onTabChange(tab.id)}
          >
            <span style={{ ...styles.icon, opacity: isActive ? 1 : 0.5 }}>
              {tab.icon}
            </span>
            <span
              style={{
                ...styles.label,
                color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
