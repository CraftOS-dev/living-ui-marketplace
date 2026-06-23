import type { AppState, Column, Email, InsightSummary } from './types'
import { ApiService } from './services/ApiService'

const BACKEND_URL: string =
  (window as unknown as Record<string, string>).__CRAFTBOT_BACKEND_URL__ ||
  'http://localhost:{{BACKEND_PORT}}'

const api = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
    gmailConnected: false,
    checkingGmail: true,
    columns: [],
    emails: {},
    insights: {},
    loadingEmails: {},
    loadingInsights: {},
  }

  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable = false
  private pollIntervalId: ReturnType<typeof setInterval> | null = null

  async initialize(): Promise<void> {
    this.backendAvailable = await ApiService.healthCheck()

    if (!this.backendAvailable) {
      this.patchState({ initialized: true, loading: false, checkingGmail: false,
        error: 'Backend unavailable' })
      return
    }

    try {
      await this.checkGmailStatus()
      await this.loadColumns()
    } catch (err) {
      console.error('[AppController] Init error:', err)
      this.patchState({ error: String(err) })
    }

    this.patchState({ initialized: true, loading: false })
  }

  async checkGmailStatus(): Promise<void> {
    this.patchState({ checkingGmail: true })
    try {
      const data = await api<{ connected: boolean; email: string | null }>('/gmail/status')
      this.patchState({ gmailConnected: data.connected, checkingGmail: false })
    } catch {
      this.patchState({ gmailConnected: false, checkingGmail: false })
    }
  }

  async loadColumns(): Promise<void> {
    try {
      const cols = await api<Column[]>('/columns')
      this.patchState({ columns: cols })
    } catch (err) {
      console.error('[AppController] Failed to load columns:', err)
    }
  }

  async updateColumn(columnId: number, updates: Partial<Pick<Column, 'title' | 'query' | 'icon' | 'aiInstructions' | 'aiEnabled'>>): Promise<void> {
    try {
      const body: Record<string, unknown> = {}
      if (updates.title !== undefined) body.title = updates.title
      if (updates.query !== undefined) body.query = updates.query
      if (updates.icon !== undefined) body.icon = updates.icon
      if (updates.aiInstructions !== undefined) body.ai_instructions = updates.aiInstructions
      if (updates.aiEnabled !== undefined) body.ai_enabled = updates.aiEnabled

      const updated = await api<Column>(`/columns/${columnId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })

      this.patchState({
        columns: this.state.columns.map((c) => (c.id === columnId ? updated : c)),
      })
    } catch (err) {
      console.error('[AppController] Failed to update column:', err)
      throw err
    }
  }

  async fetchEmails(columnId: number): Promise<void> {
    this.patchState({ loadingEmails: { ...this.state.loadingEmails, [columnId]: true } })
    try {
      const emails = await api<Email[]>(`/emails/${columnId}`)
      this.patchState({
        emails: { ...this.state.emails, [columnId]: emails },
        loadingEmails: { ...this.state.loadingEmails, [columnId]: false },
      })
    } catch (err) {
      console.error(`[AppController] Failed to fetch emails for column ${columnId}:`, err)
      this.patchState({ loadingEmails: { ...this.state.loadingEmails, [columnId]: false } })
    }
  }

  async generateInsights(columnId: number): Promise<void> {
    this.patchState({ loadingInsights: { ...this.state.loadingInsights, [columnId]: true } })
    try {
      const insight = await api<InsightSummary>(`/columns/${columnId}/insights`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      this.patchState({
        insights: { ...this.state.insights, [columnId]: insight },
        loadingInsights: { ...this.state.loadingInsights, [columnId]: false },
      })
    } catch (err) {
      console.error(`[AppController] Failed to generate insights for column ${columnId}:`, err)
      this.patchState({ loadingInsights: { ...this.state.loadingInsights, [columnId]: false } })
    }
  }

  clearInsights(columnId: number): void {
    this.patchState({
      insights: { ...this.state.insights, [columnId]: null },
    })
  }

  startPolling(intervalMs = 60000): void {
    this.stopPolling()
    this.pollIntervalId = setInterval(() => {
      if (this.state.gmailConnected) {
        this.state.columns.forEach((col) => this.fetchEmails(col.id))
      }
    }, intervalMs)
  }

  stopPolling(): void {
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId)
      this.pollIntervalId = null
    }
  }

  getState(): AppState {
    return { ...this.state }
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  cleanup(): void {
    this.stopPolling()
    this.listeners.clear()
  }

  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  private patchState(updates: Partial<AppState>): void {
    this.state = { ...this.state, ...updates }
    this.listeners.forEach((l) => l(this.getState()))
  }
}
