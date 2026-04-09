import type {
  AppState, IntegrationStatus, YouTubeChannel, YouTubeVideo, SyncResult,
  AnalysisStatus, ContentAnalysisData,
} from './types'
import { ApiService } from './services/ApiService'
import { toast } from 'react-toastify'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3109'

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

  // ============================================================
  // Content Analysis
  // ============================================================

  async startAnalysis(): Promise<{ analysisId: number } | null> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/analysis/start`, { method: 'POST' })
      if (!resp.ok) throw new Error()
      const data = await resp.json()
      if (data.status === 'already_running') {
        toast.info('Analysis already running')
      } else {
        toast.success('Analysis started')
      }
      return { analysisId: data.analysisId }
    } catch { toast.error('Failed to start analysis'); return null }
  }

  async getAnalysisStatus(id: number): Promise<AnalysisStatus | null> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/analysis/status/${id}`)
      if (!resp.ok) throw new Error()
      return resp.json()
    } catch { return null }
  }

  async getLatestAnalysis(): Promise<ContentAnalysisData | null> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/analysis/latest`)
      if (!resp.ok) throw new Error()
      return resp.json()
    } catch { return null }
  }

  async getAnalysis(id: number): Promise<ContentAnalysisData | null> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/analysis/${id}`)
      if (!resp.ok) throw new Error()
      return resp.json()
    } catch { return null }
  }
}
