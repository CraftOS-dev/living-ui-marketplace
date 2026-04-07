import type {
  AppState, IntegrationStatus, YouTubeChannel, YouTubeVideo, SyncResult
} from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'
import { toast } from 'react-toastify'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'

export class AppController {
  private state: AppState = { initialized: false, loading: true, error: null }
  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable = false

  async initialize(): Promise<void> {
    this.backendAvailable = await ApiService.healthCheck()
    this.state = { ...this.state, initialized: true, loading: false, error: this.backendAvailable ? null : 'Backend unavailable' }
    this.notifyListeners()
  }

  cleanup(): void { this.listeners.clear() }
  getState(): AppState { return { ...this.state } }
  isBackendAvailable(): boolean { return this.backendAvailable }
  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notifyListeners(): void { this.listeners.forEach(l => l(this.getState())) }

  // ============================================================
  // Integration Status
  // ============================================================

  async getIntegrationStatus(): Promise<IntegrationStatus> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/integrations/status`)
      if (!resp.ok) throw new Error()
      return resp.json()
    } catch {
      return { bridgeAvailable: false, integrations: [] }
    }
  }

  // ============================================================
  // YouTube
  // ============================================================

  async getYouTubeChannels(): Promise<YouTubeChannel[]> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/youtube/channels`)
      if (!resp.ok) throw new Error()
      return resp.json()
    } catch { toast.error('Failed to load channels'); return [] }
  }

  async getYouTubeVideos(): Promise<YouTubeVideo[]> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/youtube/videos`)
      if (!resp.ok) throw new Error()
      return resp.json()
    } catch { toast.error('Failed to load videos'); return [] }
  }

  async syncYouTube(): Promise<SyncResult | null> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/youtube/sync`, { method: 'POST' })
      if (!resp.ok) throw new Error()
      const result = await resp.json()
      if (result.status === 'ok') {
        toast.success('YouTube data synced')
      } else if (result.status === 'partial') {
        toast.warn('YouTube sync completed with some errors')
      }
      return result
    } catch {
      toast.error('Failed to sync YouTube data')
      return null
    }
  }
}
