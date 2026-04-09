export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
}

// Integration status
export interface IntegrationInfo {
  id: string
  connected: boolean
}

export interface IntegrationStatus {
  bridgeAvailable: boolean
  integrations: IntegrationInfo[]
}

// YouTube
export interface YouTubeChannel {
  id: number
  channelId: string
  title: string
  description: string
  thumbnailUrl: string
  subscriberCount: number
  videoCount: number
  viewCount: number
  syncedAt: string | null
}

export interface YouTubeVideo {
  id: number
  videoId: string
  title: string
  description: string
  thumbnailUrl: string
  publishedAt: string
  viewCount: number
  likeCount: number
  commentCount: number
  duration: string
  syncedAt: string | null
}

export interface SyncResult {
  status: string
  errors: string[]
  channels: YouTubeChannel[]
  videos: YouTubeVideo[]
  syncedAt: string
}

// Content Analysis
export interface AnalysisStatus {
  id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  progressMessage: string
}

export interface AnalysisTodo {
  task: string
  priority: 'high' | 'medium' | 'low'
}

export interface ContentIdea {
  title: string
  format: string
  reasoning: string
}

export interface PerformanceRanking {
  title: string
  score: number
  reason: string
}

export interface ContentCategory {
  category: string
  video_count: number
  avg_views: number
  insight: string
}

export interface AnalysisReport {
  summary: string
  performance_ranking: PerformanceRanking[]
  content_categories: ContentCategory[]
  timing_analysis: string
  thumbnail_insights: string
  recommendations: string[]
  content_ideas: ContentIdea[]
  todos: AnalysisTodo[]
}

export interface ContentAnalysisData {
  id: number
  analysisType: string
  status: string
  progress: number
  progressMessage: string
  report: AnalysisReport
  summary: string
  recommendations: string[]
  todos: AnalysisTodo[]
  contentIdeas: ContentIdea[]
  videoCountAnalyzed: number
  errorMessage: string
  createdAt: string | null
  completedAt: string | null
}
