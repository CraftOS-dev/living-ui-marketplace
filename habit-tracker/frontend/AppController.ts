import type {
  AppState,
  Category,
  Habit,
  HabitEntry,
  HabitStats,
  HeatmapData,
  DashboardSummary,
  HabitType,
} from './types'
import { ApiService } from './services/ApiService'

const BACKEND_URL =
  (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3200'

interface HabitInput {
  name: string
  description?: string | null
  type: HabitType
  target?: number | null
  unit?: string | null
  color: string
  icon: string
  category_id?: number | null
}

interface CategoryInput {
  name: string
  color: string
}

interface ControllerSnapshot {
  initialized: boolean
  loading: boolean
  error: string | null
  habits: Habit[]
  categories: Category[]
  dashboard: DashboardSummary
  selectedHabitId: number | null
  search: string
  categoryFilter: number | null
  showHabitForm: boolean
  editingHabitId: number | null
  showCategoryManager: boolean
}

const EMPTY_DASHBOARD: DashboardSummary = {
  todayCompleted: 0,
  todayTotal: 0,
  weeklyRate: 0,
  activeStreaks: 0,
}

export class AppController {
  private snapshot: ControllerSnapshot = {
    initialized: false,
    loading: true,
    error: null,
    habits: [],
    categories: [],
    dashboard: EMPTY_DASHBOARD,
    selectedHabitId: null,
    search: '',
    categoryFilter: null,
    showHabitForm: false,
    editingHabitId: null,
    showCategoryManager: false,
  }

  private listeners: Set<(state: ControllerSnapshot) => void> = new Set()
  private backendAvailable = false

  // ------------------------------------------------------------ lifecycle

  async initialize(): Promise<void> {
    this.backendAvailable = await ApiService.healthCheck()
    if (!this.backendAvailable) {
      this.update({
        initialized: true,
        loading: false,
        error: 'Backend unavailable. Start the backend server.',
      })
      return
    }
    await this.refresh()
    this.update({ initialized: true, loading: false, error: null })
  }

  cleanup(): void {
    this.listeners.clear()
  }

  // ------------------------------------------------------------ subscription

  getSnapshot(): ControllerSnapshot {
    // MUST return a stable reference — useSyncExternalStore re-renders
    // whenever Object.is(prev, next) is false. Mutate via update().
    return this.snapshot
  }

  subscribe(listener: (state: ControllerSnapshot) => void): () => void {
    this.listeners.add(listener)
    // Do NOT eager-fire here. useSyncExternalStore reads via getSnapshot
    // and would treat an in-subscribe state mutation as instability.
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(partial: Partial<ControllerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial }
    const next = this.snapshot
    this.listeners.forEach((l) => l(next))
  }

  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  // ------------------------------------------------------------ data refresh

  async refresh(): Promise<void> {
    try {
      const [habits, categories, dashboard] = await Promise.all([
        this.fetchJson<Habit[]>('GET', '/api/habits'),
        this.fetchJson<Category[]>('GET', '/api/categories'),
        this.fetchJson<DashboardSummary>('GET', '/api/dashboard'),
      ])
      this.update({ habits, categories, dashboard, error: null })
    } catch (err) {
      console.error('[Controller] refresh failed', err)
      this.update({ error: 'Failed to load data from backend' })
    }
  }

  async refreshDashboard(): Promise<void> {
    try {
      const dashboard = await this.fetchJson<DashboardSummary>('GET', '/api/dashboard')
      this.update({ dashboard })
    } catch (err) {
      console.error('[Controller] refreshDashboard failed', err)
    }
  }

  // ------------------------------------------------------------ filters / UI

  setSearch(value: string): void {
    this.update({ search: value })
  }

  setCategoryFilter(value: number | null): void {
    this.update({ categoryFilter: value })
  }

  selectHabit(id: number | null): void {
    this.update({ selectedHabitId: id })
  }

  openCreateHabit(): void {
    this.update({ showHabitForm: true, editingHabitId: null })
  }

  openEditHabit(id: number): void {
    this.update({ showHabitForm: true, editingHabitId: id })
  }

  closeHabitForm(): void {
    this.update({ showHabitForm: false, editingHabitId: null })
  }

  openCategoryManager(): void {
    this.update({ showCategoryManager: true })
  }

  closeCategoryManager(): void {
    this.update({ showCategoryManager: false })
  }

  // ------------------------------------------------------------ filtered view

  getVisibleHabits(): Habit[] {
    const { habits, search, categoryFilter } = this.snapshot
    const q = search.trim().toLowerCase()
    return habits.filter((h) => {
      if (categoryFilter !== null && (h.categoryId ?? h.category_id ?? null) !== categoryFilter)
        return false
      if (!q) return true
      return h.name.toLowerCase().includes(q)
    })
  }

  // ------------------------------------------------------------ category ops

  async createCategory(input: CategoryInput): Promise<Category> {
    const created = await this.fetchJson<Category>('POST', '/api/categories', input)
    await this.refresh()
    return created
  }

  async updateCategory(id: number, input: Partial<CategoryInput>): Promise<Category> {
    const updated = await this.fetchJson<Category>('PUT', `/api/categories/${id}`, input)
    await this.refresh()
    return updated
  }

  async deleteCategory(id: number): Promise<void> {
    await this.fetchJson('DELETE', `/api/categories/${id}`)
    await this.refresh()
  }

  // ------------------------------------------------------------ habit ops

  async createHabit(input: HabitInput): Promise<Habit> {
    const created = await this.fetchJson<Habit>('POST', '/api/habits', input)
    await this.refresh()
    return created
  }

  async updateHabit(id: number, input: Partial<HabitInput> & { archived?: boolean }): Promise<Habit> {
    const updated = await this.fetchJson<Habit>('PUT', `/api/habits/${id}`, input)
    await this.refresh()
    return updated
  }

  async deleteHabit(id: number): Promise<void> {
    await this.fetchJson('DELETE', `/api/habits/${id}`)
    if (this.snapshot.selectedHabitId === id) {
      this.update({ selectedHabitId: null })
    }
    await this.refresh()
  }

  async reorderHabits(orderedIds: number[]): Promise<void> {
    // Optimistic update
    const ordered: Habit[] = []
    const byId = new Map(this.snapshot.habits.map((h) => [h.id, h]))
    orderedIds.forEach((id) => {
      const h = byId.get(id)
      if (h) ordered.push(h)
    })
    // Append any missing (e.g. archived) at the end to keep array consistent
    this.snapshot.habits.forEach((h) => {
      if (!orderedIds.includes(h.id)) ordered.push(h)
    })
    this.update({ habits: ordered })

    try {
      await this.fetchJson('POST', '/api/habits/reorder', { habitIds: orderedIds })
    } catch (err) {
      console.error('[Controller] reorder failed', err)
      await this.refresh()
    }
  }

  // ------------------------------------------------------------ entry ops

  async upsertEntry(
    habitId: number,
    date: string,
    payload: { value?: number; note?: string }
  ): Promise<HabitEntry> {
    const result = await this.fetchJson<HabitEntry>(
      'PUT',
      `/api/habits/${habitId}/entry`,
      { date, ...payload }
    )
    await this.refresh()
    return result
  }

  async deleteEntry(habitId: number, date: string): Promise<void> {
    await this.fetchJson('DELETE', `/api/habits/${habitId}/entry?date=${encodeURIComponent(date)}`)
    await this.refresh()
  }

  /**
   * Toggle today's completion for the habit. Always flips between
   * "not completed" (value=0) and "completed" (value=target, or 1 for
   * binary/negative). Used by the keyboard shortcut and by the binary/
   * negative checkbox in the row. Count habits use `upsertEntry` directly
   * via the +/- buttons for finer-grained increments.
   */
  async toggleToday(habit: Habit): Promise<void> {
    const today = todayIso()
    const entry = habit.todayEntry
    const completed = !!entry?.completed
    if (completed) {
      await this.upsertEntry(habit.id, today, { value: 0 })
      return
    }
    if (habit.type === 'binary' || habit.type === 'negative') {
      await this.upsertEntry(habit.id, today, { value: 1 })
      return
    }
    if (habit.type === 'count') {
      const target = habit.target ?? 1
      await this.upsertEntry(habit.id, today, { value: target })
      return
    }
    if (habit.type === 'duration') {
      const target = habit.target ?? 30
      await this.upsertEntry(habit.id, today, { value: target })
      return
    }
  }

  async setEntryValue(habitId: number, date: string, value: number): Promise<void> {
    await this.upsertEntry(habitId, date, { value })
  }

  // ------------------------------------------------------------ analytics

  async getHabitDetail(id: number): Promise<Habit & HabitStats> {
    return this.fetchJson<Habit & HabitStats>('GET', `/api/habits/${id}`)
  }

  async getHeatmap(id: number, days: number = 365): Promise<HeatmapData> {
    return this.fetchJson<HeatmapData>('GET', `/api/habits/${id}/heatmap?days=${days}`)
  }

  // ------------------------------------------------------------ legacy adapter

  // Standard agent state methods (kept for UI capture compatibility).
  getState(): AppState {
    return {
      initialized: this.snapshot.initialized,
      loading: this.snapshot.loading,
      error: this.snapshot.error,
      habits: this.snapshot.habits as unknown as never,
      dashboard: this.snapshot.dashboard as unknown as never,
    }
  }

  // ------------------------------------------------------------ HTTP helper

  private async fetchJson<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      let detail: string | undefined
      try {
        const data = await response.json()
        detail = data.detail || data.message
      } catch {
        // ignore
      }
      throw new Error(detail || `${method} ${path} failed: ${response.status}`)
    }
    if (response.status === 204) return undefined as T
    const text = await response.text()
    return text ? (JSON.parse(text) as T) : (undefined as T)
  }
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export type { ControllerSnapshot, HabitInput, CategoryInput }
