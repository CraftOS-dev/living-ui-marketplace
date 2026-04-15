import type {
  AppState,
  Contact,
  Company,
  Deal,
  DealStage,
  Activity,
  Note,
  Tag,
  PipelineStage,
  PaginatedResponse,
  SearchResults,
  DashboardSummary,
  SmtpConfig,
  AIEmailRequest,
  AIEmailResponse,
  LeadScore,
  SalesForecast,
  ImportJob,
} from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

const BACKEND_URL = 'http://localhost:{{BACKEND_PORT}}/api'

export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
    currentView: 'dashboard',

    // Data caches
    contacts: null,
    companies: null,
    deals: null,
    pipeline: null,
    activities: null,
    stages: [],
    tags: [],
    dashboardSummary: null,

    // Detail views
    selectedContact: null,
    selectedCompany: null,
    selectedDeal: null,

    // UI state
    sidebarCollapsed: false,
    searchQuery: '',
    // Modal states
    showContactForm: false,
    showCompanyForm: false,
    showDealForm: false,
    showActivityForm: false,
    editingContact: null,
    editingCompany: null,
    editingDeal: null,
  }

  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable: boolean = false

  // ========================================================================
  // Generic fetch helper
  // ========================================================================

  private async fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(text || `HTTP ${res.status}`)
    }
    const contentType = res.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      return res.json()
    }
    return {} as T
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

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

        // Load essential data in parallel
        await Promise.all([
          this.fetchStages(),
          this.fetchTags(),
          this.fetchDashboardSummary(),
        ])
      } catch (error) {
        console.error('[AppController] Failed to load from backend:', error)
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
    if (cached) {
      this.state = {
        ...this.state,
        ...cached,
        initialized: true,
        loading: false,
        error: this.backendAvailable ? null : 'Backend unavailable - using cached data',
      }
    } else {
      this.state = {
        ...this.state,
        initialized: true,
        loading: false,
        error: this.backendAvailable ? null : 'Backend unavailable - no cached data',
      }
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

  async setState(
    updates: Partial<AppState>,
    persistToBackend: boolean = true
  ): Promise<void> {
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

    stateCache.save(this.state as unknown as Record<string, unknown>)
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
  // Navigation
  // ========================================================================

  async navigateTo(view: string): Promise<void> {
    await this.setState({ currentView: view, error: null })
  }

  // ========================================================================
  // Contacts
  // ========================================================================

  async fetchContacts(params?: {
    page?: number
    perPage?: number
    search?: string
    status?: string
    leadStatus?: string
    companyId?: number
    tagId?: number
    sortBy?: string
    sortDir?: string
  }): Promise<PaginatedResponse<Contact>> {
    try {
      const qs = new URLSearchParams()
      if (params?.page) qs.set('page', String(params.page))
      if (params?.perPage) qs.set('per_page', String(params.perPage))
      if (params?.search) qs.set('search', params.search)
      if (params?.status) qs.set('status', params.status)
      if (params?.leadStatus) qs.set('lead_status', params.leadStatus)
      if (params?.companyId) qs.set('company_id', String(params.companyId))
      if (params?.tagId) qs.set('tag_id', String(params.tagId))
      if (params?.sortBy) qs.set('sort_by', params.sortBy)
      if (params?.sortDir) qs.set('sort_dir', params.sortDir)
      const queryStr = qs.toString()

      const result = await this.fetchJson<PaginatedResponse<Contact>>(
        `${BACKEND_URL}/contacts${queryStr ? '?' + queryStr : ''}`
      )
      await this.setState({ contacts: result }, false)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch contacts'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async getContact(id: number): Promise<Contact> {
    const contact = await this.fetchJson<Contact>(`${BACKEND_URL}/contacts/${id}`)
    await this.setState({ selectedContact: contact }, false)
    return contact
  }

  async createContact(data: Partial<Contact> & { firstName: string; lastName: string; tagIds?: number[] }): Promise<Contact> {
    try {
      const contact = await this.fetchJson<Contact>(`${BACKEND_URL}/contacts`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      // Refresh contacts list
      if (this.state.contacts) {
        await this.fetchContacts({ page: this.state.contacts.page, perPage: this.state.contacts.perPage })
      }
      return contact
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create contact'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async updateContact(id: number, data: Partial<Contact> & { tagIds?: number[] }): Promise<Contact> {
    try {
      const contact = await this.fetchJson<Contact>(`${BACKEND_URL}/contacts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      if (this.state.selectedContact?.id === id) {
        await this.setState({ selectedContact: contact }, false)
      }
      return contact
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update contact'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async deleteContact(id: number): Promise<void> {
    try {
      await this.fetchJson(`${BACKEND_URL}/contacts/${id}`, { method: 'DELETE' })
      if (this.state.selectedContact?.id === id) {
        await this.setState({ selectedContact: null }, false)
      }
      if (this.state.contacts) {
        await this.fetchContacts({ page: this.state.contacts.page, perPage: this.state.contacts.perPage })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete contact'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Companies
  // ========================================================================

  async fetchCompanies(params?: {
    page?: number
    perPage?: number
    search?: string
    industry?: string
    sortBy?: string
    sortDir?: string
  }): Promise<PaginatedResponse<Company>> {
    try {
      const qs = new URLSearchParams()
      if (params?.page) qs.set('page', String(params.page))
      if (params?.perPage) qs.set('per_page', String(params.perPage))
      if (params?.search) qs.set('search', params.search)
      if (params?.industry) qs.set('industry', params.industry)
      if (params?.sortBy) qs.set('sort_by', params.sortBy)
      if (params?.sortDir) qs.set('sort_dir', params.sortDir)
      const queryStr = qs.toString()

      const result = await this.fetchJson<PaginatedResponse<Company>>(
        `${BACKEND_URL}/companies${queryStr ? '?' + queryStr : ''}`
      )
      await this.setState({ companies: result }, false)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch companies'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async getCompany(id: number): Promise<Company> {
    const company = await this.fetchJson<Company>(`${BACKEND_URL}/companies/${id}`)
    await this.setState({ selectedCompany: company }, false)
    return company
  }

  async createCompany(data: Partial<Company> & { name: string }): Promise<Company> {
    try {
      const company = await this.fetchJson<Company>(`${BACKEND_URL}/companies`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      if (this.state.companies) {
        await this.fetchCompanies({ page: this.state.companies.page, perPage: this.state.companies.perPage })
      }
      return company
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create company'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async updateCompany(id: number, data: Partial<Company>): Promise<Company> {
    try {
      const company = await this.fetchJson<Company>(`${BACKEND_URL}/companies/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      if (this.state.selectedCompany?.id === id) {
        await this.setState({ selectedCompany: company }, false)
      }
      return company
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update company'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async deleteCompany(id: number): Promise<void> {
    try {
      await this.fetchJson(`${BACKEND_URL}/companies/${id}`, { method: 'DELETE' })
      if (this.state.selectedCompany?.id === id) {
        await this.setState({ selectedCompany: null }, false)
      }
      if (this.state.companies) {
        await this.fetchCompanies({ page: this.state.companies.page, perPage: this.state.companies.perPage })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete company'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Deals
  // ========================================================================

  async fetchDeals(params?: {
    page?: number
    perPage?: number
    search?: string
    stageId?: number
    status?: string
    companyId?: number
    priority?: string
    sortBy?: string
    sortDir?: string
  }): Promise<PaginatedResponse<Deal>> {
    try {
      const qs = new URLSearchParams()
      if (params?.page) qs.set('page', String(params.page))
      if (params?.perPage) qs.set('per_page', String(params.perPage))
      if (params?.search) qs.set('search', params.search)
      if (params?.stageId) qs.set('stage_id', String(params.stageId))
      if (params?.status) qs.set('status', params.status)
      if (params?.companyId) qs.set('company_id', String(params.companyId))
      if (params?.priority) qs.set('priority', params.priority)
      if (params?.sortBy) qs.set('sort_by', params.sortBy)
      if (params?.sortDir) qs.set('sort_dir', params.sortDir)
      const queryStr = qs.toString()

      const result = await this.fetchJson<PaginatedResponse<Deal>>(
        `${BACKEND_URL}/deals${queryStr ? '?' + queryStr : ''}`
      )
      await this.setState({ deals: result }, false)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch deals'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async getDeal(id: number): Promise<Deal> {
    const deal = await this.fetchJson<Deal>(`${BACKEND_URL}/deals/${id}`)
    await this.setState({ selectedDeal: deal }, false)
    return deal
  }

  async createDeal(data: Partial<Deal> & { title: string; stageId: number; contactIds?: number[] }): Promise<Deal> {
    try {
      const deal = await this.fetchJson<Deal>(`${BACKEND_URL}/deals`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      if (this.state.deals) {
        await this.fetchDeals({ page: this.state.deals.page, perPage: this.state.deals.perPage })
      }
      return deal
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create deal'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async updateDeal(id: number, data: Partial<Deal> & { contactIds?: number[] }): Promise<Deal> {
    try {
      const deal = await this.fetchJson<Deal>(`${BACKEND_URL}/deals/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      if (this.state.selectedDeal?.id === id) {
        await this.setState({ selectedDeal: deal }, false)
      }
      return deal
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update deal'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async deleteDeal(id: number): Promise<void> {
    try {
      await this.fetchJson(`${BACKEND_URL}/deals/${id}`, { method: 'DELETE' })
      if (this.state.selectedDeal?.id === id) {
        await this.setState({ selectedDeal: null }, false)
      }
      if (this.state.deals) {
        await this.fetchDeals({ page: this.state.deals.page, perPage: this.state.deals.perPage })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete deal'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async moveDeal(id: number, stageId: number, position: number): Promise<Deal> {
    try {
      const deal = await this.fetchJson<Deal>(`${BACKEND_URL}/deals/${id}/move`, {
        method: 'PUT',
        body: JSON.stringify({ stageId, position }),
      })
      // Refresh pipeline after move
      await this.fetchPipeline()
      return deal
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to move deal'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async fetchPipeline(): Promise<PipelineStage[]> {
    try {
      const pipeline = await this.fetchJson<PipelineStage[]>(`${BACKEND_URL}/deals/pipeline`)
      await this.setState({ pipeline }, false)
      return pipeline
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch pipeline'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Deal Stages
  // ========================================================================

  async fetchStages(): Promise<DealStage[]> {
    try {
      const stages = await this.fetchJson<DealStage[]>(`${BACKEND_URL}/stages`)
      await this.setState({ stages }, false)
      return stages
    } catch (err) {
      console.error('[AppController] Failed to fetch stages:', err)
      return []
    }
  }

  // ========================================================================
  // Activities
  // ========================================================================

  async fetchActivities(params?: {
    page?: number
    perPage?: number
    entityType?: string
    entityId?: number
    activityType?: string
    isCompleted?: boolean
    sortBy?: string
    sortDir?: string
  }): Promise<PaginatedResponse<Activity>> {
    try {
      const qs = new URLSearchParams()
      if (params?.page) qs.set('page', String(params.page))
      if (params?.perPage) qs.set('per_page', String(params.perPage))
      if (params?.entityType) qs.set('entity_type', params.entityType)
      if (params?.entityId) qs.set('entity_id', String(params.entityId))
      if (params?.activityType) qs.set('activity_type', params.activityType)
      if (params?.isCompleted !== undefined) qs.set('is_completed', String(params.isCompleted))
      if (params?.sortBy) qs.set('sort_by', params.sortBy)
      if (params?.sortDir) qs.set('sort_dir', params.sortDir)
      const queryStr = qs.toString()

      const result = await this.fetchJson<PaginatedResponse<Activity>>(
        `${BACKEND_URL}/activities${queryStr ? '?' + queryStr : ''}`
      )
      await this.setState({ activities: result }, false)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch activities'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async createActivity(data: {
    entityType: string
    entityId: number
    activityType: string
    subject: string
    description?: string
    dueDate?: string
    priority?: string
    durationMinutes?: number
    assignedTo?: string
    extraData?: Record<string, unknown>
  }): Promise<Activity> {
    try {
      const activity = await this.fetchJson<Activity>(`${BACKEND_URL}/activities`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return activity
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create activity'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async completeActivity(id: number): Promise<Activity> {
    try {
      const activity = await this.fetchJson<Activity>(`${BACKEND_URL}/activities/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isCompleted: true }),
      })
      return activity
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to complete activity'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Notes
  // ========================================================================

  async fetchNotes(entityType: string, entityId: number): Promise<Note[]> {
    try {
      return await this.fetchJson<Note[]>(
        `${BACKEND_URL}/notes?entity_type=${entityType}&entity_id=${entityId}`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch notes'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async createNote(data: { entityType: string; entityId: number; content: string }): Promise<Note> {
    try {
      return await this.fetchJson<Note>(`${BACKEND_URL}/notes`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create note'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Tags
  // ========================================================================

  async fetchTags(): Promise<Tag[]> {
    try {
      const tags = await this.fetchJson<Tag[]>(`${BACKEND_URL}/tags`)
      await this.setState({ tags }, false)
      return tags
    } catch (err) {
      console.error('[AppController] Failed to fetch tags:', err)
      return []
    }
  }

  async createTag(data: { name: string; color?: string }): Promise<Tag> {
    try {
      const tag = await this.fetchJson<Tag>(`${BACKEND_URL}/tags`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      await this.fetchTags()
      return tag
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create tag'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Dashboard
  // ========================================================================

  async fetchDashboardSummary(): Promise<DashboardSummary> {
    try {
      const dashboardSummary = await this.fetchJson<DashboardSummary>(
        `${BACKEND_URL}/dashboard/summary`
      )
      await this.setState({ dashboardSummary }, false)
      return dashboardSummary
    } catch (err) {
      console.error('[AppController] Failed to fetch dashboard summary:', err)
      throw err
    }
  }

  // ========================================================================
  // Search
  // ========================================================================

  async globalSearch(query: string): Promise<SearchResults> {
    try {
      await this.setState({ searchQuery: query }, false)
      return await this.fetchJson<SearchResults>(
        `${BACKEND_URL}/search?q=${encodeURIComponent(query)}`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // AI Features
  // ========================================================================

  async scoreLead(contactId: number): Promise<LeadScore> {
    try {
      return await this.fetchJson<LeadScore>(
        `${BACKEND_URL}/ai/score-lead/${contactId}`,
        { method: 'POST' }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lead scoring failed'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async generateEmail(request: AIEmailRequest): Promise<AIEmailResponse> {
    try {
      return await this.fetchJson<AIEmailResponse>(`${BACKEND_URL}/ai/generate-email`, {
        method: 'POST',
        body: JSON.stringify(request),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Email generation failed'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async forecastDeal(dealId: number): Promise<SalesForecast> {
    try {
      return await this.fetchJson<SalesForecast>(
        `${BACKEND_URL}/ai/forecast-deal/${dealId}`,
        { method: 'POST' }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deal forecast failed'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Import / Export
  // ========================================================================

  async importContacts(data: {
    data: Array<Record<string, unknown>>
    mapping?: Record<string, string>
  }): Promise<ImportJob> {
    try {
      return await this.fetchJson<ImportJob>(`${BACKEND_URL}/import/contacts`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async exportContacts(): Promise<void> {
    try {
      const res = await fetch(`${BACKEND_URL}/export/contacts`)
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`)
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'contacts_export.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // SMTP & Email
  // ========================================================================

  async getSmtpConfig(): Promise<SmtpConfig> {
    return this.fetchJson<SmtpConfig>(`${BACKEND_URL}/smtp/config`)
  }

  async updateSmtpConfig(data: {
    smtpServer: string
    smtpPort?: number
    emailAddress: string
    password?: string
    useTls?: boolean
    fromName?: string
  }): Promise<SmtpConfig> {
    try {
      return await this.fetchJson<SmtpConfig>(`${BACKEND_URL}/smtp/config`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update SMTP config'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  async sendEmail(data: {
    contactId?: number
    toEmail: string
    subject: string
    body: string
  }): Promise<Record<string, unknown>> {
    try {
      return await this.fetchJson<Record<string, unknown>>(`${BACKEND_URL}/email/send`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send email'
      await this.setState({ error: message }, false)
      throw err
    }
  }

  // ========================================================================
  // Seed Demo Data
  // ========================================================================

  async seedDemoData(): Promise<Record<string, unknown>> {
    try {
      await this.setState({ loading: true }, false)
      const result = await this.fetchJson<Record<string, unknown>>(
        `${BACKEND_URL}/seed/demo-data`,
        { method: 'POST' }
      )
      // Refresh everything after seeding
      await this.initialize()
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to seed demo data'
      await this.setState({ error: message, loading: false }, false)
      throw err
    }
  }
}
