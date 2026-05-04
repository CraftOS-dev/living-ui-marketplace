/**
 * Word Improve AppController
 *
 * Owns the session-list + active-session state. Subscribers (React components)
 * receive a fresh state object on every change.
 */

import type {
  AppState,
  CompileResponse,
  CreateSessionPayload,
  MergeSegment,
  SessionDetail,
  SessionSummary,
} from './types'

const BACKEND_URL =
  (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

async function http<T>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const body = init?.json !== undefined ? JSON.stringify(init.json) : init?.body
  const resp = await fetch(`${BACKEND_URL}${path}`, {
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    headers,
    body,
  })
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`
    try {
      const j = await resp.json()
      detail = (j && (j.detail || j.error)) || detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return (await resp.json()) as T
}

export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
    llmAvailable: false,
    sessions: [],
    active: null,
    generating: false,
    regenerating: false,
    compiling: false,
    lastCompile: null,
  }

  private listeners: Set<(state: AppState) => void> = new Set()

  async initialize(): Promise<void> {
    try {
      const sessions = await http<SessionSummary[]>('/api/sessions')
      this.set({ sessions, initialized: true, loading: false, error: null })
      if (sessions.length > 0) {
        await this.loadSession(sessions[0].id)
      }
    } catch (err) {
      this.set({
        initialized: true,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load sessions',
      })
    }
  }

  cleanup(): void {
    this.listeners.clear()
  }

  getState(): AppState {
    return { ...this.state }
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(updates: Partial<AppState>): void {
    this.state = { ...this.state, ...updates }
    this.listeners.forEach((l) => l({ ...this.state }))
  }

  private async refreshSessionList(): Promise<void> {
    try {
      const sessions = await http<SessionSummary[]>('/api/sessions')
      this.set({ sessions })
    } catch (err) {
      console.error('[AppController] refreshSessionList failed:', err)
    }
  }

  startNewSession(): void {
    this.set({ active: null, lastCompile: null, error: null })
  }

  async createAndGenerate(payload: CreateSessionPayload): Promise<void> {
    this.set({ loading: true, error: null, lastCompile: null })
    try {
      const session = await http<SessionDetail>('/api/sessions', {
        method: 'POST',
        json: payload,
      })
      this.set({ active: session, loading: false, generating: true })
      const resp = await http<{
        status: string
        llmAvailable: boolean
        session: SessionDetail
      }>(`/api/sessions/${session.id}/generate`, { method: 'POST' })
      this.set({
        active: resp.session,
        llmAvailable: resp.llmAvailable,
        generating: false,
      })
      await this.refreshSessionList()
      if (resp.session.segments.length > 0) {
        this.runCompile(true)
      }
    } catch (err) {
      // Surface the error in state AND propagate to the caller — without the
      // re-throw the promise resolves cleanly, the SessionInput handleSubmit's
      // catch never runs, and a misleading "success" toast fires on failure.
      this.set({
        loading: false,
        generating: false,
        error: err instanceof Error ? err.message : 'Failed to create session',
      })
      throw err
    }
  }

  async loadSession(id: number): Promise<void> {
    this.set({ loading: true, error: null, lastCompile: null })
    try {
      const session = await http<SessionDetail>(`/api/sessions/${id}`)
      this.set({ active: session, loading: false })
      if (session.segments.length > 0) {
        this.runCompile(true)
      }
    } catch (err) {
      this.set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load session',
      })
    }
  }

  async deleteSession(id: number): Promise<void> {
    try {
      await http<{ status: string }>(`/api/sessions/${id}`, { method: 'DELETE' })
      const wasActive = this.state.active?.id === id
      await this.refreshSessionList()
      if (wasActive) this.set({ active: null, lastCompile: null })
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'Delete failed' })
      throw err
    }
  }

  async renameSession(id: number, title: string): Promise<void> {
    try {
      const resp = await http<{ status: string; session?: SessionSummary }>(
        `/api/sessions/${id}/title`,
        { method: 'PUT', json: { title } }
      )
      if (resp.status === 'ok') {
        await this.refreshSessionList()
        if (this.state.active?.id === id) {
          this.set({ active: { ...this.state.active, title } })
        }
      }
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'Rename failed' })
      throw err
    }
  }

  async regenerate(): Promise<void> {
    if (!this.state.active) return
    const id = this.state.active.id
    this.set({ regenerating: true, error: null, lastCompile: null })
    try {
      const resp = await http<{
        status: string
        llmAvailable: boolean
        session: SessionDetail
      }>(`/api/sessions/${id}/regenerate`, { method: 'POST' })
      this.set({
        active: resp.session,
        llmAvailable: resp.llmAvailable,
        regenerating: false,
      })
      await this.refreshSessionList()
      if (resp.session.segments.length > 0) {
        this.runCompile(true)
      }
    } catch (err) {
      this.set({
        regenerating: false,
        error: err instanceof Error ? err.message : 'Regenerate failed',
      })
      throw err
    }
  }

  async selectSegment(segmentId: number, selection: number | null): Promise<void> {
    if (!this.state.active) return
    try {
      const resp = await http<{ status: string; segment?: MergeSegment }>(
        `/api/segments/${segmentId}/select`,
        { method: 'PUT', json: { selection } }
      )
      if (resp.segment) {
        this.applySegmentUpdate(resp.segment)
      }
      // Live-update the compiled result whenever a pick changes.
      this.runCompile(true)
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'Selection failed' })
    }
  }

  async compile(): Promise<CompileResponse | null> {
    return this.runCompile(false)
  }

  private async runCompile(silent: boolean): Promise<CompileResponse | null> {
    if (!this.state.active) return null
    const id = this.state.active.id
    if (!silent) this.set({ compiling: true, error: null })
    try {
      const resp = await http<CompileResponse>(`/api/sessions/${id}/compile`, {
        method: 'POST',
      })
      // The session may have changed (e.g. user switched) while compiling —
      // only apply the response if it still matches the active session.
      if (this.state.active?.id !== id) return resp
      this.set({
        active: resp.session,
        lastCompile: resp,
        compiling: false,
      })
      if (!silent) await this.refreshSessionList()
      return resp
    } catch (err) {
      if (!silent) {
        this.set({
          compiling: false,
          error: err instanceof Error ? err.message : 'Compile failed',
        })
      }
      return null
    }
  }

  private applySegmentUpdate(updated: MergeSegment): void {
    if (!this.state.active) return
    const newSegments = this.state.active.segments.map((seg) =>
      seg.id === updated.id ? updated : seg
    )
    this.set({ active: { ...this.state.active, segments: newSegments } })
  }
}
