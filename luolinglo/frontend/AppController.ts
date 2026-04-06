import type { AppState, ViewName, UserProfile, DashboardData } from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

export interface LuolingloState extends AppState {
  activeView: ViewName
  profile: UserProfile | null
  dashboard: DashboardData | null
  profileLoading: boolean
}

export class AppController {
  private state: LuolingloState = {
    initialized: false,
    loading: true,
    error: null,
    activeView: 'dashboard',
    profile: null,
    dashboard: null,
    profileLoading: true,
  }

  private listeners: Set<(state: LuolingloState) => void> = new Set()
  private backendAvailable: boolean = false

  async initialize(): Promise<void> {
    this.backendAvailable = await ApiService.healthCheck()

    if (this.backendAvailable) {
      try {
        const profile = await ApiService.getProfile()
        this.state = {
          ...this.state,
          initialized: true,
          loading: false,
          profile,
          profileLoading: false,
          error: null,
        }

        if (profile) {
          const dashboard = await ApiService.getDashboard()
          this.state.dashboard = dashboard
        }
      } catch (error) {
        this.state = {
          ...this.state,
          initialized: true,
          loading: false,
          profileLoading: false,
          error: 'Failed to connect to backend',
        }
      }
    } else {
      this.state = {
        ...this.state,
        initialized: true,
        loading: false,
        profileLoading: false,
        error: 'Backend unavailable',
      }
    }

    this.notifyListeners()
  }

  cleanup(): void {
    this.listeners.clear()
  }

  getState(): LuolingloState {
    return { ...this.state }
  }

  subscribe(listener: (state: LuolingloState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setActiveView(view: ViewName): void {
    this.state = { ...this.state, activeView: view }
    this.notifyListeners()
  }

  async createProfile(data: { nativeLanguage: string; targetLanguage: string; proficiencyLevel: string; displayName?: string }): Promise<void> {
    try {
      const profile = await ApiService.createProfile(data)
      const dashboard = await ApiService.getDashboard()
      this.state = { ...this.state, profile, dashboard }
      this.notifyListeners()
    } catch (error) {
      throw error
    }
  }

  async updateProfile(data: Partial<UserProfile>): Promise<void> {
    const profile = await ApiService.updateProfile(data)
    this.state = { ...this.state, profile }
    this.notifyListeners()
  }

  async refreshDashboard(): Promise<void> {
    if (!this.state.profile) return
    try {
      const dashboard = await ApiService.getDashboard()
      const profile = await ApiService.getProfile()
      this.state = { ...this.state, dashboard, profile }
      this.notifyListeners()
    } catch (error) {
      console.error('[AppController] Failed to refresh dashboard:', error)
    }
  }

  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.getState()))
  }

  async refresh(): Promise<void> {
    await this.setState({ loading: true }, false)
    await this.initialize()
  }

  async setState(updates: Partial<LuolingloState>, persistToBackend: boolean = true): Promise<void> {
    this.state = { ...this.state, ...updates }
    this.notifyListeners()

    if (persistToBackend && this.backendAvailable) {
      try {
        const { initialized, loading, error, activeView, profile, dashboard, profileLoading, ...persistable } = updates as Record<string, unknown>
        if (Object.keys(persistable).length > 0) {
          await ApiService.updateState(persistable)
        }
      } catch (err) {
        console.error('[AppController] Failed to persist state:', err)
      }
    }

    stateCache.save(this.state as unknown as Record<string, unknown>)
  }
}
