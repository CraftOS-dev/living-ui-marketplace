import type { AppState, BrainstormSession, BrainstormNode, NodeCreateInput, ExploreResult, ExploreOptions, SessionSummary } from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || ''

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!r.ok) {
    // Surface backend error detail (e.g. "CraftBot is not connected…") to the UI.
    let detail = `Request failed (${r.status})`
    try { const body = await r.json(); detail = body.detail || body.message || detail } catch { /* non-JSON */ }
    throw new Error(detail)
  }
  return r.json()
}

export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
    sessions: [],
    activeSessionId: null,
    nodes: [],
    view: 'graph',
    agentRunning: false,
    expandingNodeId: null,
  }

  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable: boolean = false

  async initialize(): Promise<void> {
    this.backendAvailable = await ApiService.healthCheck()
    if (this.backendAvailable) {
      try {
        const sessions = await this.getSessions()
        this.state = { ...this.state, initialized: true, loading: false, error: null, sessions }
      } catch (err) {
        this.state = { ...this.state, initialized: true, loading: false, error: 'Failed to load sessions' }
      }
    } else {
      this.state = { ...this.state, initialized: true, loading: false, error: 'Backend unavailable' }
    }
    this.notifyListeners()
  }

  cleanup(): void { this.listeners.clear() }
  getState(): AppState { return { ...this.state } }
  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  isBackendAvailable(): boolean { return this.backendAvailable }

  private notifyListeners(): void {
    this.listeners.forEach(l => l(this.getState()))
  }

  private patch(updates: Partial<AppState>): void {
    this.state = { ...this.state, ...updates }
    this.notifyListeners()
  }

  async refresh(): Promise<void> {
    await this.initialize()
    if (this.state.activeSessionId) {
      await this.loadSession(this.state.activeSessionId)
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async getSessions(): Promise<BrainstormSession[]> {
    return api<BrainstormSession[]>('/api/sessions')
  }

  async createSession(title: string, topic: string): Promise<void> {
    const result = await api<{ session: BrainstormSession; rootNode: BrainstormNode }>(
      '/api/sessions',
      { method: 'POST', body: JSON.stringify({ title, topic }) }
    )
    const sessions = await this.getSessions()
    this.patch({
      sessions,
      activeSessionId: result.session.id,
      nodes: [result.rootNode],
    })
  }

  async renameSession(id: number, title: string): Promise<void> {
    await api('/api/sessions/' + id, { method: 'PUT', body: JSON.stringify({ title }) })
    const sessions = await this.getSessions()
    this.patch({ sessions })
  }

  async deleteSession(id: number): Promise<void> {
    await api('/api/sessions/' + id, { method: 'DELETE' })
    const sessions = await this.getSessions()
    const next = sessions[0] ?? null
    if (next) {
      const nodes = await api<BrainstormNode[]>('/api/sessions/' + next.id + '/nodes')
      this.patch({ sessions, activeSessionId: next.id, nodes })
    } else {
      this.patch({ sessions, activeSessionId: null, nodes: [] })
    }
  }

  async loadSession(id: number): Promise<void> {
    const nodes = await api<BrainstormNode[]>('/api/sessions/' + id + '/nodes')
    this.patch({ activeSessionId: id, nodes })
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────

  async createNode(data: NodeCreateInput): Promise<void> {
    const node = await api<BrainstormNode>('/api/nodes', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    this.patch({ nodes: [...this.state.nodes, node] })
  }

  async updateNodeContent(id: number, content: string): Promise<void> {
    const updated = await api<BrainstormNode>('/api/nodes/' + id, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
    this.patch({ nodes: this.state.nodes.map(n => n.id === id ? updated : n) })
  }

  async updateNode(id: number, fields: { content?: string; nodeType?: string }): Promise<void> {
    const updated = await api<BrainstormNode>('/api/nodes/' + id, {
      method: 'PUT',
      body: JSON.stringify(fields),
    })
    this.patch({ nodes: this.state.nodes.map(n => n.id === id ? updated : n) })
  }

  async updateNodePosition(id: number, x: number, y: number): Promise<void> {
    // Optimistic: patch local state immediately so the node's position prop
    // never lags behind NodeCard's local drag state after drop — otherwise
    // NodeCard's resync-on-render guard sees a stale x/y for one render and
    // snaps the card back before the PATCH resolves and snaps it forward again.
    this.patch({ nodes: this.state.nodes.map(n => n.id === id ? { ...n, x, y } : n) })
    await api('/api/nodes/' + id, { method: 'PUT', body: JSON.stringify({ x, y }) })
  }

  async deleteNode(id: number): Promise<void> {
    await api('/api/nodes/' + id, { method: 'DELETE' })
    // Remove node and all descendants from local state
    const toRemove = new Set<number>()
    const collect = (nodeId: number) => {
      toRemove.add(nodeId)
      this.state.nodes.filter(n => n.parentId === nodeId).forEach(c => collect(c.id))
    }
    collect(id)
    this.patch({ nodes: this.state.nodes.filter(n => !toRemove.has(n.id)) })
  }

  // ── Agent actions ──────────────────────────────────────────────────────────

  async expandNode(nodeId: number): Promise<void> {
    this.patch({ expandingNodeId: nodeId, agentRunning: true })
    try {
      const result = await api<{ status: string; newNodes: BrainstormNode[] }>(
        '/api/nodes/' + nodeId + '/expand',
        { method: 'POST' }
      )
      if (result.newNodes) {
        this.patch({ nodes: [...this.state.nodes, ...result.newNodes] })
      }
    } finally {
      this.patch({ expandingNodeId: null, agentRunning: false })
    }
  }

  async answerNode(nodeId: number): Promise<void> {
    this.patch({ expandingNodeId: nodeId, agentRunning: true })
    try {
      const result = await api<{ status: string; node: BrainstormNode }>(
        '/api/nodes/' + nodeId + '/answer',
        { method: 'POST' }
      )
      if (result.node) {
        this.patch({ nodes: [...this.state.nodes, result.node] })
      }
    } finally {
      this.patch({ expandingNodeId: null, agentRunning: false })
    }
  }

  async exploreSession(opts: ExploreOptions): Promise<ExploreResult> {
    const { activeSessionId } = this.state
    if (!activeSessionId) throw new Error('No active session')
    this.patch({ agentRunning: true })
    try {
      const result = await api<ExploreResult>(
        '/api/sessions/' + activeSessionId + '/explore',
        {
          method: 'POST',
          body: JSON.stringify({
            strategy: opts.strategy,
            effort: opts.effort,
            startNodeId: opts.startNodeId,
          }),
        }
      )
      if (result.newNodes && result.newNodes.length) {
        this.patch({ nodes: [...this.state.nodes, ...result.newNodes] })
      }
      if (result.node) {
        this.patch({ nodes: [...this.state.nodes, result.node] })
      }
      return result
    } finally {
      this.patch({ agentRunning: false })
    }
  }

  setView(view: 'graph' | 'tree' | 'summary'): void {
    this.patch({ view })
  }

  async generateSummary(): Promise<SessionSummary> {
    const { activeSessionId } = this.state
    if (!activeSessionId) return { summary: 'No active session.', themes: [], insights: [] }
    const result = await api<{ status: string; summary: string; themes: string[]; insights: string[] }>(
      '/api/sessions/' + activeSessionId + '/summary'
    )
    return { summary: result.summary || '', themes: result.themes || [], insights: result.insights || [] }
  }

  // executeAction kept for agent compatibility (POST /api/action)
  async executeAction(action: string, payload?: Record<string, unknown>): Promise<void> {
    if (!this.backendAvailable) return
    try {
      const result = await ApiService.executeAction(action, payload)
      // Reload nodes after any agent action
      if (this.state.activeSessionId && ['expand_node', 'answer_node', 'explore'].includes(action)) {
        const nodes = await api<BrainstormNode[]>('/api/sessions/' + this.state.activeSessionId + '/nodes')
        this.patch({ nodes })
      }
      if (result.data) this.patch(result.data as Partial<AppState>)
    } catch (err) {
      console.error('[AppController] action failed:', err)
    }
  }

  setState(updates: Partial<AppState>): void {
    this.patch(updates)
    stateCache.save(this.state)
  }
}
