/**
 * Market pulse (fix 4, the Overview tab): one card per thesis sector. Each
 * card: the sector and its thesis / News (8-week sparkline and the count) /
 * Funding rounds found (8-week sparkline, the count and dollars) / New
 * companies found / Latest take. The card opens the sector's page.
 */
import { ChevronRight, LineChart as LineIcon } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { compact } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { Sparkline } from '../charts.tsx';
import { Empty, LoadError, Skeleton } from '../ui.tsx';
import { ImpactChip } from './Insights.tsx';
import type { Impact } from './news.ts';

export interface PulseSector {
  key: string;
  label: string;
  thesis: { id: string; name: string };
  news_weeks: number[];
  rounds_weeks: number[];
  news_total: number;
  rounds_total: number;
  usd_total: number;
  new_companies: number;
  latest_insight: { id: string; title: string; impact: Impact; created_at: string } | null;
}

export interface Pulse {
  sectors: PulseSector[];
  weeks: string[];
}

export const PULSE_READS = ['news', 'news_insights', 'signals', 'theses'];

export function usd(n: number): string {
  return n > 0 ? `USD ${compact(n)}` : '';
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A labelled row: the words on the left, the sparkline on the right, aligned with its siblings. */
function TrendRow({ title, line, values, tone }: { title: string; line: string; values: number[]; tone: 'a' | 'b' }): React.JSX.Element {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_96px] items-center gap-3 px-4 py-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12px] text-[var(--vo-muted)]">{title}</span>
        <span className="vo-wrap text-[13px] font-medium text-[var(--vo-ink)]">{line}</span>
      </span>
      <Sparkline values={values} tone={tone} width={96} height={28} area label={`${title} per week, last 8 weeks`} format={(v) => String(Math.round(v))} />
    </div>
  );
}

export function PulseCard({ s }: { s: PulseSector }): React.JSX.Element {
  const go = (): void => navigate(`/markets/sectors/${s.key}`);
  return (
    <button type="button" onClick={go} className="vo-in vo-panel vo-focus group flex min-w-0 cursor-pointer flex-col divide-y divide-[var(--vo-line)] overflow-hidden text-left transition-colors duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)]">
      <span className="flex min-w-0 items-center gap-2 px-4 py-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-semibold leading-5 text-[var(--vo-ink)]">{s.label}</span>
          <span className="truncate text-[12px] text-[var(--vo-muted)]">{s.thesis.name}</span>
        </span>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--vo-muted)] transition-colors duration-150 group-hover:text-[var(--vo-ink)]" />
      </span>
      <TrendRow title="News, last 8 weeks" line={plural(s.news_total, 'story', 'stories')} values={s.news_weeks} tone="a" />
      <TrendRow title="Funding rounds found" line={[plural(s.rounds_total, 'round', 'rounds'), usd(s.usd_total)].filter((x) => x !== '').join(', ')} values={s.rounds_weeks} tone="b" />
      <span className="flex min-w-0 items-baseline justify-between gap-3 px-4 py-3">
        <span className="text-[12px] text-[var(--vo-muted)]">New companies found</span>
        <span className="text-[13px] font-medium text-[var(--vo-ink)]">{plural(s.new_companies, 'company', 'companies')}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-[12px] text-[var(--vo-muted)]">Latest take</span>
        {s.latest_insight !== null ? (
          <span className="flex min-w-0 items-start gap-2">
            <ImpactChip impact={s.latest_insight.impact} />
            <span className="vo-wrap line-clamp-2 min-w-0 text-[13px] leading-[18px] text-[var(--vo-ink)]">{s.latest_insight.title}</span>
          </span>
        ) : (
          <span className="text-[13px] text-[var(--vo-muted)]">No take on this sector yet</span>
        )}
      </span>
    </button>
  );
}

export function PulseGrid({ className }: { className?: string | undefined }): React.JSX.Element {
  const live = useOp<Pulse>('markets.pulse', {}, PULSE_READS, { name: 'markets.pulse', keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-72 w-full" />;
  if (live.data.sectors.length === 0)
    return (
      <div className="vo-panel">
        <Empty icon={LineIcon} title="Add a thesis with sectors to see their pulse" />
      </div>
    );
  return (
    <div className={cn('grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {live.data.sectors.map((s) => (
        <PulseCard key={s.key} s={s} />
      ))}
    </div>
  );
}
