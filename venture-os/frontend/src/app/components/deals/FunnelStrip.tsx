/**
 * The Deals page's landing visual: this quarter's cohort funnel from
 * deals.funnel. The first bar is Inbound ("30 inbound": the intake items
 * received in the quarter), then one bar per stage with how many of THAT
 * cohort reached it ("11 deals"), so the bars only shrink. Under each stage
 * name, the share of the bar before that moved on ("37% moved on").
 */
import { useEffect, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { Skeleton } from '../ui.tsx';
import { TONE } from '../charts.tsx';
import { pct } from '../../lib/format.ts';
import type { FunnelAnswer, FunnelStage } from './types.ts';

function useDrawn(): boolean {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return drawn;
}

/** The words of one bar for its tooltip and the strip's accessible name. */
function barText(s: FunnelStage, prev: FunnelStage | undefined, quarter: string): string {
  if (s.key === 'inbound') return `Inbound: ${s.count} received in ${quarter}`;
  return `${s.label}: ${s.count} of the ${quarter} deals reached it` + (prev !== undefined && s.conversion_ppm !== null ? `, ${pct(s.conversion_ppm, 0)} of ${prev.label} moved on` : '') + (s.now !== null ? `, ${s.now} here now` : '') + (s.median_days !== null ? `, usually ${s.median_days} days in this stage` : '');
}

export function FunnelStrip({ funnel, onStage, className }: { funnel: FunnelAnswer | null; onStage?: ((key: string) => void) | undefined; className?: string | undefined }): React.JSX.Element {
  const drawn = useDrawn();
  if (funnel === null) return <Skeleton className={cn('h-[124px] w-full', className)} />;
  const stages = funnel.stages;
  const quarter = funnel.quarter.key.replace('-', ' ');
  const max = Math.max(1, ...stages.map((s) => s.count));
  const n = stages.length;
  return (
    <div role="img" aria-label={stages.map((s, i) => barText(s, stages[i - 1], quarter)).join('; ')} className={cn('vo-in vo-scroll min-w-0 overflow-x-auto', className)}>
      <ol className="flex min-w-[560px] items-end gap-2">
        {stages.map((s, i) => {
          const h = s.count === 0 ? 2 : Math.max(6, Math.round((s.count / max) * 56));
          const body = (
            <>
              <div className="flex h-5 items-baseline gap-1 whitespace-nowrap px-0.5">
                <span className="vo-mono vo-num text-[15px] leading-5 text-[var(--vo-ink)]">{s.count}</span>
                <span className="truncate text-[12px] text-[var(--vo-muted)]">{s.key === 'inbound' ? 'inbound' : s.count === 1 ? 'deal' : 'deals'}</span>
              </div>
              <div className="flex h-[58px] items-end">
                <span aria-hidden className="block w-full rounded-t-[3px] transition-[height,filter] duration-700 ease-out group-hover:brightness-110" style={{ height: drawn ? h : 2, background: s.count === 0 ? 'var(--vo-line)' : TONE.a, opacity: s.count === 0 ? 1 : 0.35 + 0.65 * (1 - i / Math.max(1, n)) }} />
              </div>
              <span className="mt-1.5 block truncate px-0.5 text-[12px] font-medium text-[var(--vo-ink-2)]">{s.label}</span>
              <span className="block h-[18px] truncate px-0.5 text-[12px] text-[var(--vo-muted)]">{s.key === 'inbound' ? 'this quarter' : s.conversion_ppm !== null ? pct(s.conversion_ppm, 0) + ' moved on' : ''}</span>
            </>
          );
          return (
            <li key={s.key} title={barText(s, stages[i - 1], quarter)} className="group min-w-[64px] flex-1">
              {onStage !== undefined && s.key !== 'inbound' ? (
                <button type="button" onClick={() => onStage(s.key)} className="vo-focus block w-full rounded-[var(--vo-radius-sm)] p-1 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                  {body}
                </button>
              ) : (
                <div className="p-1">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
