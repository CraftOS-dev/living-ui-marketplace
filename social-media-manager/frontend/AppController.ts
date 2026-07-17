import type {
  AppState,
  Post,
  PostCreateInput,
  PostAnalytics,
  PlatformAccount,
  IntegrationsStatus,
  AnalyticsSummary,
  CalendarData,
  Platform,
  PostStatus,
  ActiveSection,
  CaptionTone,
  HookResult,
  CommentInsightsResult,
  Idea,
  HashtagSet,
} from './types'
import { ApiService } from './services/ApiService'
import { stateCache } from './services/StatePersistence'

const BACKEND_URL = (window as any).__CRAFTBOT_BACKEND_URL__ || 'http://localhost:{{BACKEND_PORT}}'
const API = `${BACKEND_URL}/api`

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  return res.json() as Promise<T>
}

export class AppController {
  private state: AppState = {
    initialized: false,
    loading: true,
    error: null,
    activeSection: 'calendar',
    posts: [],
    queue: [],
    calendarPosts: {},
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    accounts: [],
    integrations: null,
    analyticsSummary: [],
    prefilledTool: null,
    composerPrefill: null,
    ideas: [],
    hashtagSets: [],
  }

  private listeners: Set<(state: AppState) => void> = new Set()
  private backendAvailable = false

  // -------------------------------------------------------------------------
  // Core state management
  // -------------------------------------------------------------------------

  getState(): AppState {
    return { ...this.state }
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this.getState()))
  }

  private update(updates: Partial<AppState>): void {
    this.state = { ...this.state, ...updates }
    this.notify()
    stateCache.save(this.state)
  }

  cleanup(): void {
    this.listeners.clear()
  }

  isBackendAvailable(): boolean {
    return this.backendAvailable
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    console.log('[SMM] Initializing...')
    this.backendAvailable = await ApiService.healthCheck()

    if (!this.backendAvailable) {
      const cached = stateCache.load()
      this.update({
        ...(cached || {}),
        initialized: true,
        loading: false,
        error: 'Backend unavailable',
      })
      return
    }

    this.update({ loading: true, error: null })

    try {
      const year = this.state.calendarYear
      const month = this.state.calendarMonth

      const [integrations, posts, queue, calendarPosts, analyticsSummary, accounts] =
        await Promise.all([
          apiFetch<IntegrationsStatus>('/integrations/status'),
          apiFetch<Post[]>('/posts'),
          apiFetch<Post[]>('/queue'),
          apiFetch<CalendarData>(`/calendar?year=${year}&month=${month}`),
          apiFetch<AnalyticsSummary[]>('/analytics/summary'),
          apiFetch<PlatformAccount[]>('/accounts'),
        ])

      this.update({
        initialized: true,
        loading: false,
        error: null,
        integrations,
        posts,
        queue,
        calendarPosts,
        analyticsSummary,
        accounts,
      })
      await Promise.all([this.refreshIdeas(), this.refreshHashtagSets()])
      console.log('[SMM] Initialized')
    } catch (err) {
      console.error('[SMM] Init error:', err)
      this.update({ initialized: true, loading: false, error: String(err) })
    }
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  setActiveSection(section: ActiveSection): void {
    this.update({ activeSection: section })
  }

  // -------------------------------------------------------------------------
  // Integrations & Accounts
  // -------------------------------------------------------------------------

  async refreshIntegrations(): Promise<void> {
    try {
      const integrations = await apiFetch<IntegrationsStatus>('/integrations/status')
      this.update({ integrations })
    } catch (err) {
      console.error('[SMM] refreshIntegrations:', err)
    }
  }

  async syncAccounts(): Promise<boolean> {
    try {
      const result = await apiFetch<{ accounts: PlatformAccount[]; error?: string }>('/accounts/sync', { method: 'POST' })
      const accounts = result.accounts || []
      this.update({ accounts })
      await this.refreshIntegrations()
      return !result.error
    } catch (err) {
      console.error('[SMM] syncAccounts:', err)
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Posts
  // -------------------------------------------------------------------------

  async refreshPosts(opts?: { platform?: Platform; status?: PostStatus }): Promise<void> {
    try {
      const params = new URLSearchParams()
      if (opts?.platform) params.set('platform', opts.platform)
      if (opts?.status) params.set('status', opts.status)
      const qs = params.toString() ? `?${params.toString()}` : ''
      const posts = await apiFetch<Post[]>(`/posts${qs}`)
      this.update({ posts })
    } catch (err) {
      console.error('[SMM] refreshPosts:', err)
    }
  }

  async createPost(data: PostCreateInput): Promise<Post | null> {
    try {
      const post = await apiFetch<Post>('/posts', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      await this.refreshPosts()
      return post
    } catch (err) {
      console.error('[SMM] createPost:', err)
      return null
    }
  }

  async updatePost(id: number, data: Partial<PostCreateInput>): Promise<Post | null> {
    try {
      const post = await apiFetch<Post>(`/posts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      await this.refreshPosts()
      return post
    } catch (err) {
      console.error('[SMM] updatePost:', err)
      return null
    }
  }

  async deletePost(id: number): Promise<boolean> {
    try {
      const result = await apiFetch<{ status: string }>(`/posts/${id}`, { method: 'DELETE' })
      await this.refreshPosts()
      await this.refreshQueue()
      await this.refreshCalendar()
      return result.status === 'deleted'
    } catch (err) {
      console.error('[SMM] deletePost:', err)
      return false
    }
  }

  async schedulePost(id: number, isoDateTime: string): Promise<Post | null> {
    try {
      const post = await apiFetch<Post>(`/posts/${id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduledAt: isoDateTime }),
      })
      await this.refreshPosts()
      await this.refreshQueue()
      await this.refreshCalendar()
      return post
    } catch (err) {
      console.error('[SMM] schedulePost:', err)
      return null
    }
  }

  async publishNow(id: number): Promise<{ status: string; message?: string; post?: Post }> {
    try {
      const result = await apiFetch<{ status: string; message?: string; post?: Post }>(
        `/posts/${id}/publish-now`,
        { method: 'POST' }
      )
      if (result.status === 'ok') {
        await this.refreshPosts()
        await this.refreshQueue()
      }
      return result
    } catch (err) {
      console.error('[SMM] publishNow:', err)
      return { status: 'error', message: String(err) }
    }
  }

  async cancelPost(id: number): Promise<Post | null> {
    try {
      const post = await apiFetch<Post>(`/posts/${id}/cancel`, { method: 'POST' })
      await this.refreshPosts()
      await this.refreshQueue()
      await this.refreshCalendar()
      return post
    } catch (err) {
      console.error('[SMM] cancelPost:', err)
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  async refreshQueue(): Promise<void> {
    try {
      const queue = await apiFetch<Post[]>('/queue')
      this.update({ queue })
    } catch (err) {
      console.error('[SMM] refreshQueue:', err)
    }
  }

  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------

  async refreshCalendar(year?: number, month?: number): Promise<void> {
    const y = year ?? this.state.calendarYear
    const m = month ?? this.state.calendarMonth
    try {
      const calendarPosts = await apiFetch<CalendarData>(`/calendar?year=${y}&month=${m}`)
      this.update({ calendarPosts, calendarYear: y, calendarMonth: m })
    } catch (err) {
      console.error('[SMM] refreshCalendar:', err)
    }
  }

  prevMonth(): void {
    let { calendarYear: y, calendarMonth: m } = this.state
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
    this.refreshCalendar(y, m)
  }

  nextMonth(): void {
    let { calendarYear: y, calendarMonth: m } = this.state
    m += 1
    if (m > 12) { m = 1; y += 1 }
    this.refreshCalendar(y, m)
  }

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------

  async refreshAnalyticsSummary(): Promise<void> {
    try {
      const analyticsSummary = await apiFetch<AnalyticsSummary[]>('/analytics/summary')
      this.update({ analyticsSummary })
    } catch (err) {
      console.error('[SMM] refreshAnalyticsSummary:', err)
    }
  }

  async syncPostAnalytics(postId: number): Promise<PostAnalytics | null> {
    try {
      const result = await apiFetch<PostAnalytics | { status: string; message?: string }>(
        `/posts/${postId}/analytics/sync`,
        { method: 'POST' }
      )
      if ('status' in result && (result as any).status === 'unavailable') {
        return null
      }
      await this.refreshAnalyticsSummary()
      return result as PostAnalytics
    } catch (err) {
      console.error('[SMM] syncPostAnalytics:', err)
      return null
    }
  }

  // -------------------------------------------------------------------------
  // AI Caption
  // -------------------------------------------------------------------------

  async generateCaption(
    platform: Platform,
    topic: string,
    tone: CaptionTone,
    keywords?: string[]
  ): Promise<string> {
    try {
      const result = await apiFetch<{ status: string; caption: string }>('/ai/generate-caption', {
        method: 'POST',
        body: JSON.stringify({ platform, topic, tone, keywords }),
      })
      return result.caption || ''
    } catch (err) {
      console.error('[SMM] generateCaption:', err)
      return ''
    }
  }

  // -------------------------------------------------------------------------
  // Media Upload
  // -------------------------------------------------------------------------

  async uploadMedia(file: File): Promise<string | null> {
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API}/media/upload`, { method: 'POST', body: formData })
      const data = await res.json()
      return data.url ? `${BACKEND_URL}${data.url}` : null
    } catch (err) {
      console.error('[SMM] uploadMedia:', err)
      return null
    }
  }

  // -------------------------------------------------------------------------
  // AI Writing Suite
  // -------------------------------------------------------------------------

  setPrefilledTool(tool: 'hooks' | 'humanizer', text: string, platform: Platform): void {
    this.update({ prefilledTool: { tool, text, platform }, activeSection: tool })
  }

  sendToComposer(text: string, platform: Platform): void {
    this.update({ composerPrefill: { text, platform }, activeSection: 'composer' })
  }

  consumeComposerPrefill(): void {
    this.update({ composerPrefill: null })
  }

  async generateHooks(
    topic: string,
    platform: Platform,
    opts?: { description?: string; audience?: string; tone?: string; goal?: string; count?: number }
  ): Promise<HookResult[]> {
    try {
      const res = await apiFetch<{ status: string; hooks: HookResult[] }>('/ai/generate-hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, platform, ...opts }),
      })
      return res.hooks || []
    } catch {
      return []
    }
  }

  async generatePost(
    topic: string,
    hook: string,
    platform: Platform,
    opts?: { description?: string; audience?: string; tone?: string; goal?: string }
  ): Promise<string> {
    try {
      const res = await apiFetch<{ status: string; post: string }>('/ai/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, hook, platform, ...opts }),
      })
      return res.post || ''
    } catch {
      return ''
    }
  }

  async humanizeText(
    text: string,
    platform: Platform,
    tone = 'casual'
  ): Promise<{ status: string; result: string; originalLength: number; resultLength: number } | null> {
    try {
      return await apiFetch('/ai/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, platform, tone }),
      })
    } catch {
      return null
    }
  }

  async fetchCommentInsights(
    platform: Platform,
    postId: string,
    maxComments = 100
  ): Promise<CommentInsightsResult | null> {
    try {
      return await apiFetch('/ai/comment-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, post_id: postId, max_comments: maxComments }),
      })
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Ideas Board
  // -------------------------------------------------------------------------

  async refreshIdeas(): Promise<void> {
    try {
      const ideas = await apiFetch<Idea[]>('/ideas')
      this.update({ ideas })
    } catch { /* ignore */ }
  }

  async createIdea(data: Partial<Idea> & { content: string }): Promise<Idea | null> {
    try {
      const idea = await apiFetch<Idea>('/ideas', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      await this.refreshIdeas()
      return idea
    } catch {
      return null
    }
  }

  async updateIdea(id: number, data: Partial<Idea>): Promise<void> {
    try {
      await apiFetch(`/ideas/${id}`, { method: 'PUT', body: JSON.stringify(data) })
      await this.refreshIdeas()
    } catch { /* ignore */ }
  }

  async deleteIdea(id: number): Promise<void> {
    try {
      await apiFetch(`/ideas/${id}`, { method: 'DELETE' })
      await this.refreshIdeas()
    } catch { /* ignore */ }
  }

  async promoteIdea(id: number): Promise<void> {
    try {
      await apiFetch(`/ideas/${id}/promote`, { method: 'POST' })
      await this.refreshPosts()
      this.update({ activeSection: 'composer' })
    } catch { /* ignore */ }
  }

  async saveHookAsIdea(hook: string, platform: Platform): Promise<void> {
    await this.createIdea({ content: hook, platform, source: 'hook_creator' })
  }

  // -------------------------------------------------------------------------
  // Hashtag Sets
  // -------------------------------------------------------------------------

  async refreshHashtagSets(): Promise<void> {
    try {
      const hashtagSets = await apiFetch<HashtagSet[]>('/hashtag-sets')
      this.update({ hashtagSets })
    } catch { /* ignore */ }
  }

  async createHashtagSet(data: Partial<HashtagSet> & { name: string }): Promise<HashtagSet | null> {
    try {
      const set = await apiFetch<HashtagSet>('/hashtag-sets', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      await this.refreshHashtagSets()
      return set
    } catch {
      return null
    }
  }

  async updateHashtagSet(id: number, data: Partial<HashtagSet> & { incrementUseCount?: boolean }): Promise<void> {
    try {
      await apiFetch(`/hashtag-sets/${id}`, { method: 'PUT', body: JSON.stringify(data) })
      await this.refreshHashtagSets()
    } catch { /* ignore */ }
  }

  async deleteHashtagSet(id: number): Promise<void> {
    try {
      await apiFetch(`/hashtag-sets/${id}`, { method: 'DELETE' })
      await this.refreshHashtagSets()
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Legacy: keep setState / executeAction for template compatibility
  // -------------------------------------------------------------------------

  async setState(updates: Partial<AppState>, persistToBackend = true): Promise<void> {
    this.update(updates)
    if (persistToBackend && this.backendAvailable) {
      try {
        const { initialized, loading, error, ...rest } = updates
        if (Object.keys(rest).length > 0) await ApiService.updateState(rest)
      } catch (err) {
        console.error('[SMM] setState persist:', err)
      }
    }
  }

  async refresh(): Promise<void> {
    await this.initialize()
  }
}
