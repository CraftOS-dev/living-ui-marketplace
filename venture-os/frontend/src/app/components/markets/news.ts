/**
 * News (fix 4): the shapes news.list and news.insights answer and the calls
 * around them, for Markets, Home and a company's page.
 *
 *   news.list --scope home | all | thesis | company | sector --ref <id or key>
 *             --category <key> --limit n --cursor <next_cursor>
 *   -> { items: NewsRow[], total, next_cursor, checked_at }
 *   news.insights --limit n --ref <company, thesis, fund, sector key or news id>
 *   -> { insights: Insight[], total }
 */
import { op } from '../../lib/api.ts';
import { act } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import type { AgentAsks } from '../../lib/types.ts';

export type NewsScope = 'home' | 'all' | 'thesis' | 'company' | 'sector';

export type NewsCategory = 'portfolio' | 'pipeline' | 'competitors' | 'funding' | 'exits' | 'macro' | 'policy' | 'sectors';

/** Every category in tab order, with the words a partner reads. */
export const NEWS_CATEGORIES: { key: NewsCategory; label: string; tip: string }[] = [
  { key: 'portfolio', label: 'Portfolio', tip: 'News about the companies you invested in' },
  { key: 'pipeline', label: 'Pipeline', tip: 'News about companies you are looking at' },
  { key: 'competitors', label: 'Competitors', tip: 'News about competitors of your portfolio' },
  { key: 'funding', label: 'Funding', tip: 'Rounds raised in your sectors, new funds and LP moves' },
  { key: 'exits', label: 'Exits and M&A', tip: 'IPOs, acquisitions and secondaries' },
  { key: 'macro', label: 'Markets and macro', tip: 'Interest rates, public tech markets, VC funding volume, valuations, the IPO window' },
  { key: 'policy', label: 'Policy', tip: 'Policy and regulation in your sectors' },
  { key: 'sectors', label: 'Sectors', tip: 'Technology and industry trends in your thesis sectors' },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(NEWS_CATEGORIES.map((c) => [c.key, c.label]));

export interface NewsAbout {
  kind: 'company' | 'sector' | 'thesis' | 'market';
  id: string;
  name: string;
}

export interface NewsRow {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
  /** Served by the app itself; null when the item has no picture. */
  image_url: string | null;
  category: NewsCategory;
  category_label: string;
  about: NewsAbout;
  summary: string;
  snippet: string;
  topic: string;
  sector: string;
  insight_ids: string[];
  saved: boolean;
  /** A funding round the item reports (structured: a person, the seed or your AI agent set it). */
  round?: { company: string; amount_usd: number | null; stage: string } | null;
}

export interface NewsAnswer {
  items: NewsRow[];
  total: number;
  next_cursor: string | null;
  checked_at: string;
}

export type Impact = 'positive' | 'negative' | 'watch';

export const IMPACT_LABEL: Record<Impact, string> = { positive: 'Positive', negative: 'Negative', watch: 'Watch' };

export interface InsightAffect {
  kind: 'company' | 'fund' | 'thesis' | 'sector';
  id: string;
  name: string;
}

export interface InsightNews {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
}

export interface Insight {
  id: string;
  title: string;
  analysis: string;
  impact: Impact;
  affects: InsightAffect[];
  news_ids: string[];
  news: InsightNews[];
  next_step: string;
  created_at: string;
}

export interface InsightsAnswer {
  insights: Insight[];
  total: number;
  /** The firm's ask of your AI agent for its take (news_insights). */
  agent?: AgentAsks | undefined;
}

/** The collections a news screen reloads on. */
export const NEWS_READS = ['news', 'news_insights', 'news_saves'];

export interface NewsExtra {
  category?: NewsCategory | 'all';
  cursor?: string;
  sector?: string;
  company?: string;
  from?: string;
  to?: string;
  q?: string;
  saved?: boolean;
}

/** The params of a news.list call (empty filters left out). */
export function newsParams(scope: NewsScope, ref = '', limit = 12, extra: NewsExtra = {}): Record<string, unknown> {
  const p: Record<string, unknown> = { scope, limit };
  if (scope !== 'home' && scope !== 'all') p['ref'] = ref;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === '' || v === false || v === 'all') continue;
    p[k] = v;
  }
  return p;
}

/** One news.list call (for screens that load outside useOp). */
export function listNews(scope: NewsScope, ref = '', limit = 12, extra: NewsExtra = {}): Promise<NewsAnswer> {
  return op<NewsAnswer>('news.list', newsParams(scope, ref, limit, extra));
}

/** One news.insights call. */
export function listInsights(limit = 6, ref = ''): Promise<InsightsAnswer> {
  return op<InsightsAnswer>('news.insights', ref === '' ? { limit } : { limit, ref });
}

/** Search the news now (it also runs every 2 hours); the lists show what came. */
export async function refreshNews(): Promise<void> {
  await act([], () => op<{ added: number }>('news.refresh', {}), NEWS_READS);
}

/** Hide an item from every news list, with Undo. */
export async function hideNews(id: string): Promise<void> {
  const out = await act([], () => op<{ _activity?: string }>('news.hide', { id }), NEWS_READS);
  const entry = out?._activity ?? '';
  if (out !== null && entry !== '') toast.undo('Hidden from the news', () => void act([], () => op('activity.undo', { entry }), NEWS_READS));
}

/** Save an item for later (or take it out of Saved). */
export async function saveNews(id: string, saved: boolean): Promise<void> {
  await act([], () => op('news.save', { id, saved }), NEWS_READS);
}

/** Take an insight away (people), with Undo. */
export async function dismissInsight(id: string): Promise<void> {
  const out = await act([], () => op<{ _activity?: string }>('news.insight-dismiss', { id }), NEWS_READS);
  const entry = out?._activity ?? '';
  if (out !== null && entry !== '') toast.undo('Insight dismissed', () => void act([], () => op('activity.undo', { entry }), NEWS_READS));
}

/** Ask your AI agent to read the news again and write its take now (trigger news_insights); again: the request a screen saw done or rejected. */
export function askInsights(again = ''): Promise<unknown> {
  return op('news.insights-ask', again !== '' ? { again } : {});
}
