// =============================================================================
// PDF Splitter - Type Definitions
// =============================================================================

// Backend PDF document model
export interface PDFDocument {
  id: number
  filename: string
  file_size: number
  page_count: number
  uploaded_at: string
}

// Individual file in a split result
export interface SplitFile {
  filename: string
  pages: number[]
}

// Backend split job model
export interface SplitJob {
  id: number
  document_id: number
  split_type: 'pages' | 'ranges' | 'every_n'
  split_config: Record<string, any>
  file_count: number
  created_at: string
  files?: SplitFile[]
}

// Split request config types
export type SplitType = 'pages' | 'ranges' | 'every_n'

export interface SplitByPagesConfig {
  pages: number[]
}

export interface SplitByRangesConfig {
  ranges: [number, number][]
}

export interface SplitEveryNConfig {
  n: number
}

export type SplitConfig = SplitByPagesConfig | SplitByRangesConfig | SplitEveryNConfig

// App state stored in backend
export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
}

// Frontend-only UI state
export interface UIState {
  documents: PDFDocument[]
  activeDocumentId: number | null
  sidebarCollapsed: boolean
  uploading: boolean
  uploadProgress: number
}

// Thumbnail URL helper
export function getThumbnailUrl(backendUrl: string, docId: number, pageNum: number): string {
  return `${backendUrl}/api/pdfs/${docId}/thumbnails/${pageNum}`
}
