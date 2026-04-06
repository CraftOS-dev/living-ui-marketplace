import { useState, useEffect, useCallback } from 'react'
import { Button, Card, Badge } from '../ui'
import type { AppController } from '../../AppController'
import type { AppState, Activity } from '../../types'

interface CalendarPageProps {
  controller: AppController
  state: AppState
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const typeColor: Record<string, string> = {
  call: 'var(--color-info)',
  email: 'var(--color-primary)',
  meeting: 'var(--color-warning)',
  task: 'var(--color-success)',
}

const typeBadgeVariant: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'default'> = {
  call: 'info',
  email: 'primary',
  meeting: 'warning',
  task: 'success',
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = []

  // Previous month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    cells.push({ day: d, month: month - 1, year: month === 0 ? year - 1 : year, isCurrentMonth: false })
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month, year, isCurrentMonth: true })
  }

  // Next month padding
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, month: month + 1, year: month === 11 ? year + 1 : year, isCurrentMonth: false })
  }

  return cells
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function CalendarPage({ controller }: CalendarPageProps) {
  const now = new Date()
  const [currentYear, setCurrentYear] = useState(now.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(now.getMonth())
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadActivities = useCallback(async () => {
    setLoading(true)
    try {
      const result = await controller.fetchActivities({ perPage: 500 })
      setActivities(result.items || [])
    } catch {
      showToast('Failed to load activities')
    } finally {
      setLoading(false)
    }
  }, [controller, showToast])

  useEffect(() => {
    loadActivities()
  }, [loadActivities])

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(currentMonth - 1)
    }
  }

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentMonth(currentMonth + 1)
    }
  }

  // Build activities by date
  const activityByDate: Record<string, Activity[]> = {}
  for (const a of activities) {
    if (!a.dueDate) continue
    const d = new Date(a.dueDate)
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
    if (!activityByDate[key]) activityByDate[key] = []
    activityByDate[key].push(a)
  }

  const cells = getMonthDays(currentYear, currentMonth)
  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate())

  const monthLabel = new Date(currentYear, currentMonth).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  })

  const selectedActivities = selectedDate ? activityByDate[selectedDate] || [] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 9999,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
          }}
        >
          {toast}
        </div>
      )}

      <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' as any }}>
        Calendar
      </h1>

      <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
        {/* Calendar Grid */}
        <Card style={{ flex: 1 }}>
          {/* Month Navigation */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-4)',
            }}
          >
            <Button variant="ghost" size="sm" onClick={prevMonth}>
              &larr; Prev
            </Button>
            <h2
              style={{
                margin: 0,
                fontSize: 'var(--font-size-lg)',
                fontWeight: 'var(--font-weight-semibold)' as any,
              }}
            >
              {monthLabel}
            </h2>
            <Button variant="ghost" size="sm" onClick={nextMonth}>
              Next &rarr;
            </Button>
          </div>

          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading...
            </div>
          ) : (
            <>
              {/* Day Headers */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)',
                  gap: 1,
                  marginBottom: 'var(--space-1)',
                }}
              >
                {DAYS_OF_WEEK.map((d) => (
                  <div
                    key={d}
                    style={{
                      textAlign: 'center',
                      fontSize: 'var(--font-size-xs)',
                      fontWeight: 'var(--font-weight-semibold)' as any,
                      color: 'var(--text-secondary)',
                      padding: 'var(--space-2)',
                    }}
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Day Cells */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)',
                  gap: 1,
                }}
              >
                {cells.map((cell, i) => {
                  const key = dateKey(cell.year, cell.month, cell.day)
                  const dayActivities = activityByDate[key] || []
                  const isToday = key === todayKey
                  const isSelected = key === selectedDate

                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedDate(key)}
                      style={{
                        minHeight: 80,
                        padding: 'var(--space-1)',
                        cursor: 'pointer',
                        backgroundColor: isSelected
                          ? 'var(--color-primary-light)'
                          : 'transparent',
                        border: isToday
                          ? '2px solid var(--color-primary)'
                          : '1px solid var(--border-primary)',
                        borderRadius: 'var(--radius-sm)',
                        opacity: cell.isCurrentMonth ? 1 : 0.4,
                        transition: 'var(--transition-fast)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: isToday ? ('var(--font-weight-bold)' as any) : 'normal',
                          color: isToday ? 'var(--color-primary)' : 'var(--text-primary)',
                          marginBottom: 'var(--space-1)',
                        }}
                      >
                        {cell.day}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        {dayActivities.slice(0, 3).map((a) => (
                          <span
                            key={a.id}
                            title={`${a.activityType}: ${a.subject}`}
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              backgroundColor: typeColor[a.activityType] || 'var(--text-secondary)',
                            }}
                          />
                        ))}
                        {dayActivities.length > 3 && (
                          <span
                            style={{
                              fontSize: '9px',
                              color: 'var(--text-secondary)',
                              lineHeight: '8px',
                            }}
                          >
                            +{dayActivities.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-4)',
                  marginTop: 'var(--space-3)',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-secondary)',
                }}
              >
                {Object.entries(typeColor).map(([type, color]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
                    {type}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Side Panel */}
        <div style={{ width: 300, flexShrink: 0 }}>
          <Card>
            <h3
              style={{
                margin: 0,
                marginBottom: 'var(--space-3)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 'var(--font-weight-semibold)' as any,
              }}
            >
              {selectedDate
                ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('default', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })
                : 'Select a day'}
            </h3>

            {!selectedDate ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                Click on a day to see its activities.
              </p>
            ) : selectedActivities.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
                No activities on this day.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {selectedActivities.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-tertiary)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 'var(--space-1)',
                      }}
                    >
                      <Badge variant={typeBadgeVariant[a.activityType] || 'default'} size="sm">
                        {a.activityType}
                      </Badge>
                      {a.isCompleted && (
                        <Badge variant="success" size="sm">done</Badge>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--font-weight-medium)' as any,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {a.subject}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {a.entityType} #{a.entityId}
                      {a.dueDate && ` - ${new Date(a.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
