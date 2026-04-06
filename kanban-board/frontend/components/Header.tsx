import { useState, useRef, useEffect } from 'react'
import type { Board, SearchParams } from '../types'
import { Button } from './ui'

interface HeaderProps {
  boards: Board[]
  currentBoard: Board | null
  searchParams: SearchParams
  onSwitchBoard: (boardId: number) => void
  onCreateBoard: (name: string) => void
  onDeleteBoard: (boardId: number) => void
  onRenameBoard: (boardId: number, name: string) => void
  onSearch: (params: SearchParams) => void
  onToggleSidebar: () => void
}

export function Header({
  boards, currentBoard, searchParams, onSwitchBoard, onCreateBoard,
  onDeleteBoard, onRenameBoard, onSearch, onToggleSidebar,
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [editingBoardId, setEditingBoardId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [searchText, setSearchText] = useState(searchParams.q || '')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSearchChange = (val: string) => {
    setSearchText(val)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      onSearch({ ...searchParams, q: val || undefined })
    }, 300)
  }

  const clearSearch = () => {
    setSearchText('')
    onSearch({})
  }

  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-primary)',
      minHeight: 48, flexShrink: 0,
    }}>
      <Button variant="ghost" size="sm" onClick={onToggleSidebar} icon={
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect y="2" width="16" height="2" rx="1" />
          <rect y="7" width="16" height="2" rx="1" />
          <rect y="12" width="16" height="2" rx="1" />
        </svg>
      }>Menu</Button>

      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-3)',
            color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--font-size-base)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            minWidth: 120,
          }}
        >
          {currentBoard?.name || 'Select Board'}
          <span style={{ fontSize: 10, opacity: 0.6 }}>&#9660;</span>
        </button>
        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)', minWidth: 220, zIndex: 'var(--z-dropdown)' as unknown as number,
            boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
          }}>
            {boards.map(b => (
              <div key={b.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 'var(--space-2) var(--space-3)',
                background: b.id === currentBoard?.id ? 'var(--bg-tertiary)' : 'transparent',
                cursor: 'pointer',
              }}>
                {editingBoardId === b.id ? (
                  <form onSubmit={e => {
                    e.preventDefault()
                    onRenameBoard(b.id, editName)
                    setEditingBoardId(null)
                  }} style={{ display: 'flex', flex: 1, gap: 4 }}>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                      style={{
                        flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                        borderRadius: 'var(--radius-sm)', padding: '2px 6px', color: 'var(--text-primary)',
                        fontSize: 'var(--font-size-sm)',
                      }}
                      onBlur={() => setEditingBoardId(null)}
                    />
                  </form>
                ) : (
                  <>
                    <span
                      onClick={() => { onSwitchBoard(b.id); setDropdownOpen(false) }}
                      style={{ flex: 1, color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}
                    >{b.name}</span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onClick={e => { e.stopPropagation(); setEditingBoardId(b.id); setEditName(b.name) }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 2, fontSize: 12 }}>
                        &#9998;
                      </button>
                      {boards.length > 1 && (
                        <button onClick={e => { e.stopPropagation(); onDeleteBoard(b.id); setDropdownOpen(false) }}
                          style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', padding: 2, fontSize: 12 }}>
                          &#10005;
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border-primary)', padding: 'var(--space-2) var(--space-3)' }}>
              <form onSubmit={e => { e.preventDefault(); if (newBoardName.trim()) { onCreateBoard(newBoardName.trim()); setNewBoardName(''); setDropdownOpen(false) } }}
                style={{ display: 'flex', gap: 4 }}>
                <input
                  value={newBoardName}
                  onChange={e => setNewBoardName(e.target.value)}
                  placeholder="New board..."
                  style={{
                    flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                    borderRadius: 'var(--radius-sm)', padding: '4px 8px', color: 'var(--text-primary)',
                    fontSize: 'var(--font-size-sm)',
                  }}
                />
                <Button variant="primary" size="sm" type="submit">+</Button>
              </form>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', maxWidth: 280 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            value={searchText}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search cards..."
            style={{
              width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-3)',
              color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)', outline: 'none',
            }}
          />
          {searchText && (
            <button onClick={clearSearch} style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14,
            }}>&#10005;</button>
          )}
        </div>
      </div>
    </header>
  )
}
