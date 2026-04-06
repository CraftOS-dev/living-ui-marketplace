import { SearchIcon } from './Icons'

interface TopBarProps {
  searchQuery: string
  onSearch: (query: string) => void
  onSearchSubmit: () => void
}

export function TopBar({ searchQuery, onSearch, onSearchSubmit }: TopBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchSubmit()
    }
  }

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 56,
        minHeight: 56,
        padding: '0 24px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-primary)',
        gap: 16,
      }}
    >
      {/* Left spacer */}
      <div style={{ flex: 1 }} />

      {/* Center: Search */}
      <div style={{ flex: 2, maxWidth: 480 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              color: 'var(--text-muted)',
              fontSize: 14,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <SearchIcon size={14} />
          </span>
          <input
            type="text"
            placeholder="Search contacts, companies, deals..."
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              height: 'var(--input-height-md)',
              padding: '0 12px 0 36px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-sm)',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-full)',
              outline: 'none',
              transition: 'var(--transition-base)',
            }}
          />
        </div>
      </div>

      {/* Right spacer */}
      <div style={{ flex: 1 }} />
    </header>
  )
}
