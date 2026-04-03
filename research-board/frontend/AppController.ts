import type { AppState, BoardItem, Connection, CreateBoardItemRequest, UpdateBoardItemRequest } from './types'
import { ApiService } from './services/ApiService'

const BACKEND_URL = 'http://localhost:{{BACKEND_PORT}}'

/**
 * AppController - Main application controller for Research Board
 *
 * Manages board items and communicates with the backend.
 */
export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
  }

  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable: boolean = false

  async initialize(): Promise<void> {
    console.log('[AppController] Initializing...')
    this.backendAvailable = await ApiService.healthCheck()

    if (this.backendAvailable) {
      this.state = { ...this.state, initialized: true, loading: false, error: null }
    } else {
      this.state = {
        ...this.state,
        initialized: true,
        loading: false,
        error: 'Backend unavailable',
      }
    }

    this.notifyListeners()
    console.log('[AppController] Initialized')
  }

  cleanup(): void {
    this.listeners.clear()
  }

  getState(): AppState {
    return { ...this.state }
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.getState()))
  }

  // ============================================================
  // Board Items API
  // ============================================================

  async getItems(search?: string, type?: string): Promise<BoardItem[]> {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (type) params.set('type', type)
    const query = params.toString() ? `?${params.toString()}` : ''
    const response = await fetch(`${BACKEND_URL}/api/items${query}`)
    if (!response.ok) throw new Error('Failed to fetch items')
    return response.json()
  }

  async createItem(data: CreateBoardItemRequest): Promise<BoardItem> {
    const response = await fetch(`${BACKEND_URL}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error('Failed to create item')
    return response.json()
  }

  async updateItem(id: number, data: UpdateBoardItemRequest): Promise<BoardItem> {
    const response = await fetch(`${BACKEND_URL}/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error('Failed to update item')
    return response.json()
  }

  async deleteItem(id: number): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/api/items/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error('Failed to delete item')
  }

  async uploadFile(file: File): Promise<{ filePath: string; fileName: string; contentType: string }> {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${BACKEND_URL}/api/upload`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) throw new Error('Failed to upload file')
    return response.json()
  }

  async getConnections(): Promise<Connection[]> {
    const response = await fetch(`${BACKEND_URL}/api/connections`)
    if (!response.ok) throw new Error('Failed to fetch connections')
    return response.json()
  }

  async createConnection(sourceId: number, targetId: number): Promise<Connection> {
    const response = await fetch(`${BACKEND_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
    })
    if (!response.ok) throw new Error('Failed to create connection')
    return response.json()
  }

  async deleteConnection(id: number): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/api/connections/${id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Failed to delete connection')
  }

  getFileUrl(filePath: string): string {
    if (filePath.startsWith('http')) return filePath
    return `${BACKEND_URL}${filePath}`
  }
}
