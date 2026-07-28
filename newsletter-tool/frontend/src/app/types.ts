/**
 * Newsletter Tool — TypeScript types mirroring the FastAPI response shapes.
 */

export type Section =
  | 'dashboard'
  | 'campaigns'
  | 'subscribers'
  | 'templates'
  | 'schedule'
  | 'settings'

export type SubscriberStatus = 'subscribed' | 'unsubscribed' | 'bounced'
export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled'

export type EmailTone =
  | 'friendly'
  | 'professional'
  | 'playful'
  | 'concise'
  | 'warm'
  | 'persuasive'

// ---------------------------------------------------------------------------
// Blocks — the building bricks of an email body
// ---------------------------------------------------------------------------

export type BlockType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'

export type BlockAlign = 'left' | 'center' | 'right'
export type TextSize = 'small' | 'normal' | 'large'
export type ImageWidth = 'small' | 'medium' | 'full'

export interface HeadingBlock {
  type: 'heading'
  text: string
  level?: 1 | 2 | 3
  align?: BlockAlign
  color?: string
}

export interface TextBlock {
  type: 'text'
  text: string
  align?: BlockAlign
  color?: string
  size?: TextSize
}

export interface ImageBlock {
  type: 'image'
  url: string
  alt?: string
  align?: BlockAlign
  width?: ImageWidth
}

export interface ButtonBlock {
  type: 'button'
  label: string
  url: string
  align?: BlockAlign
  backgroundColor?: string
  textColor?: string
}

export interface DividerBlock {
  type: 'divider'
  color?: string
}

export interface SpacerBlock {
  type: 'spacer'
  height?: number
}

export type EmailBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

export interface Subscriber {
  id: number
  email: string
  firstName?: string | null
  lastName?: string | null
  status: SubscriberStatus
  tags: string[]
  bounceReason?: string | null
  unsubscribeToken: string
  source?: string
  createdAt?: string | null
  updatedAt?: string | null
}

export interface Template {
  id: number
  name: string
  subject: string
  preheader: string
  blocks: EmailBlock[]
  design?: CampaignDesign
  category: string
  isBuiltin: boolean
  icon: string
  usageCount: number
  createdAt?: string | null
  updatedAt?: string | null
}

export interface CampaignDesign {
  emailBg?: string
  cardBg?: string
  textColor?: string
  headingColor?: string
  buttonBg?: string
  buttonTextColor?: string
  fontFamily?: 'system' | 'serif' | 'mono'
}

export interface Campaign {
  id: number
  name: string
  subject: string
  preheader: string
  fromName?: string | null
  fromEmail?: string | null
  replyTo?: string | null
  status: CampaignStatus
  targetTags: string[]
  targetAll: boolean
  scheduledAt?: string | null
  sentAt?: string | null
  totalRecipients: number
  sentCount: number
  failedCount: number
  opensUnique: number
  clicksUnique: number
  unsubscribes: number
  errorMessage?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  blocks?: EmailBlock[]
  design?: CampaignDesign
}

export interface CampaignRecipient {
  id: number
  campaignId: number
  subscriberId: number | null
  email: string
  name?: string | null
  status: string
  sentAt?: string | null
  openedAt?: string | null
  clickedAt?: string | null
  errorMessage?: string | null
}

export interface SenderIdentity {
  id: number
  fromName: string
  fromEmail: string
  replyTo: string
  organizationName: string
  organizationAddress: string
  trackingBaseUrl: string
  subscribeKey: string
  updatedAt?: string | null
}

export interface IntegrationsStatus {
  llm: { connected: boolean }
  gmail: { bridge: boolean; connected: boolean }
}

export interface TagCount {
  name: string
  count: number
}

export interface DashboardOverview {
  subscribers: {
    total: number
    active: number
    unsubscribed: number
    bounced: number
    newLast30Days: number
  }
  campaigns: {
    totalSent: number
    scheduled: number
    drafts: number
    emailsDelivered: number
    uniqueOpens: number
    uniqueClicks: number
    openRate: number
    clickRate: number
    sendsByDay: Record<string, number>
  }
}

export interface DashboardData {
  overview: DashboardOverview
  recentCampaigns: Campaign[]
  upcomingCampaigns: Campaign[]
}

export interface AIGenerationResult {
  status: string
  llmAvailable: boolean
  subject: string
  preheader: string
  blocks: EmailBlock[]
}

// ---------------------------------------------------------------------------
// Frontend app state
// ---------------------------------------------------------------------------

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  activeSection: Section
  subscribers: Subscriber[]
  templates: Template[]
  campaigns: Campaign[]
  senderIdentity: SenderIdentity | null
  integrations: IntegrationsStatus | null
  tags: TagCount[]
  dashboard: DashboardData | null
  [key: string]: unknown
}
