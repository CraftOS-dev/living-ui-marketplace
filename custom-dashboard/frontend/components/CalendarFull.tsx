import { useState, useEffect } from 'react'
import type { AppController } from '../AppController'
import type { CalendarEvent, CalendarEventCreate } from '../types'
import { Card, Button, Input, Modal } from './ui'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'react-toastify'

interface CalendarFullProps {
  controller: AppController
}

const EVENT_COLORS = ['#FF4F18', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899']

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface EventModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: CalendarEventCreate) => Promise<void>
  initial?: Partial<CalendarEventCreate>
  title: string
}

function EventModal({ open, onClose, onSave, initial, title }: EventModalProps) {
  const [form, setForm] = useState<CalendarEventCreate>({
    title: initial?.title ?? '',
    event_date: initial?.event_date ?? '',
    start_time: initial?.start_time ?? '',
    end_time: initial?.end_time ?? '',
    description: initial?.description ?? '',
    color: initial?.color ?? EVENT_COLORS[0],
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({
        title: initial?.title ?? '',
        event_date: initial?.event_date ?? '',
        start_time: initial?.start_time ?? '',
        end_time: initial?.end_time ?? '',
        description: initial?.description ?? '',
        color: initial?.color ?? EVENT_COLORS[0],
      })
    }
  }, [open])

  const submit = async () => {
    if (!form.title.trim() || !form.event_date) return
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } catch {
      toast.error('Failed to save event')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={saving} onClick={submit}>Save</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input label="Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        <Input label="Date *" type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <Input label="Start time" type="time" value={form.start_time ?? ''} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
          </div>
          <div style={{ flex: 1 }}>
            <Input label="End time" type="time" value={form.end_time ?? ''} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
          </div>
        </div>
        <Input label="Description" value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        <div>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' as any, marginBottom: 'var(--space-1)' }}>Color</div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {EVENT_COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{
                  width: 24, height: 24, borderRadius: '50%',
                  backgroundColor: c, border: form.color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                  cursor: 'pointer', padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function CalendarFull({ controller }: CalendarFullProps) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const loadEvents = () => {
    const m = `${year}-${String(month + 1).padStart(2, '0')}`
    controller.getCalendarEvents(m).then(setEvents).catch(() => {})
  }

  useEffect(() => { loadEvents() }, [year, month, controller])

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const dayCount = daysInMonth(year, month)
  const startDay = firstDayOfMonth(year, month)
  const monthName = new Date(year, month).toLocaleDateString([], { month: 'long', year: 'numeric' })

  const eventsOnDate = (dateStr: string) => events.filter(e => e.eventDate === dateStr)
  const selectedEvents = selectedDate ? eventsOnDate(selectedDate) : []

  const createEvent = async (data: CalendarEventCreate) => {
    await controller.createCalendarEvent(data)
    loadEvents()
    toast.success('Event created')
  }

  const deleteEvent = async (id: number) => {
    await controller.deleteCalendarEvent(id)
    loadEvents()
    toast.success('Event deleted')
  }

  const days = Array.from({ length: startDay }, (_, i) => ({ day: 0, key: `pad-${i}` }))
    .concat(Array.from({ length: dayCount }, (_, i) => ({ day: i + 1, key: `day-${i + 1}` })))

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', paddingTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
        <CalendarDays size={20} style={{ color: 'var(--color-primary)' }} />
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-semibold)' as any }}>Calendar</h2>
      </div>

      <Card padding="md" style={{ marginBottom: 'var(--space-4)' }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 'var(--space-1)' }}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-base)' }}>{monthName}</span>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 'var(--space-1)' }}>
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Weekday headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', padding: 'var(--space-1)' }}>{d}</div>
          ))}
        </div>

        {/* Day grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {days.map(({ day, key }) => {
            if (day === 0) return <div key={key} />
            const dateStr = toDateStr(year, month, day)
            const dayEvents = eventsOnDate(dateStr)
            const isToday = dateStr === toDateStr(today.getFullYear(), today.getMonth(), today.getDate())
            const isSelected = selectedDate === dateStr
            return (
              <button
                key={key}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'var(--color-primary)' : isToday ? 'var(--color-primary-light)' : 'transparent',
                  color: isSelected ? 'white' : isToday ? 'var(--color-primary)' : 'var(--text-primary)',
                  fontWeight: isToday ? 'var(--font-weight-bold)' as any : undefined,
                  fontSize: 'var(--font-size-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  padding: 'var(--space-1)',
                  transition: 'var(--transition-fast)',
                }}
              >
                <span>{day}</span>
                {dayEvents.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {dayEvents.slice(0, 3).map(e => (
                      <span key={e.id} style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: isSelected ? 'white' : (e.color || 'var(--color-primary)') }} />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </Card>

      {/* Selected day events */}
      {selectedDate && (
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-sm)' }}>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setModalOpen(true)}>
              Add event
            </Button>
          </div>
          {selectedEvents.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>No events. Click "Add event" to create one.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {selectedEvents.map(ev => (
                <div key={ev.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                  padding: 'var(--space-2)', borderRadius: 'var(--radius-md)',
                  borderLeft: `4px solid ${ev.color || 'var(--color-primary)'}`,
                  backgroundColor: 'var(--bg-tertiary)',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'var(--font-weight-medium)' as any, fontSize: 'var(--font-size-sm)' }}>{ev.title}</div>
                    {(ev.startTime || ev.endTime) && (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        {ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}
                      </div>
                    )}
                    {ev.description && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{ev.description}</div>}
                  </div>
                  <button onClick={() => deleteEvent(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 'var(--space-1)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={createEvent}
        initial={selectedDate ? { event_date: selectedDate } : undefined}
        title="New Event"
      />
    </div>
  )
}
