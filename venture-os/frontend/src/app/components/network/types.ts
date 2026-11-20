/**
 * Network shapes as the network operations answer them (cat_network_graph.js,
 * cat_network_work.js). Numbers come from the engines; the screens only show them.
 */
import type { AgentAskState } from '../../lib/types.ts';


export type Band = 'strong' | 'good' | 'weak' | 'none';

export interface MemberRef {
  id: string;
  name: string;
  email?: string | undefined;
}

export interface CompanyRef {
  id: string;
  name: string;
  domain?: string | undefined;
}

export interface PersonRef {
  id: string;
  name: string;
  email: string;
  title?: string | undefined;
  company: CompanyRef | null;
}

export interface FindHit {
  kind: 'company' | 'person';
  id: string;
  name: string;
  sub: string;
  score: number;
  band: Band;
}

export interface PathNodeView {
  kind: 'member' | 'person';
  id: string;
  name: string;
  email?: string | undefined;
}

export interface PathView {
  kind: 'direct' | 'one_hop';
  member: string;
  connector: string | null;
  target: string;
  weakest: number;
  band: Band;
  last_at: string | null;
  edges: { from: string; to: string; score: number; band: Band; last_at: string | null }[];
  nodes: PathNodeView[];
}

export interface Steps {
  labels: string[];
  at: number;
}

export interface IntroView {
  id: string;
  status: 'requested' | 'drafted' | 'sent' | 'failed' | 'made' | 'declined' | 'no_answer' | 'cancelled';
  steps: Steps;
  target: PersonRef;
  target_company: CompanyRef | null;
  via: MemberRef | null;
  connector: PersonRef | null;
  path_kind: 'direct' | 'one_hop';
  requested_by: MemberRef | null;
  to_email: string;
  outbound: { id: string; status: string; subject: string } | null;
  created: string;
  sent_at: string;
  outcome: string;
}

export interface PathsAnswer {
  target: { kind: 'person' | 'company'; id: string; name: string; email?: string | undefined; domain?: string | undefined; company?: CompanyRef | null | undefined };
  people_total: number;
  paths: PathView[];
  intros: IntroView[];
}

export interface CoverageCompany {
  id: string;
  name: string;
  score: number;
  band: Band;
  last_at: string | null;
  best_member: MemberRef | null;
  portfolio: boolean;
  pipeline: boolean;
}

export interface Coverage {
  scope: string;
  total: number;
  bands: Record<Band, number>;
  groups: { pipeline: Record<Band, number>; portfolio: Record<Band, number> };
  companies: CoverageCompany[];
  hidden: number;
}

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  title: string;
  company: CompanyRef | null;
  score: number;
  band: Band;
  last_at: string | null;
  owner: MemberRef | null;
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  sector: string;
  score: number;
  band: Band;
  last_at: string | null;
  owner: MemberRef | null;
  people_known: number;
  relation: 'portfolio' | 'pipeline' | '';
}

export interface RecordFigures {
  kind: 'person' | 'company';
  id: string;
  score: number;
  band: Band;
  last_at: string | null;
  best_member: MemberRef | null;
  deals: number;
  /** The firm holds the company (on a person page: the person's company). */
  invested: boolean;
  holdings: number;
  invested_cost: { currency: string; cost_minor: number }[];
  people_known?: number | undefined;
  people_total?: number | undefined;
  next_meeting: { id: string; start_at: string; title: string } | null;
}

export interface Attendee {
  name: string;
  email: string;
  person: string | null;
  member: string | null | MemberRef;
  external: boolean;
  response: string;
}

export interface BriefState {
  id: string;
  state: 'queued' | 'reading' | 'ready' | 'failed';
  error: string;
  steps: Steps;
  prepared_at: string;
}

export interface MeetingView {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string;
  meet: string;
  link: string;
  status: string;
  external: boolean;
  company: CompanyRef | null;
  deal: { id: string; number: string; stage: string; stage_label: string; status: string } | null;
  attendees: Attendee[];
  brief: BriefState | null;
  note_state: string;
  ended: boolean;
}

export interface CalendarAnswer {
  day: string;
  days: number;
  zone: string;
  events: MeetingView[];
  calendar: string;
  synced_at: string;
}

export interface BriefAttendee {
  name: string;
  email: string;
  person: string | null;
  member: MemberRef | null;
  external: boolean;
  response: string;
  strength: { score: number; band: Band; last_at: string | null; best_member: MemberRef | null } | null;
}

export interface BriefView {
  id: string;
  state: 'queued' | 'reading' | 'ready' | 'failed';
  steps: Steps;
  error: string;
  /** The meeting's ask of your AI agent (meeting_brief), followed live. */
  ask?: AgentAskState | null | undefined;
  event: Omit<MeetingView, 'attendees' | 'brief' | 'external'> | null;
  company: CompanyRef | null;
  deal: MeetingView['deal'];
  deal_hidden: boolean;
  attendees: BriefAttendee[];
  sections: { who: { name: string; email: string; person: string; text: string }[]; history: string; deal: string; questions: string[]; news: { title: string; url: string; day: string; source: string }[] };
  prepared_at: string;
  agent: boolean;
}

export interface TimelineItem {
  at: string;
  module: string;
  kind: string;
  title: string;
  href?: string | undefined;
  icon?: string | undefined;
  actor?: string | undefined;
}

export interface CaptureStatus {
  gmail: 'connected' | 'waiting' | 'offline' | 'error';
  bridge: boolean;
  sources: Record<'mail_owner' | 'mail_firm' | 'calendar', { state: string; error: string; last_ok_at: string; last_try_at: string; counts: Record<string, unknown> }>;
  firm: { capture_address: string; capture_account: string; firm_domains: string[]; derived_domains: string[]; exclude_domains: string[] };
  labels: string[];
  members: { id: string; name: string; email: string; me: boolean; consent: boolean; exclude_domains: string[]; excluded: number }[];
  me: { id: string; consent: boolean; exclude_domains: string[] } | null;
  interactions: number;
}
