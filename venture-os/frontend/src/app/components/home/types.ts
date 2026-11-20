/** home.summary as the screens read it (pb/pb_hooks/lib_home.js, lib_home_visual.js). */
import type { NextItem, NextKind } from '../../lib/types.ts';

/** One bar of deals' cohort funnel: Inbound (the quarter's intake items), then how many of them reached each stage. */
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Deals in the stage now (null for Inbound). */
  now: number | null;
  /** This bar over the bar before it (null for the first bar, or when the bar before is 0). */
  conversion_ppm: number | null;
}

export type Health = 'good' | 'warn' | 'bad' | 'unknown';

export interface CompanyRef {
  id: string;
  name: string;
}

export interface Ring {
  id: string;
  label: string;
  vintage: number;
  scoped: boolean;
  /** The fund's size in the firm's currency (size, else target, else signed commitments); null when unknown. */
  size_minor: number | null;
  /** First close, else 1 January of the vintage ('' when unknown). */
  start_day: string;
  /** The fund's numbers today in the firm's currency (null when unknown or not visible). */
  nav_minor?: number | null;
  tvpi_e8?: number | null;
  dpi_e8?: number | null;
  net_irr_ppm?: number | null;
  committed_minor?: number | null;
  called_minor?: number | null;
  unfunded_minor?: number | null;
}

export interface ConstellationNode {
  holding: string;
  company: CompanyRef;
  fund: string;
  /** In the firm's currency (the holding's own when no rate). */
  value_minor: number;
  value_basis: string;
  moic_e8: number | null;
  runway_months: number | null;
  health: Health;
  /** The day the holding was first invested ('' when unknown). */
  first_day: string;
  /** Runway under the threshold or valued below cost. */
  attention: boolean;
  reasons: ('runway' | 'marked_down')[];
}

export interface Constellation {
  rings: Ring[];
  nodes: ConstellationNode[];
  stages: { key: string; label: string }[];
  deals: { id: string; number: string; name: string; stage: string; stage_index: number }[];
  passed: { name: string; day: string }[];
  threshold_months: number;
}

export interface FlowExit {
  col: number;
  passed: number;
  invested: number;
  held: number;
  open: number;
}

export interface FlowAnswer {
  quarter: { key: string; start_day: string; end_day: string };
  /** Inbound, then each stage: how many of the cohort reached it (deals' cohort funnel). */
  columns: FunnelStage[];
  /** Where each member stopped, by column. */
  exits: FlowExit[];
  counts: number[];
  cohort: number;
}

export type SourceKey = 'email' | 'upload' | 'scout' | 'sourced' | 'introduced';

export interface SourcesAnswer {
  keys: SourceKey[];
  months: ({ month: string } & Record<SourceKey, number>)[];
  total: number;
}

export interface DayMeeting {
  id: string;
  title: string;
  company: CompanyRef | null;
  deal: { number: string; stage_label: string } | null;
  start_at: string;
  end_at: string;
  /** Minutes from midnight in the firm's zone. */
  start_min: number;
  end_min: number;
  attendees: string[];
  more: number;
  brief: string | null;
}

export interface KpiPoint {
  period_end: string;
  value: number | null;
  status: string;
}

export interface PortfolioVisual {
  currency: string;
  treemap: { company: CompanyRef; value_minor: number; cost_minor: number | null; moic_e8: number | null; holdings: number }[];
  runway: { rows: { company: CompanyRef; months: number | null; state: string; as_of_day: string; health: Health }[]; threshold_months: number };
  growth: { company: CompanyRef; key: string; label: string; currency: string; points: KpiPoint[]; growth_ppm: number | null; months: number }[];
  invested: { sector: string; value_minor: number; companies: number }[];
  companies: number;
  hidden: number;
}

export interface Performance {
  fund: { id: string; name: string; label: string; currency: string };
  quarters: { quarter: string; end: string; calls_minor: number; dist_minor: number; nav_minor: number | null; tvpi_e8: number | null; dpi_e8: number | null; rvpi_e8: number | null; gross_moic_e8: number | null }[];
  net: { tvpi_e8: number | null; dpi_e8: number | null; rvpi_e8: number | null; irr_ppm: number | null };
  gross: { moic_e8: number | null; irr_ppm: number | null };
  paid_in_minor: number;
}

export interface Visual {
  currency: string;
  readouts: {
    /** The firm's NAV in its currency (every fund the person may see). */
    nav_minor: number | null;
    nav_reason: string | null;
    /** The scoped fund's own NAV in the firm's currency (null without a fund scope). */
    fund_nav_minor: number | null;
    tvpi_e8: number | null;
    tvpi_reason: string | null;
    dpi_e8: number | null;
    /** Net IRR (lib_eng_metrics.netIrr): the scoped fund's, else over every fund's LP flows with the firm's NAV. */
    net_irr_ppm: number | null;
    tvpi_fund: { id: string; label: string } | null;
    /** Signed commitments and the part called, in the firm's currency (the scoped fund, else every fund). */
    committed_minor: number | null;
    called_minor: number | null;
    /** Called over committed, in millionths (null without commitments). */
    called_ppm: number | null;
    /** Uncalled commitments (lib_funds.overviewOf unfunded), in the firm's currency. */
    dry_powder_minor: number | null;
    funds: number;
    /** Portfolio companies in the scope (null when the person may not see the portfolio). */
    companies: number | null;
    open_deals: number | null;
    next_total: number;
  };
  constellation: Constellation | null;
  flow: FlowAnswer | null;
  sources: SourcesAnswer | null;
  day: { day: string; zone: string; meetings: DayMeeting[] } | null;
  portfolio: PortfolioVisual | null;
  pipeline_sectors: { sector: string; deals: number }[] | null;
  performance: Performance | null;
  next_items: NextItem[];
  hidden: string[];
  timing: Record<string, number>;
}

export interface HomeSummary {
  today: string;
  first_name: string;
  next: { items: NextItem[]; total: number; counts: Partial<Record<NextKind, number>> };
  meetings: { time: string; title: string; company: string; deal: string; attendees: string[]; brief: string; cal_event: string }[];
  /** Weeks oldest first; `quarter` = the week's items received this quarter (they add up to the funnel's Inbound). */
  inbound: { weeks: { start_day: string; count: number; quarter: number }[]; total: number; this_week: number; last_week: number; quarter: { key: string; start_day: string; count: number } } | null;
  funnel: { quarter: { key: string; start_day: string; end_day: string }; stages: FunnelStage[]; cohort: number; open: number; hidden: number } | null;
  fund: {
    id: string;
    name: string;
    label: string;
    currency: string;
    as_of_day: string;
    tvpi_e8: number | null;
    dpi_e8: number | null;
    rvpi_e8: number | null;
    net_irr_ppm: number | null;
    paid_in_minor: number;
    reasons: { tvpi: string | null; dpi: string | null; net_irr: string | null };
    curve: { quarter: string; end: string; net_minor: number; nav_minor: number | null; value_minor: number | null }[];
  } | null;
  runways: { rows: { company: { id: string; name: string }; months: number; as_of_day: string; zero_day: string | null }[]; companies: number; unknown: number; threshold_months: number; hidden: number } | null;
  /** The dashboard's figures (null in app.today's reading). */
  visual: Visual | null;
  hidden: string[];
  errors: { block: string; error: string }[];
  ms: number;
  timing: Record<string, number>;
}

export interface DigestOut {
  on: boolean;
  time: string;
  zone: string;
  day: string;
  can_send: boolean;
  bridge: boolean;
  subject: string;
  lines: { kind: string; text: string; href: string; link: string }[];
  body: string;
  next_total: number;
}
