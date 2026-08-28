/**
 * PocketBase API Service for Invoice & Subscription Tracker (V2)
 */

import { getPbClient } from '../../kit/index.ts'
import type {
  DashboardStats,
  InvoiceReceipt,
  Subscription,
  ActivityEvent,
  TrackerGroup,
  YearlyHistoryData,
  MonthlySpendBar,
  SpendSegment,
} from '../types.ts'

export class ApiService {
  private static get pb() {
    return getPbClient().pb
  }

  // --- Groups ---
  static async fetchGroups(): Promise<TrackerGroup[]> {
    try {
      const records = await this.pb.collection('groups').getFullList({
        sort: '-created',
        requestKey: null,
      })
      return records.map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        color: r.color || '#3B82F6',
        icon: r.icon || 'Server',
        currency: r.currency || 'USD',
        createdAt: r.created,
        updatedAt: r.updated,
      }))
    } catch (e) {
      console.warn('Failed to fetch groups from PocketBase:', e)
      return [
        {
          id: 'grp-default',
          name: 'Engineering & Cloud Stack',
          description: 'Production infrastructure, AWS clusters, databases & CI/CD',
          color: '#FF9900',
          icon: 'Cpu',
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]
    }
  }

  static async createGroup(data: Partial<TrackerGroup>): Promise<TrackerGroup> {
    const res = await this.pb.collection('groups').create({
      name: data.name,
      description: data.description,
      color: data.color || '#3B82F6',
      icon: data.icon || 'Folder',
      currency: data.currency || 'USD',
    })
    return {
      id: res.id,
      name: res.name,
      description: res.description,
      color: res.color,
      icon: res.icon,
      currency: res.currency,
      createdAt: res.created,
      updatedAt: res.updated,
    }
  }

  static async updateGroup(groupId: string | number, data: Partial<TrackerGroup>): Promise<TrackerGroup> {
    const res = await this.pb.collection('groups').update(String(groupId), data)
    return {
      id: res.id,
      name: res.name,
      description: res.description,
      color: res.color,
      icon: res.icon,
      currency: res.currency,
      createdAt: res.created,
      updatedAt: res.updated,
    }
  }

  static async deleteGroup(groupId: string | number): Promise<void> {
    await this.pb.collection('groups').delete(String(groupId))
  }

  // --- Subscriptions ---
  static async fetchSubscriptions(groupId?: string | number | null): Promise<Subscription[]> {
    try {
      const filter = groupId && groupId !== 'all' ? `group_id = "${groupId}"` : ''
      const records = await this.pb.collection('subscriptions').getFullList({
        filter,
        sort: '-created',
        requestKey: null,
      })
      return records.map((r: any) => ({
        id: r.id,
        name: r.name || r.vendor,
        vendor: r.vendor || r.name,
        amount: Number(r.amount) || 0,
        currency: r.currency || 'USD',
        billingFrequency: r.billing_frequency || 'monthly',
        category: r.category || 'Software & SaaS',
        purpose: r.purpose || '',
        status: r.status || 'active',
        groupId: r.group_id,
        lastBilledDate: r.last_billed_date || r.created,
        nextRenewalDate: r.next_renewal_date,
        autoRenew: r.auto_renew ?? true,
        iconName: r.icon_name || 'CreditCard',
        createdAt: r.created,
        updatedAt: r.updated,
      }))
    } catch (e) {
      console.warn('Failed to fetch subscriptions:', e)
      return []
    }
  }

  static async createSubscription(data: Partial<Subscription>): Promise<Subscription> {
    const res = await this.pb.collection('subscriptions').create({
      name: data.name || data.vendor,
      vendor: data.vendor || data.name,
      amount: Number(data.amount) || 0,
      currency: data.currency || 'USD',
      billing_frequency: data.billingFrequency || 'monthly',
      category: data.category || 'Software & SaaS',
      purpose: data.purpose || '',
      status: data.status || 'active',
      group_id: data.groupId || '',
      last_billed_date: data.lastBilledDate || new Date().toISOString(),
      next_renewal_date: data.nextRenewalDate || new Date(Date.now() + 30 * 86400000).toISOString(),
      auto_renew: data.autoRenew ?? true,
      icon_name: data.iconName || 'CreditCard',
    })

    // Log activity
    await this.logActivity({
      eventType: 'subscription_created',
      title: `New Subscription: ${res.name || res.vendor}`,
      description: `Created recurring subscription of ${res.currency} ${Number(res.amount).toFixed(2)}/${res.billing_frequency}.`,
      amount: Number(res.amount),
      vendor: res.vendor || res.name,
      groupId: res.group_id,
    })

    return {
      id: res.id,
      name: res.name,
      vendor: res.vendor,
      amount: Number(res.amount),
      currency: res.currency,
      billingFrequency: res.billing_frequency,
      category: res.category,
      purpose: res.purpose,
      status: res.status,
      groupId: res.group_id,
      lastBilledDate: res.last_billed_date,
      nextRenewalDate: res.next_renewal_date,
      autoRenew: res.auto_renew,
      iconName: res.icon_name,
      createdAt: res.created,
      updatedAt: res.updated,
    }
  }

  static async updateSubscription(id: string | number, data: Partial<Subscription>): Promise<Subscription> {
    const payload: any = {}
    if (data.name !== undefined) payload.name = data.name
    if (data.vendor !== undefined) payload.vendor = data.vendor
    if (data.amount !== undefined) payload.amount = Number(data.amount)
    if (data.currency !== undefined) payload.currency = data.currency
    if (data.billingFrequency !== undefined) payload.billing_frequency = data.billingFrequency
    if (data.category !== undefined) payload.category = data.category
    if (data.purpose !== undefined) payload.purpose = data.purpose
    if (data.status !== undefined) payload.status = data.status
    if (data.groupId !== undefined) payload.group_id = data.groupId
    if (data.autoRenew !== undefined) payload.auto_renew = data.autoRenew
    if (data.nextRenewalDate !== undefined) payload.next_renewal_date = data.nextRenewalDate

    const res = await this.pb.collection('subscriptions').update(String(id), payload)
    return {
      id: res.id,
      name: res.name,
      vendor: res.vendor,
      amount: Number(res.amount),
      currency: res.currency,
      billingFrequency: res.billing_frequency,
      category: res.category,
      purpose: res.purpose,
      status: res.status,
      groupId: res.group_id,
      lastBilledDate: res.last_billed_date,
      nextRenewalDate: res.next_renewal_date,
      autoRenew: res.auto_renew,
      iconName: res.icon_name,
      createdAt: res.created,
      updatedAt: res.updated,
    }
  }

  static async toggleSubscriptionStatus(id: string | number): Promise<Subscription> {
    const current = await this.pb.collection('subscriptions').getOne(String(id))
    const nextStatus = current.status === 'active' ? 'paused' : 'active'
    const res = await this.pb.collection('subscriptions').update(String(id), { status: nextStatus })

    await this.logActivity({
      eventType: `subscription_${nextStatus}`,
      title: `Subscription ${nextStatus === 'active' ? 'Resumed' : 'Paused'}: ${res.name || res.vendor}`,
      description: `Subscription ${res.name || res.vendor} is now ${nextStatus}.`,
      amount: Number(res.amount),
      vendor: res.vendor || res.name,
      groupId: res.group_id,
    })

    return {
      id: res.id,
      name: res.name,
      vendor: res.vendor,
      amount: Number(res.amount),
      currency: res.currency,
      billingFrequency: res.billing_frequency,
      category: res.category,
      purpose: res.purpose,
      status: res.status,
      groupId: res.group_id,
      lastBilledDate: res.last_billed_date,
      nextRenewalDate: res.next_renewal_date,
      autoRenew: res.auto_renew,
      iconName: res.icon_name,
      createdAt: res.created,
      updatedAt: res.updated,
    }
  }

  static async deleteSubscription(id: string | number): Promise<void> {
    const current = await this.pb.collection('subscriptions').getOne(String(id)).catch(() => null)
    await this.pb.collection('subscriptions').delete(String(id))
    if (current) {
      await this.logActivity({
        eventType: 'subscription_cancelled',
        title: `Subscription Removed: ${current.name || current.vendor}`,
        description: `Cancelled subscription for ${current.name || current.vendor}.`,
        amount: Number(current.amount),
        vendor: current.vendor || current.name,
        groupId: current.group_id,
      })
    }
  }

  // --- Invoices ---
  static async fetchInvoices(groupId?: string | number | null): Promise<InvoiceReceipt[]> {
    try {
      const filter = groupId && groupId !== 'all' ? `group_id = "${groupId}"` : ''
      const records = await this.pb.collection('invoices').getFullList({
        filter,
        sort: '-created',
        requestKey: null,
      })
      return records.map((r: any) => ({
        id: r.id,
        vendor: r.vendor,
        amount: Number(r.amount) || 0,
        currency: r.currency || 'USD',
        paymentType: r.payment_type || 'one_time',
        billingFrequency: r.billing_frequency || 'none',
        category: r.category || 'Software & SaaS',
        purpose: r.purpose || '',
        invoiceDate: r.invoice_date || r.created,
        invoiceNumber: r.invoice_number || `INV-${r.id}`,
        groupId: r.group_id,
        hasPdfAttachment: r.has_pdf_attachment ?? true,
        pdfFilename: r.pdf_filename || `${r.vendor}_Invoice.pdf`,
        pdfTextPreview: r.pdf_text_preview || '',
        pdfDataBase64: r.pdf_data_base64,
        lineItems: Array.isArray(r.line_items) ? r.line_items : [],
        notes: r.notes || '',
        subscriptionId: r.subscription_id,
        confidenceScore: Number(r.confidence_score) || 0.99,
        isVerified: r.is_verified ?? true,
        createdAt: r.created,
        updatedAt: r.updated,
      }))
    } catch (e) {
      console.warn('Failed to fetch invoices:', e)
      return []
    }
  }

  static async createInvoice(data: Partial<InvoiceReceipt>): Promise<InvoiceReceipt> {
    const res = await this.pb.collection('invoices').create({
      vendor: data.vendor,
      amount: Number(data.amount) || 0,
      currency: data.currency || 'USD',
      payment_type: data.paymentType || 'one_time',
      billing_frequency: data.billingFrequency || 'none',
      category: data.category || 'Software & SaaS',
      purpose: data.purpose || '',
      invoice_date: data.invoiceDate || new Date().toISOString(),
      invoice_number: data.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      group_id: data.groupId || '',
      has_pdf_attachment: data.hasPdfAttachment ?? true,
      pdf_filename: data.pdfFilename || `${data.vendor}_Receipt.pdf`,
      pdf_text_preview: data.pdfTextPreview || `RECEIPT\nVendor: ${data.vendor}\nAmount: $${Number(data.amount || 0).toFixed(2)}`,
      line_items: data.lineItems || [],
      notes: data.notes || '',
      subscription_id: data.subscriptionId || '',
      confidence_score: data.confidenceScore ?? 0.99,
      is_verified: data.isVerified ?? true,
    })

    await this.logActivity({
      eventType: 'invoice_created',
      title: `Invoice Added: ${res.vendor}`,
      description: `Recorded ${res.currency} ${Number(res.amount).toFixed(2)} invoice #${res.invoice_number}.`,
      amount: Number(res.amount),
      vendor: res.vendor,
      groupId: res.group_id,
    })

    return {
      id: res.id,
      vendor: res.vendor,
      amount: Number(res.amount),
      currency: res.currency,
      paymentType: res.payment_type,
      billingFrequency: res.billing_frequency,
      category: res.category,
      purpose: res.purpose,
      invoiceDate: res.invoice_date,
      invoiceNumber: res.invoice_number,
      groupId: res.group_id,
      hasPdfAttachment: res.has_pdf_attachment,
      pdfFilename: res.pdf_filename,
      pdfTextPreview: res.pdf_text_preview,
      lineItems: res.line_items || [],
      notes: res.notes,
      subscriptionId: res.subscription_id,
      confidenceScore: res.confidence_score,
      isVerified: res.is_verified,
      createdAt: res.created,
      updatedAt: res.updated,
    }
  }

  static async updateInvoice(id: string | number, data: Partial<InvoiceReceipt>): Promise<InvoiceReceipt> {
    const payload: any = {}
    if (data.vendor !== undefined) payload.vendor = data.vendor
    if (data.amount !== undefined) payload.amount = Number(data.amount)
    if (data.currency !== undefined) payload.currency = data.currency
    if (data.paymentType !== undefined) payload.payment_type = data.paymentType
    if (data.billingFrequency !== undefined) payload.billing_frequency = data.billingFrequency
    if (data.category !== undefined) payload.category = data.category
    if (data.purpose !== undefined) payload.purpose = data.purpose
    if (data.invoiceNumber !== undefined) payload.invoice_number = data.invoiceNumber
    if (data.invoiceDate !== undefined) payload.invoice_date = data.invoiceDate
    if (data.notes !== undefined) payload.notes = data.notes
    if (data.lineItems !== undefined) payload.line_items = data.lineItems
    if (data.groupId !== undefined) payload.group_id = data.groupId

    const res = await this.pb.collection('invoices').update(String(id), payload)
    return {
      id: res.id,
      vendor: res.vendor,
      amount: Number(res.amount),
      currency: res.currency,
      paymentType: res.payment_type,
      billingFrequency: res.billing_frequency,
      category: res.category,
      purpose: res.purpose,
      invoiceDate: res.invoice_date,
      invoiceNumber: res.invoice_number,
      groupId: res.group_id,
      hasPdfAttachment: res.has_pdf_attachment,
      pdfFilename: res.pdf_filename,
      pdfTextPreview: res.pdf_text_preview,
      lineItems: res.line_items || [],
      notes: res.notes,
      subscriptionId: res.subscription_id,
      confidenceScore: res.confidence_score,
      isVerified: res.is_verified,
      createdAt: res.created,
      updatedAt: res.updated,
    }
  }

  static async deleteInvoice(id: string | number): Promise<void> {
    const current = await this.pb.collection('invoices').getOne(String(id)).catch(() => null)
    await this.pb.collection('invoices').delete(String(id))
    if (current) {
      await this.logActivity({
        eventType: 'invoice_deleted',
        title: `Invoice Removed: ${current.vendor}`,
        description: `Deleted ${current.currency} ${Number(current.amount).toFixed(2)} invoice #${current.invoice_number || 'N/A'}.`,
        amount: Number(current.amount),
        vendor: current.vendor,
        groupId: current.group_id,
      })
    }
  }

  // --- Activities ---
  static async fetchActivities(groupId?: string | number | null): Promise<ActivityEvent[]> {
    try {
      const filter = groupId && groupId !== 'all' ? `group_id = "${groupId}"` : ''
      const records = await this.pb.collection('activities').getFullList({
        filter,
        sort: '-created',
        limit: 50,
        requestKey: null,
      })
      return records.map((r: any) => ({
        id: r.id,
        eventType: r.event_type,
        title: r.title,
        description: r.description,
        amount: Number(r.amount) || 0,
        currency: r.currency || 'USD',
        vendor: r.vendor,
        groupId: r.group_id,
        createdAt: r.created,
      }))
    } catch (e) {
      console.warn('Failed to fetch activities:', e)
      return []
    }
  }

  static async logActivity(data: Partial<ActivityEvent>): Promise<void> {
    try {
      await this.pb.collection('activities').create({
        event_type: data.eventType || 'event',
        title: data.title || 'Activity',
        description: data.description || '',
        amount: Number(data.amount) || 0,
        currency: data.currency || 'USD',
        vendor: data.vendor || '',
        group_id: data.groupId || '',
      })
    } catch (e) {
      console.warn('Failed to write activity log:', e)
    }
  }

  // --- Simulation Hook ---
  static async simulateEmail(preset: string = 'aws'): Promise<any> {
    try {
      const res = await this.pb.send('/api/ops/invoices/simulate-bill', {
        method: 'POST',
        body: { preset },
      })
      return res
    } catch (e) {
      console.warn('simulate-bill op hook failed, executing fallback:', e)
      const presetsMap: Record<string, any> = {
        aws: { vendor: 'Amazon Web Services', amount: 248.5, category: 'Cloud Infrastructure', purpose: 'Monthly AWS cluster bill' },
        openai: { vendor: 'OpenAI', amount: 42.0, category: 'AI & Developer Tools', purpose: 'ChatGPT Plus & API credits' },
        figma: { vendor: 'Figma', amount: 15.0, category: 'Design & Creative', purpose: 'Figma Pro design seat renewal' },
      }
      const p = presetsMap[preset] || presetsMap.aws
      return await this.createInvoice({
        vendor: p.vendor,
        amount: p.amount,
        category: p.category,
        purpose: p.purpose,
        paymentType: 'subscription',
        billingFrequency: 'monthly',
      })
    }
  }

  // --- Synchronous Pure Aggregation from Cached / Fetched Records ---
  static computeDashboardStatsFromData(invoices: InvoiceReceipt[], subs: Subscription[]): DashboardStats {
    const activeSubs = subs.filter((s) => (s.status || 'active').toLowerCase() === 'active')

    // 1. Monthly recurring burn
    const monthlyRecurringBurn = activeSubs.reduce((sum, s) => {
      const freq = (s.billingFrequency || 'monthly').toLowerCase()
      if (freq === 'yearly') return sum + s.amount / 12.0
      if (freq === 'weekly') return sum + s.amount * 4.33
      if (freq === 'quarterly') return sum + s.amount / 3.0
      return sum + s.amount
    }, 0)

    // 2. Invoices total
    const invoiceSum = invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)

    // 3. Subscriptions spent up to now (August 2026)
    const subsSpentUpToNow = activeSubs.reduce((sum, s) => {
      const hasInv = invoices.some((inv) =>
        (inv.subscriptionId && String(inv.subscriptionId) === String(s.id)) ||
        ((inv.vendor || '').toLowerCase() === (s.vendor || s.name || '').toLowerCase() && inv.paymentType === 'subscription')
      )
      if (hasInv) return sum

      let elapsedMonths = 1
      const freq = (s.billingFrequency || 'monthly').toLowerCase()
      if (freq === 'yearly') return sum + s.amount
      if (freq === 'weekly') return sum + s.amount * 4.33 * elapsedMonths
      if (freq === 'quarterly') return sum + s.amount
      return sum + s.amount * elapsedMonths
    }, 0)

    const totalSpentAllTime = invoiceSum + subsSpentUpToNow
    const monthToDateSpend = totalSpentAllTime

    // 4. Category breakdown
    const catMap: Record<string, { total: number; count: number }> = {}
    invoices.forEach((inv) => {
      const c = inv.category || 'Other Services'
      if (!catMap[c]) catMap[c] = { total: 0, count: 0 }
      catMap[c].total += Number(inv.amount) || 0
      catMap[c].count += 1
    })

    const categoryBreakdown = Object.entries(catMap).map(([cName, val]) => ({
      category: cName,
      total: Math.round(val.total * 100) / 100,
      count: val.count,
      percentage: totalSpentAllTime > 0 ? Math.round((val.total / totalSpentAllTime) * 1000) / 10 : 0,
    }))

    // 5. Vendor segments
    const vendorMap: Record<string, number> = {}
    invoices.forEach((inv) => {
      const v = inv.vendor || 'Other Services'
      vendorMap[v] = (vendorMap[v] || 0) + (Number(inv.amount) || 0)
    })
    activeSubs.forEach((s) => {
      const v = s.vendor || s.name || 'Other Services'
      vendorMap[v] = (vendorMap[v] || 0) + (Number(s.amount) || 0)
    })

    const serviceBreakdown: SpendSegment[] = Object.entries(vendorMap)
      .sort((a, b) => b[1] - a[1])
      .map(([sName, amt]) => ({
        service: sName,
        category: sName,
        amount: Math.round(amt * 100) / 100,
        percentage: totalSpentAllTime > 0 ? Math.round((amt / totalSpentAllTime) * 1000) / 10 : 0,
        color: '#FF4F18',
      }))

    // 6. Monthly Spending Bars
    const monthlySpending: MonthlySpendBar[] = [
      { month: 'March 2026', shortMonth: 'Mar', total: 0, segments: [] },
      { month: 'April 2026', shortMonth: 'Apr', total: 0, segments: [] },
      { month: 'May 2026', shortMonth: 'May', total: 0, segments: [] },
      { month: 'June 2026', shortMonth: 'Jun', total: 0, segments: [] },
      { month: 'July 2026', shortMonth: 'Jul', total: 0, segments: [] },
      {
        month: 'August 2026',
        shortMonth: 'Aug',
        total: Math.round(monthToDateSpend * 100) / 100,
        computedTotal: Math.round(monthToDateSpend * 100) / 100,
        segments: serviceBreakdown,
      },
    ]

    return {
      totalSpentAllTime: Math.round(totalSpentAllTime * 100) / 100,
      totalSpentMonth: Math.round(monthToDateSpend * 100) / 100,
      monthToDateSpend: Math.round(monthToDateSpend * 100) / 100,
      monthlyRecurringBurn: Math.round(monthlyRecurringBurn * 100) / 100,
      topService: serviceBreakdown[0]?.service || 'None',
      activeSubscriptionsCount: activeSubs.length,
      totalInvoicesCount: invoices.length,
      recurringTotal: Math.round(subsSpentUpToNow * 100) / 100,
      onetimeTotal: Math.round(invoiceSum * 100) / 100,
      categoryBreakdown,
      serviceBreakdown,
      monthlySpending,
      upcomingRenewals: activeSubs.map((s) => ({
        id: s.id,
        name: s.name,
        vendor: s.vendor,
        amount: s.amount,
        currency: s.currency,
        billingFrequency: s.billingFrequency,
        category: s.category,
        nextRenewalDate: s.nextRenewalDate,
        daysLeft: 29,
        status: s.status,
      })),
      lastUpdated: new Date().toISOString(),
    }
  }

  // --- Real-time Dashboard Aggregations from Backend ---
  static async fetchDashboardStats(groupId?: string | number | null): Promise<DashboardStats> {
    const [invoices, subs] = await Promise.all([
      this.fetchInvoices(groupId),
      this.fetchSubscriptions(groupId),
    ])
    return this.computeDashboardStatsFromData(invoices, subs)
  }

  static async getYearlyHistory(groupId?: string | number | null): Promise<YearlyHistoryData> {
    const [invoices, subs] = await Promise.all([
      this.fetchInvoices(groupId),
      this.fetchSubscriptions(groupId),
    ])

    const currentYear = 2026
    const allYears = [2026, 2025, 2024, 2023]
    const summaries = allYears.map((yr) => {
      const yrInvs = invoices.filter((inv) => {
        const y = inv.invoiceDate ? new Date(inv.invoiceDate).getFullYear() : 2026
        return y === yr
      })

      let total = yrInvs.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
      const vMap: Record<string, number> = {}
      const cMap: Record<string, number> = {}
      const qMap = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }

      yrInvs.forEach((inv) => {
        const v = inv.vendor || 'Other'
        const c = inv.category || 'Other'
        vMap[v] = (vMap[v] || 0) + inv.amount
        cMap[c] = (cMap[c] || 0) + inv.amount
        qMap.Q3 += inv.amount
      })

      if (yr === currentYear) {
        subs.forEach((s) => {
          if ((s.status || 'active').toLowerCase() === 'active') {
            const hasInv = yrInvs.some((inv) =>
              (inv.subscriptionId && String(inv.subscriptionId) === String(s.id)) ||
              ((inv.vendor || '').toLowerCase() === (s.vendor || s.name || '').toLowerCase() && inv.paymentType === 'subscription')
            )
            if (!hasInv) {
              total += s.amount
              const v = s.vendor || s.name || 'Other'
              const c = s.category || 'Software & SaaS'
              vMap[v] = (vMap[v] || 0) + s.amount
              cMap[c] = (cMap[c] || 0) + s.amount
              qMap.Q3 += s.amount
            }
          }
        })
      }

      return {
        year: yr,
        totalSpend: Math.round(total * 100) / 100,
        invoiceCount: yrInvs.length,
        averageMonthly: Math.round((total / 12) * 100) / 100,
        topVendor: Object.entries(vMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None',
        yoyGrowthPct: 0.0,
        quarterlySpend: qMap,
        categoryBreakdown: cMap,
        vendorBreakdown: vMap,
        monthlyTotals: [
          { month: 'Jan', total: 0 },
          { month: 'Feb', total: 0 },
          { month: 'Mar', total: 0 },
          { month: 'Apr', total: 0 },
          { month: 'May', total: 0 },
          { month: 'Jun', total: 0 },
          { month: 'Jul', total: 0 },
          { month: 'Aug', total: Math.round(total * 100) / 100 },
          { month: 'Sep', total: 0 },
          { month: 'Oct', total: 0 },
          { month: 'Nov', total: 0 },
          { month: 'Dec', total: 0 },
        ],
      }
    })

    const grandTotal = summaries.reduce((s, y) => s + y.totalSpend, 0)
    const totalCount = summaries.reduce((s, y) => s + y.invoiceCount, 0)

    return {
      allYears,
      yearlySummaries: summaries,
      grandTotalAllYears: grandTotal,
      totalInvoicesAllYears: totalCount,
    }
  }
}
