/**
 * Shapes read by the "Your AI agent" screens: proposals, the Inbox,
 * questions and what your AI agent did.
 */
import type { AuditEntry, Proposal, ProposalStatus } from '../types.ts';

export interface ProposalList {
  proposals: Proposal[];
  total: number;
  counts: Partial<Record<ProposalStatus, number>>;
}

export type InboxStatus = 'waiting' | 'reading' | 'done' | 'failed';
export type InboxKind = 'bill' | 'receipt' | 'statement' | 'other';

export interface InboxFile {
  id: string;
  filename: string;
  kind: InboxKind | string;
  status: InboxStatus;
  summary: string;
  error: string;
  note: string;
  result: { entity: string; id: string; label: string } | null;
  is_pdf: boolean;
  actor: 'person' | 'agent' | string;
  added_by: string;
  created: string;
  updated: string;
}

export interface InboxList {
  files: InboxFile[];
  counts: Record<InboxStatus, number>;
}

export type AskStatus = 'waiting' | 'working' | 'answered' | 'failed';

export interface Ask {
  id: string;
  question: string;
  status: AskStatus;
  answer: string;
  answered_at: string;
  who: string;
  created: string;
}

export interface AskCreated extends Ask {
  /** Your AI agent was told (false: it picks the question up later). */
  asked: boolean;
  request: string;
}

export interface AgentActivity {
  entries: AuditEntry[];
  today: number;
  proposals_waiting: number;
  inbox_waiting: number;
}
