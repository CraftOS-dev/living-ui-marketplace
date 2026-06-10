/**
 * Newsletter Tool — thin REST client.
 *
 * No state, no retry magic. Each method maps to one backend endpoint and
 * returns the parsed JSON response. Errors throw with a readable message so
 * the controller can surface them via toast.
 */

import type {
  AIGenerationResult,
  Campaign,
  CampaignRecipient,
  DashboardData,
  EmailBlock,
  EmailTone,
  IntegrationsStatus,
  SenderIdentity,
  Subscriber,
  SubscriberStatus,
  TagCount,
  Template,
} from '../types'

const BACKEND_URL =
  ((window as unknown as Record<string, unknown>).__CRAFTBOT_BACKEND_URL__ as
    | string
    | undefined) || ''
if (!BACKEND_URL) {
  // Fail loudly rather than silently masking a missing manifest with a guessed port.
  console.error(
    '[ApiService] __CRAFTBOT_BACKEND_URL__ is not set. ' +
      'Could not load /config/manifest.json — the backend URL cannot be resolved.',
  )
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      detail = (body && (body.detail || body.error)) || detail
    } catch {
      /* ignore parse errors */
    }
    throw new Error(`${resp.status} ${detail}`)
  }
  if (resp.status === 204) return undefined as unknown as T
  return (await resp.json()) as T
}

export const ApiService = {
  // ----- Health -------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    try {
      const r = await fetch(`${BACKEND_URL}/health`)
      return r.ok
    } catch {
      return false
    }
  },

  // ----- Subscribers --------------------------------------------------------

  listSubscribers(opts: {
    status?: SubscriberStatus
    tag?: string
    search?: string
  } = {}): Promise<Subscriber[]> {
    const q = new URLSearchParams()
    if (opts.status) q.set('status', opts.status)
    if (opts.tag) q.set('tag', opts.tag)
    if (opts.search) q.set('search', opts.search)
    const qs = q.toString()
    return json<Subscriber[]>(`/api/subscribers${qs ? `?${qs}` : ''}`)
  },

  createSubscriber(data: {
    email: string
    first_name?: string
    last_name?: string
    tags?: string[]
    status?: SubscriberStatus
  }): Promise<Subscriber> {
    return json<Subscriber>('/api/subscribers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  updateSubscriber(
    id: number,
    data: Partial<{
      email: string
      first_name: string
      last_name: string
      tags: string[]
      status: SubscriberStatus
    }>,
  ): Promise<Subscriber> {
    return json<Subscriber>(`/api/subscribers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  deleteSubscriber(id: number): Promise<{ status: string }> {
    return json(`/api/subscribers/${id}`, { method: 'DELETE' })
  },

  importSubscribers(csv: string, tags: string[] = []): Promise<{
    inserted: number
    updated: number
    skipped: number
    errors: string[]
  }> {
    return json('/api/subscribers/import', {
      method: 'POST',
      body: JSON.stringify({ csv_content: csv, tags }),
    })
  },

  exportSubscribersUrl(): string {
    return `${BACKEND_URL}/api/subscribers-export`
  },

  listTags(): Promise<TagCount[]> {
    return json<TagCount[]>('/api/tags')
  },

  // ----- Templates ----------------------------------------------------------

  listTemplates(): Promise<Template[]> {
    return json<Template[]>('/api/templates')
  },

  createTemplate(data: {
    name: string
    subject?: string
    preheader?: string
    blocks?: EmailBlock[]
    design?: Record<string, unknown>
    category?: string
    icon?: string
  }): Promise<Template> {
    return json<Template>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  updateTemplate(
    id: number,
    data: Partial<{
      name: string
      subject: string
      preheader: string
      blocks: EmailBlock[]
      design: Record<string, unknown>
      category: string
      icon: string
    }>,
  ): Promise<Template> {
    return json<Template>(`/api/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  deleteTemplate(id: number): Promise<{ status: string }> {
    return json(`/api/templates/${id}`, { method: 'DELETE' })
  },

  // ----- Campaigns ----------------------------------------------------------

  listCampaigns(status?: string): Promise<Campaign[]> {
    return json<Campaign[]>(`/api/campaigns${status ? `?status=${status}` : ''}`)
  },

  getCampaign(id: number): Promise<Campaign> {
    return json<Campaign>(`/api/campaigns/${id}`)
  },

  createCampaign(data: {
    name: string
    subject?: string
    preheader?: string
    from_name?: string
    from_email?: string
    reply_to?: string
    blocks?: EmailBlock[]
    target_tags?: string[]
    target_all?: boolean
    template_id?: number
  }): Promise<Campaign> {
    return json<Campaign>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  updateCampaign(
    id: number,
    data: Partial<{
      name: string
      subject: string
      preheader: string
      from_name: string
      from_email: string
      reply_to: string
      blocks: EmailBlock[]
      design: Record<string, unknown>
      target_tags: string[]
      target_all: boolean
      status: string
    }>,
  ): Promise<Campaign> {
    return json<Campaign>(`/api/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  deleteCampaign(id: number): Promise<{ status: string }> {
    return json(`/api/campaigns/${id}`, { method: 'DELETE' })
  },

  duplicateCampaign(id: number): Promise<Campaign> {
    return json<Campaign>(`/api/campaigns/${id}/duplicate`, { method: 'POST' })
  },

  sendCampaign(id: number): Promise<{ campaign: Campaign; result: Record<string, unknown> }> {
    return json(`/api/campaigns/${id}/send`, { method: 'POST' })
  },

  scheduleCampaign(id: number, isoDateTime: string): Promise<Campaign> {
    return json<Campaign>(`/api/campaigns/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_at: isoDateTime }),
    })
  },

  cancelCampaign(id: number): Promise<Campaign> {
    return json<Campaign>(`/api/campaigns/${id}/cancel`, { method: 'POST' })
  },

  listRecipients(id: number): Promise<CampaignRecipient[]> {
    return json<CampaignRecipient[]>(`/api/campaigns/${id}/recipients`)
  },

  previewCampaign(id: number): Promise<{
    status: string
    subject: string
    preheader: string
    html: string
    text: string
  }> {
    return json(`/api/campaigns/${id}/preview`)
  },

  generateCampaignCopy(data: {
    prompt: string
    tone: EmailTone
    audience?: string
    include_cta?: boolean
  }): Promise<AIGenerationResult> {
    return json('/api/campaigns/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // ----- Sender identity / integrations -------------------------------------

  getSenderIdentity(): Promise<SenderIdentity> {
    return json<SenderIdentity>('/api/sender-identity')
  },

  updateSenderIdentity(data: Partial<SenderIdentity>): Promise<SenderIdentity> {
    return json<SenderIdentity>('/api/sender-identity', {
      method: 'PUT',
      body: JSON.stringify({
        from_name: data.fromName,
        from_email: data.fromEmail,
        reply_to: data.replyTo,
        organization_name: data.organizationName,
        organization_address: data.organizationAddress,
        tracking_base_url: data.trackingBaseUrl,
      }),
    })
  },

  getIntegrationsStatus(): Promise<IntegrationsStatus> {
    return json<IntegrationsStatus>('/api/integrations')
  },

  rotateSubscribeKey(): Promise<SenderIdentity> {
    return json<SenderIdentity>('/api/sender-identity/rotate-subscribe-key', {
      method: 'POST',
    })
  },

  // ----- Dashboard / analytics ----------------------------------------------

  getDashboard(): Promise<DashboardData> {
    return json<DashboardData>('/api/dashboard')
  },

  // ----- State (template-provided) ------------------------------------------

  getState<T = Record<string, unknown>>(): Promise<T> {
    return json<T>('/api/state')
  },

  updateState<T = Record<string, unknown>>(updates: Partial<T>): Promise<T> {
    return json<T>('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ data: updates }),
    })
  },

  executeAction(action: string, payload?: Record<string, unknown>): Promise<{
    status: string
    [key: string]: unknown
  }> {
    return json('/api/action', {
      method: 'POST',
      body: JSON.stringify({ action, payload }),
    })
  },
}
