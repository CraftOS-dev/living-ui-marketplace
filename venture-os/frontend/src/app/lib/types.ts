/**
 * Kernel shapes as the operations answer them (SPEC 4.3, 4.7). Modules keep
 * their own record types next to their pages.
 */

export type Module = 'network' | 'intake' | 'pipeline' | 'diligence' | 'committee' | 'portfolio' | 'funds' | 'lps' | 'markets' | 'settings';
export type Level = 'none' | 'view' | 'edit' | 'full';

export const MODULES: Module[] = ['network', 'intake', 'pipeline', 'diligence', 'committee', 'portfolio', 'funds', 'lps', 'markets', 'settings'];

/** An entity as entities.* and auth.me answer it (management company, fund or SPV). */
export interface EntityRef {
  id: string;
  kind: 'management' | 'fund' | 'spv';
  name: string;
  short_name: string;
  legal_name?: string | undefined;
  currency: string;
  vintage: number | null;
  size_minor: number;
  status?: string | undefined;
  archived?: boolean | undefined;
  lpa?: Record<string, unknown> | null | undefined;
}

/** A fund the member may see (the sidebar's scope switch lists them). */
export type FundRef = EntityRef;

export interface Firm {
  name: string;
  /** The firm's own logo ('' when none): the sidebar shows it in place of the app's name (lib/images.ts). */
  logo_url?: string | undefined;
  base_currency: string;
  /** IANA zone; every `_day` is a day in this zone. */
  zone: string;
  /** 'dmy' | 'mdy' | 'ymd' | 'iso' */
  date_style: string;
  week_start?: number | undefined;
  setup_done: boolean;
  agent_sees_fund_data: boolean;
}

/** auth.me for a person. */
export interface Me {
  actor: 'person';
  member: { id: string; name: string; email: string; title: string; zone?: string | undefined; prefs: Record<string, unknown> };
  role: { id: string; code: string; name: string; votes?: boolean | undefined; own_items?: boolean | undefined } | null;
  levels: Record<Module, Level>;
  owner: boolean;
  admin: boolean;
  /** Fund ids this member is limited to; empty means all. */
  funds_scope: string[];
  /** The funds the member may see. */
  funds: FundRef[];
  /** Every entity the member may see (management, funds, SPVs). */
  entities: EntityRef[];
  /** LP data is visible to your AI agent (settings) and to this member. */
  fund_data_visible?: boolean | undefined;
  has_pin: boolean;
  firm: Firm;
  unread: number;
  /** The firm's today, 'YYYY-MM-DD'. */
  today: string;
}

/* ------------------------------------------------------------------ Next */

export type NextKind = 'verdict' | 'draft' | 'proposal' | 'vote' | 'decision' | 'verify' | 'alert' | 'condition' | 'payment' | 'mark' | 'candidate' | 'note' | 'task' | 'stall';
export type ChipTone = 'neutral' | 'good' | 'warn' | 'bad' | 'agent';

export interface NextAction {
  label: string;
  /** The operation the button runs (a name from the catalog). */
  op: string;
  params?: Record<string, unknown> | undefined;
  /** The one black button (keyboard A). */
  primary?: boolean | undefined;
  /** Ask the approval PIN before it runs (ops with effect confirm ask anyway). */
  pin?: boolean | undefined;
  /** Ask "Sure?" before it runs. */
  confirm?: boolean | undefined;
  /** Pick a chip first; its value goes in `param`. */
  choose?: { param: string; options: { value: string; label: string }[] } | null | undefined;
  /** The undo toast's word after it ran ("Passed"); default "Done". (Needs kernel-core's lib_next to pass it through.) */
  done?: string | undefined;
  /** The operation that takes it back (the toast's Undo). */
  undo?: { op: string; params?: Record<string, unknown> | undefined } | undefined;
  tone?: 'danger' | undefined;
}

/** What the generic card shows beyond figures and chips (NextItem.data). */
export interface NextData {
  /** Full text shown in the card (a draft email, a letter). */
  body?: string | undefined;
  /** Before and after lines (a proposal). */
  lines?: { label: string; before?: string | undefined; after: string }[] | undefined;
  /** The source snippet beside a value to verify. */
  quote?: { text: string; source?: string | undefined; href?: string | undefined; file?: string | undefined; page?: number | undefined; anchor?: string | undefined } | undefined;
  /** How E edits the item: `fields` holds each editable field's current text ({ subject, body }); Save calls `op` with params plus every changed field. */
  edit?: { op: string; params?: Record<string, unknown> | undefined; fields: Record<string, string> } | undefined;
  [key: string]: unknown;
}

export interface NextItem {
  /** Stable and unique across modules: 'intake:<id>'. */
  key: string;
  /** The module whose needsYou answered it. */
  module?: string | undefined;
  kind: NextKind;
  /** A custom renderer key (registry `cards`); '' for the generic card. */
  card: string;
  title: string;
  /** At most 3, already formatted. */
  figures: { label: string; value: string }[];
  chips: { label: string; tone?: ChipTone | undefined }[];
  steps: { labels: string[]; at: number } | null;
  /** Prepared by your AI agent. */
  agent: boolean;
  /** Lower first: 10 decisions due today, 20 verdicts, 30 approvals, 40 verify, 50 alerts, 60 other. */
  rank: number;
  at: string;
  /** '' when there is no page to open. */
  href: string;
  /** The generic card's extras and anything a custom card needs. */
  data: NextData | null;
  actions: NextAction[];
}

export interface NextList {
  items: NextItem[];
  total: number;
  next_cursor: string;
}

export interface NextCount {
  total: number;
  by_kind: Partial<Record<NextKind, number>>;
}

/* -------------------------------------------------------- your AI agent */

/**
 * A record's ask of one trigger (its `agent` field, lib_agent.view): the
 * request id the platform keeps (follow it with useAgentRequest), when it
 * was asked and by whom, done_at once your AI agent's result landed, error
 * when it could not; pending while it waits (under 24 hours), stale once
 * nobody picked it up in 24 hours (Retry asks again).
 */
export interface AgentAskState {
  request: string;
  at: string;
  by: string;
  done_at: string;
  error: string;
  pending: boolean;
  stale: boolean;
}

/** A record's asks by trigger ({ deck_triage: {...} }). */
export type AgentAsks = Partial<Record<string, AgentAskState>>;

/** A record's ask as a StepTrack (lib_agent.track). */
export interface AgentTrack {
  trigger: string;
  request: string;
  status: 'asked' | 'done' | 'failed' | 'unanswered';
  at: number;
  labels: string[];
  open: boolean;
  failed: boolean;
  stale: boolean;
  error: string;
  asked_at: string;
  done_at: string;
}

/** A question a person asked your AI agent (chat.ask; trigger question_asked). */
export interface AgentQuestion {
  id: string;
  question: string;
  context: string;
  status: 'waiting' | 'answered' | 'failed';
  answer: string;
  failure: string;
  request: string;
  asked_by: string;
  asked_by_name: string;
  answered_at: string;
  created: string;
  updated: string;
}

/** A trigger in plain words (settings.get agent_triggers, ai.inventory). */
export interface AgentTrigger {
  name: string;
  module: string;
  label: string;
  description: string;
  fires: string;
  cooldown_seconds: number;
  params: string[];
  record: string;
  /** The switch that lets the app fire it on its own ('' when only a person asks). */
  policy: string;
  on: boolean | null;
  summary?: string | undefined;
}

/* --------------------------------------------------------------- search */

export interface SearchHit {
  module?: string | undefined;
  kind: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  /** A lucide icon name ('Building2'), '' for the kind's. */
  icon: string;
}
