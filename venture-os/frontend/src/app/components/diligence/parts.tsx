/**
 * Small pieces every diligence view shares: an answer's value with its grade,
 * your AI agent's mark and its citations; one answer to check (the tab's list
 * and the Focus card use the same row); the Confirm and Reject buttons of a
 * row; one answer decided with an instant screen.
 */
import { Check, ExternalLink, Lock, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { fmtDay, money, num, pct } from '../../lib/format.ts';
import { act, patch } from '../../lib/live.ts';
import { AgentTag, Citation, GradeDot, IconButton } from '../ui.tsx';
import type { Answer, Cite, QType, Raw, ReadTarget } from './types.ts';
import { DD_READS, GRID_READS } from './types.ts';

/** The chips that open a citation: p.N per cited page (NDA ones locked when hidden), a link per public source. */
export function CiteChips({ cites, sources, onOpen, max = 2 }: { cites: Cite[]; sources: string[]; onOpen: (c: Cite) => void; max?: number | undefined }): React.JSX.Element | null {
  if (cites.length === 0 && sources.length === 0) return null;
  const list = cites.slice(0, max);
  return (
    <span className="inline-flex shrink-0 items-center gap-1 [&>button:hover]:bg-[var(--vo-active)]">
      {list.map((c) =>
        c.hidden ? (
          <span key={c.anchor} title="Under NDA: the deal team reads it" className="inline-flex h-[18px] items-center gap-0.5 rounded-[3px] border border-[var(--vo-line)] px-1 text-[10.5px] text-[var(--vo-muted)]">
            <Lock size={10} aria-hidden />
            <span className="vo-mono">{`p.${c.page}`}</span>
          </span>
        ) : (
          <Citation key={c.anchor} label={`p.${c.page}`} quote={c.quote ?? undefined} onOpen={() => onOpen(c)} />
        ),
      )}
      {cites.length === 0 &&
        sources.slice(0, 1).map((s) => (
          <a key={s} href={s} target="_blank" rel="noreferrer noopener" title={s} className="vo-focus hit inline-flex h-[18px] items-center gap-0.5 rounded-[3px] border border-[var(--vo-line)] bg-[var(--vo-raised)] px-1 text-[10.5px] text-[var(--vo-ink-2)] transition-colors duration-150 hover:border-[var(--vo-ink-2)] hover:bg-[var(--vo-active)] hover:text-[var(--vo-ink)]">
            <ExternalLink size={10} aria-hidden />
            <span className="vo-mono">{hostOf(s)}</span>
          </a>
        ))}
    </span>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

/** An answer as people read it at a glance: amounts compact ("USD 1.2M"), percents, counts with their unit, days. */
export function shown(a: { type?: QType | undefined; value: string; unit?: string | undefined; raw?: Raw | undefined }): string {
  const r = a.raw;
  if (r === undefined || a.type === undefined) return a.value;
  const unit = a.unit ?? '';
  if (a.type === 'number') {
    if (/^[A-Z]{3}$/.test(unit)) return money(r.minor, unit, { compact: true });
    if (unit === '%') return pct(r.ppm, 1);
    return num(r.e6 / 1e6, 2) + (unit !== '' ? ' ' + unit : '');
  }
  if (a.type === 'date') return fmtDay(r.day, { year: 'always' });
  return a.value;
}

/** Value, grade and marks of one answer, in one line. */
export function AnswerValue({ a, onOpen, struck, className }: { a: { type?: QType | undefined; raw?: Raw | undefined; unit?: string | undefined; value: string; grade: Answer['grade']; status: Answer['status']; cites: Cite[]; sources: string[]; formula?: string | undefined }; onOpen: (c: Cite) => void; struck?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const short = shown(a);
  const exact = a.value + (a.formula !== undefined && a.formula !== '' ? ' (' + a.formula + ')' : '');
  return (
    <span className={cn('flex min-w-0 items-center justify-end gap-2', className)}>
      {struck !== undefined && <span className="vo-mono vo-num hidden truncate text-[12px] text-[var(--vo-muted)] line-through decoration-[var(--vo-line-2)] sm:inline">{struck}</span>}
      <span className="vo-mono vo-num vo-wrap min-w-0 text-right text-[13px] text-[var(--vo-ink)]" title={exact !== short ? exact : undefined}>
        {short}
      </span>
      <GradeDot grade={a.grade} />
      {a.status === 'agent_proposed' && <AgentTag />}
      <CiteChips cites={a.cites} sources={a.sources} onOpen={onOpen} />
    </span>
  );
}

/** An answer's value in its face: text answers in the text face, numbers in mono (the exact value in the tooltip). */
export function AnswerText({ a, className }: { a: { type?: QType | undefined; raw?: Raw | undefined; unit?: string | undefined; value: string; formula?: string | undefined }; className?: string | undefined }): React.JSX.Element {
  const short = shown(a);
  const exact = a.value + (a.formula !== undefined && a.formula !== '' ? ' (' + a.formula + ')' : '');
  return (
    <span data-data className={cn('vo-wrap min-w-0', a.type === 'number' && 'vo-mono vo-num', className)} title={exact !== short ? exact : undefined}>
      {short}
    </span>
  );
}

/** One proposed answer as the tab's list and the Focus card show it. */
export interface CheckItem {
  id: string;
  question: string;
  type?: QType | undefined;
  value: string;
  raw?: Raw | undefined;
  unit?: string | undefined;
  formula?: string | undefined;
  grade: Answer['grade'];
  cites: Cite[];
  sources: string[];
  /** The confirmed answer this one would replace. */
  struck?: string | undefined;
}

/**
 * One answer to check, the same layout in the tab and in Focus: the question
 * above its answer (with its grade and source), Reject and Confirm on the
 * right. A citation opens the reader at the quote.
 */
export function CheckRow({ item, onOpen, onDecide, busy }: { item: CheckItem; onOpen: (c: Cite) => void; onDecide: (confirm: boolean) => void; busy?: boolean | undefined }): React.JSX.Element {
  return (
    <li className="group grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 transition-colors duration-150 hover:bg-[var(--vo-hover)] sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-0.5">
        <span className="vo-wrap text-[12px] leading-4 text-[var(--vo-muted)]">{item.question}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {item.struck !== undefined && <span data-data className="vo-wrap text-[13px] text-[var(--vo-muted)] line-through decoration-[var(--vo-line-2)]">{item.struck}</span>}
          <AnswerText a={item} className="text-[14px] leading-5 text-[var(--vo-ink)]" />
        </span>
      </div>
      {/* Grade and source: their own column, under the answer on a phone. */}
      <span className="col-start-1 row-start-2 mt-1 flex min-w-0 items-center gap-2 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-end">
        <GradeDot grade={item.grade} />
        <CiteChips cites={item.cites} sources={item.sources} onOpen={onOpen} max={1} />
      </span>
      <span className="col-start-2 row-span-2 row-start-1 flex shrink-0 items-center gap-0.5 sm:col-start-3 sm:row-span-1">
        <IconButton icon={X} label="Reject" size={30} onRow disabled={busy} onClick={() => onDecide(false)} />
        <IconButton icon={Check} label="Confirm" size={30} onRow disabled={busy} onClick={() => onDecide(true)} />
      </span>
    </li>
  );
}

/** Confirm (check) and Reject (x) for a row: shown on hover, always on touch screens. */
export function DecideButtons({ id, onDone, always, reads = DD_READS }: { id: string; onDone?: (() => void) | undefined; always?: boolean | undefined; reads?: string[] | undefined }): React.JSX.Element {
  return (
    <span className={cn('flex shrink-0 items-center gap-0.5 transition-opacity duration-150', always === true ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')}>
      <IconButton icon={X} label="Reject" size={28} onRow onClick={() => void decide(id, false, reads).then((ok) => ok && onDone?.())} />
      <IconButton icon={Check} label="Confirm" size={28} onRow onClick={() => void decide(id, true, reads).then((ok) => ok && onDone?.())} />
    </span>
  );
}

/** Confirm or reject one answer (or several) with the screen updated at once. */
export async function decide(ids: string | string[], confirm: boolean, reads: string[] = DD_READS): Promise<boolean> {
  const list = Array.isArray(ids) ? ids : [ids];
  const edits = list.map((id) => patch(id, { status: confirm ? 'confirmed' : 'rejected' }));
  const out = await act(edits, () => op(confirm ? 'dd.confirm' : 'dd.reject', list.length === 1 ? { answer: list[0] } : { answers: list }), reads);
  return out !== null;
}

export { GRID_READS };

/** A cited passage of an answer as the reader opens it. */
export function readTarget(c: Cite, a: Answer | null, question?: string): ReadTarget {
  return { cite: c, question, answer: a !== null ? { id: a.id, value: shown(a), status: a.status, grade: a.grade } : undefined };
}
