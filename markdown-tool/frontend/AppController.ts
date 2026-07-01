import type { AppState, FileItem, EditorSession } from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3200'

export class UploadConflictError extends Error {
  conflicts: string[]
  constructor(conflicts: string[]) {
    super(`Upload conflict: ${conflicts.length} file(s) already exist`)
    this.name = 'UploadConflictError'
    this.conflicts = conflicts
  }
}

export class AppController {
  private state: AppState = { initialized: false, loading: true, error: null }
  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable: boolean = false

  async initialize(): Promise<void> {
    console.log('[AppController] Initializing...')
    this.backendAvailable = await ApiService.healthCheck()
    if (this.backendAvailable) {
      try {
        const backendState = await ApiService.getState<Partial<AppState>>()
        this.state = { ...this.state, ...backendState, initialized: true, loading: false, error: null }
        stateCache.saveSync(backendState)
      } catch {
        this.loadFromCache()
      }
    } else {
      this.loadFromCache()
    }
    this.notifyListeners()
    console.log('[AppController] Initialized')
  }

  private loadFromCache(): void {
    const cached = stateCache.load()
    this.state = {
      ...this.state,
      ...(cached || {}),
      initialized: true,
      loading: false,
      error: this.backendAvailable ? null : 'Backend unavailable',
    }
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
        const { initialized, loading, error, ...rest } = updates
        if (Object.keys(rest).length > 0) await ApiService.updateState(rest)
      } catch { /* ignore */ }
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

  // ──────────────────────────────────────────────────────────────
  // HTTP helpers (no hardcoded port — uses BACKEND_URL)
  // ──────────────────────────────────────────────────────────────

  private async apiGet<T>(path: string): Promise<T> {
    const resp = await fetch(`${BACKEND_URL}${path}`, { headers: { 'Content-Type': 'application/json' } })
    if (!resp.ok) throw new Error(`GET ${path} → ${resp.status}: ${resp.statusText}`)
    return resp.json()
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`POST ${path} → ${resp.status}: ${resp.statusText}`)
    return resp.json()
  }

  private async apiPut<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${BACKEND_URL}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`PUT ${path} → ${resp.status}: ${resp.statusText}`)
    return resp.json()
  }

  private async apiDelete<T>(path: string): Promise<T> {
    const resp = await fetch(`${BACKEND_URL}${path}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
    if (!resp.ok) throw new Error(`DELETE ${path} → ${resp.status}: ${resp.statusText}`)
    return resp.json()
  }

  // ──────────────────────────────────────────────────────────────
  // Workspace file operations
  // ──────────────────────────────────────────────────────────────

  async listDirectory(path: string): Promise<FileItem[]> {
    return this.apiGet<FileItem[]>(`/api/files?path=${encodeURIComponent(path)}`)
  }

  async readFile(path: string): Promise<{ path: string; name: string; content: string }> {
    return this.apiGet(`/api/files/read?path=${encodeURIComponent(path)}`)
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.apiPut('/api/files/write', { path, content })
  }

  async createItem(path: string, type: 'file' | 'directory'): Promise<void> {
    await this.apiPost('/api/files/create', { path, type })
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.apiPut('/api/files/rename', { old_path: oldPath, new_path: newPath })
  }

  async deleteItem(path: string): Promise<void> {
    await this.apiDelete(`/api/files/delete?path=${encodeURIComponent(path)}`)
  }

  async uploadFiles(
    items: { file: File; relativePath: string }[],
    overwrite: boolean,
    parentPath: string = '',
  ): Promise<{ status: 'uploaded'; written: string[] }> {
    const formData = new FormData()
    for (const { file, relativePath } of items) {
      formData.append('files', file)
      formData.append('relative_paths', relativePath)
    }
    formData.append('parent_path', parentPath)
    formData.append('overwrite', String(overwrite))

    const resp = await fetch(`${BACKEND_URL}/api/files/upload`, { method: 'POST', body: formData })
    if (resp.status === 409) {
      const body = await resp.json().catch(() => null)
      throw new UploadConflictError(body?.detail?.conflicts ?? [])
    }
    if (!resp.ok) throw new Error(`POST /api/files/upload → ${resp.status}: ${resp.statusText}`)
    return resp.json()
  }

  // ──────────────────────────────────────────────────────────────
  // Editor session
  // ──────────────────────────────────────────────────────────────

  async getSession(): Promise<EditorSession> {
    return this.apiGet<EditorSession>('/api/session')
  }

  async saveSession(patch: Partial<EditorSession>): Promise<void> {
    await this.apiPut('/api/session', patch)
  }
}
