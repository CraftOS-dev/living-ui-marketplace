/**
 * REST API Client for Invoice & Subscription Tracker (Multi-Group Workspace)
 */

import type {
  DashboardStats,
  InvoiceReceipt,
  Subscription,
  ActivityEvent,
  TrackerGroup,
  YearlyHistoryData,
} from '../types'

const API_BASE = '/api'

export class ApiService {
  /**
   * Fetch all workspace groups
   */
  static async fetchGroups(): Promise<TrackerGroup[]> {
    try {
      const res = await fetch(`${API_BASE}/groups`)
      if (!res.ok) throw new Error('Failed to fetch groups')
      return await res.json()
    } catch (e) {
      console.warn('Using local fallback groups:', e)
      return [
        {
          id: 1,
          name: 'Engineering & Cloud Stack',
          description: 'Production infrastructure, AWS clusters, databases & CI/CD',
          color: '#FF9900',
          icon: 'Cpu',
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 2,
          name: 'AI & Modern Dev Tools',
          description: 'AI coding assistants, LLM APIs, Vercel & design tools',
          color: '#00A67E',
          icon: 'Sparkles',
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]
    }
  }

  /**
   * Create a new workspace group
   */
  static async createGroup(data: {
    name: string
    description?: string
    color?: string
    icon?: string
    currency?: string
    template_type?: string
  }): Promise<TrackerGroup> {
    const res = await fetch(`${API_BASE}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to create group')
    }
    return await res.json()
  }

  /**
   * Update group
   */
  static async updateGroup(groupId: number, data: Partial<TrackerGroup>): Promise<TrackerGroup> {
    const res = await fetch(`${API_BASE}/groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to update group')
    return await res.json()
  }

  /**
   * Delete group
   */
  static async deleteGroup(groupId: number): Promise<void> {
    const res = await fetch(`${API_BASE}/groups/${groupId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete group')
  }

  /**
   * Fetch live dashboard statistics for active group
   */
  static async fetchDashboardStats(groupId?: number): Promise<DashboardStats> {
    const url = groupId ? `${API_BASE}/dashboard/stats?group_id=${groupId}` : `${API_BASE}/dashboard/stats`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch dashboard stats')
    return await res.json()
  }

  /**
   * Fetch multi-year financial history for active group
   */
  static async fetchYearlyHistory(groupId?: number): Promise<YearlyHistoryData> {
    const url = groupId ? `${API_BASE}/yearly-history?group_id=${groupId}` : `${API_BASE}/yearly-history`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch yearly history')
    return await res.json()
  }

  static async getYearlyHistory(groupId?: number | null): Promise<YearlyHistoryData> {
    return this.fetchYearlyHistory(groupId || undefined)
  }

  /**
   * Fetch filterable invoices list for active group
   */
  static async fetchInvoices(params: {
    category?: string
    paymentType?: string
    vendor?: string
    search?: string
    groupId?: number
    limit?: number
  } = {}): Promise<InvoiceReceipt[]> {
    const query = new URLSearchParams()
    if (params.category && params.category !== 'all') query.set('category', params.category)
    if (params.paymentType && params.paymentType !== 'all') query.set('payment_type', params.paymentType)
    if (params.vendor) query.set('vendor', params.vendor)
    if (params.search) query.set('search', params.search)
    if (params.groupId) query.set('group_id', String(params.groupId))
    if (params.limit) query.set('limit', String(params.limit))

    const res = await fetch(`${API_BASE}/invoices?${query.toString()}`)
    if (!res.ok) throw new Error('Failed to fetch invoices')
    return await res.json()
  }

  /**
   * Create an invoice/receipt manually
   */
  static async createInvoice(data: {
    vendor: string
    amount: number
    currency?: string
    payment_type?: string
    billing_frequency?: string
    category?: string
    purpose?: string
    invoice_date?: string
    invoice_number?: string
    group_id?: number
    notes?: string
    has_pdf_attachment?: boolean
    pdf_filename?: string
    pdf_text_preview?: string
  }): Promise<InvoiceReceipt> {
    const res = await fetch(`${API_BASE}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to create invoice')
    }
    return await res.json()
  }

  /**
   * Update invoice
   */
  static async updateInvoice(invoiceId: number, data: any): Promise<InvoiceReceipt> {
    const res = await fetch(`${API_BASE}/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to update invoice')
    return await res.json()
  }

  /**
   * Delete invoice
   */
  static async deleteInvoice(invoiceId: number): Promise<void> {
    const res = await fetch(`${API_BASE}/invoices/${invoiceId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete invoice')
  }

  /**
   * Fetch active subscriptions for active group
   */
  static async fetchSubscriptions(params: {
    category?: string
    status?: string
    groupId?: number
  } = {}): Promise<Subscription[]> {
    const query = new URLSearchParams()
    if (params.category && params.category !== 'all') query.set('category', params.category)
    if (params.status && params.status !== 'all') query.set('status', params.status)
    if (params.groupId) query.set('group_id', String(params.groupId))

    const res = await fetch(`${API_BASE}/subscriptions?${query.toString()}`)
    if (!res.ok) throw new Error('Failed to fetch subscriptions')
    return await res.json()
  }

  /**
   * Create a new recurring subscription
   */
  static async createSubscription(data: {
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
  }): Promise<Subscription> {
    const res = await fetch(`${API_BASE}/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to create subscription')
    }
    return await res.json()
  }

  /**
   * Update subscription
   */
  static async updateSubscription(subId: number, data: Partial<Subscription>): Promise<Subscription> {
    const res = await fetch(`${API_BASE}/subscriptions/${subId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to update subscription')
    return await res.json()
  }

  /**
   * Delete subscription
   */
  static async deleteSubscription(subId: number): Promise<void> {
    const res = await fetch(`${API_BASE}/subscriptions/${subId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete subscription')
  }

  /**
   * Fetch activity stream for active group
   */
  static async fetchActivity(groupId?: number, limit = 50): Promise<ActivityEvent[]> {
    const url = groupId ? `${API_BASE}/activity?group_id=${groupId}&limit=${limit}` : `${API_BASE}/activity?limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch activity logs')
    return await res.json()
  }

  /**
   * Log manual activity
   */
  static async createActivity(data: {
    event_type: string
    title: string
    description?: string
    amount?: number
    currency?: string
    vendor?: string
    group_id?: number
  }): Promise<ActivityEvent> {
    const res = await fetch(`${API_BASE}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to create activity')
    }
    return await res.json()
  }

  /**
   * Backward-compatibility aliases
   */
  static async getDashboardStats(groupId?: number): Promise<DashboardStats> {
    return this.fetchDashboardStats(groupId)
  }

  static async getInvoices(params: any = {}): Promise<InvoiceReceipt[]> {
    return this.fetchInvoices(params)
  }

  static async getSubscriptions(params: any = {}): Promise<Subscription[]> {
    return this.fetchSubscriptions(params)
  }

  static async addEmailAccount(_data: any): Promise<any> { return {} }
  static async removeEmailAccount(_id: number): Promise<any> { return {} }
  static async syncSpecificEmailAccount(_id: number): Promise<any> { return {} }
  static async syncEmailInbox(): Promise<any> { return {} }
  static async clearDemoData(): Promise<any> { return {} }
  static async simulateIncomingEmail(_payload: any): Promise<any> { return {} }
}

export const apiService = new ApiService()
