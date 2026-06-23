/**
 * Email Manager — TypeScript Interfaces
 */

export interface Column {
  id: number
  title: string
  query: string
  icon: string
  aiInstructions: string
  aiEnabled: boolean
  position: number
  isGeneral: boolean
  unreadCount: number
  createdAt: string
  updatedAt: string
}

export interface Email {
  id: string
  from: string
  fromName: string
  fromEmail: string
  subject: string
  snippet: string
  date: string
  isUnread: boolean
}

export interface InsightSummary {
  summary: string
  points: string[]
  columnId: number
  generatedAt?: string
}

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  gmailConnected: boolean
  checkingGmail: boolean
  columns: Column[]
  emails: Record<number, Email[]>
  insights: Record<number, InsightSummary | null>
  loadingEmails: Record<number, boolean>
  loadingInsights: Record<number, boolean>
}
