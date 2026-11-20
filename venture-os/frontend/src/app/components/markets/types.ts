/**
 * Markets shapes as the markets ops answer them (pb_hooks/lib_markets.js,
 * lib_markets_maps.js) and small shared helpers for the markets screens.
 */
import type { AgentTrack } from '../../lib/types.ts';
import { exponent, fmtDay, humanize } from '../../lib/format.ts';
import type { Tone } from '../ui.tsx';

export type SourceKey = 'edgar_form_d' | 'hacker_news' | 'github' | 'companies_house' | 'jp_corporate';
export type SignalSource = SourceKey | 'agent' | 'person';
export type Relation = 'portfolio' | 'pipeline' | 'passed' | 'tracked' | 'competitor';

export interface Criterion {
  key: string;
  op: string;
  label?: string | undefined;
  value?: unknown;
  values?: unknown[] | undefined;
  min?: number | undefined;
  max?: number | undefined;
  currency?: string | undefined;
  required?: boolean | undefined;
}

export interface Schedule {
  every: 'daily' | 'weekly';
  day?: string | undefined;
  time: string;
  label?: string | undefined;
}

export interface SourceCount {
  by: 'app' | 'agent';
  pulled?: number | undefined;
  new?: number | undefined;
  known?: number | undefined;
  out?: number | undefined;
  error?: string | undefined;
  left?: number | undefined;
}

export interface Radar {
  id: string;
  thesis: { id: string; name: string } | null;
  name: string;
  sources: SourceKey[];
  filters: Record<string, Record<string, unknown>>;
  query: string;
  schedule: Schedule;
  status: 'active' | 'paused';
  next_run_at: string;
  last_run_at: string;
  runs: number;
  last_counts: Record<string, SourceCount>;
  open: number;
  steps: { labels: string[]; at: number; state: 'idle' | 'screening' | 'ready' | 'failed'; request?: string | undefined; error?: string | undefined };
}

export interface ThesisTile {
  id: string;
  name: string;
  status: string;
  criteria: Criterion[];
  net_new: number;
  candidates: number;
  unscreened: number;
  added: number;
  weekly: number[];
  maps: number;
  radar: Radar | null;
}

export interface Signal {
  id: string;
  radar: string;
  thesis: string;
  run: number;
  source: SignalSource;
  source_label: string;
  kind: string;
  display: string;
  name: string;
  domain: string;
  website: string;
  company: { id: string; name: string; domain: string } | null;
  title: string;
  summary: string;
  source_url: string;
  payload: Record<string, unknown>;
  facts: Record<string, { value: unknown; grade?: string | undefined }>;
  fit: { state: 'met' | 'unmet' | 'unknown'; counts: { met: number; unmet: number; unknown: number }; checks?: { key: string; label: string; status: 'met' | 'unmet' | 'unknown'; required: boolean }[] | undefined } | null;
  context: Record<string, unknown>;
  licence: 'public' | 'internal_only';
  status: 'new' | 'candidate' | 'screened_out' | 'known' | 'dismissed' | 'added';
  actor: string;
  screened_at: string;
  created: string;
}

export interface Options {
  sources: { key: SourceKey; label: string; by: 'app' | 'agent'; kind: string }[];
  defaults: { sources: SourceKey[]; filters: Record<string, Record<string, unknown>>; schedule: Schedule };
  sectors: string[];
  stages: string[];
  countries: string[];
  days: string[];
  dismiss_reasons: string[];
  limits: { edgar_limit: number; hn_limit: number; github_limit: number };
  user_agent: string;
}

export interface MapEntry {
  id: string;
  company: { id: string; name: string; domain: string } | null;
  segment: string;
  relation: Relation;
  role: 'tracked' | 'competitor';
  deal: { number: string; stage: string; status: string } | null;
  note: string;
  source_url: string;
  licence: string;
  added_day: string;
  actor: string;
  position: number;
  moves: { day: string; at: string; from: string; to: string; by: string }[];
}

export interface MapProposal {
  id: string;
  label: string;
  company: { id: string; name: string; domain: string };
  segment: string;
  remove: boolean;
  role: string;
  why: string;
  source_url: string;
}

export interface MarketMap {
  id: string;
  name: string;
  thesis: { id: string; name: string } | null;
  segments: { key: string; label: string }[];
  status: string;
  as_of: string;
  entries: MapEntry[];
  counts: Record<Relation, number>;
  hidden: number;
  proposals: MapProposal[];
  history: { day: string; at: string; company: { id: string; name: string } | null; from: string; to: string; by: string }[];
  first_day: string;
  /** The map's refresh ask of your AI agent (map_refresh), as a StepTrack. */
  refresh: AgentTrack | null;
  last_refresh_at: string;
}

export interface MapSummary {
  id: string;
  name: string;
  thesis: { id: string; name: string } | null;
  segments: { key: string; label: string }[];
  entries: number;
  counts: Record<Relation, number>;
  pending: number;
}

/** Words a partner uses for the codes. */
const WORDS: Record<string, string> = {
  ai: 'AI',
  devtools: 'Dev tools',
  enterprise_saas: 'Enterprise SaaS',
  hr_tech: 'HR tech',
  legal_tech: 'Legal tech',
  insurtech: 'Insurtech',
  proptech: 'Proptech',
  edtech: 'Edtech',
  agtech: 'Agtech',
  fintech: 'Fintech',
  idea: 'Idea',
  pre_seed: 'Pre-seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b: 'Series B',
  series_c: 'Series C',
  growth: 'Growth',
  raise_filed: 'Raise filed',
  founder_move: 'Founder move',
};

export function word(code: string): string {
  return WORDS[code] ?? humanize(code);
}

/** The relation colours as tones (the kernel TileMap's palette). */
export const RELATION_TONE: Record<Relation, Tone> = { portfolio: 'a', pipeline: 'b', passed: 'faint', tracked: 'neutral', competitor: 'warn' };
export const RELATIONS: Relation[] = ['portfolio', 'pipeline', 'passed', 'tracked', 'competitor'];
/** What a tile's colour means, in words (the legend and the tile say the same). */
export const RELATION_WORD: Record<Relation, string> = { portfolio: 'In portfolio', pipeline: 'In pipeline', passed: 'Passed', tracked: 'Watching', competitor: 'Competitor' };
export const RELATION_HELP: Record<Relation, string> = {
  portfolio: 'The firm holds a stake (from the portfolio)',
  pipeline: 'An open deal in the pipeline',
  passed: 'The firm passed or lost the deal',
  tracked: 'On the map to keep an eye on',
  competitor: 'Competes with a portfolio or pipeline company',
};

/** Where the app looks for companies, as a person says it. */
export const SOURCE_WORD: Record<SourceKey, string> = { edgar_form_d: 'SEC filings', hacker_news: 'Show HN', github: 'GitHub', companies_house: 'Companies House', jp_corporate: 'the Japan registry' };

/** "a", "a and b", "a, b and c". */
export function andList(words: string[], last = 'and'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${last} ${words[words.length - 1] ?? ''}`;
}

/** "Checked 2 h ago from SEC filings, Show HN and GitHub" (the radar's sources in words). */
export function sourcesPhrase(sources: SourceKey[]): string {
  return andList(sources.map((s) => SOURCE_WORD[s] ?? word(s)));
}

const STAGE_ORDER = ['idea', 'pre_seed', 'seed', 'seed_extension', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'growth', 'bridge', 'other'];
const COUNTRY: Record<string, string> = { US: 'US', GB: 'UK', AE: 'UAE', KR: 'South Korea' };
const EUROPE = ['GB', 'IE', 'DE', 'FR', 'NL', 'SE', 'ES', 'CH', 'IT', 'PT', 'DK', 'NO', 'FI', 'PL', 'AT', 'BE'];

function countryName(code: string): string {
  const c = code.toUpperCase();
  if (COUNTRY[c] !== undefined) return COUNTRY[c];
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c;
  } catch {
    return c;
  }
}

/** Stages as a range when they follow each other ("Seed to Series A"), else listed. */
function stagesWords(values: string[]): string {
  const known = values.filter((v) => STAGE_ORDER.includes(v)).sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
  const idx = known.map((v) => STAGE_ORDER.indexOf(v));
  const run = known.length >= 3 && idx.every((n, i) => i === 0 || n === (idx[i - 1] ?? 0) + 1);
  if (known.length === 2 || run) return `${word(known[0] ?? '')} to ${word(known[known.length - 1] ?? '')}`;
  return andList(values.map((v) => word(v)), 'or');
}

/** Countries in words; three or more European ones read "Europe". */
function placesWords(values: string[]): string {
  const codes = values.map((v) => v.toUpperCase());
  const eu = codes.filter((c) => EUROPE.includes(c));
  const rest = codes.filter((c) => !EUROPE.includes(c)).map(countryName);
  const words = eu.length >= 3 ? [...rest, 'Europe'] : [...rest, ...eu.map(countryName)];
  return andList(words);
}

function moneyWords(minor: number, currency: string): string {
  const major = minor / 10 ** exponent(currency);
  return major >= 1_000_000 ? `${currency} ${Number((major / 1_000_000).toFixed(1))}M` : `${currency} ${Math.round(major / 1000)}K`;
}

/**
 * A thesis's criteria as plain chips: each sector ("Fintech"), the stages
 * as a range ("Seed to Series A"), the places ("US and Europe"), the
 * business model ("SaaS or transactional"), the round size.
 */
export function criteriaChips(criteria: Criterion[], currency = 'USD'): string[] {
  const out: string[] = [];
  for (const c of criteria) {
    const values = (c.values ?? (c.value !== undefined ? [c.value] : [])).map((v) => String(v));
    if (c.key === 'sector') out.push(...values.map((v) => word(v.toLowerCase())));
    else if (c.key === 'stage' || c.key === 'round_type') {
      if (values.length > 0) out.push(stagesWords(values));
    } else if (c.key === 'hq_country') {
      if (values.length > 0) out.push(placesWords(values));
    } else if (c.key === 'business_model') {
      if (values.length > 0) out.push(andList(values.map((v, i) => (v === 'saas' ? 'SaaS' : i === 0 ? word(v) : word(v).toLowerCase())), 'or'));
    } else if (c.key === 'raise_minor') {
      const cur = c.currency ?? currency;
      const min = c.min ?? (c.op === 'gte' && typeof c.value === 'number' ? c.value : undefined);
      const max = c.max ?? (c.op === 'lte' && typeof c.value === 'number' ? c.value : undefined);
      if (min !== undefined && max !== undefined) out.push(`Raising ${moneyWords(min, cur)} to ${moneyWords(max, cur).replace(`${cur} `, '')}`);
      else if (min !== undefined) out.push(`Raising ${moneyWords(min, cur)} or more`);
      else if (max !== undefined) out.push(`Raising up to ${moneyWords(max, cur)}`);
    } else if (values.length > 0) out.push(`${c.label ?? word(c.key)}: ${andList(values.map((v) => word(v)), 'or')}`);
  }
  return out;
}

/** A source as a short chip word. */
export function sourceWord(s: SignalSource, label?: string): string {
  return label ?? (s === 'agent' ? 'Your AI agent' : s === 'person' ? 'By hand' : word(s));
}

/** The radar's place as a picture: Pull, Screen, Ready. */
export function radarSteps(r: Radar | null, pulling: boolean): { labels: string[]; at: number } | null {
  if (pulling) return { labels: ['Pull', 'Screen', 'Ready'], at: 0 };
  if (r === null || r.steps.state !== 'screening') return null;
  return { labels: r.steps.labels, at: r.steps.at };
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago", then the day. */
export function agoWords(ts: string): string {
  const t = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T'));
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  const say = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return say(Math.round(s / 60), 'minute');
  if (s < 86400) return say(Math.round(s / 3600), 'hour');
  if (s < 86400 * 14) return say(Math.round(s / 86400), 'day');
  return `on ${fmtDay(ts, { year: 'auto' })}`;
}
