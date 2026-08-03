import { useState, useEffect, useCallback } from 'react'
import type { AppController } from '../AppController'
import type { WidgetConfig, DashboardView, CalendarEvent } from '../types'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Modal, Input, Button } from './ui'
import { toast } from 'react-toastify'

interface CalendarWidgetProps {
  controller: AppController
  config: WidgetConfig
  navigate: (view: DashboardView) => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface EventForm {
  title: string
  event_date: string
  start_time: string
}

export function CalendarWidget({ controller, navigate }: CalendarWidgetProps) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EventForm>({ title: '', event_date: today(), start_time: '' })

  const load = useCallback(() => {
    const m = `${year}-${String(month + 1).padStart(2, '0')}`
    return controller.getCalendarEvents(m)
      .then(setEvents)
      .catch(() => {})
  }, [controller, year, month])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const eventsOnDate = (dateStr: string) => events.filter(e => e.eventDate === dateStr)

  function openAddFor(dateStr: string) {
    setEditing(null)
    setForm({ title: '', event_date: dateStr, start_time: '' })
    setModalOpen(true)
  }

  function openEdit(event: CalendarEvent) {
    setEditing(event)
    setForm({ title: event.title, event_date: event.eventDate, start_time: event.startTime ?? '' })
    setModalOpen(true)
  }

  function selectDay(dateStr: string) {
    const dayEvents = eventsOnDate(dateStr)
    if (dayEvents.length === 0) {
      openAddFor(dateStr)
    } else {
      setSelectedDate(prev => prev === dateStr ? null : dateStr)
    }
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error('Title is required')
      return
    }
    setSaving(true)
    try {
      const payload = { title: form.title, event_date: form.event_date, start_time: form.start_time || undefined }
      if (editing) {
        await controller.updateCalendarEvent(editing.id, payload)
        toast.success('Event updated')
      } else {
        await controller.createCalendarEvent(payload)
        toast.success('Event added')
      }
      setModalOpen(false)
      await load()
    } catch {
      toast.error(editing ? 'Failed to update event' : 'Failed to add event')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEvent(id: number) {
    try {
      await controller.deleteCalendarEvent(id)
      await load()
      toast.success('Event deleted')
    } catch {
      toast.error('Failed to delete event')
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Loading…</div>

  const dayCount = daysInMonth(year, month)
  const startDay = firstDayOfMonth(year, month)
  const monthName = new Date(year, month).toLocaleDateString([], { month: 'short', year: 'numeric' })
  const todayStr = today()

  const days = Array.from({ length: startDay }, (_, i) => ({ day: 0, key: `pad-${i}` }))
    .concat(Array.from({ length: dayCount }, (_, i) => ({ day: i + 1, key: `day-${i + 1}` })))

  const selectedEvents = selectedDate ? eventsOnDate(selectedDate) : []

  const modal = (
    <Modal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      title={editing ? 'Edit Event' : 'Add Event'}
      footer={
        <>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save' : 'Add'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="Title"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Team meeting"
        />
        <Input
          label="Date"
          type="date"
          value={form.event_date}
          onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
        />
        <Input
          label="Time (optional)"
          type="time"
          value={form.start_time}
          onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
        />
      </div>
    </Modal>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 2 }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontWeight: 'var(--font-weight-semibold)' as any, fontSize: 'var(--font-size-xs)' }}>{monthName}</span>
        <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: 2 }}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-muted)' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 'var(--space-1)' }}>
        {days.map(({ day, key }) => {
          if (day === 0) return <div key={key} />
          const dateStr = toDateStr(year, month, day)
          const dayEvents = eventsOnDate(dateStr)
          const isToday = dateStr === todayStr
          const isSelected = selectedDate === dateStr
          return (
            <button
              key={key}
              onClick={() => selectDay(dateStr)}
              style={{
                aspectRatio: '1',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                backgroundColor: isSelected ? 'var(--color-primary)' : isToday ? 'var(--color-primary-light)' : 'transparent',
                color: isSelected ? 'white' : isToday ? 'var(--color-primary)' : 'var(--text-primary)',
                fontWeight: isToday ? 'var(--font-weight-bold)' as any : undefined,
                fontSize: '10px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                padding: 0,
              }}
            >
              <span>{day}</span>
              {dayEvents.length > 0 && (
                <span style={{
                  width: 4, height: 4, borderRadius: '50%',
                  backgroundColor: isSelected ? 'white' : (dayEvents[0].color || 'var(--color-primary)'),
                }} />
              )}
            </button>
          )
        })}
      </div>

      {selectedDate && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
          {selectedEvents.map(ev => (
            <div key={ev.id} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-tertiary)',
            }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, backgroundColor: ev.color ?? 'var(--color-primary)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.title}
                </div>
                {ev.startTime && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{ev.startTime}</div>}
              </div>
              <button onClick={() => openEdit(ev)} title="Edit event" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}>
                <Pencil size={11} />
              </button>
              <button onClick={() => deleteEvent(ev.id)} title="Delete event" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}>
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button
            onClick={() => openAddFor(selectedDate)}
            style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 'var(--space-1) 0' }}
          >
            + Add event
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 'var(--space-1)' }}>
        <button
          onClick={() => navigate('calendar')}
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-primary)',
            background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Open calendar →
        </button>
        <button
          onClick={() => openAddFor(selectedDate ?? today())}
          title="Quick add event"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', display: 'flex', padding: 0 }}
        >
          <Plus size={16} />
        </button>
      </div>
      {modal}
    </div>
  )
}
