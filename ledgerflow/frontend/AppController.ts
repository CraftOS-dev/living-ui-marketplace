import type {
  AppState, Settings, SettingsUpdate, Account, AccountBalance,
  CreateAccountData, UpdateAccountData, Category, CreateCategoryData, UpdateCategoryData,
  Contact, CreateContactData, UpdateContactData, JournalEntry, TransactionFilters,
  RecordIncomeData, RecordExpenseData, RecordTransferData,
  Invoice, CreateInvoiceData, UpdateInvoiceData, RecordInvoicePaymentData,
  Bill, CreateBillData, UpdateBillData, RecordBillPaymentData,
  ProfitLossReport, BalanceSheetReport, TrialBalanceReport, AccountLedgerEntry,
  DashboardSummary, MonthlyData, CategoryBreakdown,
} from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

const BACKEND_URL = 'http://localhost:3109/api'

export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
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
    stateCache.save(this.state as any)
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
  // Settings
  // ========================================================================

  async getSettings(): Promise<Settings> {
    return this.fetchJson<Settings>(`${BACKEND_URL}/settings`)
  }

  async updateSettings(data: SettingsUpdate): Promise<Settings> {
    return this.fetchJson<Settings>(`${BACKEND_URL}/settings`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async seedAccounts(): Promise<{ message: string; count: number }> {
    return this.fetchJson(`${BACKEND_URL}/settings/seed-accounts`, {
      method: 'POST',
    })
  }

  // ========================================================================
  // Accounts
  // ========================================================================

  async getAccounts(): Promise<Account[]> {
    return this.fetchJson<Account[]>(`${BACKEND_URL}/accounts`)
  }

  async getAccount(id: number): Promise<Account> {
    return this.fetchJson<Account>(`${BACKEND_URL}/accounts/${id}`)
  }

  async createAccount(data: CreateAccountData): Promise<Account> {
    return this.fetchJson<Account>(`${BACKEND_URL}/accounts`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateAccount(id: number, data: UpdateAccountData): Promise<Account> {
    return this.fetchJson<Account>(`${BACKEND_URL}/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteAccount(id: number): Promise<void> {
    await this.fetchJson<void>(`${BACKEND_URL}/accounts/${id}`, { method: 'DELETE' })
  }

  async getAccountBalance(id: number): Promise<AccountBalance> {
    return this.fetchJson<AccountBalance>(`${BACKEND_URL}/accounts/${id}/balance`)
  }

  async getAccountsTree(): Promise<Record<string, Account[]>> {
    return this.fetchJson<Record<string, Account[]>>(`${BACKEND_URL}/accounts/tree`)
  }

  // ========================================================================
  // Categories
  // ========================================================================

  async getCategories(): Promise<Category[]> {
    return this.fetchJson<Category[]>(`${BACKEND_URL}/categories`)
  }

  async createCategory(data: CreateCategoryData): Promise<Category> {
    return this.fetchJson<Category>(`${BACKEND_URL}/categories`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateCategory(id: number, data: UpdateCategoryData): Promise<Category> {
    return this.fetchJson<Category>(`${BACKEND_URL}/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteCategory(id: number): Promise<void> {
    await this.fetchJson<void>(`${BACKEND_URL}/categories/${id}`, { method: 'DELETE' })
  }

  // ========================================================================
  // Contacts
  // ========================================================================

  async getContacts(): Promise<Contact[]> {
    return this.fetchJson<Contact[]>(`${BACKEND_URL}/contacts`)
  }

  async getContact(id: number): Promise<Contact> {
    return this.fetchJson<Contact>(`${BACKEND_URL}/contacts/${id}`)
  }

  async createContact(data: CreateContactData): Promise<Contact> {
    return this.fetchJson<Contact>(`${BACKEND_URL}/contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateContact(id: number, data: UpdateContactData): Promise<Contact> {
    return this.fetchJson<Contact>(`${BACKEND_URL}/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteContact(id: number): Promise<void> {
    await this.fetchJson<void>(`${BACKEND_URL}/contacts/${id}`, { method: 'DELETE' })
  }

  // ========================================================================
  // Transactions (Journal Entries)
  // ========================================================================

  async getTransactions(filters?: TransactionFilters): Promise<JournalEntry[]> {
    const params = new URLSearchParams()
    if (filters) {
      if (filters.fromDate) params.set('fromDate', filters.fromDate)
      if (filters.toDate) params.set('toDate', filters.toDate)
      if (filters.accountId) params.set('accountId', String(filters.accountId))
      if (filters.categoryId) params.set('categoryId', String(filters.categoryId))
      if (filters.type) params.set('type', filters.type)
      if (filters.search) params.set('search', filters.search)
      if (filters.limit) params.set('limit', String(filters.limit))
      if (filters.offset) params.set('offset', String(filters.offset))
    }
    const qs = params.toString()
    return this.fetchJson<JournalEntry[]>(`${BACKEND_URL}/transactions${qs ? '?' + qs : ''}`)
  }

  async getTransaction(id: number): Promise<JournalEntry> {
    return this.fetchJson<JournalEntry>(`${BACKEND_URL}/transactions/${id}`)
  }

  async deleteTransaction(id: number): Promise<void> {
    await this.fetchJson<void>(`${BACKEND_URL}/transactions/${id}`, { method: 'DELETE' })
  }

  async recordIncome(data: RecordIncomeData): Promise<JournalEntry> {
    return this.fetchJson<JournalEntry>(`${BACKEND_URL}/transactions/income`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async recordExpense(data: RecordExpenseData): Promise<JournalEntry> {
    return this.fetchJson<JournalEntry>(`${BACKEND_URL}/transactions/expense`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async recordTransfer(data: RecordTransferData): Promise<JournalEntry> {
    return this.fetchJson<JournalEntry>(`${BACKEND_URL}/transactions/transfer`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ========================================================================
  // Invoices
  // ========================================================================

  async getInvoices(status?: string): Promise<Invoice[]> {
    const qs = status && status !== 'all' ? `?status=${status}` : ''
    return this.fetchJson<Invoice[]>(`${BACKEND_URL}/invoices${qs}`)
  }

  async getInvoice(id: number): Promise<Invoice> {
    return this.fetchJson<Invoice>(`${BACKEND_URL}/invoices/${id}`)
  }

  async createInvoice(data: CreateInvoiceData): Promise<Invoice> {
    return this.fetchJson<Invoice>(`${BACKEND_URL}/invoices`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateInvoice(id: number, data: UpdateInvoiceData): Promise<Invoice> {
    return this.fetchJson<Invoice>(`${BACKEND_URL}/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteInvoice(id: number): Promise<void> {
    await this.fetchJson<void>(`${BACKEND_URL}/invoices/${id}`, { method: 'DELETE' })
  }

  async sendInvoice(id: number): Promise<Invoice> {
    return this.fetchJson<Invoice>(`${BACKEND_URL}/invoices/${id}/send`, {
      method: 'POST',
    })
  }

  async recordInvoicePayment(id: number, data: RecordInvoicePaymentData): Promise<Invoice> {
    return this.fetchJson<Invoice>(`${BACKEND_URL}/invoices/${id}/payment`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ========================================================================
  // Bills
  // ========================================================================

  async getBills(status?: string): Promise<Bill[]> {
    const qs = status && status !== 'all' ? `?status=${status}` : ''
    return this.fetchJson<Bill[]>(`${BACKEND_URL}/bills${qs}`)
  }

  async getBill(id: number): Promise<Bill> {
    return this.fetchJson<Bill>(`${BACKEND_URL}/bills/${id}`)
  }

  async createBill(data: CreateBillData): Promise<Bill> {
    return this.fetchJson<Bill>(`${BACKEND_URL}/bills`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateBill(id: number, data: UpdateBillData): Promise<Bill> {
    return this.fetchJson<Bill>(`${BACKEND_URL}/bills/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteBill(id: number): Promise<void> {
    await this.fetchJson<void>(`${BACKEND_URL}/bills/${id}`, { method: 'DELETE' })
  }

  async receiveBill(id: number): Promise<Bill> {
    return this.fetchJson<Bill>(`${BACKEND_URL}/bills/${id}/receive`, {
      method: 'POST',
    })
  }

  async recordBillPayment(id: number, data: RecordBillPaymentData): Promise<Bill> {
    return this.fetchJson<Bill>(`${BACKEND_URL}/bills/${id}/payment`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ========================================================================
  // Reports
  // ========================================================================

  async getProfitLoss(fromDate: string, toDate: string): Promise<ProfitLossReport> {
    return this.fetchJson<ProfitLossReport>(`${BACKEND_URL}/reports/profit-loss?fromDate=${fromDate}&toDate=${toDate}`)
  }

  async getBalanceSheet(asOf: string): Promise<BalanceSheetReport> {
    return this.fetchJson<BalanceSheetReport>(`${BACKEND_URL}/reports/balance-sheet?asOf=${asOf}`)
  }

  async getTrialBalance(fromDate?: string, toDate?: string): Promise<TrialBalanceReport> {
    const params = new URLSearchParams()
    if (fromDate) params.set('fromDate', fromDate)
    if (toDate) params.set('toDate', toDate)
    const qs = params.toString()
    return this.fetchJson<TrialBalanceReport>(`${BACKEND_URL}/reports/trial-balance${qs ? '?' + qs : ''}`)
  }

  async getAccountLedger(accountId: number, fromDate?: string, toDate?: string): Promise<AccountLedgerEntry[]> {
    const params = new URLSearchParams()
    if (fromDate) params.set('fromDate', fromDate)
    if (toDate) params.set('toDate', toDate)
    const qs = params.toString()
    return this.fetchJson<AccountLedgerEntry[]>(`${BACKEND_URL}/reports/account-ledger/${accountId}${qs ? '?' + qs : ''}`)
  }

  // ========================================================================
  // Dashboard
  // ========================================================================

  async getDashboardSummary(): Promise<DashboardSummary> {
    return this.fetchJson<DashboardSummary>(`${BACKEND_URL}/dashboard/summary`)
  }

  async getRecentTransactions(limit: number = 10): Promise<JournalEntry[]> {
    return this.fetchJson<JournalEntry[]>(`${BACKEND_URL}/dashboard/recent-transactions?limit=${limit}`)
  }

  async getOverdueItems(): Promise<{ invoices: Invoice[]; bills: Bill[] }> {
    return this.fetchJson(`${BACKEND_URL}/dashboard/overdue`)
  }

  async getIncomeExpenseChart(months: number = 6): Promise<MonthlyData[]> {
    return this.fetchJson<MonthlyData[]>(`${BACKEND_URL}/dashboard/income-expense-chart?months=${months}`)
  }

  async getExpenseBreakdown(fromDate?: string, toDate?: string): Promise<CategoryBreakdown[]> {
    const params = new URLSearchParams()
    if (fromDate) params.set('fromDate', fromDate)
    if (toDate) params.set('toDate', toDate)
    const qs = params.toString()
    return this.fetchJson<CategoryBreakdown[]>(`${BACKEND_URL}/dashboard/expense-breakdown${qs ? '?' + qs : ''}`)
  }
}
