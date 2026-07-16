import { SearchIcon, ContactIcon, CompanyIcon, DealsIcon } from './Icons'
import type { SearchResults } from '../types'

interface TopBarProps {
  searchQuery: string
  onSearch: (query: string) => void
  onSearchSubmit: () => void
  searchResults: SearchResults | null
  onResultClick: (view: 'contacts' | 'companies' | 'deals') => void
  onCloseResults: () => void
}

export function TopBar({ searchQuery, onSearch, onSearchSubmit, searchResults, onResultClick, onCloseResults }: TopBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchSubmit()
    } else if (e.key === 'Escape') {
      onCloseResults()
    }
  }

  const hasResults = searchResults && (
    searchResults.contacts.length > 0 || searchResults.companies.length > 0 || searchResults.deals.length > 0
  )

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

          {searchResults && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                maxHeight: 360,
                overflowY: 'auto',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.3))',
                zIndex: 20,
              }}
            >
              {!hasResults && (
                <div style={{ padding: '12px 14px', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                  No results for "{searchQuery}"
                </div>
              )}
              {searchResults.contacts.length > 0 && (
                <SearchResultGroup
                  label="Contacts"
                  icon={<ContactIcon size={13} />}
                  items={searchResults.contacts.map(c => ({ id: c.id, primary: `${c.firstName} ${c.lastName}`, secondary: c.companyName || c.email || '' }))}
                  onClick={() => onResultClick('contacts')}
                />
              )}
              {searchResults.companies.length > 0 && (
                <SearchResultGroup
                  label="Companies"
                  icon={<CompanyIcon size={13} />}
                  items={searchResults.companies.map(c => ({ id: c.id, primary: c.name, secondary: c.industry || '' }))}
                  onClick={() => onResultClick('companies')}
                />
              )}
              {searchResults.deals.length > 0 && (
                <SearchResultGroup
                  label="Deals"
                  icon={<DealsIcon size={13} />}
                  items={searchResults.deals.map(d => ({ id: d.id, primary: d.title, secondary: d.companyName || '' }))}
                  onClick={() => onResultClick('deals')}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right spacer */}
      <div style={{ flex: 1 }} />
    </header>
  )
}

interface SearchResultGroupProps {
  label: string
  icon: React.ReactNode
  items: { id: number; primary: string; secondary: string }[]
  onClick: () => void
}

function SearchResultGroup({ label, icon, items, onClick }: SearchResultGroupProps) {
  return (
    <div style={{ borderTop: '1px solid var(--border-primary)' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px 4px', fontSize: 11, fontWeight: 600,
          color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}
      >
        {icon} {label}
      </div>
      {items.map(item => (
        <button
          key={item.id}
          onClick={onClick}
          style={{
            display: 'flex', flexDirection: 'column', width: '100%', textAlign: 'left',
            padding: '6px 14px', background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
        >
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{item.primary}</span>
          {item.secondary && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.secondary}</span>
          )}
        </button>
      ))}
    </div>
  )
}
