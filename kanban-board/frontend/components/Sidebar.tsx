import { useState } from 'react'
import type { AppController } from '../AppController'
import type { Board, BoardStats, Priority, SearchParams } from '../types'
import { Button } from './ui'
import { toast } from 'react-toastify'
import { MemberList } from './auth/MemberList'
import { InviteModal } from './auth/InviteModal'

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: '#22C55E' },
  { value: 'medium', label: 'Medium', color: '#EAB308' },
  { value: 'high', label: 'High', color: '#FF4F18' },
  { value: 'urgent', label: 'Urgent', color: '#EF4444' },
]

const LABEL_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280']

interface SidebarProps {
  controller: AppController
  board: Board
  stats: BoardStats | null
  searchParams: SearchParams
  onSearch: (params: SearchParams) => void
  onRefresh: () => void
  onClose: () => void
}

export function Sidebar({ controller, board, stats, searchParams, onSearch, onRefresh, onClose }: SidebarProps) {
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0])
  const [activeTab, setActiveTab] = useState<'filters' | 'labels' | 'stats' | 'members'>('filters')
  const [showInvite, setShowInvite] = useState(false)

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return
    try {
      await controller.createLabel(board.id, newLabelName.trim(), newLabelColor)
      setNewLabelName('')
      onRefresh()
      toast.success('Label created')
    } catch {
      toast.error('Failed to create label')
    }
  }

  const handleDeleteLabel = async (labelId: number) => {
    try {
      await controller.deleteLabel(labelId)
      onRefresh()
      toast.success('Label deleted')
    } catch {
      toast.error('Failed to delete label')
    }
  }

  const clearFilters = () => {
    onSearch({})
  }

  const hasActiveFilters = searchParams.priority || searchParams.label_id || searchParams.due_status

  const tabs = [
    { key: 'filters' as const, label: 'Filters' },
    { key: 'labels' as const, label: 'Labels' },
    { key: 'stats' as const, label: 'Stats' },
    { key: 'members' as const, label: 'Members' },
  ]

  return (
    <div style={{
      width: 260, flexShrink: 0, background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border-primary)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-3)', borderBottom: '1px solid var(--border-primary)',
      }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
          {board.name}
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--text-secondary)',
          cursor: 'pointer', fontSize: 16,
        }}>&#10005;</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)' }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: 'var(--space-2)', background: 'none', border: 'none',
            borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 'var(--font-size-xs)', fontWeight: 600,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)' }}>
        {/* Filters Tab */}
        {activeTab === 'filters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} fullWidth>Clear Filters</Button>
            )}

            {/* Priority filter */}
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>Priority</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {PRIORITY_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => {
                    onSearch({ ...searchParams, priority: searchParams.priority === opt.value ? undefined : opt.value })
                  }} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)',
                    border: searchParams.priority === opt.value ? `1px solid ${opt.color}` : '1px solid transparent',
                    background: searchParams.priority === opt.value ? `${opt.color}15` : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: opt.color }} />
                    <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)' }}>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Due date filter */}
            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>Due Date</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {[
                  { value: 'overdue' as const, label: 'Overdue', color: '#EF4444' },
                  { value: 'upcoming' as const, label: 'Due Soon', color: '#EAB308' },
                  { value: 'no_date' as const, label: 'No Date', color: 'var(--text-secondary)' },
                ].map(opt => (
                  <button key={opt.value} onClick={() => {
                    onSearch({ ...searchParams, due_status: searchParams.due_status === opt.value ? undefined : opt.value })
                  }} style={{
                    padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)',
                    border: searchParams.due_status === opt.value ? `1px solid ${opt.color}` : '1px solid transparent',
                    background: searchParams.due_status === opt.value ? `${opt.color}15` : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                    color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)',
                  }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Label filter */}
            {board.labels.length > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>Label</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  {board.labels.map(label => (
                    <button key={label.id} onClick={() => {
                      onSearch({ ...searchParams, label_id: searchParams.label_id === label.id ? undefined : label.id })
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                      padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)',
                      border: searchParams.label_id === label.id ? '1px solid var(--color-primary)' : '1px solid transparent',
                      background: searchParams.label_id === label.id ? 'var(--color-primary-alpha, rgba(255,79,24,0.1))' : 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: label.color }} />
                      <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)' }}>{label.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Labels Tab */}
        {activeTab === 'labels' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {board.labels.map(label => (
                <div key={label.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)',
                }}>
                  <span style={{ width: 20, height: 20, borderRadius: 4, background: label.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>{label.name}</span>
                  <button onClick={() => handleDeleteLabel(label.id)} style={{
                    background: 'none', border: 'none', color: 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 12, opacity: 0.5,
                  }}
                    onMouseOver={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-error)' }}
                    onMouseOut={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-secondary)' }}
                  >&#10005;</button>
                </div>
              ))}
              {board.labels.length === 0 && (
                <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>No labels yet</span>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--space-3)' }}>
              <input
                value={newLabelName}
                onChange={e => setNewLabelName(e.target.value)}
                placeholder="Label name..."
                onKeyDown={e => { if (e.key === 'Enter') handleCreateLabel() }}
                style={{
                  width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-2)',
                  color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
                  marginBottom: 'var(--space-2)', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                {LABEL_COLORS.map(c => (
                  <button key={c} onClick={() => setNewLabelColor(c)} style={{
                    width: 24, height: 24, borderRadius: 4, background: c, border: 'none',
                    cursor: 'pointer', outline: newLabelColor === c ? '2px solid var(--text-primary)' : 'none',
                    outlineOffset: 2,
                  }} />
                ))}
              </div>
              <Button variant="primary" size="sm" onClick={handleCreateLabel} fullWidth>Create Label</Button>
            </div>
          </div>
        )}

        {/* Members Tab */}
        {activeTab === 'members' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Button variant="primary" size="sm" onClick={() => setShowInvite(true)} fullWidth>
              Invite / Join
            </Button>
            <MemberList resourceType="board" resourceId={board.id} />
            <InviteModal
              resourceType="board"
              resourceId={board.id}
              isOpen={showInvite}
              onClose={() => setShowInvite(false)}
            />
          </div>
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && stats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{
              background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)', border: '1px solid var(--border-primary)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-primary)' }}>
                {stats.totalCards}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Total Cards</div>
            </div>

            {stats.overdueCount > 0 && (
              <div style={{
                background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-3)', border: '1px solid rgba(239,68,68,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: '#EF4444', fontWeight: 600 }}>Overdue</span>
                <span style={{ fontSize: 'var(--font-size-base)', color: '#EF4444', fontWeight: 700 }}>{stats.overdueCount}</span>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>Cards per List</label>
              {stats.cardsByList.map(item => (
                <div key={item.listId} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 'var(--space-1) 0',
                }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)' }}>{item.title}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>{item.count}</span>
                </div>
              ))}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>By Priority</label>
              {Object.entries(stats.cardsByPriority).filter(([_, v]) => v > 0).map(([p, count]) => (
                <div key={p} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 'var(--space-1) 0',
                }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)', textTransform: 'capitalize' }}>{p}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>

            {stats.totalChecklistItems > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontWeight: 600 }}>Checklist Progress</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.round((stats.completedChecklistItems / stats.totalChecklistItems) * 100)}%`,
                      background: '#22C55E', borderRadius: 3,
                    }} />
                  </div>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                    {stats.completedChecklistItems}/{stats.totalChecklistItems}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
