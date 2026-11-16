/**
 * One thesis sector's research page (fix 4, #/markets/sectors/:key):
 *
 *   left   Funding activity: Rounds per month / Dollars raised per month /
 *          Recent rounds; Market map (read only, opens the thesis map);
 *          News in this sector
 *   right  Your AI agent's take / Key companies / Competitors of your
 *          portfolio, one card divided by hairlines
 *
 * Funding comes from SEC Form D filings the thesis radar pulled and Funding
 * news that reports a round (never read from headlines).
 */
import { ExternalLink, Map as MapIcon } from 'lucide-react';
import { fmtDay, fmtMonth } from '../../lib/format.ts';
import { can, useMe } from '../../lib/auth.ts';
import { useOp } from '../../lib/live.ts';
import { BarChart, TileMap } from '../charts.tsx';
import type { MapTile } from '../charts.tsx';
import { Empty, LoadError, Skeleton, Tag } from '../ui.tsx';
import { DCard, DSection } from './Divided.tsx';
import { InsightList } from './Insights.tsx';
import type { NewsAnswer } from './news.ts';
import { NEWS_READS } from './news.ts';
import { StoryCard } from './NewsCards.tsx';
import { usd } from './MarketPulse.tsx';
import type { Impact } from './news.ts';
import type { MarketMap, Relation } from './types.ts';
import { RELATION_WORD } from './types.ts';

export interface SectorAnswer {
  key: string;
  label: string;
  thesis: { id: string; name: string };
  months: { month: string; rounds: number; usd: number; with_amount: number }[];
  totals: { rounds: number; usd: number };
  rounds: { id: string; kind: 'news' | 'filing'; company: { id: string; name: string }; amount_usd: number | null; stage: string; at: string; source: string; url: string; title: string }[];
  rounds_total: number;
  maps: { id: string; name: string; thesis: string }[];
  companies: { id: string; name: string; relation: 'portfolio' | 'pipeline' | 'tracked'; detail: string }[];
  competitors: { id: string; name: string; website: string; segment: string; map: string }[];
  latest_insight: { id: string; title: string; impact: Impact; created_at: string } | null;
}

const READS = ['news', 'news_insights', 'signals', 'maps', 'map_entries', 'holdings', 'deals', 'companies'];
const REL_ORDER: ('portfolio' | 'pipeline' | 'tracked')[] = ['portfolio', 'pipeline', 'tracked'];

function SectorMap({ id }: { id: string }): React.JSX.Element {
  const live = useOp<{ map: MarketMap }>('maps.get', { map: id }, ['maps', 'map_entries'], { name: `markets.sector.map.${id}`, keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const m = live.data.map;
  const segments = m.segments.map((s) => ({
    key: s.key,
    label: s.label,
    tiles: m.entries
      .filter((e) => e.segment === s.key && e.company !== null)
      .map((e): MapTile => ({ id: e.id, label: e.company?.name ?? '', relation: e.relation as Relation, href: e.company !== null ? `#/companies/${e.company.id}` : undefined })),
  }));
  return <TileMap segments={segments} />;
}

function SectorNews({ sectorKey }: { sectorKey: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<NewsAnswer>('news.list', { scope: 'sector', ref: sectorKey, limit: 6 }, NEWS_READS, { name: `markets.sector.news.${sectorKey}`, keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  if (live.data.items.length === 0) return <span className="text-[13px] text-[var(--vo-muted)]">News about this sector appears after the next check</span>;
  return (
    <ul className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
      {live.data.items.map((n) => (
        <li key={n.id}>
          <StoryCard n={n} variant="row" canHide={can(me, 'markets', 'edit')} />
        </li>
      ))}
    </ul>
  );
}

export function SectorView({ sectorKey }: { sectorKey: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<SectorAnswer>('markets.sector', { sector: sectorKey }, READS, { name: `markets.sector.${sectorKey}`, keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-[480px] w-full" />;
  const d = live.data;
  const labels = d.months.map((m) => fmtMonth(m.month));
  const rel = (r: 'portfolio' | 'pipeline' | 'tracked'): string => (r === 'tracked' ? 'Watching' : RELATION_WORD[r]);
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <DCard label="Funding activity">
          <DSection title="Funding activity, last 6 months" aside={<span>{[d.totals.rounds === 1 ? '1 round' : `${d.totals.rounds} rounds`, usd(d.totals.usd)].filter((x) => x !== '').join(', ')}</span>} tip="Rounds from SEC Form D filings your thesis radar found and from Funding news that reports a round (set by your team or your AI agent)" />
          <div className="grid min-w-0 grid-cols-1 divide-y divide-[var(--vo-line)] md:grid-cols-2 md:divide-x md:divide-y-0">
            <DSection title="Rounds per month">
              <BarChart labels={labels} series={[{ key: 'rounds', label: 'Rounds', values: d.months.map((m) => m.rounds), tone: 'b' }]} height={150} format={(v) => `${Math.round(v)} ${Math.round(v) === 1 ? 'round' : 'rounds'}`} yFormat={(v) => String(Math.round(v))} label="Funding rounds per month" />
            </DSection>
            <DSection title="Dollars raised per month">
              <BarChart labels={labels} series={[{ key: 'usd', label: 'Raised', values: d.months.map((m) => m.usd), tone: 'a' }]} height={150} format={(v) => usd(v) || 'USD 0'} yFormat={(v) => usd(v) || '0'} label="Dollars raised per month" />
            </DSection>
          </div>
          <DSection title="Recent rounds" aside={d.rounds_total > d.rounds.length ? <span>{`Newest ${d.rounds.length} of ${d.rounds_total}`}</span> : undefined}>
            {d.rounds.length === 0 ? (
              <span className="text-[13px] text-[var(--vo-muted)]">Rounds appear when your radar finds filings or the news reports a round</span>
            ) : (
              <ul className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
                {d.rounds.map((r) => (
                  <li key={r.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,1.4fr)_90px_110px_90px_minmax(0,1fr)]">
                    <span className="min-w-0 truncate text-[13px] font-medium text-[var(--vo-ink)]">{r.company.name}</span>
                    <span className="text-right text-[12px] text-[var(--vo-ink-2)] sm:text-left">{r.stage !== '' ? r.stage : r.kind === 'filing' ? 'Form D' : ''}</span>
                    <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{r.amount_usd !== null ? usd(r.amount_usd) : ''}</span>
                    <span className="text-right text-[12px] text-[var(--vo-muted)] sm:text-left">{fmtDay(r.at, { year: 'auto' })}</span>
                    <a href={r.url} target="_blank" rel="noreferrer" title={r.title !== '' ? r.title : 'Open the source'} className="vo-focus col-span-2 inline-flex min-w-0 items-center gap-1 rounded-[3px] text-[12px] text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)] hover:underline hover:underline-offset-[3px] sm:col-span-1">
                      <ExternalLink size={12} aria-hidden className="shrink-0" />
                      <span className="truncate">{r.source}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </DSection>
        </DCard>
        <DCard label="Market map">
          <DSection
            title={d.maps.length > 0 ? `Market map: ${d.maps[0]?.name ?? ''}` : 'Market map'}
            aside={
              d.maps.length > 0 ? (
                <a href={`#/markets/${d.thesis.id}/map`} className="vo-focus vo-tap rounded-[var(--vo-radius-sm)] px-1.5 text-[12px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
                  Open the market map
                </a>
              ) : undefined
            }
          >
            {d.maps[0] !== undefined ? <SectorMap id={d.maps[0].id} /> : <Empty icon={MapIcon} title="No market map for this thesis yet" />}
          </DSection>
        </DCard>
        <DCard label="News">
          <DSection title={`News about ${d.label}`} aside={<a href="#/markets/news" className="vo-focus vo-tap rounded-[var(--vo-radius-sm)] px-1.5 text-[12px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">All news</a>}>
            <SectorNews sectorKey={d.key} />
          </DSection>
        </DCard>
      </div>
      <DCard label="About this sector" className="lg:sticky lg:top-[72px]">
        <DSection title="Your AI agent's take">
          <InsightList refKey={d.key} limit={3} canAsk={me !== null} empty={`Your AI agent's take on ${d.label} appears here`} />
        </DSection>
        <DSection title="Key companies" aside={<span>{d.companies.length === 1 ? '1 company' : `${d.companies.length} companies`}</span>}>
          {d.companies.length === 0 ? (
            <span className="text-[13px] text-[var(--vo-muted)]">Companies you invest in, look at or watch in this sector appear here</span>
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              {REL_ORDER.filter((r) => d.companies.some((c) => c.relation === r)).map((r) => (
                <div key={r} className="flex min-w-0 flex-col gap-1">
                  <span className="text-[12px] text-[var(--vo-muted)]">{rel(r)}</span>
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {d.companies
                      .filter((c) => c.relation === r)
                      .map((c) => (
                        <a key={c.id} href={`#/companies/${c.id}`} title={`Open ${c.name}`} className="vo-focus group/chip inline-flex min-w-0 rounded-[4px]">
                          <Tag tone={r === 'portfolio' ? 'a' : r === 'pipeline' ? 'b' : 'neutral'} className="max-w-[200px] transition-[filter] duration-150 group-hover/chip:brightness-95 dark:group-hover/chip:brightness-125">
                            <span className="truncate">{c.name}</span>
                          </Tag>
                        </a>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DSection>
        <DSection title="Competitors of your portfolio" aside={<span>{d.competitors.length === 1 ? '1 company' : `${d.competitors.length} companies`}</span>} tip="Companies marked Competitor on this thesis's market map">
          {d.competitors.length === 0 ? (
            <span className="text-[13px] text-[var(--vo-muted)]">Mark competitors on the market map to see them here</span>
          ) : (
            <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[13px]">
              {d.competitors.map((c) => (
                <li key={c.id} className="contents">
                  <a href={`#/companies/${c.id}`} className="vo-focus min-w-0 truncate rounded-[3px] text-[var(--vo-ink)] hover:underline hover:underline-offset-[3px]">
                    {c.name}
                  </a>
                  <span className="truncate text-right text-[12px] text-[var(--vo-muted)]">{c.segment}</span>
                </li>
              ))}
            </ul>
          )}
        </DSection>
      </DCard>
    </div>
  );
}

