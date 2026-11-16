/**
 * Home (SPEC 3.1, Fix 3): the firm as a dashboard, in one read (home.summary).
 *
 *   1. The firm constellation, on the page itself, with the Firm NAV and its key.
 *   2. Today's meetings beside Waiting for you (Next, with Start).
 *   3. News (markets' news.list, the latest six).
 *   4. New deals by source beside this quarter's deals (the cohort flow).
 *   5. The portfolio by value beside fund performance.
 *   6. Runway, sectors and growth.
 *
 * The title greets the person by the time of day; nothing sits under it.
 * Start, in Waiting for you, is the page's one black button. Blocks sit
 * --vo-gap (12px) apart. A phone stacks the hero first, then Waiting for
 * you, Today and News, then the rest.
 */
import { useEffect, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { DealFlowBlock, GrowthBlock, NextBlock, PerformanceBlock, RunwayBlock, SectorBlock, TreemapBlock } from '../../components/home/Blocks.tsx';
import { TodayBlock } from '../../components/home/Day.tsx';
import { FlowBlock } from '../../components/home/Flow.tsx';
import { Hero } from '../../components/home/Hero.tsx';
import { NewsBlock } from '../../components/home/News.tsx';
import type { HomeSummary } from '../../components/home/types.ts';
import { LoadError, PageBody, PageHeader } from '../../components/ui.tsx';
import { useMe } from '../../lib/auth.ts';
import { today } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { useUi } from '../../lib/store.ts';

/** Morning, afternoon or evening by the device's clock; it changes while the page stays open. */
function usePartOfDay(): string {
  const at = (): string => {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  };
  const [part, setPart] = useState(at);
  useEffect(() => {
    const t = setInterval(() => setPart(at()), 60000);
    return () => clearInterval(t);
  }, []);
  return part;
}

export function HomePage(): React.JSX.Element {
  const me = useMe();
  const ui = useUi();
  const part = usePartOfDay();
  const live = useOp<HomeSummary>('home.summary', ui.fund !== '' ? { fund: ui.fund } : {}, ['*'], { name: 'home.summary', keep: true });
  const first = (me.member.name || '').trim().split(/\s+/)[0] ?? '';
  const data = live.data;
  const v = data?.visual ?? null;
  const loading = data === null;
  // A block the person's role may not see leaves its row to the others.
  const shown = {
    flow: loading || (v !== null && v.flow !== null),
    sources: loading || (v !== null && v.sources !== null),
    day: loading || (v !== null && v.day !== null),
    tree: loading || (v !== null && v.portfolio !== null),
    perf: loading || (v !== null && v.performance !== null),
    sectors: loading || (v !== null && (v.portfolio !== null || v.pipeline_sectors !== null)),
  };
  const row5 = (shown.tree ? 2 : 0) + (shown.sectors ? 1 : 0);
  const span5 = row5 >= 3 ? 'lg:col-span-4' : row5 === 2 ? 'lg:col-span-6' : 'lg:col-span-12';
  return (
    <>
      <PageHeader title={`Good ${part}${first !== '' ? ', ' + first : ''}`} />
      <PageBody>
        {live.error !== null && data === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-[var(--vo-gap)] lg:grid-cols-12">
            <Hero v={v} today={data?.today ?? today()} className="order-1 lg:col-span-12" />
            <TodayBlock day={v?.day ?? null} loading={loading} className="order-3 lg:order-2 lg:col-span-8" />
            <NextBlock next={v !== null ? v.next_items : data !== null ? data.next.items : null} total={data?.next.total ?? 0} className={cn('order-2 lg:order-3', shown.day ? 'lg:col-span-4' : 'lg:col-span-12')} />
            <NewsBlock className="order-4 lg:col-span-12" />
            <DealFlowBlock sources={v?.sources ?? null} loading={loading} className={cn('order-5', shown.flow ? 'lg:col-span-5' : 'lg:col-span-12')} />
            <FlowBlock flow={v?.flow ?? null} loading={loading} className={cn('order-6', shown.sources ? 'lg:col-span-7' : 'lg:col-span-12')} />
            <TreemapBlock p={v?.portfolio ?? null} loading={loading} className={cn('order-7', shown.perf ? 'lg:col-span-7' : 'lg:col-span-12')} />
            <PerformanceBlock perf={v?.performance ?? null} loading={loading} className={cn('order-8', shown.tree ? 'lg:col-span-5' : 'lg:col-span-12')} />
            <RunwayBlock p={v?.portfolio ?? null} loading={loading} className={cn('order-9', span5)} />
            <SectorBlock v={v} loading={loading} className={cn('order-10', span5)} />
            <GrowthBlock p={v?.portfolio ?? null} loading={loading} className={cn('order-11', span5)} />
          </div>
        )}
      </PageBody>
    </>
  );
}
