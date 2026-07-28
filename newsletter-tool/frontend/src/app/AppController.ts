/**
 * AppController — central state for the Newsletter Tool.
 *
 * - Owns: the active section, cached entity lists, sender identity, dashboard.
 * - Fetches fresh data from the backend on demand (each section view triggers
 *   its own refresh) and notifies subscribed React components.
 * - All mutations go through the backend; local state only updates after the
 *   backend confirms.
 */

import { toast } from 'react-toastify'
import type {
  AppState,
  Campaign,
  EmailBlock,
  EmailTone,
  Section,
  SenderIdentity,
  Subscriber,
  SubscriberStatus,
  Template,
} from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

const DEFAULT_STATE: AppState = {
  initialized: false,
  loading: true,
  error: null,
  activeSection: 'dashboard',
  subscribers: [],
  templates: [],
  campaigns: [],
  senderIdentity: null,
  integrations: null,
  tags: [],
  dashboard: null,
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export class AppController {
  private state: AppState = { ...DEFAULT_STATE }
  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable = false

  async initialize(): Promise<void> {
    this.backendAvailable = await ApiService.healthCheck()
    if (!this.backendAvailable) {
      this.set({
        initialized: true,
        loading: false,
        error: 'Backend unavailable. Reload after the server starts.',
      })
      return
    }

    try {
      const persisted = await ApiService.getState<Partial<AppState>>()
      if (persisted && typeof persisted === 'object' && 'activeSection' in persisted) {
        const section = persisted.activeSection as Section | undefined
        if (section) {
          this.state.activeSection = section
        }
      }
    } catch {
      /* state is allowed to be empty */
    }

    this.set({ initialized: true, loading: false, error: null })
    // Fire off the initial loads in parallel — they're independent.
    await Promise.allSettled([
      this.refreshDashboard(),
      this.refreshSubscribers(),
      this.refreshTemplates(),
      this.refreshCampaigns(),
      this.refreshTags(),
      this.refreshSenderIdentity(),
      this.refreshIntegrations(),
    ])
  }

  cleanup(): void {
    this.listeners.clear()
  }

  getState(): AppState {
    return { ...this.state }
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(updates: Partial<AppState>): void {
    this.state = { ...this.state, ...updates }
    stateCache.save(this.state as unknown as Record<string, unknown>)
    this.listeners.forEach((l) => l(this.getState()))
  }

  // ----- Navigation ---------------------------------------------------------

  setActiveSection(section: Section): void {
    this.set({ activeSection: section })
    if (this.backendAvailable) {
      ApiService.updateState({ activeSection: section }).catch(() => {
        /* best-effort persistence */
      })
    }
  }

  // ----- Dashboard ----------------------------------------------------------

  async refreshDashboard(): Promise<void> {
    try {
      const dashboard = await ApiService.getDashboard()
      this.set({ dashboard })
    } catch (e) {
      console.error('[Controller] refreshDashboard:', e)
    }
  }

  // ----- Subscribers --------------------------------------------------------

  async refreshSubscribers(opts: { status?: SubscriberStatus; tag?: string; search?: string } = {}): Promise<void> {
    try {
      const subscribers = await ApiService.listSubscribers(opts)
      this.set({ subscribers })
    } catch (e) {
      toast.error(`Could not load subscribers: ${errorMessage(e)}`)
    }
  }

  async addSubscriber(input: {
    email: string
    firstName?: string
    lastName?: string
    tags?: string[]
  }): Promise<Subscriber | null> {
    try {
      const created = await ApiService.createSubscriber({
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        tags: input.tags,
      })
      await this.refreshSubscribers()
      await this.refreshTags()
      toast.success(`Added ${created.email}`)
      return created
    } catch (e) {
      toast.error(`Add failed: ${errorMessage(e)}`)
      return null
    }
  }

  async updateSubscriber(
    id: number,
    updates: Partial<{ email: string; firstName: string; lastName: string; tags: string[]; status: SubscriberStatus }>,
  ): Promise<boolean> {
    try {
      await ApiService.updateSubscriber(id, {
        email: updates.email,
        first_name: updates.firstName,
        last_name: updates.lastName,
        tags: updates.tags,
        status: updates.status,
      })
      await this.refreshSubscribers()
      await this.refreshTags()
      toast.success('Saved')
      return true
    } catch (e) {
      toast.error(`Save failed: ${errorMessage(e)}`)
      return false
    }
  }

  async deleteSubscriber(id: number): Promise<boolean> {
    try {
      await ApiService.deleteSubscriber(id)
      await this.refreshSubscribers()
      await this.refreshTags()
      toast.success('Removed')
      return true
    } catch (e) {
      toast.error(`Delete failed: ${errorMessage(e)}`)
      return false
    }
  }

  async importSubscribersCsv(csv: string, tags: string[]): Promise<void> {
    try {
      const r = await ApiService.importSubscribers(csv, tags)
      toast.success(`Imported ${r.inserted} new, updated ${r.updated}` + (r.skipped ? `, skipped ${r.skipped}` : ''))
      await this.refreshSubscribers()
      await this.refreshTags()
    } catch (e) {
      toast.error(`Import failed: ${errorMessage(e)}`)
    }
  }

  exportSubscribersUrl(): string {
    return ApiService.exportSubscribersUrl()
  }

  async refreshTags(): Promise<void> {
    try {
      const tags = await ApiService.listTags()
      this.set({ tags })
    } catch {
      /* non-fatal */
    }
  }

  // ----- Templates ----------------------------------------------------------

  async refreshTemplates(): Promise<void> {
    try {
      const templates = await ApiService.listTemplates()
      this.set({ templates })
    } catch (e) {
      toast.error(`Could not load templates: ${errorMessage(e)}`)
    }
  }

  async saveTemplate(input: {
    id?: number
    name: string
    subject: string
    preheader: string
    blocks: EmailBlock[]
    design?: Record<string, unknown>
    category?: string
    icon?: string
    silent?: boolean
  }): Promise<Template | null> {
    try {
      const payload = {
        name: input.name,
        subject: input.subject,
        preheader: input.preheader,
        blocks: input.blocks,
        design: input.design,
        category: input.category,
        icon: input.icon,
      }
      const saved =
        input.id !== undefined
          ? await ApiService.updateTemplate(input.id, payload)
          : await ApiService.createTemplate(payload)
      await this.refreshTemplates()
      if (!input.silent) {
        toast.success(input.id ? 'Template saved' : 'Template created')
      }
      return saved
    } catch (e) {
      toast.error(`Save failed: ${errorMessage(e)}`)
      return null
    }
  }

  async deleteTemplate(id: number): Promise<boolean> {
    try {
      await ApiService.deleteTemplate(id)
      toast.success('Template removed')
      await this.refreshTemplates()
      return true
    } catch (e) {
      toast.error(`Delete failed: ${errorMessage(e)}`)
      return false
    }
  }

  // ----- Campaigns ----------------------------------------------------------

  async refreshCampaigns(status?: string): Promise<void> {
    try {
      const campaigns = await ApiService.listCampaigns(status)
      this.set({ campaigns })
    } catch (e) {
      toast.error(`Could not load campaigns: ${errorMessage(e)}`)
    }
  }

  getCampaign(id: number): Promise<Campaign> {
    return ApiService.getCampaign(id)
  }

  async createCampaign(name: string, templateId?: number): Promise<Campaign | null> {
    try {
      const created = await ApiService.createCampaign({
        name,
        template_id: templateId,
        target_all: true,
      })
      await this.refreshCampaigns()
      toast.success(`Created "${created.name}"`)
      return created
    } catch (e) {
      toast.error(`Create failed: ${errorMessage(e)}`)
      return null
    }
  }

  async saveCampaign(campaign: Campaign): Promise<Campaign | null> {
    try {
      const updated = await ApiService.updateCampaign(campaign.id, {
        name: campaign.name,
        subject: campaign.subject,
        preheader: campaign.preheader,
        from_name: campaign.fromName || '',
        from_email: campaign.fromEmail || '',
        reply_to: campaign.replyTo || '',
        blocks: campaign.blocks || [],
        target_tags: campaign.targetTags,
        target_all: campaign.targetAll,
        design: (campaign.design || {}) as Record<string, unknown>,
      })
      await this.refreshCampaigns()
      return updated
    } catch (e) {
      toast.error(`Save failed: ${errorMessage(e)}`)
      return null
    }
  }

  async deleteCampaign(id: number): Promise<boolean> {
    try {
      await ApiService.deleteCampaign(id)
      await this.refreshCampaigns()
      toast.success('Campaign removed')
      return true
    } catch (e) {
      toast.error(`Delete failed: ${errorMessage(e)}`)
      return false
    }
  }

  async duplicateCampaign(id: number): Promise<Campaign | null> {
    try {
      const copy = await ApiService.duplicateCampaign(id)
      await this.refreshCampaigns()
      toast.success(`Duplicated as "${copy.name}"`)
      return copy
    } catch (e) {
      toast.error(`Duplicate failed: ${errorMessage(e)}`)
      return null
    }
  }

  async sendCampaign(id: number): Promise<Campaign | null> {
    try {
      const { campaign } = await ApiService.sendCampaign(id)
      if (campaign.status === 'sent') {
        toast.success(`Sent to ${campaign.sentCount} subscribers`)
      } else if (campaign.status === 'failed') {
        toast.error(campaign.errorMessage || 'Send failed')
      } else {
        toast.info(`Status: ${campaign.status}`)
      }
      await this.refreshCampaigns()
      await this.refreshDashboard()
      return campaign
    } catch (e) {
      toast.error(`Send failed: ${errorMessage(e)}`)
      return null
    }
  }

  async scheduleCampaign(id: number, isoDateTime: string): Promise<Campaign | null> {
    try {
      const updated = await ApiService.scheduleCampaign(id, isoDateTime)
      await this.refreshCampaigns()
      await this.refreshDashboard()
      toast.success(`Scheduled for ${new Date(isoDateTime).toLocaleString()}`)
      return updated
    } catch (e) {
      toast.error(`Schedule failed: ${errorMessage(e)}`)
      return null
    }
  }

  async cancelCampaign(id: number): Promise<Campaign | null> {
    try {
      const updated = await ApiService.cancelCampaign(id)
      await this.refreshCampaigns()
      await this.refreshDashboard()
      toast.success('Schedule cancelled')
      return updated
    } catch (e) {
      toast.error(`Cancel failed: ${errorMessage(e)}`)
      return null
    }
  }

  generateCopy(prompt: string, tone: EmailTone, audience?: string) {
    return ApiService.generateCampaignCopy({
      prompt,
      tone,
      audience,
      include_cta: true,
    })
  }

  previewCampaign(id: number) {
    return ApiService.previewCampaign(id)
  }

  listRecipients(id: number) {
    return ApiService.listRecipients(id)
  }

  // ----- Sender identity / integrations -------------------------------------

  async refreshSenderIdentity(): Promise<void> {
    try {
      const senderIdentity = await ApiService.getSenderIdentity()
      this.set({ senderIdentity })
    } catch {
      /* non-fatal */
    }
  }

  async saveSenderIdentity(updates: Partial<SenderIdentity>): Promise<SenderIdentity | null> {
    try {
      const saved = await ApiService.updateSenderIdentity(updates)
      this.set({ senderIdentity: saved })
      toast.success('Settings saved')
      return saved
    } catch (e) {
      toast.error(`Save failed: ${errorMessage(e)}`)
      return null
    }
  }

  async rotateSubscribeKey(): Promise<SenderIdentity | null> {
    try {
      const saved = await ApiService.rotateSubscribeKey()
      this.set({ senderIdentity: saved })
      toast.success('New subscribe key generated. Re-copy the embed snippet.')
      return saved
    } catch (e) {
      toast.error(`Rotate failed: ${errorMessage(e)}`)
      return null
    }
  }

  async refreshIntegrations(): Promise<void> {
    try {
      const integrations = await ApiService.getIntegrationsStatus()
      this.set({ integrations })
    } catch {
      this.set({ integrations: { llm: { connected: false }, gmail: { bridge: false, connected: false } } })
    }
  }

  isBackendAvailable(): boolean {
    return this.backendAvailable
  }
}
