/**
 * Word Improve domain types — kept in sync with backend/models.py + routes.py.
 */

export type Mode = 'improve' | 'tone_shift' | 'custom'

export type Tone =
  | 'Formal'
  | 'Casual'
  | 'Persuasive'
  | 'Concise'
  | 'Friendly'
  | 'Academic'

export const TONES: Tone[] = [
  'Formal',
  'Casual',
  'Persuasive',
  'Concise',
  'Friendly',
  'Academic',
]

export type SessionStatus = 'draft' | 'variants_ready' | 'compiled'

export interface SessionVariant {
  id: number
  sessionId: number
  idx: number
  text: string
}

export type ChoiceSource = 'original' | string // 'variant_0' | 'variant_1' | ...

export type ChoiceNote =
  | 'reordered'
  | 'split'
  | 'removed'
  | 'added'
  | 'skip'
  | null

export interface SegmentChoice {
  source: ChoiceSource
  text: string
  note?: ChoiceNote
}

export type SegmentKind = 'auto' | 'conflict' | 'addition'

export interface MergeSegment {
  id: number
  sessionId: number
  position: number
  kind: SegmentKind
  choices: SegmentChoice[]
  selection: number | null
}

export interface SessionSummary {
  id: number
  title: string
  mode: Mode
  tone: Tone | null
  variantCount: number
  status: SessionStatus
  createdAt: string | null
  updatedAt: string | null
}

export interface SessionDetail extends SessionSummary {
  originalText: string
  customInstruction: string | null
  compiledText: string | null
  variants: SessionVariant[]
  segments: MergeSegment[]
}

export interface DiffSegment {
  op: 'equal' | 'insert' | 'delete'
  text: string
}

export interface CompileResponse {
  status: string
  compiled: string
  diff: DiffSegment[]
  session: SessionDetail
}

export interface CreateSessionPayload {
  original_text: string
  mode: Mode
  tone?: Tone | null
  custom_instruction?: string | null
  variant_count: number
  title?: string | null
}

export interface AppState {
  initialized: boolean
  loading: boolean
  error: string | null
  llmAvailable: boolean
  sessions: SessionSummary[]
  active: SessionDetail | null
  generating: boolean
  regenerating: boolean
  compiling: boolean
  lastCompile: CompileResponse | null
}
