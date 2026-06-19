/**
 * Social Media Manager — Type Definitions
 */

export type Platform = 'twitter' | 'linkedin' | 'google_youtube'
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'
export type ActiveSection = 'composer' | 'calendar' | 'queue' | 'analytics' | 'hooks' | 'humanizer' | 'insights'
export type CaptionTone = 'professional' | 'casual' | 'playful' | 'persuasive' | 'informative'

export interface Post {
  id: number
  globalContent: string
  platform: Platform
  status: PostStatus
  scheduledAt: string | null
  publishedAt: string | null
  platformPostId: string | null
  errorMessage: string | null
  retryCount: number
  mediaUrls: string[]
  extraData: Record<string, unknown>
  effectiveContent: string
  createdAt: string | null
  updatedAt: string | null
}

export interface PostAnalytics {
  id: number
  postId: number
  impressions: number
  likes: number
  comments: number
  shares: number
  clicks: number
  fetchedAt: string | null
}

export interface PlatformAccount {
  id: number
  platform: Platform
  accountId: string
  displayName: string
  username: string | null
  avatarUrl: string | null
  followerCount: number
  extraData: Record<string, unknown>
  syncedAt: string | null
}

export interface IntegrationsStatus {
  bridgeAvailable: boolean
  platforms: { twitter: boolean; linkedin: boolean; google_youtube: boolean }
}

export interface AnalyticsSummary {
  platform: Platform
  totalPosts: number
  totalImpressions: number
  totalLikes: number
  totalComments: number
  totalShares: number
}

export interface CalendarData {
  [dayKey: string]: Post[]
}

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  activeSection: ActiveSection
  posts: Post[]
  queue: Post[]
  calendarPosts: CalendarData
  calendarYear: number
  calendarMonth: number
  accounts: PlatformAccount[]
  integrations: IntegrationsStatus | null
  analyticsSummary: AnalyticsSummary[]
  prefilledTool: PrefilledTool | null
  [key: string]: unknown
}

export interface PostCreateInput {
  globalContent: string
  platform: Platform
  status?: PostStatus
  scheduledAt?: string | null
  mediaUrls?: string[]
  extraData?: Record<string, unknown>
}

// AI Writing Suite types
export type HookFramework = 'Data/Number' | 'Curiosity Gap' | 'Problem-Solution' | 'Social Proof' | 'Contrarian' | 'Story' | 'Question'

export interface HookResult {
  hook: string
  framework: HookFramework
  explanation: string
}

export interface CommentInsightsAnalysis {
  sentiment: { positive: number; neutral: number; negative: number }
  themes: Array<{ theme: string; count: number; quote: string; sentiment: string }>
  top_questions: string[]
  insights: string[]
  top_comments: Array<{ text: string; reason: string }>
}

export interface CommentInsightsResult {
  status: 'ok' | 'unavailable' | 'error' | 'restricted'
  platform?: Platform
  commentsFetched: number
  message?: string
  analysis?: CommentInsightsAnalysis
}

export interface PrefilledTool {
  tool: 'hooks' | 'humanizer'
  text: string
  platform: Platform
}
