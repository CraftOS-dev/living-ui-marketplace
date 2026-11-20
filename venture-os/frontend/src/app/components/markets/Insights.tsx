/**
 * Your AI agent's take on the news (fix 4): each insight says the point in
 * one line, the analysis in two to four sentences, its impact on the firm
 * (Positive, Negative, Watch), what it affects (companies, funds, theses,
 * sectors) and a next step; "Based on" lists the stories it rests on, each
 * opening the article. People dismiss an insight (Undo in the toast).
 */
import { ArrowRight, ExternalLink, Sparkle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { useOp } from '../../lib/live.ts';
import { Button, IconButton, LoadError, Skeleton, Tag } from '../ui.tsx';
import type { Tone } from '../ui.tsx';
import type { Impact, Insight, InsightAffect, InsightsAnswer } from './news.ts';
import { askInsights, dismissInsight, IMPACT_LABEL, NEWS_READS } from './news.ts';
import { agoWords } from './types.ts';
import { AskAgent } from '../agent.tsx';

const IMPACT_TONE: Record<Impact, Tone> = { positive: 'good', negative: 'bad', watch: 'warn' };
const IMPACT_TIP: Record<Impact, string> = { positive: 'Good for the firm', negative: 'Bad for the firm', watch: 'Worth watching; the effect is not clear yet' };

export function ImpactChip({ impact }: { impact: Impact }): React.JSX.Element {
  return (
    <Tag tone={IMPACT_TONE[impact]} title={IMPACT_TIP[impact]}>
      {IMPACT_LABEL[impact]}
    </Tag>
  );
}

/** Where an affected thing opens. */
function affectHref(a: InsightAffect): string | undefined {
  if (a.kind === 'company') return `#/companies/${a.id}`;
  if (a.kind === 'thesis') return `#/markets/${a.id}`;
  if (a.kind === 'sector') return `#/markets/sectors/${a.id}`;
  if (a.kind === 'fund') return `#/funds/${a.id}`;
  return undefined;
}

function AffectChips({ affects }: { affects: InsightAffect[] }): React.JSX.Element | null {
  if (affects.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {affects.map((a) => {
        const link = affectHref(a);
        const chip = (
          <Tag tone="neutral" className="max-w-[180px] transition-colors duration-150 group-hover/chip:border-[var(--vo-line-2)] group-hover/chip:bg-[var(--vo-active)] group-hover/chip:text-[var(--vo-ink)]">
            <span className="truncate">{a.name}</span>
          </Tag>
        );
        return link !== undefined ? (
          <a key={a.kind + a.id} href={link} title={`Open ${a.name}`} className="vo-focus group/chip inline-flex min-w-0 rounded-[4px]">
            {chip}
          </a>
        ) : (
          <span key={a.kind + a.id}>{chip}</span>
        );
      })}
    </span>
  );
}

/** One insight. `full` shows the analysis whole, the next step and the stories; compact shows two lines. */
export function InsightCard({ x, full, onDismiss, focus }: { x: Insight; full?: boolean | undefined; onDismiss?: (() => void) | undefined; focus?: boolean | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(full === true || focus === true);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focus === true) ref.current?.scrollIntoView({ block: 'center' });
  }, [focus]);
  return (
    <div ref={ref} data-insight={x.id} className={cn('group/ins flex min-w-0 flex-col gap-1.5', focus === true && '-mx-2 rounded-[var(--vo-radius-sm)] bg-[var(--vo-active)] px-2 py-2')}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <ImpactChip impact={x.impact} />
            <span className="text-[12px] text-[var(--vo-muted)]">{agoWords(x.created_at)}</span>
          </span>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="vo-focus vo-wrap cursor-pointer self-start rounded-[3px] text-left text-[14px] font-semibold leading-[19px] text-[var(--vo-ink)] hover:underline hover:decoration-[var(--vo-line-2)] hover:underline-offset-[3px]">
            {x.title}
          </button>
        </span>
        {onDismiss !== undefined && <IconButton icon={X} label="Dismiss this insight" size={26} onClick={onDismiss} className="shrink-0 opacity-100 md:opacity-0 md:focus-visible:opacity-100 md:group-hover/ins:opacity-100" />}
      </div>
      <p className={cn('vo-wrap text-[13px] leading-[19px] text-[var(--vo-ink-2)]', !open && 'line-clamp-2')}>{x.analysis}</p>
      <AffectChips affects={x.affects} />
      {open && x.next_step !== '' && (
        <p className="vo-wrap flex min-w-0 gap-1.5 text-[13px] leading-[19px] text-[var(--vo-ink)]">
          <ArrowRight size={14} aria-hidden className="mt-[2px] shrink-0 text-[var(--vo-muted)]" />
          <span className="min-w-0">{x.next_step}</span>
        </p>
      )}
      {open ? (
        x.news.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1 pt-0.5">
            <span className="text-[12px] text-[var(--vo-muted)]">{x.news.length === 1 ? 'Based on 1 story' : `Based on ${x.news.length} stories`}</span>
            <ul className="flex min-w-0 flex-col gap-1">
              {x.news.map((n) => (
                <li key={n.id} className="min-w-0">
                  <a href={n.url} target="_blank" rel="noreferrer" title="Open the article in a new tab" className="vo-focus group/src flex min-w-0 items-start gap-1.5 rounded-[3px] text-[12px] leading-4 text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)]">
                    <ExternalLink size={12} aria-hidden className="mt-[2px] shrink-0 text-[var(--vo-muted)]" />
                    <span className="min-w-0 group-hover/src:underline group-hover/src:underline-offset-[3px]">{n.source !== '' ? `${n.title} (${n.source})` : n.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="vo-focus cursor-pointer self-start rounded-[3px] text-[12px] font-medium text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)] hover:underline hover:underline-offset-[3px]">
          {x.news.length === 1 ? 'Next step and the 1 story it rests on' : `Next step and the ${x.news.length} stories it rests on`}
        </button>
      )}
    </div>
  );
}

/** The latest insights (all, or those about a ref), stacked with hairlines between them. */
export function InsightList({ refKey = '', limit = 4, canAsk, empty, focus = '' }: { refKey?: string | undefined; limit?: number | undefined; canAsk: boolean; empty?: string | undefined; focus?: string | undefined }): React.JSX.Element {
  // A link to one insight (Home's "full insight") loads more so that one is found, then shows it open.
  const n = focus !== '' ? 30 : limit;
  const live = useOp<InsightsAnswer>('news.insights', refKey === '' ? { limit: n } : { limit: n, ref: refKey }, NEWS_READS, { name: `markets.insights.${refKey}.${n}`, keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-32 w-full" />;
  const all = live.data.insights;
  const hit = all.find((x) => x.id === focus);
  const rows = hit !== undefined && !all.slice(0, limit).includes(hit) ? [hit, ...all.slice(0, limit - 1)] : all.slice(0, limit);
  if (rows.length === 0)
    return (
      <div className="flex min-w-0 flex-col items-start gap-2 py-1">
        <span className="text-[13px] text-[var(--vo-muted)]">{empty ?? "Your AI agent's take on the news appears here each morning"}</span>
        {canAsk && <AskAgent label="Ask for its take now" size="md" state={live.data.agent?.news_insights} onAsk={askInsights} reads={['news_insights', 'agent_requests']} />}
      </div>
    );
  return (
    <ul className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
      {rows.map((x) => (
        <li key={x.id} className="py-3 first:pt-0 last:pb-0">
          <InsightCard x={x} focus={x.id === focus} onDismiss={canAsk ? () => void dismissInsight(x.id) : undefined} />
        </li>
      ))}
    </ul>
  );
}
