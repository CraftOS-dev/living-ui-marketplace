/**
 * AppController - Main state controller for Invoice & Subscription Tracker Living UI V2
 */

import { toast } from '../kit/index.ts'
import type { InvoiceReceipt, Subscription, DashboardStats, ActivityEvent, TrackerGroup } from './types.ts'
import { ApiService } from './services/ApiService.ts'

export interface ControllerState {
  initialized: boolean
  loading: boolean
  error: string | null
  stats: DashboardStats | null
  invoices: InvoiceReceipt[]
  subscriptions: Subscription[]
  activities: ActivityEvent[]
  groups: TrackerGroup[]
  activeGroupId: string | number | null
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
    activeGroupName: 'All Workspaces',
    currentTab: 'dashboard',
    searchQuery: '',
    selectedCategory: 'all',
    selectedPaymentType: 'all',
    allCategories: [
      'Cloud Infrastructure',
      'Software & SaaS',
      'Developer Tools & DevOps',
      'Productivity & AI',
      'Design & Creative',
      'Marketing & Growth',
      'Security & Compliance',
      'Communications & Collaboration',
      'Finance & Operations',
      'Customer Support',
      'Other Services',
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
  }

  private listeners: Set<(state: ControllerState) => void> = new Set()
  private pollTimer: any = null

  async initialize(): Promise<void> {
    console.log('[AppController] Initializing Invoice & Subscription Tracker V2...')
    try {
      const fetchedGroups = await ApiService.fetchGroups()
      this.state.groups = fetchedGroups
      if (fetchedGroups.length > 0 && fetchedGroups[0] && !this.state.activeGroupId) {
        this.state.activeGroupId = fetchedGroups[0].id
        this.state.activeGroupName = fetchedGroups[0].name
      }

      await this.refreshData(true)
      this.state.initialized = true
      this.state.loading = false
      this.notifyListeners()

      this.startPolling()
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
    }, 10000)
  }

  async setActiveGroup(groupId: string | number | null): Promise<void> {
    this.state.activeGroupId = groupId
    const grp = this.state.groups.find((g) => g.id === groupId)
    if (grp) {
      this.state.activeGroupName = grp.name
    } else {
      this.state.activeGroupName = 'All Workspaces'
    }
    toast.info(`Switched workspace to: ${this.state.activeGroupName}`)
    await this.refreshData(true)
  }

  async refreshData(showLoading = false): Promise<void> {
    if (showLoading) {
      this.state.loading = true
      this.notifyListeners()
    }

    try {
      const grpId = this.state.activeGroupId
      const [invoices, subscriptions, activities, groups] = await Promise.all([
        ApiService.fetchInvoices(grpId),
        ApiService.fetchSubscriptions(grpId),
        ApiService.fetchActivities(grpId),
        ApiService.fetchGroups(),
      ])

      const stats = ApiService.computeDashboardStatsFromData(invoices, subscriptions)
      stats.recentActivities = activities
      this.state.stats = stats
      this.state.invoices = invoices
      this.state.subscriptions = subscriptions
      this.state.activities = activities
      this.state.groups = groups

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

  // Group Operations
  async createGroup(data: { name: string; description?: string; color?: string; icon?: string; currency?: string }): Promise<void> {
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

  async updateGroup(groupId: string | number, data: { name?: string; description?: string; color?: string; icon?: string; currency?: string }): Promise<void> {
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

  async deleteGroup(groupId: string | number): Promise<void> {
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

  // Subscriptions
  async createManualSubscription(data: any): Promise<void> {
    try {
      const grpId = data.groupId || data.group_id || this.state.activeGroupId
      await ApiService.createSubscription({
        ...data,
        groupId: grpId,
      })
      toast.success(`✨ Added Subscription: ${data.name} ($${Number(data.amount).toFixed(2)}/${data.billingFrequency || 'mo'})!`)
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

  async toggleSubscriptionStatus(id: string | number): Promise<void> {
    try {
      const sub = await ApiService.toggleSubscriptionStatus(id)
      toast.success(`Subscription is now ${sub.status}`)
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to toggle subscription: ' + err.message)
    }
  }

  async updateSubscription(id: string | number, data: Partial<Subscription>): Promise<void> {
    try {
      await ApiService.updateSubscription(id, data)
      toast.success('Subscription updated successfully.')
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to update subscription: ' + err.message)
    }
  }

  async updateSubscriptionStatus(id: string | number, status: 'active' | 'paused' | 'cancelled'): Promise<void> {
    await this.updateSubscription(id, { status })
  }

  async deleteSubscription(id: string | number): Promise<void> {
    try {
      await ApiService.deleteSubscription(id)
      toast.info('Subscription deleted.')
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to delete subscription: ' + err.message)
    }
  }

  // Invoices
  async createManualInvoice(data: any): Promise<void> {
    try {
      const grpId = data.groupId || data.group_id || this.state.activeGroupId
      const newInv = await ApiService.createInvoice({
        ...data,
        groupId: grpId,
      })
      toast.success(`✨ Added Invoice: ${newInv.vendor} ($${newInv.amount.toFixed(2)})!`)
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

  async updateInvoice(id: string | number, data: Partial<InvoiceReceipt>): Promise<void> {
    try {
      await ApiService.updateInvoice(id, data)
      toast.success('Invoice updated.')
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to update invoice: ' + err.message)
    }
  }

  async deleteInvoice(id: string | number): Promise<void> {
    try {
      await ApiService.deleteInvoice(id)
      toast.info('Invoice deleted.')
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to delete invoice: ' + err.message)
    }
  }

  // Simulation & Manual Ingestion
  async createManualIngestionEvent(data: any): Promise<void> {
    try {
      await ApiService.logActivity({
        eventType: data.eventType || 'manual_event',
        title: data.title || 'Manual Event',
        description: data.description,
        amount: Number(data.amount) || 0,
        vendor: data.vendor,
        groupId: this.state.activeGroupId,
      })
      toast.success('Activity event logged.')
      await this.refreshData(false)
    } catch (err: any) {
      toast.error('Failed to log event: ' + err.message)
    }
  }

  async simulateEmailBill(preset = 'aws'): Promise<void> {
    this.state.isSimulating = true
    this.notifyListeners()
    try {
      const res = await ApiService.simulateEmail(preset)
      toast.success(`⚡ Simulated email ingestion: ${preset.toUpperCase()} received!`)
      this.state.livePulseActive = true
      this.state.lastSimulatedInvoice = res.invoice
      this.notifyListeners()
      await this.refreshData(false)
      setTimeout(() => {
        this.state.livePulseActive = false
        this.notifyListeners()
      }, 4000)
    } catch (err: any) {
      toast.error('Simulation failed: ' + err.message)
    } finally {
      this.state.isSimulating = false
      this.notifyListeners()
    }
  }

  async simulateIncomingBill(preset = 'aws'): Promise<void> {
    await this.simulateEmailBill(preset)
  }

  async triggerMailboxSync(): Promise<void> {
    await this.simulateEmailBill('aws')
  }

  // Navigation & Modals
  setTab(tab: ControllerState['currentTab']): void {
    this.state.currentTab = tab
    this.notifyListeners()
  }

  setCurrentTab(tab: ControllerState['currentTab']): void {
    this.setTab(tab)
  }

  setSelectedInvoice(inv: InvoiceReceipt | null): void {
    this.state.selectedInvoice = inv
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

  setSelectedPaymentType(type: string): void {
    this.state.selectedPaymentType = type
    this.notifyListeners()
  }

  openInvoiceDetail(inv: InvoiceReceipt): void {
    this.state.selectedInvoice = inv
    this.notifyListeners()
  }

  closeInvoiceDetail(): void {
    this.state.selectedInvoice = null
    this.notifyListeners()
  }

  openAddInvoiceModal(): void {
    this.state.isAddInvoiceModalOpen = true
    this.notifyListeners()
  }

  closeAddInvoiceModal(): void {
    this.state.isAddInvoiceModalOpen = false
    this.notifyListeners()
  }

  setAddInvoiceModalOpen(open: boolean): void {
    this.state.isAddInvoiceModalOpen = open
    this.notifyListeners()
  }

  openAddSubscriptionModal(): void {
    this.state.isAddSubscriptionModalOpen = true
    this.notifyListeners()
  }

  closeAddSubscriptionModal(): void {
    this.state.isAddSubscriptionModalOpen = false
    this.notifyListeners()
  }

  setAddSubscriptionModalOpen(open: boolean): void {
    this.state.isAddSubscriptionModalOpen = open
    this.notifyListeners()
  }

  openAddIngestionModal(): void {
    this.state.isAddIngestionModalOpen = true
    this.notifyListeners()
  }

  closeAddIngestionModal(): void {
    this.state.isAddIngestionModalOpen = false
    this.notifyListeners()
  }

  setAddIngestionModalOpen(open: boolean): void {
    this.state.isAddIngestionModalOpen = open
    this.notifyListeners()
  }

  openGroupModal(): void {
    this.state.isAddGroupModalOpen = true
    this.notifyListeners()
  }

  closeGroupModal(): void {
    this.state.isAddGroupModalOpen = false
    this.notifyListeners()
  }

  setAddGroupModalOpen(open: boolean): void {
    this.state.isAddGroupModalOpen = open
    this.notifyListeners()
  }

  openSyncModal(): void {
    this.state.isSyncModalOpen = true
    this.notifyListeners()
  }

  closeSyncModal(): void {
    this.state.isSyncModalOpen = false
    this.notifyListeners()
  }

  setSyncModalOpen(open: boolean): void {
    this.state.isSyncModalOpen = open
    this.notifyListeners()
  }

  getState(): ControllerState {
    return { ...this.state }
  }

  subscribe(listener: (state: ControllerState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    const currentState = this.getState()
    this.listeners.forEach((listener) => listener(currentState))
  }
}
