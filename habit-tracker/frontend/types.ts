/**
 * Habit Tracker — domain types
 */

export type HabitType = 'binary' | 'count' | 'duration' | 'negative'

export interface Category {
  id: number
  name: string
  color: string
  order: number
  createdAt?: string
  updatedAt?: string
}

export interface HabitEntry {
  id: number
  habitId: number
  date: string // YYYY-MM-DD
  value: number
  note: string | null
  completed: boolean
  createdAt?: string
  updatedAt?: string
}

export interface Habit {
  id: number
  name: string
  description: string | null
  type: HabitType
  target: number | null
  unit: string | null
  color: string
  icon: string
  categoryId: number | null
  category_id?: number | null
  category?: Category | null
  order: number
  archived: boolean
  todayEntry?: HabitEntry | null
  currentStreak?: number
  bestStreak?: number
  completionRate?: number
  totalCompletions?: number
  trend?: TrendPoint[]
  createdAt?: string
  updatedAt?: string
}

export interface TrendPoint {
  date: string
  value: number
  completed: boolean
  intensity: number
}

export interface HeatmapCell {
  date: string
  value: number
  completed: boolean
  intensity: number
  note: string | null
}

export interface HeatmapData {
  habitId: number
  color: string
  days: number
  cells: HeatmapCell[]
}

export interface DashboardSummary {
  todayCompleted: number
  todayTotal: number
  weeklyRate: number
  activeStreaks: number
}

export interface HabitStats {
  currentStreak: number
  bestStreak: number
  completionRate: number
  trend: TrendPoint[]
  totalCompletions: number
}

// Base state interface — kept for the agent template's UI capture layer.
export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  [key: string]: unknown
}
