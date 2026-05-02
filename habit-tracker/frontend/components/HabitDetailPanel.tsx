import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { X, Pencil, Flame, Trophy, Percent, CheckCheck, CalendarPlus } from 'lucide-react'
import type { Habit, HabitStats, HeatmapCell, HeatmapData } from '../types'
import type { AppController } from '../AppController'
import { Button } from './ui'
import { getIcon } from '../lib/icons'
import { tintColor, formatLong, todayIso } from '../lib/dates'
import { useViewport } from '../lib/hooks'
import { FullHeatmap } from './FullHeatmap'
import { TrendChart } from './TrendChart'

interface HabitDetailPanelProps {
  habit: Habit | null
  controller: AppController
  onClose: () => void
  onEdit: (habit: Habit) => void
}

export function HabitDetailPanel({ habit, controller, onClose, onEdit }: HabitDetailPanelProps) {
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null)
  const [stats, setStats] = useState<HabitStats | null>(null)
  const [loadingMap, setLoadingMap] = useState(false)
  const [activeCell, setActiveCell] = useState<HeatmapCell | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const { isMobile } = useViewport()

  useEffect(() => {
    if (!habit) {
      setHeatmap(null)
      setStats(null)
      setActiveCell(null)
      return
    }
    let mounted = true
    setLoadingMap(true)
    Promise.all([
      controller.getHeatmap(habit.id, 365),
      controller.getHabitDetail(habit.id),
    ])
      .then(([map, detail]) => {
        if (!mounted) return
        setHeatmap(map)
        setStats({
          currentStreak: detail.currentStreak ?? 0,
          bestStreak: detail.bestStreak ?? 0,
          completionRate: detail.completionRate ?? 0,
          trend: detail.trend ?? [],
          totalCompletions: detail.totalCompletions ?? 0,
        })
        setLoadingMap(false)
        // Default the active cell to today.
        const today = map.cells[map.cells.length - 1]
        setActiveCell(today)
        setNoteDraft(today?.note || '')
      })
      .catch(() => {
        if (mounted) {
          setLoadingMap(false)
          toast.error('Failed to load habit detail')
        }
      })
    return () => {
      mounted = false
    }
  }, [habit?.id, controller, habit])

  if (!habit) return null

  const Icon = getIcon(habit.icon)

  const onCellClick = async (cell: HeatmapCell) => {
    setActiveCell(cell)
    setNoteDraft(cell.note || '')
  }

  const onToggleCell = async () => {
    if (!activeCell) return
    try {
      const nextValue =
        activeCell.completed
          ? 0
          : habit.type === 'binary' || habit.type === 'negative'
            ? 1
            : habit.target ?? 1
      await controller.upsertEntry(habit.id, activeCell.date, { value: nextValue })
      const fresh = await controller.getHeatmap(habit.id, 365)
      setHeatmap(fresh)
      const updated = fresh.cells.find((c) => c.date === activeCell.date) || null
      setActiveCell(updated)
      setNoteDraft(updated?.note || '')
      const detail = await controller.getHabitDetail(habit.id)
      setStats({
        currentStreak: detail.currentStreak ?? 0,
        bestStreak: detail.bestStreak ?? 0,
        completionRate: detail.completionRate ?? 0,
        trend: detail.trend ?? [],
        totalCompletions: detail.totalCompletions ?? 0,
      })
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update entry')
    }
  }

  const onSetCellValue = async (raw: string) => {
    if (!activeCell) return
    const v = Number(raw)
    if (Number.isNaN(v) || v < 0) return
    try {
      await controller.upsertEntry(habit.id, activeCell.date, { value: v })
      const fresh = await controller.getHeatmap(habit.id, 365)
      setHeatmap(fresh)
      const updated = fresh.cells.find((c) => c.date === activeCell.date) || null
      setActiveCell(updated)
      const detail = await controller.getHabitDetail(habit.id)
      setStats({
        currentStreak: detail.currentStreak ?? 0,
        bestStreak: detail.bestStreak ?? 0,
        completionRate: detail.completionRate ?? 0,
        trend: detail.trend ?? [],
        totalCompletions: detail.totalCompletions ?? 0,
      })
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update entry')
    }
  }

  const onSaveNote = async () => {
    if (!activeCell) return
    try {
      await controller.upsertEntry(habit.id, activeCell.date, {
        value: activeCell.value,
        note: noteDraft,
      })
      toast.success('Note saved')
      const fresh = await controller.getHeatmap(habit.id, 365)
      setHeatmap(fresh)
      const updated = fresh.cells.find((c) => c.date === activeCell.date) || null
      setActiveCell(updated)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save note')
    }
  }

  return (
    <aside
      role="complementary"
      aria-label={`${habit.name} details`}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        background: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: 16,
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: tintColor(habit.color, 0.18),
            color: habit.color,
            flexShrink: 0,
          }}
        >
          <Icon size={20} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {habit.name}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {habit.type}
            {habit.target ? ` • target ${habit.target} ${habit.unit ?? ''}` : ''}
            {habit.category ? ` • ${habit.category.name}` : ''}
          </span>
        </div>
        <Button variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={() => onEdit(habit)}>
          Edit
        </Button>
        <button
          aria-label="Close"
          onClick={onClose}
          style={{
            width: isMobile ? 36 : 28,
            height: isMobile ? 36 : 28,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={isMobile ? 20 : 16} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Stats row — 2 cols on very narrow mobile, 4 cols otherwise */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: 6,
          }}
        >
          <StatTile
            icon={<Flame size={13} />}
            label="Current"
            value={`${stats?.currentStreak ?? 0}d`}
            color={habit.color}
          />
          <StatTile
            icon={<Trophy size={13} />}
            label="Best"
            value={`${stats?.bestStreak ?? 0}d`}
            color={habit.color}
          />
          <StatTile
            icon={<Percent size={13} />}
            label="30-day rate"
            value={`${Math.round((stats?.completionRate ?? 0) * 100)}%`}
            color={habit.color}
          />
          <StatTile
            icon={<CheckCheck size={13} />}
            label="Total"
            value={String(stats?.totalCompletions ?? 0)}
            color={habit.color}
          />
        </div>

        {/* Heatmap */}
        <Section title="Last 365 days">
          {heatmap && !loadingMap ? (
            <FullHeatmap
              cells={heatmap.cells}
              color={habit.color}
              onCellClick={onCellClick}
              cellSize={11}
            />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
          )}
        </Section>

        {/* Active day editor */}
        {activeCell && (
          <Section
            title={`Edit ${formatLong(activeCell.date)}`}
            badge={
              activeCell.date === todayIso() ? (
                <span style={{ fontSize: 10, color: habit.color }}>Today</span>
              ) : null
            }
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 10,
                borderRadius: 6,
                background: 'var(--bg-secondary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {habit.type === 'binary' || habit.type === 'negative' ? (
                  <Button
                    onClick={onToggleCell}
                    variant={activeCell.completed ? 'secondary' : 'primary'}
                    icon={<CalendarPlus size={13} />}
                  >
                    {activeCell.completed ? 'Mark not done' : 'Mark done'}
                  </Button>
                ) : (
                  <input
                    type="number"
                    value={activeCell.value}
                    min={0}
                    onChange={(e) => onSetCellValue(e.target.value)}
                    style={{
                      width: 100,
                      height: 28,
                      padding: '0 8px',
                      borderRadius: 4,
                      border: '1px solid var(--border-primary)',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                  />
                )}
                {habit.target && (habit.type === 'count' || habit.type === 'duration') && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    target {habit.target} {habit.unit ?? ''}
                  </span>
                )}
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    color: activeCell.completed ? habit.color : 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  {activeCell.completed ? 'completed' : activeCell.value > 0 ? 'partial' : '—'}
                </span>
              </div>
              <textarea
                placeholder="Note for this day (optional)"
                rows={2}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                style={{
                  width: '100%',
                  padding: 8,
                  borderRadius: 4,
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="ghost" size="sm" onClick={onSaveNote}>
                  Save note
                </Button>
              </div>
            </div>
          </Section>
        )}

        {/* Trend */}
        <Section title="30-day trend">
          {stats ? (
            <TrendChart points={stats.trend ?? []} color={habit.color} />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
          )}
        </Section>

        {habit.description && (
          <Section title="Notes">
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {habit.description}
            </p>
          </Section>
        )}
      </div>
    </aside>
  )
}

function Section({
  title,
  badge,
  children,
}: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            fontWeight: 600,
          }}
        >
          {title}
        </span>
        {badge}
      </div>
      {children}
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 10px',
        background: 'var(--bg-secondary)',
        borderRadius: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ color }}>{icon}</span>
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}
