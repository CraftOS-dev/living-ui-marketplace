import type { AppState, WidgetConfig, WidgetId, WeatherData, CalendarEvent, CalendarEventCreate, CalendarEventUpdate, Task, TaskCreate, TaskUpdate, Note, NoteCreate, NoteUpdate, Reminder, ReminderCreate, ReminderUpdate, DailyBriefing } from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3101'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`)
  return res.json()
}

export class AppController {
  private state: AppState = { initialized: false, loading: true, error: null }
  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable: boolean = false

  async initialize(): Promise<void> {
    this.backendAvailable = await ApiService.healthCheck()
    this.state = {
      ...this.state,
      initialized: true,
      loading: false,
      error: this.backendAvailable ? null : 'Backend unavailable',
    }
    this.notifyListeners()
  }

  cleanup(): void { this.listeners.clear() }
  getState(): AppState { return { ...this.state } }
  isBackendAvailable(): boolean { return this.backendAvailable }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async setState(updates: Partial<AppState>, persistToBackend = true): Promise<void> {
    this.state = { ...this.state, ...updates }
    this.notifyListeners()
    if (persistToBackend && this.backendAvailable) {
      try {
        const { initialized, loading, error, ...persistable } = updates
        if (Object.keys(persistable).length > 0) await ApiService.updateState(persistable)
      } catch (err) {
        console.error('[AppController] persist failed:', err)
      }
    }
    stateCache.save(this.state)
  }

  async refresh(): Promise<void> {
    await this.setState({ loading: true }, false)
    await this.initialize()
  }

  private notifyListeners(): void {
    this.listeners.forEach(l => l(this.getState()))
  }

  // ============================================================
  // Widget Configs
  // ============================================================

  async getWidgetConfigs(): Promise<WidgetConfig[]> {
    return api<WidgetConfig[]>('/widget-configs')
  }

  async updateWidgetConfig(widgetId: WidgetId, updates: {
    enabled?: boolean
    position?: number
    widget_settings?: Record<string, unknown>
  }): Promise<WidgetConfig> {
    return api<WidgetConfig>(`/widget-configs/${widgetId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  }

  // ============================================================
  // Weather
  // ============================================================

  async getWeather(): Promise<WeatherData> {
    return api<WeatherData>('/weather')
  }

  async setWeatherCity(city: string): Promise<WeatherData> {
    return api<WeatherData>('/weather/city', {
      method: 'PUT',
      body: JSON.stringify({ city }),
    })
  }

  // ============================================================
  // Calendar
  // ============================================================

  async getCalendarEvents(month?: string): Promise<CalendarEvent[]> {
    const qs = month ? `?month=${month}` : ''
    return api<CalendarEvent[]>(`/calendar-events${qs}`)
  }

  async createCalendarEvent(data: CalendarEventCreate): Promise<CalendarEvent> {
    return api<CalendarEvent>('/calendar-events', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateCalendarEvent(id: number, data: CalendarEventUpdate): Promise<CalendarEvent> {
    return api<CalendarEvent>(`/calendar-events/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteCalendarEvent(id: number): Promise<void> {
    await api(`/calendar-events/${id}`, { method: 'DELETE' })
  }

  // ============================================================
  // Tasks
  // ============================================================

  async getTasks(): Promise<Task[]> {
    return api<Task[]>('/tasks')
  }

  async createTask(data: TaskCreate): Promise<Task> {
    return api<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateTask(id: number, data: TaskUpdate): Promise<Task> {
    return api<Task>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteTask(id: number): Promise<void> {
    await api(`/tasks/${id}`, { method: 'DELETE' })
  }

  // ============================================================
  // Notes
  // ============================================================

  async getNotes(): Promise<Note[]> {
    return api<Note[]>('/notes')
  }

  async getNote(id: number): Promise<Note> {
    return api<Note>(`/notes/${id}`)
  }

  async createNote(data: NoteCreate): Promise<Note> {
    return api<Note>('/notes', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateNote(id: number, data: NoteUpdate): Promise<Note> {
    return api<Note>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteNote(id: number): Promise<void> {
    await api(`/notes/${id}`, { method: 'DELETE' })
  }

  // ============================================================
  // Reminders
  // ============================================================

  async getReminders(upcoming?: boolean): Promise<Reminder[]> {
    const qs = upcoming ? '?upcoming=true' : ''
    return api<Reminder[]>(`/reminders${qs}`)
  }

  async createReminder(data: ReminderCreate): Promise<Reminder> {
    return api<Reminder>('/reminders', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateReminder(id: number, data: ReminderUpdate): Promise<Reminder> {
    return api<Reminder>(`/reminders/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteReminder(id: number): Promise<void> {
    await api(`/reminders/${id}`, { method: 'DELETE' })
  }

  // ============================================================
  // Daily Briefing
  // ============================================================

  async getBriefing(): Promise<DailyBriefing> {
    return api<DailyBriefing>('/briefing')
  }

  async generateBriefing(): Promise<DailyBriefing> {
    return api<DailyBriefing>('/briefing/generate', { method: 'POST' })
  }
}
