/**
 * Shapes of the funds module's answers (lib_funds*.js), as the screens read them.
 * Money is integer minor units of `currency`; rates in ppm; multiples in _e8.
 */
import type { AgentAsks } from '../../lib/types.ts';


export interface Metrics {
  currency: string;
  as_of_day: string;
  paid_in_minor: number;
  distributed_minor: number;
  nav_minor: number | null;
  dpi_e8: number | null;
  rvpi_e8: number | null;
  tvpi_e8: number | null;
  net_irr_ppm: number | null;
  gross_moic_e8: number | null;
  gross_irr_ppm: number | null;
  reasons: Record<string, string | null>;
}

export interface Lpa {
  mgmt_fee_ppm: number;
  fee_basis: string;
  carry_ppm: number;
  waterfall: 'european' | 'american';
  hurdle_ppm: number;
  catch_up_ppm: number;
  pref_compounding: 'compound' | 'simple';
  [k: string]: unknown;
}

export interface FundView {
  id: string;
  kind: 'fund' | 'spv';
  name: string;
  short_name: string;
  legal_name: string;
  label: string;
  currency: string;
  vintage: number | null;
  size_minor: number;
  target_minor: number;
  first_close_day: string;
  status: string;
  lpa: Lpa;
  settings: Record<string, Record<string, unknown>>;
}

export interface Steps {
  labels: string[];
  at: number;
  done?: boolean | undefined;
  void?: boolean | undefined;
}

export interface Quarter {
  id: string;
  fund: string;
  period_end: string;
  label: string;
  status: 'open' | 'frozen' | 'final' | 'sent';
  hash: string;
  steps: Steps;
  /** The quarter's asks of your AI agent (mark_notes, lp_letter). */
  agent?: AgentAsks | undefined;
}

export interface Overview {
  commitment_minor: number;
  called_minor: number;
  called_ppm: number | null;
  unfunded_minor: number;
  distributed_minor: number;
  recallable_minor: number;
  lps: number;
}

export interface JPoint {
  quarter: string;
  end: string;
  calls_minor: number;
  dist_minor: number;
  nav_minor: number;
}

export interface FundDash {
  fund: FundView;
  funds: { id: string; name: string; short_name: string; kind: string }[];
  metrics: Metrics;
  overview: Overview;
  jcurve: JPoint[];
  quarter: Quarter | null;
  next_quarter_end: string;
  counts: { events_open: number; marks_draft: number; holdings: number };
  today: string;
}

export interface LpRow {
  id: string;
  name: string;
  status: 'signed' | 'soft';
  commitment: string;
  commitment_minor: number;
  called_minor: number;
  called_ppm: number | null;
  distributed_minor: number;
  unfunded_minor: number;
  nav_share_minor: number;
  fee_paying: boolean;
  side_letter: string[];
}

export interface Account {
  commitment_minor: number;
  contributed_minor: number;
  contributed_ppm: number | null;
  unfunded_minor: number;
  distributed_minor: number;
  recallable_minor: number;
  callable_minor?: number | undefined;
  warnings?: string[] | undefined;
}

export interface Purpose {
  type: 'investment' | 'fees' | 'expenses' | 'other' | 'recall' | 'subline' | 'distribution';
  amount_minor: number;
  holding?: string | undefined;
  holding_name?: string | undefined;
  label?: string | undefined;
  from_day?: string | undefined;
  to_day?: string | undefined;
  proceeds_minor?: number | undefined;
  recallable_minor?: number | undefined;
}

export interface PreviewLine {
  lp: string;
  lp_name: string;
  amounts: Record<string, number>;
  total_minor: number;
  fee_gross_minor?: number | undefined;
  fee_waiver_minor?: number | undefined;
  recallable_minor?: number | undefined;
  balances: Account;
}

export interface Waterfall {
  estimate: true;
  method: string;
  compounding: string;
  gross_minor: number;
  carry_minor: number;
  lp_minor: number;
  roc_minor: number;
  gain_minor: number;
}

export interface Preview {
  kind: 'call' | 'distribution';
  currency: string;
  lines: PreviewLine[];
  totals: Record<string, number>;
  fee?: { from_day: string; to_day: string; rate_ppm: number; basis: string } | null | undefined;
  waterfall?: Waterfall | null | undefined;
  warnings?: { lp: string; lp_name: string; warnings: string[] }[] | undefined;
  hidden?: number | undefined;
}

export interface EventLine {
  id: string;
  lp: string;
  lp_name: string;
  total_minor: number;
  amounts: Record<string, number>;
  paid_minor: number;
  left_minor: number;
  paid_ppm: number | null;
  sent: string;
  has_notice: boolean;
}

export interface CapitalEvent {
  id: string;
  number: string;
  kind: 'call' | 'distribution';
  status: 'draft' | 'previewed' | 'issued' | 'settled' | 'void';
  fund: string;
  fund_name: string;
  currency: string;
  notice_day: string;
  due_day: string;
  purposes: Purpose[];
  total_minor: number;
  carry_minor: number;
  note: string;
  note_by: '' | 'person' | 'agent';
  paid_minor: number;
  paid_ppm: number | null;
  lps: number;
  steps: Steps;
  /** The notice's ask of your AI agent (notice_review). */
  agent?: AgentAsks | undefined;
  preview?: Preview | undefined;
  lines?: EventLine[] | undefined;
  hidden?: number | undefined;
  queued?: number | undefined;
  no_email?: string[] | undefined;
}

export interface Holding {
  id: string;
  name: string;
  status: string;
  ownership_ppm: number;
  cost_minor: number;
  value_minor: number;
  method: string;
}

export interface Mark {
  id: string;
  holding: string;
  value_minor: number;
  prior_minor: number;
  change_minor: number;
  currency: string;
  method: string;
  rationale: string;
  inputs: { label: string; value: string; source: string }[];
  status: 'draft' | 'approved' | 'superseded';
  actor: string;
}

export interface MarksList {
  fund: { id: string; name: string; currency: string };
  quarter: Quarter | null;
  methods: string[];
  holdings: { holding: string; name: string; status: string; cost_minor: number; value_minor: number; method: string; mark_day: string; quarter_mark: Mark | null }[];
  totals: { value_minor: number; next_minor: number; change_minor: number; drafts: number };
  hidden: number;
}

export interface ReserveRow {
  holding: string;
  name: string;
  ownership_ppm: number;
  target_ppm: number | null;
  rounds: number;
  allocated_minor: number;
  deployed_minor: number;
  needed_minor: number | null;
  shortfall_minor: number | null;
  assumptions: { round: number; raise_minor: number; post_money_minor: number; pool_ppm: number; source: string }[];
}

export interface Reserves {
  fund: { id: string; name: string; currency: string };
  holdings: ReserveRow[];
  totals: { needed_minor: number; allocated_minor: number; budget_minor: number; available_minor: number; shortfall_minor: number; deployed_minor: number };
  hidden: number;
}

export interface Paragraph {
  id: string;
  text: string;
  by: 'agent' | 'person';
  state: 'proposed' | 'kept';
  cites?: string[] | undefined;
}

export interface QuarterDetail {
  quarter: Quarter;
  metrics: Metrics | null;
  marks: { draft: number; approved: number };
  letter: { id: string; status: string; paragraphs: Paragraph[]; ai_chars: number; typed_chars: number } | null;
  packs: { id: string; lp: string; lp_name: string; status: string; outbound: string }[];
}

export const METHOD_LABEL: Record<string, string> = {
  calibrated_round: 'Round',
  round_adjusted: 'Adjusted',
  multiples: 'Multiples',
  write_down: 'Write-down',
  write_off: 'Write-off',
  cost: 'Cost',
  exited: 'Exited',
  written_off: 'Written off',
};

export const TYPE_LABEL: Record<string, string> = {
  call_investment: 'Investment',
  call_fees: 'Fees',
  call_expenses: 'Expenses',
  call_other: 'Other',
  call_recall: 'Recall',
  call_subline: 'Line repayment',
  dist_capital: 'Capital back',
  dist_gain: 'Gain',
};
