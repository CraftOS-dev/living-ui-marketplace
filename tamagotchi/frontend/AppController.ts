import type { AppState, Pet, ActivityLogEntry, EvolutionStatus, CareAction } from './types'
import { ApiService } from './services/ApiService'

/**
 * AppController - CraftBot Pet Tamagotchi Controller
 *
 * Manages pet state, polling, and care actions.
 * Backend is the source of truth — frontend polls every 10 seconds.
 */
export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
    pet: null,
    retiredPet: null,
    activityLog: [],
    evolutionStatus: null,
  }

  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable: boolean = false
  private pollInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Initialize the controller — fetch pet state and start polling
   */
  async initialize(): Promise<void> {
    console.log('[AppController] Initializing...')
    this.backendAvailable = await ApiService.healthCheck()

    if (this.backendAvailable) {
      await this.fetchPetState()
      this.startPolling()
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

  /**
   * Fetch current pet state from backend
   */
  async fetchPetState(): Promise<void> {
    try {
      // Try to get active pet
      const petResponse = await fetch('/api/pet')
      if (petResponse.status === 404) {
        // No active pet — check for retired pet
        const retiredResponse = await fetch('/api/pet/retired')
        let retiredPet = null
        if (retiredResponse.ok) {
          const retiredData = await retiredResponse.json()
          // Handle both old (404) and new ({retired: false}) response formats
          retiredPet = retiredData && retiredData.id ? retiredData : null
        }
        this.state = {
          ...this.state,
          initialized: true,
          loading: false,
          error: null,
          pet: null,
          retiredPet,
          activityLog: [],
          evolutionStatus: null,
        }
      } else if (petResponse.ok) {
        const pet: Pet = await petResponse.json()
        // Fetch activity log and evolution status in parallel
        const [activityResponse, evolutionResponse] = await Promise.all([
          fetch('/api/pet/activity'),
          fetch('/api/pet/evolution-status'),
        ])
        const activityLog: ActivityLogEntry[] = activityResponse.ok ? await activityResponse.json() : []
        const evolutionStatus: EvolutionStatus | null = evolutionResponse.ok ? await evolutionResponse.json() : null
        this.state = {
          ...this.state,
          initialized: true,
          loading: false,
          error: null,
          pet,
          retiredPet: null,
          activityLog,
          evolutionStatus,
        }
      } else {
        throw new Error(`Failed to fetch pet: ${petResponse.status}`)
      }
    } catch (error) {
      console.error('[AppController] Failed to fetch pet state:', error)
      this.state = {
        ...this.state,
        initialized: true,
        loading: false,
        error: 'Failed to load pet data',
      }
    }
    this.notifyListeners()
  }

  /**
   * Start polling for pet state updates every 10 seconds
   */
  private startPolling(): void {
    if (this.pollInterval) return
    this.pollInterval = setInterval(async () => {
      if (this.state.pet && !this.state.pet.is_retired) {
        await this.fetchPetState()
      }
    }, 10000)
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  /**
   * Cleanup on unmount
   */
  cleanup(): void {
    this.stopPolling()
    this.listeners.clear()
  }

  /**
   * Get current state
   */
  getState(): AppState {
    return { ...this.state }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.getState()))
  }

  /**
   * Create a new pet (hatch an egg)
   */
  async createPet(name: string): Promise<void> {
    this.state = { ...this.state, loading: true }
    this.notifyListeners()
    try {
      const response = await fetch('/api/pet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Failed to create pet')
      }
      await this.fetchPetState()
      this.startPolling()
    } catch (error: any) {
      this.state = { ...this.state, loading: false, error: error.message }
      this.notifyListeners()
      throw error
    }
  }

  /**
   * Perform a care action on the pet
   */
  async performAction(action: CareAction): Promise<void> {
    try {
      const response = await fetch(`/api/pet/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || `Failed to ${action}`)
      }
      await this.fetchPetState()
    } catch (error: any) {
      throw error
    }
  }

  /**
   * Retire the pet (trigger retirement ceremony)
   */
  async retirePet(): Promise<void> {
    try {
      const response = await fetch('/api/pet/retire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Failed to retire pet')
      }
      this.stopPolling()
      await this.fetchPetState()
    } catch (error: any) {
      throw error
    }
  }

  /**
   * Check if an action is on cooldown
   */
  isOnCooldown(action: CareAction, cooldownSeconds: number): boolean {
    const pet = this.state.pet
    if (!pet || cooldownSeconds === 0) return false
    const lastUsedStr = pet.cooldowns[action]
    if (!lastUsedStr) return false
    const lastUsed = new Date(lastUsedStr).getTime()
    const elapsed = (Date.now() - lastUsed) / 1000
    return elapsed < cooldownSeconds
  }

  /**
   * Get remaining cooldown seconds for an action
   */
  getCooldownRemaining(action: CareAction, cooldownSeconds: number): number {
    const pet = this.state.pet
    if (!pet || cooldownSeconds === 0) return 0
    const lastUsedStr = pet.cooldowns[action]
    if (!lastUsedStr) return 0
    const lastUsed = new Date(lastUsedStr).getTime()
    const elapsed = (Date.now() - lastUsed) / 1000
    return Math.max(0, Math.ceil(cooldownSeconds - elapsed))
  }

  /**
   * Check if backend is available
   */
  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  /**
   * Refresh state from backend
   */
  async refresh(): Promise<void> {
    await this.fetchPetState()
  }

  /**
   * Legacy setState for compatibility
   */
  async setState(updates: Partial<AppState>, _persistToBackend: boolean = true): Promise<void> {
    this.state = { ...this.state, ...updates }
    this.notifyListeners()
  }
}
