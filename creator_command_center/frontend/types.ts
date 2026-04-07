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
