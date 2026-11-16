/**
 * The news dashboard (fix 4, #/markets/news and the first tab of Markets):
 *
 *   category tabs, then one filter row (search, sector, company, period,
 *   All stories or Saved, Check now)
 *   left   the lead story with its picture, a row of 3 featured stories,
 *          then cards with thumbnails grouped by category (All) or the
 *          chosen category's stories with Load more
 *   right  one card: Your AI agent's take / Trending topics / Sources,
 *          divided by hairlines
 *
 * Every card opens its article in a new tab; insights link to their stories.
 */
import { Newspaper, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { can, useMe } from '../../lib/auth.ts';
import { addDays, today } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { Button, Empty, IconButton, LoadError, SearchInput, Segmented, Select, Skeleton, Tabs } from '../ui.tsx';
import type { TabItem } from '../ui.tsx';
import { DCard, DSection } from './Divided.tsx';
import { InsightList } from './Insights.tsx';
import type { NewsAnswer, NewsCategory, NewsExtra, NewsRow, NewsScope } from './news.ts';
import { NEWS_CATEGORIES, NEWS_READS, newsParams, refreshNews } from './news.ts';
import { StoryCard, StoryGrid } from './NewsCards.tsx';
import { agoWords } from './types.ts';

export interface NewsStats {
  total: number;
  categories: { key: NewsCategory; label: string; count: number }[];
  topics: { topic: string; count: number }[];
  week_total: number;
  sources: { source: string; count: number }[];
  feeds: { key: string; label: string; count: number }[];
  sectors: { key: string; label: string; count: number }[];
  companies: { id: string; name: string; count: number }[];
  checked_at: string;
}

type Period = '7' | '30' | '60';
type View = 'all' | 'saved';

/** Lead first (the first story with a picture among the top ones), then the next three, pictures first. */
export function pickLead(items: NewsRow[]): { lead: NewsRow | null; featured: NewsRow[]; rest: NewsRow[] } {
  if (items.length === 0) return { lead: null, featured: [], rest: [] };
  const top = items.slice(0, 24);
  const lead = top.find((n) => n.image_url !== null) ?? items[0] ?? null;
  const left = items.filter((n) => n !== lead);
  const pics = left.slice(0, 24).filter((n) => n.image_url !== null);
  const featured = (pics.length >= 3 ? pics.slice(0, 3) : [...pics, ...left.filter((n) => n.image_url === null)].slice(0, 3)).sort((a, b) => left.indexOf(a) - left.indexOf(b));
  const rest = left.filter((n) => !featured.includes(n));
  return { lead, featured, rest };
}

/** Where the stories come from, in words: "From Bing News search and your team". */
function feedLine(feeds: NewsStats['feeds']): string {
  const searches = feeds.filter((f) => f.key === 'bing' || f.key === 'google').map((f) => `${f.label} search`);
  const team = feeds.some((f) => f.key === 'person');
  const parts = [...searches, ...(team ? ['your team'] : [])];
  if (parts.length === 0) return '';
  return `From ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}`;
}

/** A bar list: label, a bar in proportion, the count with its noun. */
function BarList({ rows, noun }: { rows: { label: string; count: number }[]; noun: [string, string] }): React.JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="vo-wrap min-w-0 truncate text-[13px] text-[var(--vo-ink)]">{r.label}</span>
          <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{`${r.count} ${r.count === 1 ? noun[0] : noun[1]}`}</span>
          <span aria-hidden className="col-span-2 h-1 overflow-hidden rounded-[2px] bg-[var(--vo-sunk)]">
            <span className="block h-full rounded-[2px] bg-[var(--vo-a)]" style={{ width: `${Math.max(4, Math.round((r.count / max) * 100))}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One page of a filtered list; Load more chains the next page. */
function StoryPage({ params, cursor, skip, canHide, first, category }: { params: Record<string, unknown>; cursor: string; skip: Set<string>; canHide: boolean; first: boolean; category: boolean }): React.JSX.Element | null {
  const [more, setMore] = useState(false);
  const live = useOp<NewsAnswer>('news.list', cursor === '' ? params : { ...params, cursor }, NEWS_READS, { name: first ? 'markets.news.page' : undefined, keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const rows = live.data.items.filter((n) => !skip.has(n.id));
  const next = live.data.next_cursor;
  return (
    <>
      {rows.length > 0 && <StoryGrid items={rows} canHide={canHide} category={category} />}
      {next !== null &&
        (more ? (
          <StoryPage params={params} cursor={next} skip={skip} canHide={canHide} first={false} category={category} />
        ) : (
          <Button className="self-center" onClick={() => setMore(true)}>
            {`Load more (${live.data.total - Number(next)} left)`}
          </Button>
        ))}
    </>
  );
}

/** A category's newest stories under its title (the All view). */
function CategoryGroup({ base, cat, count, skip, canHide, onAll }: { base: Record<string, unknown>; cat: { key: NewsCategory; label: string }; count: number; skip: Set<string>; canHide: boolean; onAll: () => void }): React.JSX.Element | null {
  const live = useOp<NewsAnswer>('news.list', { ...base, category: cat.key, limit: 7 }, NEWS_READS, { name: `markets.news.group.${cat.key}`, keep: true });
  if (live.data === null) return live.error !== null ? null : <Skeleton className="h-40 w-full" />;
  const rows = live.data.items.filter((n) => !skip.has(n.id)).slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <section aria-label={cat.label} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-7 min-w-0 items-center gap-3 border-b border-[var(--vo-line)] pb-1.5">
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-[var(--vo-ink)]">{cat.label}</h3>
        <button type="button" onClick={onAll} className="vo-focus vo-tap cursor-pointer rounded-[var(--vo-radius-sm)] px-1.5 text-[12px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
          {count === 1 ? 'See the 1 story' : `See all ${count} stories`}
        </button>
      </div>
      <StoryGrid items={rows} canHide={canHide} category={false} />
    </section>
  );
}

export function NewsDashboard({ scope = 'home', refId = '', aside = true, insight = '' }: { scope?: NewsScope | undefined; refId?: string | undefined; aside?: boolean | undefined; insight?: string | undefined }): React.JSX.Element {
  const me = useMe();
  const canHide = can(me, 'markets', 'edit');
  const [cat, setCat] = useState<NewsCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('');
  const [company, setCompany] = useState('');
  const [period, setPeriod] = useState<Period>('60');
  const [view, setView] = useState<View>('all');
  const [busy, setBusy] = useState(false);
  const extra: NewsExtra = { q: q.trim(), sector, company, from: period === '60' ? '' : addDays(today(), -Number(period)), saved: view === 'saved' };
  const filtered = extra.q !== '' || sector !== '' || company !== '' || period !== '60' || view === 'saved';
  const statsParams = useMemo(() => {
    const p = newsParams(scope, refId, 1, extra);
    delete p['limit'];
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, refId, extra.q, sector, company, extra.from, view]);
  const stats = useOp<NewsStats>('news.stats', statsParams, NEWS_READS, { name: `markets.news.stats.${scope}`, keep: true });
  const listParams = newsParams(scope, refId, 21, { ...extra, category: cat });
  const top = useOp<NewsAnswer>('news.list', { ...listParams, limit: 24 }, NEWS_READS, { name: `markets.news.top.${scope}`, keep: true });
  const s = stats.data;

  const refresh = (): void => {
    setBusy(true);
    void refreshNews().finally(() => setBusy(false));
  };
  const checked = s !== null && s.checked_at !== '' ? `Checked ${agoWords(s.checked_at)}; it checks every 2 hours` : 'It checks every 2 hours';

  const tabs: TabItem<NewsCategory | 'all'>[] = [{ value: 'all', label: 'All' }, ...NEWS_CATEGORIES.map((c) => ({ value: c.key, label: c.label, count: s?.categories.find((x) => x.key === c.key)?.count }))];

  const filters = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <SearchInput value={q} onChange={setQ} placeholder="Search the news" className="w-full sm:w-[220px]" />
      <Select aria-label="Sector" value={sector} onChange={(e) => setSector(e.target.value)} className="w-[calc(50%-4px)] sm:w-[170px]">
        <option value="">All sectors</option>
        {(s?.sectors ?? []).map((x) => (
          <option key={x.key} value={x.key}>{`${x.label} (${x.count})`}</option>
        ))}
      </Select>
      <Select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className="w-[calc(50%-4px)] sm:w-[190px]">
        <option value="">All companies</option>
        {(s?.companies ?? []).map((x) => (
          <option key={x.id} value={x.id}>{`${x.name} (${x.count})`}</option>
        ))}
      </Select>
      <Segmented<Period>
        label="Period"
        size="sm"
        value={period}
        onChange={setPeriod}
        options={[
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
          { value: '60', label: '60 days', title: 'The news keeps 60 days' },
        ]}
      />
      <Segmented<View>
        label="Show"
        size="sm"
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: 'All stories' },
          { value: 'saved', label: 'Saved', title: 'The stories you saved' },
        ]}
      />
      <span className="ml-auto flex items-center gap-1.5">
        <span className="hidden text-[12px] text-[var(--vo-muted)] xl:inline">{s !== null && s.checked_at !== '' ? `Checked ${agoWords(s.checked_at)}` : ''}</span>
        <IconButton icon={RefreshCw} label={`Check the news now. ${checked}`} disabled={busy} onClick={refresh} />
      </span>
    </div>
  );

  let main: React.JSX.Element;
  if (top.data === null) main = top.error !== null ? <LoadError message={top.error} onRetry={top.reload} /> : <Skeleton className="h-[420px] w-full" />;
  else if (top.data.items.length === 0)
    main = (
      <div className="vo-panel">
        <Empty
          icon={Newspaper}
          title={view === 'saved' ? 'Stories you save appear here' : filtered || cat !== 'all' ? 'No stories match these filters' : 'News appears here after the first check'}
          action={
            view === 'saved' ? (
              <Button onClick={() => setView('all')}>All stories</Button>
            ) : filtered ? (
              <Button
                onClick={() => {
                  setQ('');
                  setSector('');
                  setCompany('');
                  setPeriod('60');
                }}
              >
                Clear the filters
              </Button>
            ) : (
              <Button icon={RefreshCw} busy={busy} onClick={refresh}>
                Check now
              </Button>
            )
          }
        />
      </div>
    );
  else {
    const { lead, featured, rest } = pickLead(top.data.items);
    const shown = new Set([lead, ...featured].filter((x): x is NewsRow => x !== null).map((n) => n.id));
    const grouped = cat === 'all' && !filtered;
    main = (
      <div className="flex min-w-0 flex-col gap-5">
        {lead !== null && <StoryCard n={lead} variant="lead" canHide={canHide} />}
        {featured.length > 0 && (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            {featured.map((n) => (
              <StoryCard key={n.id} n={n} variant="featured" canHide={canHide} />
            ))}
          </div>
        )}
        {grouped ? (
          NEWS_CATEGORIES.filter((c) => (s?.categories.find((x) => x.key === c.key)?.count ?? 0) > 0).map((c) => (
            <CategoryGroup key={c.key} base={newsParams(scope, refId, 7, extra)} cat={c} count={s?.categories.find((x) => x.key === c.key)?.count ?? 0} skip={shown} canHide={canHide} onAll={() => setCat(c.key)} />
          ))
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {rest.length > 0 && <StoryGrid items={rest} canHide={canHide} category={cat === 'all'} />}
            {top.data.next_cursor !== null && <StoryPage key={JSON.stringify(listParams)} params={listParams} cursor={top.data.next_cursor} skip={shown} canHide={canHide} first category={cat === 'all'} />}
          </div>
        )}
      </div>
    );
  }

  const side = aside && (
    <DCard label="Beside the news" className="lg:sticky lg:top-[72px]">
      <DSection title="Your AI agent's take" tip="Your AI agent reads the week's news every morning and says what it means for the firm, citing the stories">
        <InsightList limit={3} canAsk={me !== null} focus={insight} />
      </DSection>
      <DSection title="Trending topics" aside={s !== null ? <span>{s.week_total === 1 ? '1 story this week' : `${s.week_total} stories this week`}</span> : undefined} tip="Stories per topic published in the last 7 days">
        {s === null ? <Skeleton className="h-24 w-full" /> : s.topics.length === 0 ? <span className="text-[13px] text-[var(--vo-muted)]">Topics appear when this week has news</span> : <BarList rows={s.topics.map((t) => ({ label: t.topic, count: t.count }))} noun={['story', 'stories']} />}
      </DSection>
      <DSection title="Sources" tip="Where the stories come from: public news search (with pictures where the feed carries one) and articles your team added">
        {s === null ? (
          <Skeleton className="h-24 w-full" />
        ) : s.sources.length === 0 ? (
          <span className="text-[13px] text-[var(--vo-muted)]">Publishers appear after the first check</span>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[13px]">
              {s.sources.slice(0, 6).map((x) => (
                <li key={x.source} className="contents">
                  <span className="min-w-0 truncate text-[var(--vo-ink)]">{x.source}</span>
                  <span className="vo-mono vo-num text-right text-[12px] text-[var(--vo-muted)]">{x.count === 1 ? '1 story' : `${x.count} stories`}</span>
                </li>
              ))}
            </ul>
            {s.feeds.length > 0 && <span className="vo-wrap text-[12px] text-[var(--vo-muted)]">{feedLine(s.feeds)}</span>}
          </div>
        )}
      </DSection>
    </DCard>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Tabs<NewsCategory | 'all'> label="News categories" value={cat} onChange={setCat} tabs={tabs} className="vo-scroll min-w-0 overflow-x-auto" />
      {filters}
      <div className={cn('grid min-w-0 grid-cols-1 items-start gap-5', aside && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
        {main}
        {side}
      </div>
    </div>
  );
}
