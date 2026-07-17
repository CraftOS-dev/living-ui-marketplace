/**
 * CRM System model types — mirror backend to_dict() payloads.
 */

export type RecordType = 'person' | 'company' | 'deal'
export type ViewLayout = 'table' | 'kanban'

/** Small chip payload used everywhere a record is referenced. */
export interface RecordBrief {
  id: number
  recordType: RecordType
  name: string
  avatarColor: string
  domain?: string
  email?: string
  value?: number
  currency?: string
  status?: string
  companyId?: number | null
  expectedCloseDate?: string
  lastInteractionAt?: string | null
}

export interface RecordRow {
  id: number
  recordType: RecordType
  name: string
  createdAt: string | null
  updatedAt: string | null
  lastInteractionAt?: string | null
  attributes: Record<string, unknown>
  tags: Tag[]
  company?: RecordBrief | null
  entry?: ListEntry
  stage?: Stage | null
  // person
  firstName?: string
  lastName?: string
  emails?: string[]
  phones?: string[]
  jobTitle?: string
  companyId?: number | null
  linkedin?: string
  location?: string
  avatarColor?: string
  description?: string
  // company
  domain?: string
  industry?: string
  size?: string
  annualRevenue?: number | null
  // deal
  value?: number
  currency?: string
  primaryPersonId?: number | null
  owner?: string
  status?: 'open' | 'won' | 'lost'
  expectedCloseDate?: string
  closedAt?: string | null
  // detail payload extras
  memberships?: Membership[]
  related?: RelatedRecords
  duplicates?: RecordBrief[]
}

export interface RelatedRecords {
  people: RecordBrief[]
  companies: RecordBrief[]
  deals: RecordBrief[]
}

export interface Membership {
  entry: ListEntry
  list: ListInfo
  stage: Stage | null
}

export type AttributeType =
  | 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'select' | 'multiselect'
  | 'status' | 'checkbox' | 'url' | 'email' | 'phone' | 'rating' | 'record-reference'
  | 'ai-generated'

export interface AttributeOption {
  id: string
  label: string
  color: string
}

export interface Attribute {
  id: number
  objectType: RecordType | null
  listId: number | null
  name: string
  slug: string
  type: AttributeType
  options: AttributeOption[]
  isSystem: boolean
  aiPrompt: string
  position: number
  createdAt: string | null
}

export interface ListInfo {
  id: number
  name: string
  icon: string
  color: string
  parentObject: RecordType
  description: string
  position: number
  createdAt: string | null
  stages?: Stage[]
  entryCount?: number
}

export interface Stage {
  id: number
  listId: number
  name: string
  color: string
  position: number
  isWon: boolean
  isLost: boolean
  probability: number | null
}

export interface ListEntry {
  id: number
  listId: number
  recordType: RecordType
  recordId: number
  stageId: number | null
  position: number
  stageEnteredAt: string | null
  createdAt: string | null
}

export interface SavedView {
  id: number
  objectType: RecordType | null
  listId: number | null
  name: string
  layout: ViewLayout
  filters: ViewFilter[]
  sorts: ViewSort[]
  visibleColumns: string[]
  groupBy: string
  isDefault: boolean
  position: number
  createdAt: string | null
}

export interface ViewFilter {
  field: string
  operator: string
  value?: unknown
}

export interface ViewSort {
  field: string
  dir: 'asc' | 'desc'
}

export interface Activity {
  id: number
  recordType: RecordType
  recordId: number
  type: string
  title: string
  body: string
  actor: string
  occurredAt: string | null
  extra: Record<string, unknown>
  record?: RecordBrief | null
}

export interface Note {
  id: number
  recordType: RecordType
  recordId: number
  title: string
  content: string
  pinned: boolean
  createdBy: string
  createdAt: string | null
  updatedAt: string | null
}

export interface Task {
  id: number
  title: string
  description: string
  dueDate: string
  completedAt: string | null
  completed: boolean
  recordType: RecordType | null
  recordId: number | null
  createdBy: string
  createdAt: string | null
  updatedAt: string | null
  record?: RecordBrief | null
}

export interface MyWork {
  overdue: Task[]
  today: Task[]
  upcoming: Task[]
  someday: Task[]
  completed: Task[]
  counts: { overdue: number; today: number; upcoming: number; open: number }
}

export interface SmtpConfig {
  host: string
  port: number
  username: string
  password: string
  fromEmail: string
  fromName: string
  useTls: boolean
  configured: boolean
}

export interface EmailLog {
  id: number
  personId: number | null
  recordType: RecordType | null
  recordId: number | null
  direction: string
  to: string
  from: string
  subject: string
  body: string
  status: string
  error: string
  createdBy: string
  sentAt: string | null
}

export interface EmailTemplate {
  id: number
  name: string
  subject: string
  body: string
  createdAt: string | null
  updatedAt: string | null
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface Attachment {
  id: number
  recordType: RecordType
  recordId: number
  fileName: string
  size: number
  mime: string
  createdBy: string
  createdAt: string | null
}

export interface AiRun {
  id: number
  kind: string
  recordType: RecordType | null
  recordId: number | null
  input: string
  output: string
  model: string
  createdBy: string
  createdAt: string | null
}

export interface QueryResult {
  items: RecordRow[]
  total: number
  page: number
  pageSize: number
}

export interface BoardColumn {
  stage: Stage
  cards: BoardCard[]
  count: number
  totalValue: number
}

export interface BoardCard {
  entry: ListEntry
  record: RecordBrief
  company?: RecordBrief | null
  daysInStage: number
}

export interface BoardPayload {
  status: string
  list: ListInfo | null
  columns: BoardColumn[]
  unstaged: BoardCard[]
}

export interface DashboardPayload {
  counts: { people: number; companies: number; deals: number; openTasks: number }
  pipeline: {
    list: ListInfo | null
    stages: { stage: Stage; count: number; value: number }[]
    totalValue: number
    openCount: number
  }
  wonThisMonth: { count: number; value: number }
  wonLastMonth: { count: number; value: number }
  tasksDueToday: Task[]
  tasksOverdue: Task[]
  recentActivity: Activity[]
  reconnect: RecordBrief[]
  checklist: {
    dismissed: boolean
    steps: { hasRecords: boolean; hasDealMoved: boolean; hasNote: boolean; hasTask: boolean }
  }
  seeded: boolean
}

export interface FunnelReport {
  list: ListInfo | null
  stages: { stage: Stage; reached: number; currentValue: number; conversion: number }[]
  lostCount: number
}

export interface WinRateReport {
  months: {
    month: string
    label: string
    won: number
    lost: number
    winRate: number | null
    wonValue: number
    avgDealSize: number
  }[]
  overall: { winRate: number | null; avgDealSize: number; totalWonValue: number }
}

export interface VelocityReport {
  list: ListInfo | null
  stages: { stage: Stage; avgDays: number; samples: number }[]
}

export interface ActivityVolumeReport {
  weeks: {
    week: string
    label: string
    total: number
    emails: number
    notes: number
    tasks: number
    meetings: number
    changes: number
  }[]
}

export interface SearchResults {
  people: RecordBrief[]
  companies: RecordBrief[]
  deals: RecordBrief[]
}

export interface ImportReport {
  created: number
  skipped: number
  errors: string[]
  message: string
}

export interface AiStatus {
  configured: boolean
  model: string
}

export interface AiChatResponse {
  configured: boolean
  ok?: boolean
  error?: string
  message?: string
  answer?: string
  records?: RecordBrief[]
}
