import { useEffect, useMemo, useState } from 'react'
import {
  FiCalendar,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiEdit3,
  FiX,
} from 'react-icons/fi'
import { Button, EmptyState } from '../ui'
import { useAgentAware } from '../../agent/hooks'
import { useViewport } from '../../hooks/useViewport'
import type { AppController } from '../../AppController'
import type { Campaign } from '../../types'

interface ScheduleProps {
  controller: AppController
  campaigns: Campaign[]
  onEdit: (id: number) => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ----- date helpers -------------------------------------------------------

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}
function startOfWeekSun(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}
function isToday(d: Date): boolean {
  const now = new Date()
  return d.toDateString() === now.toDateString()
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// =========================================================================

export function Schedule({ controller, campaigns, onEdit }: ScheduleProps) {
  const viewport = useViewport()
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)

  useEffect(() => {
    controller.refreshCampaigns()
  }, [controller])

  const scheduled = useMemo(
    () =>
      campaigns
        .filter((c) => c.status === 'scheduled' && c.scheduledAt)
        .sort(
          (a, b) =>
            new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime(),
        ),
    [campaigns],
  )

  const byDay = useMemo(() => {
    const m = new Map<string, Campaign[]>()
    for (const c of scheduled) {
      if (!c.scheduledAt) continue
      const key = dateKey(new Date(c.scheduledAt))
      const list = m.get(key) || []
      list.push(c)
      m.set(key, list)
    }
    return m
  }, [scheduled])

  useAgentAware('Schedule', {
    count: scheduled.length,
    visibleMonth: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
    selectedDay: selectedDayKey,
  })

  const gridStart = startOfWeekSun(startOfMonth(cursor))
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  const inMonthCount = scheduled.filter((c) => {
    const d = new Date(c.scheduledAt!)
    return isSameMonth(d, cursor)
  }).length

  const isMobile = viewport.size === 'mobile'

  // Agenda list: filtered by the selected day if any, otherwise the full
  // forward-looking list. Past-month days you can still click to inspect.
  const agendaItems = useMemo(() => {
    if (selectedDayKey) return byDay.get(selectedDayKey) || []
    return scheduled
  }, [selectedDayKey, byDay, scheduled])

  const selectedDayLabel = selectedDayKey
    ? new Date(selectedDayKey + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Schedule</h1>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          A month-at-a-glance view, with the full agenda on the right.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 'var(--space-5)',
          gridTemplateColumns: isMobile
            ? 'minmax(0, 1fr)'
            : 'minmax(440px, 1.1fr) minmax(320px, 1fr)',
          alignItems: 'flex-start',
        }}
      >
        {/* Calendar pane (compact) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <CalendarHeader
            cursor={cursor}
            setCursor={(d) => {
              setCursor(d)
              setSelectedDayKey(null)
            }}
            inMonthCount={inMonthCount}
            totalCount={scheduled.length}
          />
          <CompactCalendar
            cells={cells}
            cursor={cursor}
            byDay={byDay}
            selectedDayKey={selectedDayKey}
            onPickDay={(d) => {
              const key = dateKey(d)
              setSelectedDayKey((cur) => (cur === key ? null : key))
            }}
          />
        </div>

        {/* Agenda list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <AgendaHeader
            selectedDayLabel={selectedDayLabel}
            count={agendaItems.length}
            onClearFilter={() => setSelectedDayKey(null)}
          />
          {agendaItems.length === 0 ? (
            <div
              style={{
                border: '1px dashed var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-5)',
              }}
            >
              <EmptyState
                icon={<FiCalendar />}
                title={selectedDayKey ? 'No sends on this day' : 'Nothing scheduled'}
                message={
                  selectedDayKey
                    ? 'Pick another day, or clear the filter to see all upcoming sends.'
                    : 'Open any draft campaign and pick a send time to schedule it.'
                }
              />
            </div>
          ) : (
            <AgendaList
              items={agendaItems}
              groupByDate={!selectedDayKey}
              onEdit={onEdit}
              onCancel={async (id, name) => {
                if (window.confirm(`Cancel "${name}"?`)) {
                  await controller.cancelCampaign(id)
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// =========================================================================

function CalendarHeader({
  cursor,
  setCursor,
  inMonthCount,
  totalCount,
}: {
  cursor: Date
  setCursor: (d: Date) => void
  inMonthCount: number
  totalCount: number
}) {
  const now = new Date()
  const isCurrentMonth = isSameMonth(cursor, now)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <Button
          size="sm"
          variant="ghost"
          icon={<FiChevronLeft size={14} />}
          onClick={() => setCursor(addMonths(cursor, -1))}
          aria-label="Previous month"
        >
          {''}
        </Button>
        <div
          style={{
            flex: 1,
            fontSize: 'var(--font-size-base)',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<FiChevronRight size={14} />}
          onClick={() => setCursor(addMonths(cursor, 1))}
          aria-label="Next month"
        >
          {''}
        </Button>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-secondary)',
        }}
      >
        <Button
          size="sm"
          variant="secondary"
          disabled={isCurrentMonth}
          onClick={() => setCursor(startOfMonth(new Date()))}
        >
          Today
        </Button>
        <span style={{ flex: 1 }} />
        <span>
          {inMonthCount} this month · {totalCount} total
        </span>
      </div>
    </div>
  )
}

// =========================================================================

function CompactCalendar({
  cells,
  cursor,
  byDay,
  selectedDayKey,
  onPickDay,
}: {
  cells: Date[]
  cursor: Date
  byDay: Map<string, Campaign[]>
  selectedDayKey: string | null
  onPickDay: (d: Date) => void
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
      }}
    >
      {/* Weekday header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            style={{
              padding: '10px 4px',
              fontSize: 'var(--font-size-xs)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}
          >
            {w}
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridAutoRows: '72px',
        }}
      >
        {cells.map((d, idx) => {
          const key = dateKey(d)
          const items = byDay.get(key) || []
          const inMonth = isSameMonth(d, cursor)
          const today = isToday(d)
          const selected = selectedDayKey === key
          const hasItems = items.length > 0
          const rightEdge = (idx + 1) % 7 === 0
          const bottomEdge = idx >= 35

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onPickDay(d)}
              aria-pressed={selected}
              aria-label={`${d.toDateString()}${hasItems ? `, ${items.length} scheduled` : ''}`}
              style={{
                position: 'relative',
                padding: 0,
                borderRight: rightEdge ? 'none' : '1px solid var(--border-primary)',
                borderBottom: bottomEdge ? 'none' : '1px solid var(--border-primary)',
                borderTop: 'none',
                borderLeft: 'none',
                background: selected
                  ? 'var(--bg-tertiary)'
                  : inMonth
                  ? 'transparent'
                  : 'var(--bg-tertiary)',
                opacity: inMonth ? 1 : 0.5,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                minWidth: 0,
                outline: selected ? '2px solid var(--text-primary)' : 'none',
                outlineOffset: -2,
                fontFamily: 'inherit',
                transition: 'var(--transition-fast)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: today ? 28 : 'auto',
                  height: today ? 28 : 'auto',
                  borderRadius: today ? '50%' : 0,
                  background: today ? 'var(--text-primary)' : 'transparent',
                  color: today
                    ? 'var(--bg-primary)'
                    : inMonth
                    ? 'var(--text-primary)'
                    : 'var(--text-muted)',
                  fontSize: 'var(--font-size-base)',
                  fontWeight: today || inMonth ? 700 : 500,
                }}
              >
                {d.getDate()}
              </span>
              {hasItems && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    height: 8,
                  }}
                >
                  {items.slice(0, 3).map((c) => (
                    <span
                      key={c.id}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--color-primary)',
                      }}
                      aria-hidden
                    />
                  ))}
                  {items.length > 3 && (
                    <span
                      style={{
                        fontSize: 10,
                        lineHeight: 1,
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                      }}
                    >
                      +{items.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// =========================================================================

function AgendaHeader({
  selectedDayLabel,
  count,
  onClearFilter,
}: {
  selectedDayLabel: string | null
  count: number
  onClearFilter: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 'var(--font-size-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        {selectedDayLabel || 'All upcoming'}
      </h2>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
        {count} {count === 1 ? 'campaign' : 'campaigns'}
      </span>
      <span style={{ flex: 1 }} />
      {selectedDayLabel && (
        <Button size="sm" variant="ghost" onClick={onClearFilter}>
          Show all
        </Button>
      )}
    </div>
  )
}

// =========================================================================

function AgendaList({
  items,
  groupByDate,
  onEdit,
  onCancel,
}: {
  items: Campaign[]
  groupByDate: boolean
  onEdit: (id: number) => void
  onCancel: (id: number, name: string) => void | Promise<void>
}) {
  // Group by ISO date when groupByDate is true; otherwise render as a flat list.
  const groups = useMemo(() => {
    if (!groupByDate) return [{ key: '_', items }]
    const m = new Map<string, Campaign[]>()
    for (const c of items) {
      if (!c.scheduledAt) continue
      const key = dateKey(new Date(c.scheduledAt))
      const list = m.get(key) || []
      list.push(c)
      m.set(key, list)
    }
    return Array.from(m.entries()).map(([key, list]) => ({ key, items: list }))
  }, [items, groupByDate])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {groups.map((g) => (
        <div key={g.key}>
          {groupByDate && (
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 8,
              }}
            >
              {fmtDay(g.items[0].scheduledAt!)}
            </div>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.items.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                  gap: 'var(--space-3)',
                  alignItems: 'center',
                  padding: '12px',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-secondary)',
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <FiClock size={14} />
                  {fmtTime(c.scheduledAt!)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 'var(--font-size-sm)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.name}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.subject || 'No subject'} · {c.totalRecipients.toLocaleString()} recipients
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<FiEdit3 size={12} />}
                    onClick={() => onEdit(c.id)}
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<FiX size={12} />}
                    onClick={() => onCancel(c.id, c.name)}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
