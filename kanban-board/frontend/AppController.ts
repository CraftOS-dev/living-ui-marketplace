import type { AppState, Board, BoardList, Card, Label, ChecklistItem, BoardStats, SearchParams } from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'
import { authService } from './services/AuthService'

const BACKEND_URL = ((window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}') + '/api'

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
      try {
        const backendState = await ApiService.getState<Partial<AppState>>()
        this.state = {
          ...this.state,
          ...backendState,
          initialized: true,
          loading: false,
          error: null,
        }
        stateCache.saveSync(backendState)
      } catch (error) {
        console.error('[AppController] Failed to load from backend:', error)
        this.loadFromCache()
      }
    } else {
      this.loadFromCache()
    }

    this.notifyListeners()
  }

  private loadFromCache(): void {
    const cached = stateCache.load()
    if (cached) {
      this.state = { ...this.state, ...cached, initialized: true, loading: false, error: this.backendAvailable ? null : 'Backend unavailable' }
    } else {
      this.state = { ...this.state, initialized: true, loading: false, error: this.backendAvailable ? null : 'Backend unavailable' }
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
    return () => this.listeners.delete(listener)
  }

  async setState(updates: Partial<AppState>, persistToBackend: boolean = true): Promise<void> {
    this.state = { ...this.state, ...updates }
    this.notifyListeners()
    if (persistToBackend && this.backendAvailable) {
      try {
        const { initialized, loading, error, ...persistableState } = updates
        if (Object.keys(persistableState).length > 0) {
          await ApiService.updateState(persistableState)
        }
      } catch (err) {
        console.error('[AppController] Failed to persist state:', err)
      }
    }
    stateCache.save({ ...this.state })
  }

  async executeAction(action: string, payload?: Record<string, unknown>): Promise<void> {
    if (!this.backendAvailable) return
    try {
      const result = await ApiService.executeAction(action, payload)
      if (result.data) {
        this.state = { ...this.state, ...result.data }
        this.notifyListeners()
      }
    } catch (error) {
      console.error('[AppController] Action failed:', error)
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

  // ========================================================================
  // Board API
  // ========================================================================

  async getBoards(): Promise<Board[]> {
    const res = await authService.authFetch(`${BACKEND_URL}/boards`)
    if (!res.ok) throw new Error('Failed to fetch boards')
    return res.json()
  }

  async createBoard(name: string): Promise<Board> {
    const res = await authService.authFetch(`${BACKEND_URL}/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error('Failed to create board')
    return res.json()
  }

  async getBoard(id: number): Promise<Board> {
    const res = await authService.authFetch(`${BACKEND_URL}/boards/${id}`)
    if (!res.ok) throw new Error('Failed to fetch board')
    return res.json()
  }

  async updateBoard(id: number, name: string): Promise<Board> {
    const res = await authService.authFetch(`${BACKEND_URL}/boards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error('Failed to update board')
    return res.json()
  }

  async deleteBoard(id: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/boards/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete board')
  }

  // ========================================================================
  // List API
  // ========================================================================

  async createList(boardId: number, title: string): Promise<BoardList> {
    const res = await authService.authFetch(`${BACKEND_URL}/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId, title }),
    })
    if (!res.ok) throw new Error('Failed to create list')
    return res.json()
  }

  async updateList(listId: number, title: string): Promise<BoardList> {
    const res = await authService.authFetch(`${BACKEND_URL}/lists/${listId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error('Failed to update list')
    return res.json()
  }

  async deleteList(listId: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/lists/${listId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete list')
  }

  async moveList(listId: number, position: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/lists/${listId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    })
    if (!res.ok) throw new Error('Failed to move list')
  }

  // ========================================================================
  // Card API
  // ========================================================================

  async createCard(listId: number, title: string, extra?: Partial<Card>): Promise<Card> {
    const res = await authService.authFetch(`${BACKEND_URL}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: listId, title, ...extra }),
    })
    if (!res.ok) throw new Error('Failed to create card')
    return res.json()
  }

  async getCard(cardId: number): Promise<Card> {
    const res = await authService.authFetch(`${BACKEND_URL}/cards/${cardId}`)
    if (!res.ok) throw new Error('Failed to fetch card')
    return res.json()
  }

  async updateCard(cardId: number, data: Record<string, unknown>): Promise<Card> {
    const res = await authService.authFetch(`${BACKEND_URL}/cards/${cardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to update card')
    return res.json()
  }

  async deleteCard(cardId: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/cards/${cardId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete card')
  }

  async moveCard(cardId: number, listId: number, position: number): Promise<Card> {
    const res = await authService.authFetch(`${BACKEND_URL}/cards/${cardId}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: listId, position }),
    })
    if (!res.ok) throw new Error('Failed to move card')
    return res.json()
  }

  // ========================================================================
  // Label API
  // ========================================================================

  async getLabels(boardId: number): Promise<Label[]> {
    const res = await authService.authFetch(`${BACKEND_URL}/boards/${boardId}/labels`)
    if (!res.ok) throw new Error('Failed to fetch labels')
    return res.json()
  }

  async createLabel(boardId: number, name: string, color: string): Promise<Label> {
    const res = await authService.authFetch(`${BACKEND_URL}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId, name, color }),
    })
    if (!res.ok) throw new Error('Failed to create label')
    return res.json()
  }

  async updateLabel(labelId: number, data: Partial<Label>): Promise<Label> {
    const res = await authService.authFetch(`${BACKEND_URL}/labels/${labelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to update label')
    return res.json()
  }

  async deleteLabel(labelId: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/labels/${labelId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete label')
  }

  async assignLabel(cardId: number, labelId: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/cards/${cardId}/labels/${labelId}`, { method: 'PUT' })
    if (!res.ok) throw new Error('Failed to assign label')
  }

  async removeLabel(cardId: number, labelId: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/cards/${cardId}/labels/${labelId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to remove label')
  }

  // ========================================================================
  // Checklist API
  // ========================================================================

  async createChecklistItem(cardId: number, text: string): Promise<ChecklistItem> {
    const res = await authService.authFetch(`${BACKEND_URL}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cardId, text }),
    })
    if (!res.ok) throw new Error('Failed to create checklist item')
    return res.json()
  }

  async updateChecklistItem(itemId: number, data: Partial<ChecklistItem>): Promise<ChecklistItem> {
    const res = await authService.authFetch(`${BACKEND_URL}/checklist/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to update checklist item')
    return res.json()
  }

  async deleteChecklistItem(itemId: number): Promise<void> {
    const res = await authService.authFetch(`${BACKEND_URL}/checklist/${itemId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete checklist item')
  }

  // ========================================================================
  // Search & Stats API
  // ========================================================================

  async searchCards(boardId: number, params: SearchParams): Promise<Card[]> {
    const res = await authService.authFetch(`${BACKEND_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId, ...params }),
    })
    if (!res.ok) throw new Error('Failed to search cards')
    return res.json()
  }

  async getBoardStats(boardId: number): Promise<BoardStats> {
    const res = await authService.authFetch(`${BACKEND_URL}/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId }),
    })
    if (!res.ok) throw new Error('Failed to fetch stats')
    return res.json()
  }
}
