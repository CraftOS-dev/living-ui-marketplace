/**
 * Brainstorm Graph — Type Definitions
 */

export type NodeType = 'question' | 'answer' | 'idea'
export type CreatedBy = 'user' | 'agent'
export type ViewMode = 'graph' | 'tree' | 'summary'

export interface SessionSummary {
  summary: string
  themes: string[]
  insights: string[]
}

export interface BrainstormSession {
  id: number
  title: string
  topic: string
  createdAt: string | null
  updatedAt: string | null
}

export interface BrainstormNode {
  id: number
  sessionId: number
  parentId: number | null
  content: string
  nodeType: NodeType
  createdBy: CreatedBy
  x: number
  y: number
  depth: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  sessions: BrainstormSession[]
  activeSessionId: number | null
  nodes: BrainstormNode[]
  view: ViewMode
  agentRunning: boolean
  expandingNodeId: number | null
  [key: string]: unknown
}

export interface NodeCreateInput {
  sessionId: number
  parentId?: number | null
  content: string
  nodeType: NodeType
}

export interface NodeUpdateInput {
  content?: string
  nodeType?: NodeType
  x?: number
  y?: number
}

export interface ExploreResult {
  status: string
  action: 'expand' | 'answer' | 'none'
  targetNodeId?: number
  reason?: string
  newNodes?: BrainstormNode[]
  node?: BrainstormNode
  message?: string
}
