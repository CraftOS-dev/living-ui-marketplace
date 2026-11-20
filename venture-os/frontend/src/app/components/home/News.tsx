/**
 * Home's News (Fix 4): a small news dashboard from the markets module's
 * `news.list` (scope home) and `news.insights` (components/markets/news.ts).
 *
 *   News (title row, "All news" opens the news dashboard)
 *   -------------------------------------------------------------------
 *   All | Portfolio | Pipeline | Sectors | ...  | Your AI agent's take
 *   the lead story: its picture when it has one | the latest 3 insights:
 *   (else a clean typographic card, never a     | impact, headline, two
 *   made-up picture), headline, summary         | lines of analysis, what
 *   6 compact cards: thumbnail, headline,       | it affects, the full
 *   topic, source and time                      | insight
 *
 * Each story opens the article in a new tab; each insight opens on the news
 * dashboard. Hidden for a role that cannot read Markets; the take column is
 * left out while news.insights is not in the build.
 */
import { useState } from 'react';
import { ArrowRight, Newspaper, Sparkle } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { isOp, runOp } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { ago } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { href, navigate } from '../../lib/router.ts';
import { askInsights, CATEGORY_LABEL, IMPACT_LABEL, NEWS_READS, newsParams } from '../markets/news.ts';
import type { Impact, Insight, InsightsAnswer, NewsAnswer, NewsCategory, NewsRow } from '../markets/news.ts';
import { Button, Empty, LoadError, Panel, Section, Sections, Skeleton, Tabs, Tag } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import { AskAgent } from '../agent.tsx';

const HIDE = new Set(['unknown_op', 'not_permitted']);
/** Home's tabs, in the order an investor reads them. */
const TABS: ('all' | NewsCategory)[] = ['all', 'portfolio', 'pipeline', 'sectors', 'macro', 'funding', 'exits', 'policy'];
const IMPACT_TONE: Record<Impact, Tone> = { positive: 'good', negative: 'bad', watch: 'warn' };
/** The lead and six cards, from the first 13 stories (the lead is the first with a picture, when one has). */
const SHOWN = 7;
const READ = 13;

/** What the card's chip says: the topic the search was about, else the category. */
function topicOf(n: NewsRow): string {
  return n.topic !== '' ? n.topic : n.category_label !== '' ? n.category_label : (CATEGORY_LABEL[n.category] ?? '');
}

function blurb(n: NewsRow): string {
  return n.summary !== '' ? n.summary : n.snippet;
}

/** A picture served by the app; when it does not load, the card goes typographic. */
function Pic({ src, className, onFail }: { src: string; className?: string | undefined; onFail: () => void }): React.JSX.Element {
  return <img src={src} alt="" loading="lazy" decoding="async" onError={onFail} className={cn('block bg-[var(--vo-sunk)] object-cover', className)} />;
}

function Meta({ n, chip = true }: { n: NewsRow; chip?: boolean | undefined }): React.JSX.Element {
  const topic = topicOf(n);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-[var(--vo-muted)]">
      {chip && topic !== '' && (
        <Tag tone="faint" className="max-w-[160px]" title={n.category_label}>
          <span className="truncate">{topic}</span>
        </Tag>
      )}
      {n.source !== '' && <span className="min-w-0 truncate">{n.source}</span>}
      <span className="shrink-0">{ago(n.published_at)}</span>
    </span>
  );
}

/** The lead story: picture beside the words, or a clean typographic card. */
function Lead({ n }: { n: NewsRow }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const pic = n.image_url !== null && n.image_url !== '' && !broken;
  const text = blurb(n);
  return (
    <a
      href={n.url}
      target="_blank"
      rel="noopener noreferrer"
      data-vo-lead={pic ? 'picture' : 'type'}
      className={cn(
        'vo-focus group grid min-w-0 overflow-hidden rounded-[var(--vo-radius)] border border-[var(--vo-line)] transition-colors duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]',
        pic ? 'bg-[var(--vo-raised)] md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]' : 'bg-[var(--vo-raised)]',
      )}
    >
      {pic && <Pic src={n.image_url ?? ''} onFail={() => setBroken(true)} className="aspect-[16/9] h-full w-full md:aspect-auto md:min-h-[200px]" />}
      <span className={cn('flex min-w-0 flex-col gap-2', pic ? 'p-4' : 'p-5')}>
        <span className="vo-label">{n.category_label !== '' ? n.category_label : (CATEGORY_LABEL[n.category] ?? 'News')}</span>
        <span className={cn('vo-wrap font-semibold text-[var(--vo-ink)] group-hover:underline', pic ? 'line-clamp-3 text-[15px] leading-[21px]' : 'line-clamp-2 text-[15px] leading-[22px]')}>{n.title}</span>
        {text !== '' && <span className={cn('vo-wrap text-[13px] leading-[19px] text-[var(--vo-ink-2)]', pic ? 'line-clamp-4' : 'line-clamp-2')}>{text}</span>}
        <span className="mt-auto pt-1">
          <Meta n={n} />
        </span>
      </span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A compact card: thumbnail (when the item has a picture), headline, topic, source and time. */
function Card({ n }: { n: NewsRow }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const pic = n.image_url !== null && n.image_url !== '' && !broken;
  return (
    <li className="min-w-0">
      <a
        href={n.url}
        target="_blank"
        rel="noopener noreferrer"
        title={blurb(n) !== '' ? blurb(n) : n.title}
        className="vo-focus group flex h-full min-w-0 items-start gap-3 rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)] p-3 transition-colors duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]"
      >
        {pic && <Pic src={n.image_url ?? ''} onFail={() => setBroken(true)} className="size-14 shrink-0 rounded-[4px]" />}
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="vo-wrap line-clamp-2 text-[13px] font-medium leading-[18px] text-[var(--vo-ink)] group-hover:underline">{n.title}</span>
          <Meta n={n} />
        </span>
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </li>
  );
}

/** One insight: impact, headline, two lines of analysis, what it affects, the full insight. */
function InsightRow({ x }: { x: Insight }): React.JSX.Element {
  const to = href('/markets/news', { insight: x.id });
  return (
    <article className="flex min-w-0 flex-col gap-1.5" data-vo-insight={x.impact}>
      <div className="flex min-w-0 items-center gap-2">
        <Tag tone={IMPACT_TONE[x.impact]}>{IMPACT_LABEL[x.impact]}</Tag>
        <span className="ml-auto shrink-0 text-[12px] text-[var(--vo-muted)]">{ago(x.created_at)}</span>
      </div>
      <a href={to} className="vo-focus vo-wrap line-clamp-2 rounded-[4px] text-[13px] font-semibold leading-[18px] text-[var(--vo-ink)] hover:underline">
        {x.title}
      </a>
      <p className="vo-wrap line-clamp-2 text-[12px] leading-[17px] text-[var(--vo-ink-2)]">{x.analysis}</p>
      {x.affects.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {x.affects.slice(0, 3).map((a) => (
            <Tag key={a.kind + a.id} tone="neutral" className="max-w-[150px]" title={a.kind === 'company' ? 'Company' : a.kind === 'thesis' ? 'Thesis' : a.kind === 'fund' ? 'Fund' : 'Sector'}>
              <span className="truncate">{a.name}</span>
            </Tag>
          ))}
          {x.affects.length > 3 && <span className="text-[12px] text-[var(--vo-muted)]">+{x.affects.length - 3}</span>}
        </div>
      )}
      <a href={to} className="vo-focus inline-flex w-fit items-center gap-1 rounded-[4px] text-[12px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:text-[var(--vo-ink)] hover:underline">
        Full insight
        <ArrowRight size={12} aria-hidden />
      </a>
    </article>
  );
}

function Take({ live, canAsk }: { live: { data: InsightsAnswer | null; error: string | null; reload: () => void }; canAsk: boolean }): React.JSX.Element {
  const list = live.data?.insights ?? [];
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-1.5">
          <Sparkle size={11} strokeWidth={2.2} aria-hidden className="text-[var(--vo-ink)]" />
          Your AI agent's take
        </span>
      }
      tip="What your AI agent makes of the latest news for your companies, funds and theses, with the stories it rests on."
    >
      {live.data === null && live.error !== null ? (
        <LoadError message={live.error} onRetry={live.reload} className="py-6" />
      ) : live.data === null ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Empty
          icon={Sparkle}
          title="Your AI agent's take shows here"
          className="px-2 py-8"
          action={
            canAsk ? <AskAgent label="Ask your AI agent" size="md" state={live.data?.agent?.news_insights} onAsk={askInsights} reads={['news_insights', 'agent_requests']} /> : undefined
          }
        />
      ) : (
        <Sections pad="flush">
          {list.slice(0, 3).map((x) => (
            <InsightRow key={x.id} x={x} />
          ))}
        </Sections>
      )}
    </Section>
  );
}

export function NewsBlock({ className }: { className?: string | undefined }): React.JSX.Element | null {
  const me = useMe();
  const can = allowed(me, 'markets:view');
  const [cat, setCat] = useState<'all' | NewsCategory>('all');
  const news = useLive<NewsAnswer>((signal) => runOp<NewsAnswer>('news.list', newsParams('home', '', READ, { category: cat }), { quiet: true, signal }), NEWS_READS, ['home', cat, READ], { name: 'news.home', skip: !can, keep: true });
  const take = useLive<InsightsAnswer>((signal) => runOp<InsightsAnswer>('news.insights', { limit: 3 }, { quiet: true, signal }), NEWS_READS, ['home', 3], { name: 'news.insights.home', skip: !can || !isOp('news.insights') });
  if (!can || (news.data === null && HIDE.has(news.code))) return null;
  const showTake = isOp('news.insights') && !(take.data === null && HIDE.has(take.code));
  const items = news.data?.items ?? [];
  const lead = items.find((n) => n.image_url !== null && n.image_url !== '') ?? items[0];
  const rest = items.filter((n) => n !== lead).slice(0, SHOWN - 1);
  return (
    <Panel
      label="News"
      tip="News for your firm: your portfolio and pipeline companies, your thesis sectors, funding, exits, markets and policy. Each story opens in a new tab."
      className={className}
      divided
      flush
      aside={
        <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => navigate('/markets/news')}>
          All news
        </Button>
      }
    >
      <div className={cn('grid min-w-0', showTake && 'lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]')}>
        <div className="flex min-w-0 flex-col gap-4 px-4 pb-4 pt-1">
          <Tabs
            label="News categories"
            value={cat}
            onChange={setCat}
            tabs={TABS.map((t) => ({ value: t, label: t === 'all' ? 'All' : (CATEGORY_LABEL[t] ?? t) }))}
          />
          {news.data === null && news.error !== null ? (
            <LoadError message={news.error} onRetry={news.reload} className="py-6" />
          ) : news.data === null ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-[200px] w-full" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-[74px] w-full" />
                ))}
              </div>
            </div>
          ) : lead === undefined ? (
            cat === 'all' ? (
              <Empty icon={Newspaper} title="News for your firm shows here" className="py-8" action={<Button onClick={() => navigate('/markets/news')}>Open Markets</Button>} />
            ) : (
              <Empty icon={Newspaper} title={`No ${(CATEGORY_LABEL[cat] ?? 'such').toLowerCase()} news yet`} className="py-8" action={<Button onClick={() => setCat('all')}>Show all news</Button>} />
            )
          ) : (
            <div className="flex min-w-0 flex-col gap-3" aria-busy={news.loading}>
              <Lead key={lead.id} n={lead} />
              {rest.length > 0 && (
                <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rest.map((n) => (
                    <Card key={n.id} n={n} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {showTake && (
          <aside className="min-w-0 border-t border-[var(--vo-line)] px-4 pb-4 pt-3 lg:border-l lg:border-t-0" aria-label="Your AI agent's take">
            <Take live={take} canAsk={isOp('news.insights-ask') && allowed(me, 'markets:view')} />
          </aside>
        )}
      </div>
    </Panel>
  );
}
