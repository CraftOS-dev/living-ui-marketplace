/**
 * Typed, authenticated API client. All CRM data flows through here.
 * Errors throw with a readable message; callers toast and roll back.
 */

import { authService } from './services/AuthService'
import type {
  ActivityVolumeReport,
  AiChatResponse,
  AiRun,
  AiStatus,
  Attachment,
  Attribute,
  BoardPayload,
  DashboardPayload,
  EmailLog,
  EmailTemplate,
  FunnelReport,
  ImportReport,
  ListEntry,
  ListInfo,
  MyWork,
  Note,
  QueryResult,
  RecordBrief,
  RecordRow,
  RecordType,
  SavedView,
  SearchResults,
  SmtpConfig,
  Stage,
  Tag,
  Task,
  VelocityReport,
  ViewFilter,
  ViewSort,
  WinRateReport,
} from './types'

const BACKEND_URL: string =
  (window as unknown as { __CRAFTBOT_BACKEND_URL__?: string }).__CRAFTBOT_BACKEND_URL__ ||
  window.location.origin

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await authService.authFetch(`${BACKEND_URL}/api${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    if (data && typeof data === 'object' && 'detail' in data) {
      detail = String((data as { detail: unknown }).detail)
    }
    throw new Error(detail)
  }
  return data as T
}

async function requestText(path: string): Promise<string> {
  const response = await authService.authFetch(`${BACKEND_URL}/api${path}`)
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return response.text()
}

export const get = <T>(path: string) => request<T>('GET', path)
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
export const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body)
export const del = <T>(path: string) => request<T>('DELETE', path)

// ── Records ────────────────────────────────────────────────────────────────

export const api = {
  records: {
    query: (recordType: RecordType, body: {
      filters?: ViewFilter[]
      sorts?: ViewSort[]
      search?: string
      page?: number
      page_size?: number
      list_id?: number | null
    }) => post<QueryResult>(`/records/${recordType}/query`, body),
    get: (recordType: RecordType, id: number) =>
      get<{ status: string; record: RecordRow | null }>(`/records/${recordType}/${id}`),
    create: (recordType: RecordType, body: Record<string, unknown>) =>
      post<RecordRow>(`/records/${recordType}`, body),
    update: (recordType: RecordType, id: number, body: Record<string, unknown>) =>
      put<RecordRow & { status?: string }>(`/records/${recordType}/${id}`, body),
    remove: (recordType: RecordType, id: number) =>
      del<{ status: string }>(`/records/${recordType}/${id}`),
    checkDuplicates: (recordType: RecordType, params: { email?: string; domain?: string; name?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString()
      return get<{ duplicates: RecordBrief[] }>(`/records/${recordType}/check-duplicates?${query}`)
    },
    linkDealPerson: (dealId: number, personId: number) =>
      post(`/deals/${dealId}/people`, { person_id: personId }),
    unlinkDealPerson: (dealId: number, personId: number) =>
      del(`/deals/${dealId}/people/${personId}`),
  },

  search: (q: string, limit = 8) =>
    get<SearchResults>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  attributes: {
    list: (scope: { objectType?: RecordType; listId?: number }) => {
      const params = new URLSearchParams()
      if (scope.objectType) params.set('object_type', scope.objectType)
      if (scope.listId) params.set('list_id', String(scope.listId))
      return get<Attribute[]>(`/attributes?${params.toString()}`)
    },
    create: (body: Record<string, unknown>) => post<Attribute>('/attributes', body),
    update: (id: number, body: Record<string, unknown>) => put<Attribute>(`/attributes/${id}`, body),
    remove: (id: number) => del<{ status: string }>(`/attributes/${id}`),
    writeValue: (body: {
      attribute_id: number
      record_type: RecordType
      record_id: number
      value: unknown
      list_entry_id?: number
    }) => post('/attribute-values', body),
  },

  lists: {
    all: () => get<ListInfo[]>('/lists'),
    get: (id: number) => get<ListInfo & { status?: string }>(`/lists/${id}`),
    create: (body: Record<string, unknown>) => post<ListInfo>('/lists', body),
    update: (id: number, body: Record<string, unknown>) => put<ListInfo>(`/lists/${id}`, body),
    remove: (id: number) => del<{ status: string }>(`/lists/${id}`),
    board: (id: number) => get<BoardPayload>(`/lists/${id}/board`),
    addEntry: (listId: number, body: { record_type?: RecordType; record_id: number; stage_id?: number | null }) =>
      post<ListEntry>(`/lists/${listId}/entries`, body),
    removeEntry: (listId: number, entryId: number) => del(`/lists/${listId}/entries/${entryId}`),
    moveEntry: (entryId: number, body: { stage_id?: number | null; position?: number }) =>
      put<ListEntry>(`/entries/${entryId}/move`, body),
    createStage: (listId: number, body: Record<string, unknown>) =>
      post<Stage>(`/lists/${listId}/stages`, body),
    updateStage: (stageId: number, body: Record<string, unknown>) => put<Stage>(`/stages/${stageId}`, body),
    removeStage: (stageId: number) => del<{ status: string }>(`/stages/${stageId}`),
    reorderStages: (listId: number, stageIds: number[]) =>
      put(`/lists/${listId}/stages-reorder`, { stage_ids: stageIds }),
  },

  views: {
    list: (scope: { objectType?: RecordType; listId?: number }) => {
      const params = new URLSearchParams()
      if (scope.objectType) params.set('object_type', scope.objectType)
      if (scope.listId) params.set('list_id', String(scope.listId))
      return get<SavedView[]>(`/views?${params.toString()}`)
    },
    create: (body: Record<string, unknown>) => post<SavedView>('/views', body),
    update: (id: number, body: Record<string, unknown>) => put<SavedView>(`/views/${id}`, body),
    remove: (id: number) => del<{ status: string }>(`/views/${id}`),
  },

  timeline: {
    get: (recordType: RecordType, recordId: number, typeFilter = '', page = 1, pageSize = 50) =>
      get<{ items: import('./types').Activity[]; total: number; page: number; pageSize: number }>(
        `/timeline/${recordType}/${recordId}?type_filter=${encodeURIComponent(typeFilter)}&page=${page}&page_size=${pageSize}`
      ),
    logActivity: (body: Record<string, unknown>) => post<import('./types').Activity>('/activities', body),
  },

  notes: {
    list: (recordType: RecordType, recordId: number) => get<Note[]>(`/notes/${recordType}/${recordId}`),
    create: (body: Record<string, unknown>) => post<Note>('/notes', body),
    update: (id: number, body: Record<string, unknown>) => put<Note>(`/notes/${id}`, body),
    remove: (id: number) => del<{ status: string }>(`/notes/${id}`),
  },

  tasks: {
    list: (params: { recordType?: RecordType; recordId?: number } = {}) => {
      const query = new URLSearchParams()
      if (params.recordType && params.recordId) {
        query.set('record_type', params.recordType)
        query.set('record_id', String(params.recordId))
      }
      return get<Task[]>(`/tasks?${query.toString()}`)
    },
    myWork: () => get<MyWork>('/tasks/my-work'),
    create: (body: Record<string, unknown>) => post<Task>('/tasks', body),
    update: (id: number, body: Record<string, unknown>) => put<Task>(`/tasks/${id}`, body),
    remove: (id: number) => del<{ status: string }>(`/tasks/${id}`),
  },

  email: {
    config: () => get<SmtpConfig>('/email/config'),
    saveConfig: (body: Record<string, unknown>) => put<SmtpConfig>('/email/config', body),
    testConfig: () => post<{ ok: boolean; error: string; notConfigured?: boolean }>('/email/config/test'),
    send: (body: Record<string, unknown>) =>
      post<{ ok: boolean; status: string; error: string; notConfigured: boolean; log: EmailLog }>('/email/send', body),
    logManual: (body: Record<string, unknown>) => post<EmailLog>('/email/log', body),
    logs: (recordType: RecordType, recordId: number) =>
      get<{ items: EmailLog[]; total: number }>(`/email/logs?record_type=${recordType}&record_id=${recordId}`),
    templates: () => get<EmailTemplate[]>('/email/templates'),
    createTemplate: (body: Record<string, unknown>) => post<EmailTemplate>('/email/templates', body),
    updateTemplate: (id: number, body: Record<string, unknown>) => put<EmailTemplate>(`/email/templates/${id}`, body),
    removeTemplate: (id: number) => del(`/email/templates/${id}`),
  },

  tags: {
    all: () => get<Tag[]>('/tags'),
    create: (body: { name: string; color?: string }) => post<Tag>('/tags', body),
    update: (id: number, body: { name?: string; color?: string }) => put<Tag>(`/tags/${id}`, body),
    remove: (id: number) => del(`/tags/${id}`),
    assign: (tagId: number, recordType: RecordType, recordId: number) =>
      post(`/tags/${tagId}/records`, { record_type: recordType, record_id: recordId }),
    unassign: (tagId: number, recordType: RecordType, recordId: number) =>
      del(`/tags/${tagId}/records/${recordType}/${recordId}`),
  },

  files: {
    list: (recordType: RecordType, recordId: number) => get<Attachment[]>(`/files/${recordType}/${recordId}`),
    upload: (body: { record_type: RecordType; record_id: number; file_name: string; data_base64: string }) =>
      post<Attachment>('/files', body),
    remove: (id: number) => del(`/files/${id}`),
    downloadUrl: (id: number) => `${BACKEND_URL}/api/files/download/${id}`,
  },

  reports: {
    dashboard: () => get<DashboardPayload>('/dashboard'),
    funnel: (listId = 0) => get<FunnelReport>(`/reports/funnel?list_id=${listId}`),
    winRate: (months = 6) => get<WinRateReport>(`/reports/win-rate?months=${months}`),
    velocity: (listId = 0) => get<VelocityReport>(`/reports/velocity?list_id=${listId}`),
    activityVolume: (weeks = 8) => get<ActivityVolumeReport>(`/reports/activity-volume?weeks=${weeks}`),
    exportCsv: (report: string, listId = 0, months = 6, weeks = 8) =>
      requestText(`/reports/export?report=${report}&list_id=${listId}&months=${months}&weeks=${weeks}`),
  },

  ai: {
    status: () => get<AiStatus>('/ai/status'),
    summary: (recordType: RecordType, recordId: number, saveAsNote = false) =>
      post<{ configured: boolean; ok?: boolean; summary?: string; error?: string; message?: string; note?: Note | null }>(
        '/ai/summary',
        { record_type: recordType, record_id: recordId, save_as_note: saveAsNote }
      ),
    emailDraft: (body: Record<string, unknown>) =>
      post<{ configured: boolean; ok?: boolean; subject?: string; body?: string; error?: string; message?: string }>(
        '/ai/email-draft',
        body
      ),
    score: (recordType: RecordType, recordIds: number[]) =>
      post<{
        configured: boolean
        ok?: boolean
        error?: string
        message?: string
        results?: { recordId: number; record: RecordBrief | null; score: number; reasoning: string }[]
      }>('/ai/score', { record_type: recordType, record_ids: recordIds }),
    chat: (question: string) => post<AiChatResponse>('/ai/chat', { question }),
    runs: (params: { recordType?: RecordType; recordId?: number; kind?: string } = {}) => {
      const query = new URLSearchParams()
      if (params.recordType && params.recordId) {
        query.set('record_type', params.recordType)
        query.set('record_id', String(params.recordId))
      }
      if (params.kind) query.set('kind', params.kind)
      return get<AiRun[]>(`/ai/runs?${query.toString()}`)
    },
  },

  dataio: {
    importCsv: (body: {
      record_type: RecordType
      csv_text: string
      mapping?: Record<string, string>
      dedupe?: boolean
      list_id?: number | null
    }) => post<ImportReport>('/import/csv', body),
    importFields: (recordType: RecordType) => get<{ fields: string[] }>(`/import/fields?record_type=${recordType}`),
    exportCsv: (recordType: RecordType, opts: { listId?: number; ids?: number[] } = {}) => {
      const params = new URLSearchParams({ record_type: recordType })
      if (opts.listId) params.set('list_id', String(opts.listId))
      if (opts.ids?.length) params.set('ids', opts.ids.join(','))
      return requestText(`/export/csv?${params.toString()}`)
    },
    seedDemo: () => post<{ status: string } & Record<string, number | string>>('/seed/demo'),
    seedClear: () => post<{ status: string }>('/seed/clear'),
  },

  state: {
    get: () => get<Record<string, unknown>>('/state'),
    update: (data: Record<string, unknown>) => put('/state', { data }),
  },
}

export { BACKEND_URL }
