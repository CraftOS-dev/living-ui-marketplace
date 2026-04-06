/**
 * CRM System TypeScript Types
 *
 * Interfaces matching backend model to_dict() output (camelCase keys).
 */

// ============================================================================
// Core CRM Types
// ============================================================================

export interface Tag {
  id: number
  name: string
  color: string
  createdAt: string | null
}

export interface Contact {
  id: number
  companyId: number | null
  companyName: string | null
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  department: string | null
  linkedinUrl: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  zipCode: string | null
  source: string | null
  status: string
  leadScore: number | null
  leadStatus: string
  avatarColor: string | null
  customData: Record<string, unknown>
  tags: Tag[]
  createdAt: string | null
  updatedAt: string | null
}

export interface ContactBrief {
  id: number
  firstName: string
  lastName: string
  email: string | null
  companyId: number | null
  companyName: string | null
  jobTitle: string | null
  leadScore: number | null
  leadStatus: string
  avatarColor: string | null
  status: string
}

export interface Company {
  id: number
  name: string
  domain: string | null
  industry: string | null
  size: string | null
  annualRevenue: number | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  description: string | null
  parentId: number | null
  customData: Record<string, unknown>
  contactCount: number
  dealCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CompanyBrief {
  id: number
  name: string
  industry: string | null
  size: string | null
  contactCount: number
}

export interface DealStage {
  id: number
  name: string
  position: number
  probabilityDefault: number
  color: string | null
  isClosedWon: boolean
  isClosedLost: boolean
  dealCount: number
  totalValue: number
  createdAt: string | null
}

export interface Deal {
  id: number
  title: string
  companyId: number | null
  companyName: string | null
  stageId: number
  stageName: string | null
  value: number
  currency: string
  probability: number | null
  expectedCloseDate: string | null
  actualCloseDate: string | null
  status: string
  lossReason: string | null
  owner: string | null
  priority: string
  description: string | null
  position: number
  customData: Record<string, unknown>
  contacts: ContactBrief[]
  createdAt: string | null
  updatedAt: string | null
}

export interface DealBrief {
  id: number
  title: string
  companyName: string | null
  stageId: number
  stageName: string | null
  value: number
  currency: string
  probability: number | null
  status: string
  priority: string
  position: number
  expectedCloseDate: string | null
}

export interface Activity {
  id: number
  entityType: string
  entityId: number
  activityType: string
  subject: string
  description: string | null
  dueDate: string | null
  completedAt: string | null
  isCompleted: boolean
  priority: string
  durationMinutes: number | null
  outcome: string | null
  assignedTo: string | null
  extraData: Record<string, unknown>
  createdAt: string | null
  updatedAt: string | null
}

export interface Note {
  id: number
  entityType: string
  entityId: number
  content: string
  pinned: boolean
  sentimentScore: number | null
  createdAt: string | null
  updatedAt: string | null
}

export interface EmailTemplate {
  id: number
  name: string
  subject: string
  body: string
  category: string | null
  variables: string[]
  createdAt: string | null
  updatedAt: string | null
}

// ============================================================================
// Data Management Types
// ============================================================================

export interface CustomField {
  id: number
  entityType: string
  fieldName: string
  fieldLabel: string
  fieldType: string
  options: string[] | null
  required: boolean
  position: number
  createdAt: string | null
}

export interface ImportJob {
  id: number
  entityType: string
  fileName: string
  status: string
  totalRows: number
  importedRows: number
  skippedRows: number
  errorLog: Array<{ row: number; error: string }>
  createdAt: string | null
  completedAt: string | null
}

export interface Attachment {
  id: number
  entityType: string
  entityId: number
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string | null
  createdAt: string | null
}

// ============================================================================
// AI Types
// ============================================================================

export interface LeadScore {
  id: number
  contactId: number
  score: number
  factors: Record<string, unknown>
  reasoning: string | null
  scoredAt: string | null
}

export interface SalesForecast {
  id: number
  dealId: number
  closeProbability: number
  predictedCloseDate: string | null
  predictedValue: number | null
  reasoning: string | null
  forecastAt: string | null
}

export interface MeetingSummary {
  id: number
  activityId: number
  summary: string
  actionItems: string[]
  keyTopics: string[]
  generatedAt: string | null
}

export interface SentimentRecord {
  id: number
  entityType: string
  entityId: number
  score: number
  label: string
  sourceType: string
  sourceId: number
  analyzedAt: string | null
}

export interface ChatMessage {
  id: number
  role: string
  content: string
  queryType: string | null
  resultData: unknown | null
  createdAt: string | null
}

// ============================================================================
// Email & SMTP Types
// ============================================================================

export interface SmtpConfig {
  id: number
  smtpServer: string | null
  smtpPort: number
  emailAddress: string | null
  password: string | null
  useTls: boolean
  fromName: string | null
  configured?: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface EmailLog {
  id: number
  contactId: number | null
  toEmail: string
  subject: string
  body: string
  status: string
  errorMessage: string | null
  sentAt: string | null
  createdAt: string | null
}

// ============================================================================
// Marketing Types
// ============================================================================

export interface Campaign {
  id: number
  name: string
  campaignType: string
  status: string
  subject: string | null
  body: string | null
  templateId: number | null
  scheduledAt: string | null
  sentAt: string | null
  stats: Record<string, number>
  contactCount?: number
  contacts?: CampaignContact[]
  createdAt: string | null
  updatedAt: string | null
}

export interface CampaignContact {
  id: number
  campaignId: number
  contactId: number
  status: string
  sentAt: string | null
  openedAt: string | null
  clickedAt: string | null
}

export interface LeadCaptureForm {
  id: number
  name: string
  fields: Array<Record<string, unknown>>
  submitAction: string
  tagIds: number[]
  active: boolean
  submissionsCount: number
  createdAt: string | null
  updatedAt: string | null
}

// ============================================================================
// Dashboard & Reports
// ============================================================================

export interface DashboardSummary {
  totalContacts: number
  totalCompanies: number
  openDeals: number
  wonDeals: number
  lostDeals: number
  pipelineValue: number
  wonValue: number
  overdueTasks: number
  upcomingTasks: number
  newContactsMonth: number
  conversionRate: number
}

export interface PipelineStage extends DealStage {
  deals: DealBrief[]
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  perPage: number
  pages: number
}

export interface SearchResults {
  contacts: ContactBrief[]
  companies: CompanyBrief[]
  deals: DealBrief[]
}

// ============================================================================
// AI Request / Response Types
// ============================================================================

export interface AIEmailRequest {
  contactId: number
  purpose: string
  tone?: string
  context?: string
}

export interface AIEmailResponse {
  subject: string
  body: string
}

// ============================================================================
// App State
// ============================================================================

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  currentView: string

  // Data caches
  contacts: PaginatedResponse<Contact> | null
  companies: PaginatedResponse<Company> | null
  deals: PaginatedResponse<Deal> | null
  pipeline: PipelineStage[] | null
  activities: PaginatedResponse<Activity> | null
  stages: DealStage[]
  tags: Tag[]
  dashboardSummary: DashboardSummary | null

  // Detail views
  selectedContact: Contact | null
  selectedCompany: Company | null
  selectedDeal: Deal | null

  // UI state
  sidebarCollapsed: boolean
  searchQuery: string
  // Modal states
  showContactForm: boolean
  showCompanyForm: boolean
  showDealForm: boolean
  showActivityForm: boolean
  editingContact: Contact | null
  editingCompany: Company | null
  editingDeal: Deal | null
}
