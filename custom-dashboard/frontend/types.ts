/**
 * Personal Dashboard — TypeScript interfaces
 */

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  [key: string]: unknown
}

export type WidgetId = 'clock' | 'weather' | 'calendar' | 'todos' | 'notes' | 'reminders' | 'briefing'

export type DashboardView = 'home' | 'store' | WidgetId

export interface WidgetConfig {
  id: number
  widgetId: WidgetId
  enabled: boolean
  position: number
  widgetSettings: Record<string, unknown>
  updatedAt: string | null
}

// Weather
export interface ForecastDay {
  date: string
  code: number
  high: number
  low: number
}

export interface WeatherData {
  cityName: string | null
  latitude: number | null
  longitude: number | null
  currentTemp: number | null
  weatherCode: number | null
  apparentTemp: number | null
  tempHigh: number | null
  tempLow: number | null
  forecast: ForecastDay[]
  fetchedAt: string | null
  status?: string
}

// Calendar
export interface CalendarEvent {
  id: number
  title: string
  eventDate: string   // YYYY-MM-DD
  startTime: string | null
  endTime: string | null
  description: string | null
  color: string | null
  createdAt: string | null
}

export interface CalendarEventCreate {
  title: string
  event_date: string
  start_time?: string
  end_time?: string
  description?: string
  color?: string
}

export interface CalendarEventUpdate {
  title?: string
  event_date?: string
  start_time?: string
  end_time?: string
  description?: string
  color?: string
}

// Tasks
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'

export interface Task {
  id: number
  title: string
  completed: boolean
  priority: TaskPriority
  position: number
  createdAt: string | null
}

export interface TaskCreate {
  title: string
  priority?: TaskPriority
}

export interface TaskUpdate {
  title?: string
  completed?: boolean
  priority?: TaskPriority
  position?: number
}

// Notes
export interface Note {
  id: number
  title: string
  content: string
  pinned: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface NoteCreate {
  title: string
  content?: string
  pinned?: boolean
}

export interface NoteUpdate {
  title?: string
  content?: string
  pinned?: boolean
}

// Reminders
export interface Reminder {
  id: number
  title: string
  dueDate: string | null
  dueTime: string | null
  completed: boolean
  createdAt: string | null
}

export interface ReminderCreate {
  title: string
  due_date?: string | null
  due_time?: string | null
}

export interface ReminderUpdate {
  title?: string
  due_date?: string | null
  due_time?: string | null
  completed?: boolean
}

// Daily Briefing
export interface DailyBriefing {
  content: string | null
  generatedAt: string | null
}
