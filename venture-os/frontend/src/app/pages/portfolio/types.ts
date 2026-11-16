/** Portfolio shapes as the portfolio operations answer them. */
import type { AgentAsks } from '../../lib/types.ts';


export interface CompanyMini {
  id: string;
  name: string;
  domain: string;
  /** The company's own logo ('' when none; lib/images.ts). */
  logo_url?: string | undefined;
  /** The domain whose favicon stands in ('' in a demo firm). */
  logo_domain?: string | undefined;
}

export interface FundMini {
  id: string;
  name: string;
  currency?: string | undefined;
}

export type Reporting = 'none' | 'requested' | 'received' | 'staged' | 'verified' | 'dismissed';

export interface SparkPoint {
  period_end: string;
  value: number | null;
  status: string;
}

export interface HoldingRow {
  id: string;
  company: CompanyMini;
  fund: FundMini | null;
  status: 'active' | 'exited' | 'written_off';
  stage: string;
  currency: string;
  cost_minor: number;
  value_minor: number;
  value_basis: string;
  ownership_ppm: number | null;
  kpi: { key: string; label: string; currency: string; value: number | null; value_text: string; period_end: string; status: string; spark: SparkPoint[]; growth_ppm: number | null };
  runway: { months: number | null; state: string; reason: string | null; as_of_day: string | null };
  reporting: Reporting;
  requests_on: boolean;
  last_update_at: string;
  alert: '' | 'warn' | 'bad';
}

export interface PortfolioList {
  figures: { companies: number; invested_minor: number | null; value_minor: number | null; currency: string; moic_e8: number | null; moic_reason: string | null; runway_low: number; runway_months: number; held_at_cost: number };
  rows: HoldingRow[];
  total: number;
  hidden: number;
  funds: FundMini[];
}

export interface Security {
  id: string;
  kind: string;
  class: string;
  day: string;
  shares: number | null;
  cost_minor: number;
  cap_minor: number | null;
  discount_ppm: number | null;
  rate_ppm: number | null;
  status: string;
  round: string;
}

export interface OwnershipPoint {
  day: string;
  ppm: number;
  basis: string;
  round: string;
}

export interface Holding {
  id: string;
  company: CompanyMini | null;
  fund: FundMini | null;
  deal: { id: string; number: string } | null;
  status: string;
  currency: string;
  pro_rata: boolean;
  board_role: string;
  first_day: string;
  cost_minor: number;
  value_minor: number;
  value_basis: string;
  moic_e8: number | null;
  ownership_ppm: number | null;
  proceeds_minor: number;
  report_currency: string;
  fy_end_month: number;
  securities?: Security[] | undefined;
  ownership?: OwnershipPoint[] | undefined;
  prorata?: { right: boolean; ownership_ppm: number | null; amount_minor: number | null; round: { label: string; day: string; currency: string } | null; currency: string } | undefined;
}

export interface Round {
  id: string;
  day: string;
  type: string;
  label: string;
  currency: string;
  pre_money_minor: number | null;
  post_money_minor: number | null;
  raised_minor: number | null;
  price_e8: number | null;
  post_shares: number | null;
  cap_table: { holder: string; class: string; shares: number | null; ppm: number | null }[];
}

export interface CompanyHoldings {
  company: CompanyMini | null;
  holdings: Holding[];
  rounds: Round[];
  hidden: number;
}

export interface KpiPoint {
  id: string;
  period_start: string;
  period_end: string;
  months: number;
  value: number | null;
  currency: string;
  status: string;
  forecast: boolean;
  reason?: string | null | undefined;
}

export interface Metric {
  key: string;
  label: string;
  kind: string;
  unit: 'money' | 'count' | 'percent' | 'months';
  points: KpiPoint[];
  forecast: KpiPoint[];
  latest: (KpiPoint & { value_text: string }) | null;
  staged: number;
  growth: { growth_ppm: number | null; reason: string | null };
}

export interface Runway {
  months: number | null;
  state: 'known' | 'not_burning' | 'unknown';
  reason: string | null;
  cash_minor: number | null;
  avg_burn_minor: number | null;
  as_of_day: string | null;
  missing: string[];
  zero_day: string | null;
  currency: string;
}

export interface KpiList {
  company: CompanyMini | null;
  holding: string;
  fy_end_month: number;
  report_currency: string;
  currency: string;
  metrics: Metric[];
  runway: Runway;
}

export interface Flag {
  code: string;
  label: string;
  note: string;
}

export interface Snippet {
  before: string;
  quote: string;
  after: string;
  page?: number | undefined;
  file?: string | undefined;
}

export interface KpiValue {
  id: string;
  key: string;
  label: string;
  unit: string;
  period_end: string;
  months: number;
  value: number;
  value_text: string;
  currency: string;
  forecast: boolean;
  status: 'staged' | 'verified' | 'rejected' | 'superseded';
  quote: string;
  anchor: string;
  flags: Flag[];
  note: string;
  actor: string;
  snippet?: Snippet | null | undefined;
}

export interface Step {
  labels: string[];
  at: number;
}

export interface UpdateRow {
  id: string;
  company: CompanyMini | null;
  source: string;
  from_email: string;
  from_name: string;
  subject: string;
  received_at: string;
  period_end: string;
  period_label: string;
  status: string;
  step: Step | null;
  counts: { staged: number; verified: number; rejected: number };
  files: number;
  /** The update's ask of your AI agent (update_extract), followed live. */
  agent?: AgentAsks | undefined;
}

export interface FileView {
  id: string;
  name: string;
  text_state: string;
  pages: number;
}

export interface Ask {
  id: string;
  company: CompanyMini | null;
  kind: string;
  title: string;
  detail: string;
  owner: { id: string; name: string } | null;
  status: 'open' | 'in_progress' | 'done';
  outcome: string;
  due_day: string;
  quote: string;
  actor: string;
  update: string;
}

export interface UpdateDetail extends UpdateRow {
  body: string;
  file_list: FileView[];
  values: KpiValue[];
  asks: Ask[];
}

export interface BriefPoint {
  text: string;
  source: Record<string, string> | null;
}

export interface BoardMeeting {
  id: string;
  company: CompanyMini | null;
  day: string;
  time: string;
  title: string;
  note: string;
  brief: { sections: { title: string; points: BriefPoint[] }[]; by?: string | undefined } | null;
  brief_state: 'none' | 'queued' | 'failed' | 'ready';
  brief_step: Step;
  brief_error?: string | undefined;
  /** The meeting's ask of your AI agent (board_brief), followed live. */
  agent?: AgentAsks | undefined;
}

export interface Alert {
  id: string;
  company: CompanyMini | null;
  rule: string;
  level: 'warn' | 'bad';
  title: string;
  status: string;
  fired_at: string;
  figure: { value: number; threshold: number; unit: string; currency?: string | undefined; cash_minor?: number | null | undefined; zero_day?: string | null | undefined; series?: { period_end: string; value: number }[] | undefined };
}

export interface RequestView {
  id: string;
  enabled: boolean;
  cadence: 'monthly' | 'quarterly';
  metrics: string[];
  to: string[];
  period_end: string;
  period_label: string;
  state: 'off' | 'scheduled' | 'requested' | 'reminded' | 'received';
  sent_at: string;
  next_day: string;
  error: string;
  company: CompanyMini | null;
}

export interface RequestsList {
  companies: { company: CompanyMini; recipients: string[]; request: RequestView | null }[];
  template: { subject: string; body: string };
  default_metrics: string[];
  updates_label: string;
  company_mail: boolean;
  gmail: boolean;
}

export interface KpiDef {
  id: string;
  key: string;
  label: string;
  kind: string;
  unit: string;
  active: boolean;
  seeded: boolean;
}

export interface SafePreview {
  instrument: string;
  currency: string;
  amount_minor: number;
  cap_minor: number | null;
  ownership_ppm: number | null;
  reason: string | null;
  implied_price_e8: number | null;
  price_e8: number | null;
  scenario: { pre_money_minor: number; raise_minor: number; notional: boolean } | null;
  converted: { ownership_ppm: number; basis: string } | null;
  fund: FundMini | null;
  day: string;
}

/** One file of a company page (portfolio.company): a deck, board deck, founder update (a file or an email) or a deal room file. */
export interface PageFile {
  id: string;
  kind: 'deck' | 'board' | 'update' | 'file';
  name: string;
  day: string;
  /** The file id ('' for an update that came as an email body). */
  file: string;
  /** The update it belongs to ('' when none). */
  update: string;
  ext: string;
  pages: number;
  folder: string;
}

export interface PagePerson {
  id: string;
  name: string;
  email: string;
  title: string;
  role: 'founder' | 'person';
}

export interface PagePosition {
  holding: string;
  fund: FundMini | null;
  deal: { id: string; number: string } | null;
  status: string;
  currency: string;
  invested_minor: number;
  value_minor: number;
  value_basis: string;
  moic_e8: number | null;
  ownership_ppm: number | null;
  first_day: string;
  board_role: string;
  lead: { id: string; name: string } | null;
}

/** portfolio.company: the company page in one read. */
export interface CompanyView {
  company: {
    id: string;
    name: string;
    domain: string;
    /** The domain whose public favicon is the logo ('' in a demo firm). */
    logo_domain: string;
    /** The company's own logo ('' when none). */
    logo_url?: string | undefined;
    /** The stage a person gave the company ('' when none; `stage` is the label to show). */
    stage_key?: string | undefined;
    website: string;
    one_liner: string;
    description: string;
    sector: string;
    subsector: string;
    stage: string;
    hq_city: string;
    hq_country: string;
    founded_year: number | null;
    team_size: number | null;
    linkedin: string;
  };
  people: { founders: boolean; list: PagePerson[] };
  links: { website: string; deck: PageFile | null; board_deck: PageFile | null; update: { id: string; day: string; label: string } | null; files: number; emails: string[] };
  position: PagePosition[];
  last_round: { label: string; day: string; currency: string; post_money_minor: number | null; raised_minor: number | null } | null;
  update: { id: string; subject: string; received_at: string; period_label: string; from_name: string; status: string; summary: string; counts: { staged: number; verified: number } } | null;
  asks: { open: number; in_progress: number; items: Ask[] };
  next_board: { id: string; day: string; time: string; title: string; brief: boolean } | null;
  files: PageFile[];
  hidden: number;
}
