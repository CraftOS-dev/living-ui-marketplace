/**
 * Committee shapes as the committee ops answer them (cat_committee_*.js).
 * Votes are blind: before an item is revealed a member carries only
 * `voted`; `choice`, `veto` and `rationale` arrive after the reveal.
 */
import type { AgentTrack } from '../../lib/types.ts';
import type { ChartTone } from '../charts.tsx';
import type { Tone } from '../ui.tsx';

export interface Mini {
  id: string;
  name: string;
}

export interface DealMini {
  id: string;
  number: string;
  title: string;
  stage: string;
  stage_label: string;
  status: string;
  round_type: string;
  raise_minor: number | null;
  currency: string;
  check_minor: number | null;
  point: Mini | null;
  restricted: boolean;
  company: (Mini & { domain?: string }) | null;
}

/** Your AI agent's ask on an item, a memo or the anti-portfolio, as a StepTrack (lib_agent.track; a memo's names its sections). */
export type JobBrief = AgentTrack & { sections?: string[] | undefined };

export interface Cite {
  n: number;
  kind: 'anchor' | 'note' | 'url';
  ok: boolean;
  label: string;
  anchor?: string;
  note?: string;
  url?: string;
  source?: string;
  title?: string;
  file?: string;
  page?: number;
  quote?: string;
  reason?: string;
  /** A passage of a file under NDA you may not read: quote is '' (hidden_reason says why). */
  hidden?: boolean;
  hidden_reason?: string;
}

export interface ScenarioRow {
  label: string;
  probability_ppm: number;
  multiple_e8: number | null;
  exit_value_minor: number | null;
  weighted_e8?: number | null;
}

export interface Scenarios {
  rows: ScenarioRow[];
  sum_ppm: number;
  expected_multiple_e8: number | null;
  expected_proceeds_minor: number | null;
  currency: string;
  reason: string | null;
}

export interface Block {
  id: string;
  section: string;
  state: 'kept' | 'proposed';
  content: string;
  citations: Cite[];
  uncited: number;
  counts: { typed: number; pasted: number; agent: number };
  origin: 'agent' | 'mixed' | 'person';
  actor: string;
  updated: string;
  scenarios?: Scenarios;
}

export interface MemoSection {
  key: string;
  label: string;
  people_only: boolean;
  removed: boolean;
  block: Block | null;
  proposed: Block | null;
  scenarios?: Scenarios;
}

export interface Disclosure {
  typed: number;
  pasted: number;
  agent: number;
  chars: number;
  text: string;
}

export interface Memo {
  id: string;
  number: string;
  version: number;
  status: 'draft' | 'submitted' | 'final';
  frozen: boolean;
  hash: string;
  deal: DealMini | null;
  snapshot: {
    company?: string;
    round_type?: string;
    raise_minor?: number | null;
    pre_money_minor?: number | null;
    post_money_minor?: number | null;
    check_minor?: number | null;
    ownership_ppm?: number | null;
    currency?: string;
    author?: string;
    day?: string;
  };
  author: Mini | null;
  submitted_at: string;
  sections: MemoSection[];
  pending: number;
  uncited: number;
  disclosure: Disclosure;
  versions: { id: string; version: number; status: string; hash: string; submitted_at: string }[];
  ask: JobBrief | null;
  agenda: { item: string; meeting: string; number: string; starts_at: string } | null;
}

export interface VoteMember {
  id: string;
  name: string;
  voted: boolean;
  choice?: string | null;
  lean?: 'for' | 'against' | 'neutral' | null;
  veto?: boolean;
  rationale?: string;
}

export interface Votes {
  eligible: number;
  voted: number;
  waiting: number;
  revealed: boolean;
  members: VoteMember[];
  me: { eligible: boolean; voted: boolean };
}

export interface TallyData {
  scale: string;
  scale_label: string;
  rule: string;
  choices: { choice: string; n: number; lean: string }[];
  for: number;
  against: number;
  neutral: number;
  vetoes: number;
  voted: number;
  eligible: number;
  result: 'invest' | 'pass' | 'none';
  reason: string;
  votes?: { member: string; name: string; choice: string; lean: string; veto: boolean; rationale: string }[] | undefined;
}

export interface BearPoint {
  kind: 'risk' | 'contrary';
  text: string;
  citations: Cite[];
}

export interface Item {
  id: string;
  meeting: string;
  kind: 'new_investment' | 'follow_on' | 'portfolio' | 'other';
  kind_label: string;
  title: string;
  sort: number;
  deal: DealMini | null;
  company: Mini | null;
  fund: Mini | null;
  memo: { id: string; number: string; version: number; status: string; hash: string; submitted_at: string } | null;
  champion: Mini | null;
  skeptic: Mini | null;
  preread_at: string;
  cooling: { state: 'none' | 'cooling' | 'over'; ends_at: string };
  voting: 'open' | 'closed';
  status: 'waiting' | 'voting' | 'revealed' | 'decided' | 'skipped';
  scale: string;
  scale_label: string;
  scale_choices: string[];
  rule: string;
  revealed: boolean;
  decision: { id: string; outcome: string; outcome_label: string; rule: string; decided_at: string } | null;
  bearcase: { points: BearPoint[] } | null;
  bearcase_at: string;
  bearcase_by: string;
  bearcase_ask: JobBrief | null;
  votes?: Votes;
  tally?: TallyData;
}

export interface Meeting {
  id: string;
  number: string;
  title: string;
  starts_at: string;
  day: string;
  status: 'planned' | 'live' | 'closed';
  fund: Mini | null;
  facilitator: Mini | null;
  current_item: string;
  started_at: string;
  closed_at: string;
  auto: boolean;
  items_total: number;
  items_decided: number;
  hidden: number;
  me: { facilitator: boolean };
  items?: Item[];
}

export interface MeetingList {
  next: Meeting | null;
  meetings: Meeting[];
  total: number;
  votes_due: number;
  defaults: { day: string; time: string; cooling_hours: number };
}

export interface Condition {
  id: string;
  decision: string;
  deal: DealMini | null;
  text: string;
  owner: Mini | null;
  due_day: string;
  overdue: boolean;
  status: 'open' | 'done' | 'waived';
  evidence: string;
  completed_at: string;
  completed_by: Mini | null;
}

export interface Review {
  id: string;
  day: string;
  event: string;
  text: string;
  source_url: string;
  source_name: string;
  by: 'agent' | 'person';
}

export interface Decision {
  id: string;
  deal: DealMini | null;
  company: Mini | null;
  meeting: { id: string; number: string } | null;
  item: string;
  outcome: 'invest' | 'pass' | 'more_diligence' | 'hold';
  outcome_label: string;
  rule: string;
  rule_label: string;
  rule_result: string;
  reason: string;
  reason_label: string;
  note: string;
  tally: TallyData | null;
  memo: { id: string; version: number; hash: string } | null;
  decided_by: Mini | null;
  decided_at: string;
  corrects: string;
  corrected_by: string;
  conditions_open: number;
  conditions_total: number;
  reviews: Review[];
  votes?: { member: string; name: string; choice: string; lean: string; veto: boolean; rationale: string }[] | undefined;
  conditions?: Condition[];
}

export interface AntiRow {
  decision: string;
  decided_at: string;
  company: Mini | null;
  deal: DealMini | null;
  reason: string;
  reason_label: string;
  note: string;
  then: { round_type: string; raise_minor: number | null; post_money_minor: number | null; currency: string; stage: string };
  latest: Review | null;
  reviews: Review[];
}

export const OUTCOMES: { value: Decision['outcome']; label: string }[] = [
  { value: 'invest', label: 'Invest' },
  { value: 'pass', label: 'Pass' },
  { value: 'more_diligence', label: 'More diligence' },
  { value: 'hold', label: 'Hold' },
];

export const RULES: { value: 'consensus' | 'champion' | 'majority'; label: string }[] = [
  { value: 'consensus', label: 'Consensus' },
  { value: 'champion', label: 'Champion' },
  { value: 'majority', label: 'Majority' },
];

export const PASS_REASONS: { value: string; label: string }[] = [
  { value: 'team', label: 'Team' },
  { value: 'market', label: 'Market' },
  { value: 'product', label: 'Product' },
  { value: 'traction', label: 'Traction' },
  { value: 'valuation', label: 'Valuation' },
  { value: 'fit', label: 'Fit' },
  { value: 'timing', label: 'Timing' },
  { value: 'other', label: 'Other' },
];

export const SCALES: { value: string; label: string }[] = [
  { value: 'no_three', label: '1 to 5, no 3' },
  { value: 'one_to_five', label: '1 to 5' },
  { value: 'ten_no_mid', label: '1 to 10, no 5 or 6' },
  { value: 'yes_no', label: 'Yes or no' },
];

export const REVIEW_EVENT: Record<string, string> = { raised: 'Raised', acquired: 'Acquired', ipo: 'IPO', shut_down: 'Shut down', pivoted: 'Pivoted', still_private: 'Private', other: 'Other' };

export function outcomeTone(o: string): Tone {
  return o === 'invest' ? 'good' : o === 'pass' ? 'bad' : o === 'hold' ? 'faint' : 'warn';
}

export function leanTone(l: string | null | undefined): ChartTone {
  return l === 'for' ? 'good' : l === 'against' ? 'bad' : 'muted';
}

export function choiceLabel(c: string): string {
  return c === 'yes' ? 'Yes' : c === 'no' ? 'No' : c;
}

/** "Waiting" | "Voting" ... as the room's StepTrack index: Pre-read, Cooling, Votes, Reveal, Decided. */
export function stepOf(it: Item): number {
  if (it.status === 'decided') return 5;
  if (it.status === 'revealed') return 4;
  if (it.preread_at === '') return 0;
  if (it.cooling.state === 'cooling') return 1;
  if (it.votes !== undefined && it.votes.eligible > 0 && it.votes.waiting === 0) return 3;
  return 2;
}

export const STEP_LABELS = ['Pre-read', 'Cooling', 'Votes', 'Reveal', 'Decided'];
