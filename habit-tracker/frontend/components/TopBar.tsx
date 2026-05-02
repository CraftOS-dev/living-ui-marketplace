import { Plus, Search, Tag, Folder } from 'lucide-react'
import { Button } from './ui'
import type { Category } from '../types'
import { useViewport } from '../lib/hooks'

interface TopBarProps {
  search: string
  onSearch: (value: string) => void
  categories: Category[]
  categoryFilter: number | null
  onCategoryFilter: (id: number | null) => void
  onAddHabit: () => void
  onManageCategories: () => void
  searchInputRef?: React.RefObject<HTMLInputElement>
}

/**
 * Layout:
 *   - Desktop / tablet (DOM order, no `order` overrides):
 *       [ Title ]  [ Search ]  [ Chips … ]            [ Cats ] [ + Add ]
 *
 *   - Mobile (CSS `order` rearranges; chips wrap to a new row):
 *       [ Title ]                            [ Cats ] [ + Add ]
 *       [           Search                                  ]
 *       [ Chips … (horizontal scroll) … ]
 *
 * The DOM order matches the desktop layout exactly so desktop rendering is
 * unchanged. `order` is only set when isMobile.
 */
export function TopBar({
  search,
  onSearch,
  categories,
  categoryFilter,
  onCategoryFilter,
  onAddHabit,
  onManageCategories,
  searchInputRef,
}: TopBarProps) {
  const { isMobile } = useViewport()

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        gap: 14,
        rowGap: isMobile ? 8 : undefined,
        padding: isMobile ? '10px 12px' : '14px 20px',
        borderBottom: '1px solid var(--border-primary)',
        background: 'var(--bg-primary)',
        flexShrink: 0,
      }}
    >
      {/* Title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          flexShrink: 0,
          order: isMobile ? 0 : undefined,
        }}
      >
        <span
          style={{
            fontSize: isMobile ? 15 : 16,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
          }}
        >
          Habit Tracker
        </span>
        {!isMobile && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {todayLong()}
          </span>
        )}
      </div>

      {/* Search */}
      <div
        style={{
          position: 'relative',
          flex: isMobile ? '1 1 100%' : '0 1 280px',
          minWidth: isMobile ? 0 : 180,
          order: isMobile ? 2 : undefined,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: 9,
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Search size={13} />
        </span>
        <input
          ref={searchInputRef}
          type="search"
          placeholder={isMobile ? 'Search…' : 'Search habits…  (press / )'}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search habits"
          style={{
            width: '100%',
            height: isMobile ? 36 : 30,
            padding: '0 10px 0 28px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontSize: isMobile ? 14 : 13,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Category filter chips */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flex: isMobile ? '1 1 100%' : '1 1 auto',
          overflowX: 'auto',
          minWidth: 0,
          scrollbarWidth: 'none',
          order: isMobile ? 3 : undefined,
        }}
      >
        <FilterChip
          active={categoryFilter === null}
          onClick={() => onCategoryFilter(null)}
          color="var(--text-secondary)"
        >
          <Tag size={11} /> All
        </FilterChip>
        {categories.map((c) => (
          <FilterChip
            key={c.id}
            active={categoryFilter === c.id}
            onClick={() => onCategoryFilter(categoryFilter === c.id ? null : c.id)}
            color={c.color}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: c.color,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {c.name}
          </FilterChip>
        ))}
      </div>

      {/* Action buttons. On mobile they sit on the title row, right-aligned;
          on desktop they sit naturally at the end of the row. */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          flexShrink: 0,
          order: isMobile ? 1 : undefined,
          marginLeft: isMobile ? 'auto' : undefined,
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          icon={<Folder size={13} />}
          onClick={onManageCategories}
          aria-label="Manage categories"
          title="Manage categories"
        >
          {!isMobile && 'Categories'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={13} />}
          onClick={onAddHabit}
          aria-label="Add habit"
          title="Add habit"
        >
          {!isMobile && 'Add habit'}
        </Button>
      </div>
    </header>
  )
}

interface FilterChipProps {
  active: boolean
  onClick: () => void
  color: string
  children: React.ReactNode
}

function FilterChip({ active, onClick, color, children }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        height: 24,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: active ? mixWithBg(color, 0.18) : 'transparent',
        border: active ? `1px solid ${color}55` : '1px solid var(--border-primary)',
        color: active ? color : 'var(--text-secondary)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'background 120ms ease',
      }}
    >
      {children}
    </button>
  )
}

function mixWithBg(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const r = parseInt(full.slice(0, 2), 16) || 115
  const g = parseInt(full.slice(2, 4), 16) || 115
  const b = parseInt(full.slice(4, 6), 16) || 115
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function todayLong(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}
