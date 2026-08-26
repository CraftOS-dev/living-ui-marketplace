/**
 * AppController - Main state controller for Invoice & Subscription Tracker Living UI
 */

import { toast } from 'react-toastify'
import type { InvoiceReceipt, Subscription, DashboardStats, ActivityEvent, TrackerGroup } from './types'
import { ApiService } from './services/ApiService'

export interface ControllerState {
  initialized: boolean
  loading: boolean
  error: string | null
  stats: DashboardStats | null
  invoices: InvoiceReceipt[]
  subscriptions: Subscription[]
  activities: ActivityEvent[]
  groups: TrackerGroup[]
  activeGroupId: number | null
  activeGroupName: string
  currentTab: 'dashboard' | 'subscriptions' | 'invoices' | 'monthly-costs' | 'feed' | 'yearly-history'
  searchQuery: string
  selectedCategory: string
  selectedPaymentType: string
  allCategories: string[]
  selectedInvoice: InvoiceReceipt | null
  isSyncModalOpen: boolean
  isAddInvoiceModalOpen: boolean
  isAddSubscriptionModalOpen: boolean
  isAddIngestionModalOpen: boolean
  isAddGroupModalOpen: boolean
  isSimulating: boolean
  lastSimulatedInvoice: InvoiceReceipt | null
  livePulseActive: boolean
  emailAccount?: any
  emailAccounts?: any[]
  activeEmailAccountId?: number | null
}

export class AppController {
  private state: ControllerState = {
    initialized: false,
    loading: true,
    error: null,
    stats: null,
    invoices: [],
    subscriptions: [],
    activities: [],
    groups: [],
    activeGroupId: null,
    activeGroupName: 'Default Workspace',
    currentTab: 'dashboard',
    searchQuery: '',
    selectedCategory: 'all',
    selectedPaymentType: 'all',
    allCategories: [
      'Cloud Infrastructure',
      'Developer Tools & DevOps',
      'Productivity & AI',
      'Communications & Collaboration',
      'Design & Creative',
      'Marketing & Analytics',
      'Security & Compliance',
      'Finance & Operations',
      'Customer Support',
    ],
    selectedInvoice: null,
    isSyncModalOpen: false,
    isAddInvoiceModalOpen: false,
    isAddSubscriptionModalOpen: false,
    isAddIngestionModalOpen: false,
    isAddGroupModalOpen: false,
    isSimulating: false,
    lastSimulatedInvoice: null,
    livePulseActive: false,
    emailAccount: null,
    emailAccounts: [],
    activeEmailAccountId: null,
  }

  private listeners: Set<(state: ControllerState) => void> = new Set()
  private pollTimer: any = null

  async initialize(): Promise<void> {
    console.log('[AppController] Initializing Invoice & Subscription Tracker...')
    try {
      // First fetch groups
      const fetchedGroups = await ApiService.fetchGroups()
      this.state.groups = fetchedGroups
      if (fetchedGroups.length > 0 && !this.state.activeGroupId) {
        this.state.activeGroupId = fetchedGroups[0].id
        this.state.activeGroupName = fetchedGroups[0].name
      }

      await this.refreshData(true)
      this.state.initialized = true
      this.state.loading = false
      this.notifyListeners()

      // Start background polling
      this.startPolling()
      console.log('[AppController] Initialized successfully')
    } catch (err: any) {
      console.error('[AppController] Init error:', err)
      this.state.error = err.message || 'Failed to initialize'
      this.state.loading = false
      this.notifyListeners()
    }
  }

  private startPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      this.refreshData(false)
    }, 6000)
  }

  async setActiveGroup(groupId: number | null): Promise<void> {
    this.state.activeGroupId = groupId
    const grp = this.state.groups.find((g) => g.id === groupId)
    if (grp) {
      this.state.activeGroupName = grp.name
    }
    toast.info(`Switched workspace to: ${this.state.activeGroupName}`, { autoClose: 2000 })
    await this.refreshData(true)
  }

  async refreshData(showLoading = false): Promise<void> {
    if (showLoading) {
      this.state.loading = true
      this.notifyListeners()
    }

    try {
      const grpId = this.state.activeGroupId || undefined
      const [stats, invoices, subscriptions, activities, groups] = await Promise.all([
        ApiService.fetchDashboardStats(grpId),
        ApiService.fetchInvoices({ groupId: grpId }),
        ApiService.fetchSubscriptions({ groupId: grpId }),
        ApiService.fetchActivity(grpId),
        ApiService.fetchGroups(),
      ])

      this.state.stats = stats
      this.state.invoices = invoices
      this.state.subscriptions = subscriptions
      this.state.activities = activities
      this.state.groups = groups

      // Extract unique categories
      const catSet = new Set(this.state.allCategories)
      invoices.forEach((i) => {
        if (i.category) catSet.add(i.category)
      })
      subscriptions.forEach((s) => {
        if (s.category) catSet.add(s.category)
      })
      this.state.allCategories = Array.from(catSet)

      this.state.error = null
    } catch (err: any) {
      console.error('[AppController] refreshData error:', err)
      this.state.error = err.message || 'Error fetching data'
    } finally {
      if (showLoading) {
        this.state.loading = false
      }
      this.notifyListeners()
    }
  }

  // Group Management
  async createGroup(data: { name: string; description?: string; color?: string; icon?: string; currency?: string; template_type?: string }): Promise<void> {
    try {
      const newGrp = await ApiService.createGroup(data)
      toast.success(`Created workspace: ${newGrp.name}`)
      await this.refreshData(false)
      this.state.activeGroupId = newGrp.id
      this.state.activeGroupName = newGrp.name
      this.notifyListeners()
    } catch (err: any) {
      toast.error('Failed to create workspace group: ' + err.message)
      throw err
    }
  }

  async updateGroup(groupId: number, data: { name?: string; description?: string; color?: string; icon?: string; currency?: string }): Promise<void> {
    try {
      const updated = await ApiService.updateGroup(groupId, data)
      toast.success(`Updated workspace: ${updated.name}`)
      if (this.state.activeGroupId === groupId) {
        this.state.activeGroupName = updated.name
      }
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to update workspace: ' + err.message)
      throw err
    }
  }

  async deleteGroup(groupId: number): Promise<void> {
    try {
      await ApiService.deleteGroup(groupId)
      toast.info('Workspace group deleted.')
      this.state.activeGroupId = null
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to delete workspace group: ' + err.message)
      throw err
    }
  }

  // Subscription Manual Entry & Management
  async createManualSubscription(data: {
    name: string
    vendor?: string
    amount: number
    currency?: string
    billing_frequency?: string
    category?: string
    purpose?: string
    status?: string
    group_id?: number
    next_renewal_date?: string
    auto_renew?: boolean
    icon_name?: string
  }): Promise<void> {
    try {
      const grpId = data.group_id || this.state.activeGroupId || undefined
      await ApiService.createSubscription({
        ...data,
        group_id: grpId,
      })
      toast.success(`✨ Added Subscription: ${data.name} ($${data.amount.toFixed(2)}/${data.billing_frequency || 'mo'})!`)
      this.state.livePulseActive = true
      this.notifyListeners()
      await this.refreshData(false)
      setTimeout(() => {
        this.state.livePulseActive = false
        this.notifyListeners()
      }, 4000)
    } catch (err: any) {
      toast.error('Failed to add subscription: ' + err.message)
      throw err
    }
  }

  async updateSubscriptionStatus(id: number, status: 'active' | 'paused' | 'cancelled'): Promise<void> {
    try {
      await ApiService.updateSubscription(id, { status })
      toast.success(`Subscription marked as ${status}`)
      this.state.livePulseActive = true
      this.notifyListeners()
      await this.refreshData(false)
      setTimeout(() => {
        this.state.livePulseActive = false
        this.notifyListeners()
      }, 4000)
    } catch (err: any) {
      toast.error('Failed to update subscription status: ' + err.message)
    }
  }

  async deleteSubscription(id: number): Promise<void> {
    try {
      await ApiService.deleteSubscription(id)
      toast.info('Subscription removed.')
      this.state.livePulseActive = true
      this.notifyListeners()
      await this.refreshData(false)
      setTimeout(() => {
        this.state.livePulseActive = false
        this.notifyListeners()
      }, 4000)
    } catch (err: any) {
      toast.error('Failed to delete subscription: ' + err.message)
    }
  }

  // Invoice & Receipt Manual Entry & Management
  async createManualInvoice(data: Partial<InvoiceReceipt>): Promise<void> {
    try {
      const grpId = data.groupId || this.state.activeGroupId || undefined
      await ApiService.createInvoice({
        vendor: data.vendor || 'Unknown Vendor',
        amount: data.amount || 0,
        currency: data.currency || 'USD',
        payment_type: data.paymentType || 'subscription',
        billing_frequency: data.billingFrequency || 'monthly',
        category: data.category || 'Software & SaaS',
        purpose: data.purpose || '',
        invoice_date: data.invoiceDate || new Date().toISOString(),
        invoice_number: data.invoiceNumber || `INV-${Date.now()}`,
        group_id: grpId,
        notes: data.notes || '',
        has_pdf_attachment: data.hasPdfAttachment || false,
        pdf_filename: data.pdfFilename,
        pdf_text_preview: data.pdfTextPreview,
      })
      toast.success(`🧾 Added Invoice & Receipt: ${data.vendor} ($${Number(data.amount || 0).toFixed(2)})!`)
      this.state.livePulseActive = true
      this.notifyListeners()
      await this.refreshData(false)
      setTimeout(() => {
        this.state.livePulseActive = false
        this.notifyListeners()
      }, 4000)
    } catch (err: any) {
      toast.error('Failed to add invoice: ' + err.message)
      throw err
    }
  }

  async updateInvoice(id: number, data: Partial<InvoiceReceipt>): Promise<void> {
    try {
      const updated = await ApiService.updateInvoice(id, {
        has_pdf_attachment: data.hasPdfAttachment,
        pdf_filename: data.pdfFilename,
        pdf_text_preview: data.pdfTextPreview,
        ...data,
      })
      toast.success('Invoice updated with PDF attachment!')
      if (this.state.selectedInvoice && this.state.selectedInvoice.id === id) {
        this.state.selectedInvoice = { ...this.state.selectedInvoice, ...updated }
      }
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to update invoice: ' + err.message)
    }
  }

  async deleteInvoice(id: number): Promise<void> {
    try {
      await ApiService.deleteInvoice(id)
      toast.info('Invoice deleted.')
      this.state.selectedInvoice = null
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to delete invoice: ' + err.message)
    }
  }

  // Live Ingestion & Activity Manual Entry
  async createManualIngestionEvent(data: {
    event_type: string
    title: string
    description?: string
    amount?: number
    currency?: string
    vendor?: string
    group_id?: number
  }): Promise<void> {
    try {
      const grpId = data.group_id || this.state.activeGroupId || undefined
      await ApiService.createActivity({
        ...data,
        group_id: grpId,
      })
      toast.success(`⚡ Live Ingestion Event Logged: ${data.title}`)
      this.state.livePulseActive = true
      this.notifyListeners()
      await this.refreshData(false)
      setTimeout(() => {
        this.state.livePulseActive = false
        this.notifyListeners()
      }, 4000)
    } catch (err: any) {
      toast.error('Failed to log ingestion event: ' + err.message)
      throw err
    }
  }

  // Tab & Filter state setters
  setCurrentTab(tab: 'dashboard' | 'subscriptions' | 'invoices' | 'monthly-costs' | 'feed' | 'yearly-history'): void {
    this.state.currentTab = tab
    this.notifyListeners()
  }

  setSearchQuery(query: string): void {
    this.state.searchQuery = query
    this.notifyListeners()
  }

  setSelectedCategory(cat: string): void {
    this.state.selectedCategory = cat
    this.notifyListeners()
  }

  setSelectedPaymentType(pt: string): void {
    this.state.selectedPaymentType = pt
    this.notifyListeners()
  }

  setSelectedInvoice(inv: InvoiceReceipt | null): void {
    this.state.selectedInvoice = inv
    this.notifyListeners()
  }

  setSyncModalOpen(open: boolean): void {
    this.state.isSyncModalOpen = open
    this.notifyListeners()
  }

  setAddInvoiceModalOpen(open: boolean): void {
    this.state.isAddInvoiceModalOpen = open
    this.notifyListeners()
  }

  setAddSubscriptionModalOpen(open: boolean): void {
    this.state.isAddSubscriptionModalOpen = open
    this.notifyListeners()
  }

  setAddIngestionModalOpen(open: boolean): void {
    this.state.isAddIngestionModalOpen = open
    this.notifyListeners()
  }

  setAddGroupModalOpen(open: boolean): void {
    this.state.isAddGroupModalOpen = open
    this.notifyListeners()
  }

  // Trigger quick manual scan / refresh
  async triggerMailboxSync(): Promise<void> {
    toast.info('Refreshing live stream & ledger totals...', { autoClose: 2000 })
    await this.refreshData(false)
    toast.success('Live data synchronized!')
  }

  async simulateIncomingBill(preset: string, _customPayload?: any): Promise<void> {
    this.state.isSimulating = true
    this.state.livePulseActive = true
    this.notifyListeners()

    try {
      const presetsMap: Record<string, { vendor: string; amount: number; cat: string; freq: string; purpose: string }> = {
        aws_ec2: { vendor: 'AWS', amount: 3700.71, cat: 'Cloud Infrastructure', freq: 'monthly', purpose: 'EC2 Compute & RDS database cluster' },
        openai_api: { vendor: 'OpenAI', amount: 120.00, cat: 'Productivity & AI', freq: 'monthly', purpose: 'GPT-4o API tokens & team workspace' },
        cursor_pro: { vendor: 'Cursor AI', amount: 20.00, cat: 'Developer Tools & DevOps', freq: 'monthly', purpose: 'AI code generation & agent completions' },
        figma_team: { vendor: 'Figma', amount: 45.00, cat: 'Design & Creative', freq: 'monthly', purpose: 'Design systems & 3 editor licenses' },
        vercel_pro: { vendor: 'Vercel', amount: 20.00, cat: 'Developer Tools & DevOps', freq: 'monthly', purpose: 'Edge serverless hosting & bandwidth' },
      }

      const p = presetsMap[preset] || presetsMap.openai_api
      await this.createManualInvoice({
        vendor: p.vendor,
        amount: p.amount,
        category: p.cat,
        paymentType: 'subscription',
        billingFrequency: p.freq as any,
        purpose: p.purpose,
        invoiceNumber: `LIVE-${Date.now().toString().slice(-6)}`,
        invoiceDate: new Date().toISOString(),
      })
      await this.createManualIngestionEvent({
        event_type: 'invoice_detected',
        title: `Ingested ${p.vendor} Bill`,
        description: `Parsed receipt for ${p.purpose} ($${p.amount.toFixed(2)})`,
        vendor: p.vendor,
        amount: p.amount,
      })
    } catch (err: any) {
      toast.error('Simulation error: ' + err.message)
    } finally {
      this.state.isSimulating = false
      setTimeout(() => {
        this.state.livePulseActive = false
        this.notifyListeners()
      }, 4000)
      this.notifyListeners()
    }
  }

  // Compatibility helpers
  async addEmailAccount(_email: string, _provider?: string): Promise<boolean> { return true }
  async removeEmailAccount(_id: number): Promise<boolean> { return true }
  async syncSpecificEmailAccount(_id: number): Promise<void> {}
  async clearDemoData(): Promise<void> {}

  cleanup(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  getState(): ControllerState {
    return { ...this.state }
  }

  subscribe(listener: (state: ControllerState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    const currentState = this.getState()
    this.listeners.forEach((listener) => listener(currentState))
  }
}
