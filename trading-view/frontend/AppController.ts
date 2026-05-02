import type {
  AppState,
  Stock,
  StockPrice,
  StockWithPrice,
  Candle,
  WatchlistEntry,
  PriceAlert,
  Drawing,
  DrawingToolType,
  WidgetLayout,
  MarketNews,
  IndicatorDataPoint,
  ScreenerFilters,

} from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

/**
 * AppController - Main application controller for TradingView Living UI
 *
 * Handles business logic, state management, and all API communication.
 * State is persisted to the backend (SQLite) and survives page reloads.
 *
 * Architecture:
 * - Backend holds the source of truth for state
 * - Frontend fetches state on mount
 * - State changes are sent to backend, then local state updated
 * - localStorage used as cache for faster initial load
 * - Agent observes via HTTP (GET /api/ui-snapshot, /api/state)
 * - Agent triggers actions via HTTP (POST /api/action)
 *
 * Polling:
 * - Price updates every 3 seconds
 * - Triggered alert checks every 5 seconds
 */
export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
  }

  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable: boolean = false
  private baseUrl: string = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:3105'

  // Polling
  private _priceInterval: ReturnType<typeof setInterval> | null = null
  private _alertInterval: ReturnType<typeof setInterval> | null = null
  private _priceListeners: Set<(prices: StockWithPrice[]) => void> = new Set()
  private _alertListeners: Set<(alerts: PriceAlert[]) => void> = new Set()

  // ============================================================================
  // Core State Management
  // ============================================================================

  /**
   * Initialize the controller
   *
   * Fetches state from backend, falls back to localStorage cache.
   */
  // Guard: ensure we only kick off the seed once per session
  private _seedTriggered: boolean = false

  async initialize(): Promise<void> {
    console.log('[AppController] Initializing...')

    // Check if backend is available
    this.backendAvailable = await ApiService.healthCheck()

    if (this.backendAvailable) {
      console.log('[AppController] Backend available, fetching state...')
      try {
        // Fetch state from backend
        const backendState = await ApiService.getState<Partial<AppState>>()
        this.state = {
          ...this.state,
          ...backendState,
          initialized: true,
          loading: false,
          error: null,
        }

        // Update local cache
        stateCache.saveSync(backendState)
        console.log('[AppController] State loaded from backend')
      } catch (error) {
        console.error('[AppController] Failed to load from backend:', error)
        this.loadFromCache()
      }

      // Kick off symbol-universe seed once per session (idempotent on the backend).
      // Done in the background — UI does not block on it.
      if (!this._seedTriggered) {
        this._seedTriggered = true
        this.seedStocks().catch((err) =>
          console.warn('[AppController] seedStocks (background) failed:', err)
        )
      }
    } else {
      console.warn('[AppController] Backend unavailable, using cache')
      this.loadFromCache()
    }

    this.notifyListeners()
    console.log('[AppController] Initialized')
  }

  /**
   * Load state from localStorage cache (fallback)
   */
  private loadFromCache(): void {
    const cached = stateCache.load()
    if (cached) {
      this.state = {
        ...this.state,
        ...cached,
        initialized: true,
        loading: false,
        error: this.backendAvailable ? null : 'Backend unavailable - using cached data',
      }
      console.log('[AppController] State loaded from cache')
    } else {
      this.state = {
        ...this.state,
        initialized: true,
        loading: false,
        error: this.backendAvailable ? null : 'Backend unavailable - no cached data',
      }
      console.log('[AppController] No cached state found')
    }
  }

  /**
   * Cleanup on unmount
   */
  cleanup(): void {
    this.stopPolling()
    this.listeners.clear()
    this._priceListeners.clear()
    this._alertListeners.clear()
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

  /**
   * Update state and persist to backend
   *
   * @param updates - Partial state to merge
   * @param persistToBackend - Whether to save to backend (default: true)
   */
  async setState(
    updates: Partial<AppState>,
    persistToBackend: boolean = true
  ): Promise<void> {
    // Update local state immediately for responsive UI
    this.state = { ...this.state, ...updates }
    this.notifyListeners()

    // Persist to backend
    if (persistToBackend && this.backendAvailable) {
      try {
        // Remove internal fields before sending to backend
        const { initialized, loading, error, ...persistableState } = updates
        if (Object.keys(persistableState).length > 0) {
          await ApiService.updateState(persistableState)
        }
      } catch (err) {
        console.error('[AppController] Failed to persist state:', err)
      }
    }

    // Update local cache
    stateCache.save(this.state as any)
  }

  /**
   * Execute an action via the backend
   *
   * For complex actions that need server-side processing.
   */
  async executeAction(
    action: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    if (!this.backendAvailable) {
      console.warn('[AppController] Backend unavailable, cannot execute action')
      return
    }

    try {
      const result = await ApiService.executeAction(action, payload)
      if (result.data) {
        // Update local state with result
        this.state = { ...this.state, ...result.data }
        this.notifyListeners()
        stateCache.save(this.state as any)
      }
    } catch (error) {
      console.error('[AppController] Action failed:', error)
    }
  }

  /**
   * Check if backend is available
   */
  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.getState()))
  }

  /**
   * Refresh state from backend
   *
   * Agent can trigger this via POST /api/action with {"action": "refresh"}
   */
  async refresh(): Promise<void> {
    console.log('[AppController] Refresh requested')
    await this.setState({ loading: true }, false)
    await this.initialize()
  }

  // ============================================================================
  // Stock Methods
  // ============================================================================

  /**
   * Seed the database with initial stock data
   */
  async seedStocks(): Promise<{ message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/stocks/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to seed stocks: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] seedStocks failed:', error)
      throw error
    }
  }

  /**
   * Get all stocks
   */
  async getStocks(): Promise<Stock[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/stocks`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get stocks: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getStocks failed:', error)
      return []
    }
  }

  /**
   * Search stocks by query string
   */
  async searchStocks(query: string): Promise<Stock[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/stocks/search?q=${encodeURIComponent(query)}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      )
      if (!response.ok) {
        throw new Error(`Failed to search stocks: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] searchStocks failed:', error)
      return []
    }
  }

  /**
   * Get current prices for all stocks
   */
  async getPrices(): Promise<StockWithPrice[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/stocks/prices`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get prices: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getPrices failed:', error)
      return []
    }
  }

  /**
   * Get the current price for a specific stock
   */
  async getStockPrice(symbol: string): Promise<StockPrice | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/stocks/${encodeURIComponent(symbol)}/price`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      )
      if (!response.ok) {
        throw new Error(`Failed to get stock price: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getStockPrice failed:', error)
      return null
    }
  }

  /**
   * Get candle data for charting
   */
  async getCandles(
    symbol: string,
    timeframe: string,
    limit?: number,
    since?: string
  ): Promise<Candle[]> {
    try {
      const params = new URLSearchParams({ timeframe })
      if (limit !== undefined) params.set('limit', String(limit))
      if (since !== undefined) params.set('since', since)

      const response = await fetch(
        `${this.baseUrl}/api/stocks/${encodeURIComponent(symbol)}/candles?${params.toString()}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      )
      if (!response.ok) {
        throw new Error(`Failed to get candles: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getCandles failed:', error)
      return []
    }
  }

  /**
   * Get technical indicator data for a stock
   */
  async getIndicators(
    symbol: string,
    type: string,
    period: number,
    timeframe: string
  ): Promise<IndicatorDataPoint[]> {
    try {
      const params = new URLSearchParams({
        type,
        period: String(period),
        timeframe,
      })
      const response = await fetch(
        `${this.baseUrl}/api/stocks/${encodeURIComponent(symbol)}/indicators?${params.toString()}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      )
      if (!response.ok) {
        throw new Error(`Failed to get indicators: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getIndicators failed:', error)
      return []
    }
  }

  // ============================================================================
  // Watchlist Methods
  // ============================================================================

  /**
   * Get the current watchlist with stock and price data
   */
  async getWatchlist(): Promise<WatchlistEntry[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/watchlist`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get watchlist: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getWatchlist failed:', error)
      return []
    }
  }

  /**
   * Add a stock to the watchlist
   */
  async addToWatchlist(symbol: string): Promise<WatchlistEntry | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      if (!response.ok) {
        throw new Error(`Failed to add to watchlist: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] addToWatchlist failed:', error)
      return null
    }
  }

  /**
   * Reorder watchlist items
   */
  async reorderWatchlist(
    items: { id: number; sortOrder: number }[]
  ): Promise<{ message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/watchlist/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!response.ok) {
        throw new Error(`Failed to reorder watchlist: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] reorderWatchlist failed:', error)
      throw error
    }
  }

  /**
   * Remove a stock from the watchlist
   */
  async removeFromWatchlist(id: number): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/watchlist/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to remove from watchlist: ${response.statusText}`)
      }
    } catch (error) {
      console.error('[AppController] removeFromWatchlist failed:', error)
      throw error
    }
  }

  // ============================================================================
  // Drawing Methods
  // ============================================================================

  /**
   * Get all drawings for a stock, optionally filtered by timeframe
   */
  async getDrawings(symbol: string, timeframe?: string): Promise<Drawing[]> {
    try {
      const params = timeframe
        ? `?timeframe=${encodeURIComponent(timeframe)}`
        : ''
      const response = await fetch(
        `${this.baseUrl}/api/stocks/${encodeURIComponent(symbol)}/drawings${params}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      )
      if (!response.ok) {
        throw new Error(`Failed to get drawings: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getDrawings failed:', error)
      return []
    }
  }

  /**
   * Create a new drawing on a stock chart
   */
  async createDrawing(
    symbol: string,
    data: {
      toolType: DrawingToolType
      drawingData: Record<string, unknown>
      color: string
      timeframe: string
    }
  ): Promise<Drawing | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/stocks/${encodeURIComponent(symbol)}/drawings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      )
      if (!response.ok) {
        throw new Error(`Failed to create drawing: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] createDrawing failed:', error)
      return null
    }
  }

  /**
   * Update an existing drawing
   */
  async updateDrawing(
    id: number,
    data: {
      drawingData?: Record<string, unknown>
      color?: string
    }
  ): Promise<Drawing | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/drawings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(`Failed to update drawing: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] updateDrawing failed:', error)
      return null
    }
  }

  /**
   * Delete a drawing
   */
  async deleteDrawing(id: number): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/drawings/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to delete drawing: ${response.statusText}`)
      }
    } catch (error) {
      console.error('[AppController] deleteDrawing failed:', error)
      throw error
    }
  }

  // ============================================================================
  // Alert Methods
  // ============================================================================

  /**
   * Get all alerts, optionally filtered by stock symbol
   */
  async getAlerts(symbol?: string): Promise<PriceAlert[]> {
    try {
      let url = `${this.baseUrl}/api/alerts`
      if (symbol) {
        url = `${this.baseUrl}/api/alerts?symbol=${encodeURIComponent(symbol)}`
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get alerts: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getAlerts failed:', error)
      return []
    }
  }

  /**
   * Create a new price alert
   */
  async createAlert(data: {
    symbol: string
    targetPrice: number
    condition: 'above' | 'below'
  }): Promise<PriceAlert | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(`Failed to create alert: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] createAlert failed:', error)
      return null
    }
  }

  /**
   * Delete an alert
   */
  async deleteAlert(id: number): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/alerts/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to delete alert: ${response.statusText}`)
      }
    } catch (error) {
      console.error('[AppController] deleteAlert failed:', error)
      throw error
    }
  }

  /**
   * Get all recently triggered alerts
   */
  async getTriggeredAlerts(): Promise<PriceAlert[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/alerts/triggered`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get triggered alerts: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getTriggeredAlerts failed:', error)
      return []
    }
  }

  // ============================================================================
  // Layout Methods
  // ============================================================================

  /**
   * Get the current widget layout configuration
   */
  async getLayout(): Promise<WidgetLayout | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/layout`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get layout: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getLayout failed:', error)
      return null
    }
  }

  /**
   * Save the widget layout configuration
   */
  async saveLayout(data: {
    layoutData: Record<string, unknown>
    chartConfig: Record<string, unknown>
    layoutName?: string
  }): Promise<WidgetLayout | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(`Failed to save layout: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] saveLayout failed:', error)
      return null
    }
  }

  // ============================================================================
  // Screener Methods
  // ============================================================================

  /**
   * Get screener results based on filter criteria
   */
  async getScreenerResults(filters: ScreenerFilters): Promise<StockWithPrice[]> {
    try {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value))
        }
      }
      const query = params.toString()
      const url = query
        ? `${this.baseUrl}/api/screener?${query}`
        : `${this.baseUrl}/api/screener`

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get screener results: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getScreenerResults failed:', error)
      return []
    }
  }

  // ============================================================================
  // News Methods
  // ============================================================================

  /**
   * Get market news, optionally filtered by stock symbol
   */
  async getNews(symbol?: string): Promise<MarketNews[]> {
    try {
      let url = `${this.baseUrl}/api/news`
      if (symbol) {
        url = `${this.baseUrl}/api/news?symbol=${encodeURIComponent(symbol)}`
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Failed to get news: ${response.statusText}`)
      }
      return response.json()
    } catch (error) {
      console.error('[AppController] getNews failed:', error)
      return []
    }
  }

  // ============================================================================
  // Polling System
  // ============================================================================

  /**
   * Start all polling intervals for real-time data
   *
   * - Price updates: every 3 seconds
   * - Triggered alert checks: every 5 seconds
   */
  startPolling(): void {
    console.log('[AppController] Starting polling...')
    this.stopPolling()

    // Price polling - every 3 seconds
    this._priceInterval = setInterval(async () => {
      try {
        const prices = await this.getPrices()
        this._priceListeners.forEach((cb) => {
          try {
            cb(prices)
          } catch (err) {
            console.error('[AppController] Price listener error:', err)
          }
        })
      } catch (error) {
        console.error('[AppController] Price polling error:', error)
      }
    }, 3000)

    // Alert polling - every 5 seconds
    this._alertInterval = setInterval(async () => {
      try {
        const triggered = await this.getTriggeredAlerts()
        if (triggered.length > 0) {
          this._alertListeners.forEach((cb) => {
            try {
              cb(triggered)
            } catch (err) {
              console.error('[AppController] Alert listener error:', err)
            }
          })
        }
      } catch (error) {
        console.error('[AppController] Alert polling error:', error)
      }
    }, 5000)

    console.log('[AppController] Polling started')
  }

  /**
   * Stop all polling intervals
   */
  stopPolling(): void {
    if (this._priceInterval !== null) {
      clearInterval(this._priceInterval)
      this._priceInterval = null
    }
    if (this._alertInterval !== null) {
      clearInterval(this._alertInterval)
      this._alertInterval = null
    }
    console.log('[AppController] Polling stopped')
  }

  /**
   * Subscribe to real-time price updates (polled every 3s)
   *
   * @returns Unsubscribe function
   */
  onPriceUpdate(callback: (prices: StockWithPrice[]) => void): () => void {
    this._priceListeners.add(callback)
    return () => this._priceListeners.delete(callback)
  }

  /**
   * Subscribe to triggered alert notifications (polled every 5s)
   *
   * @returns Unsubscribe function
   */
  onAlertTriggered(callback: (alerts: PriceAlert[]) => void): () => void {
    this._alertListeners.add(callback)
    return () => this._alertListeners.delete(callback)
  }
}
