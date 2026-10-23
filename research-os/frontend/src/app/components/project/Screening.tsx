/**
 * A systematic review: import records, screen them one at a time (titles
 * and abstracts, then full texts), resolve conflicts, and the PRISMA 2020
 * flow that counts every record.
 *
 *   I include, E exclude, M maybe (titles and abstracts), 1 to 8 pick the
 *   exclusion reason, U takes back the last decision.
 *
 * With your AI agent as the second screener its decision stays hidden until
 * you have decided; disagreements become conflicts you settle.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, Download, FileUp, GitCompareArrows, Import, Library, ListChecks, Search, Settings2, Sparkles, Undo2, Workflow, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { download, op, opForm } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import { clip, num, plural } from '../../lib/format.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { Project } from '../../lib/types.ts';
import { askAgent, RequestStatus } from '../agent.tsx';
import { ProgressRing } from '../ui.tsx';
import { Badge, Button, Empty, Field, IconButton, Kbd, LoadError, Modal, Segmented, Spinner, Tabs, Toggle, inputCls, textareaCls } from '../ui.tsx';

type Stage = 'title_abstract' | 'full_text';

interface Review {
  id: string;
  project: string;
  title: string;
  question: string;
  criteria: { include: string[]; exclude: string[] };
  reasons: { key: string; label: string }[];
  dual: boolean;
  blind: boolean;
  agent_seat: boolean;
  stage: string;
  counts: Prisma;
}

interface Prisma {
  identified: number;
  by_source: { source_db: string; n: number }[];
  duplicates: number;
  screened: number;
  ta_pending: number;
  ta_conflict: number;
  ta_excluded: number;
  sought: number;
  ft_pending: number;
  ft_conflict: number;
  assessed: number;
  ft_excluded: number;
  ft_reasons: { reason: string; n: number }[];
  included: number;
}

interface Decision {
  id: string;
  stage: Stage;
  seat: 'person' | 'agent' | 'final';
  value: 'include' | 'exclude' | 'maybe';
  reason: string;
  basis_quote: string;
  rationale: string;
  confidence: string;
  actor: string;
  created: string;
}

interface Rec {
  id: string;
  title: string;
  authors_short: string;
  year: number;
  venue: string;
  abstract: string;
  abstract_words: number;
  doi: string;
  pmid: string;
  source_db: string;
  work: string;
  dup_of: string;
  ta: string;
  ft: string;
  ta_reason: string;
  ft_reason: string;
  decisions: Decision[];
  hidden_decisions: number;
}

interface Summary {
  review: Review;
  prisma: Prisma;
  agreement: Record<Stage, { n: number; kappa: number | null; agreement: number | null }>;
}

type Tab = 'screen' | 'conflicts' | 'records' | 'prisma' | 'protocol';

export function Screening({ project, reviewId }: { project: Project; reviewId: string }): React.JSX.Element {
  if (reviewId === '') {
    const make = async (): Promise<void> => {
      const r = await op<{ review: { id: string } }>('screen.create', { project: project.id, question: project.question });
      changed('reviews');
      replaceQuery({ view: 'screen', review: r.review.id });
    };
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty icon={ListChecks} title="No systematic review yet" action={<Button variant="primary" icon={ListChecks} onClick={() => void make()}>New review</Button>}>
          Screen records with blinded dual decisions and a PRISMA flow.
        </Empty>
      </div>
    );
  }
  return <ReviewView key={reviewId} project={project} reviewId={reviewId} />;
}

function ReviewView({ project, reviewId }: { project: Project; reviewId: string }): React.JSX.Element {
  const s = useLive((signal) => op<Summary>('screen.summary', { review: reviewId }, { quiet: true, signal }), ['reviews', 'review_records', 'decisions', 'import_logs'], [reviewId], 200);
  const [tab, setTab] = useState<Tab>('screen');
  const [stage, setStage] = useState<Stage>('title_abstract');
  const [importing, setImporting] = useState(false);
  const [req, setReq] = useState('');
  if (s.error !== null) return <div className="p-4"><LoadError message={s.error} onRetry={s.reload} /></div>;
  if (s.data === null) return <div className="flex flex-1 items-center justify-center"><Spinner size={20} /></div>;
  const r = s.data.review;
  const p = s.data.prisma;
  const conflicts = p.ta_conflict + p.ft_conflict;
  const total = stage === 'title_abstract' ? p.screened : p.sought;
  const left = stage === 'title_abstract' ? p.ta_pending : p.ft_pending;
  const k = s.data.agreement[stage];
  const exportCsv = async (): Promise<void> => {
    const x = await op<{ filename: string; content: string }>('screen.export', { review: r.id });
    download(x.filename, x.content, 'text/csv;charset=utf-8');
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2">
        <ListChecks size={14} className="text-[var(--ro-muted)]" />
        <span className="min-w-0 max-w-[260px] truncate text-[13px] font-bold">{r.title}</span>
        <Segmented label="Stage" size="sm" value={stage} onChange={setStage} options={[{ value: 'title_abstract', label: 'Titles and abstracts' }, { value: 'full_text', label: 'Full texts' }]} />
        <span className="flex items-center gap-1.5">
          <ProgressRing value={total === 0 ? 0 : (total - left) / total} size={22} stroke={3} label="Screened" />
          <span className="num text-[12px] text-[var(--ro-muted)]">
            {num(total - left)} / {num(total)}
          </span>
        </span>
        {k.kappa !== null && (
          <span className="text-[12px] text-[var(--ro-muted)]" title={'Agreement with your AI agent over ' + plural(k.n, 'record')}>
            kappa <span className="num font-bold text-[var(--ro-ink)]">{k.kappa.toFixed(2)}</span>
          </span>
        )}
        <span className="flex-1" />
        {req !== '' && <RequestStatus id={req} />}
        {r.agent_seat && project.confidentiality !== 'confidential' && p.screened > 0 && (
          <Button size="sm" icon={Sparkles} onClick={() => void askAgent('screening_requested', { review: r.id, stage }, 'Asked your AI agent to screen as the second reviewer').then((id) => id !== '' && setReq(id))}>
            Your AI agent screens
          </Button>
        )}
        <Button size="sm" icon={Import} onClick={() => setImporting(true)}>
          Import
        </Button>
        <IconButton icon={Download} label="Export as CSV" onClick={() => void exportCsv()} />
      </div>
      <Tabs
        label="Review"
        value={tab}
        onChange={setTab}
        className="shrink-0 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-3"
        options={[
          { value: 'screen', label: 'Screen' },
          { value: 'conflicts', label: conflicts > 0 ? <span className="inline-flex items-center gap-1">Conflicts <span className="num rounded-full bg-[var(--ro-red)] px-1.5 text-[12px] text-[var(--ro-on-red)]">{conflicts}</span></span> : 'Conflicts' },
          { value: 'records', label: 'Records' },
          { value: 'prisma', label: 'PRISMA flow' },
          { value: 'protocol', label: 'Protocol' },
        ]}
      />
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto">
        {p.identified === 0 && tab !== 'protocol' ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty icon={Import} title="No records yet" action={<Button variant="primary" icon={Import} onClick={() => setImporting(true)}>Import records</Button>}>
              From the reading list, a PubMed search, or a RIS or BibTeX file from any database.
            </Empty>
          </div>
        ) : tab === 'screen' ? (
          <ScreenQueue review={r} stage={stage} queue="undecided" />
        ) : tab === 'conflicts' ? (
          <ScreenQueue review={r} stage={p.ta_conflict > 0 ? 'title_abstract' : 'full_text'} queue="conflicts" />
        ) : tab === 'records' ? (
          <Records review={r} />
        ) : tab === 'prisma' ? (
          <PrismaFlow p={p} reasons={r.reasons} title={r.title} />
        ) : (
          <Protocol review={r} />
        )}
      </div>
      <ImportDialog open={importing} review={r.id} onClose={() => setImporting(false)} />
    </div>
  );
}

/* --------------------------------------------------------------- screen */

function ScreenQueue({ review, stage, queue }: { review: Review; stage: Stage; queue: 'undecided' | 'conflicts' }): React.JSX.Element {
  const n = useLive((signal) => op<{ record: Rec | null; left: number }>('screen.next', { review: review.id, stage, queue }, { quiet: true, signal }), ['review_records', 'decisions'], [review.id, stage, queue], 80);
  const [reason, setReason] = useState('');
  const [last, setLast] = useState<{ rec: Rec; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rec = n.data?.record ?? null;
  useEffect(() => setReason(''), [rec?.id]);
  const decide = async (value: 'include' | 'exclude' | 'maybe'): Promise<void> => {
    if (rec === null || busy) return;
    if (value === 'exclude' && stage === 'full_text' && reason === '') {
      toast.error('Pick the reason for excluding it (1 to ' + review.reasons.length + ')');
      return;
    }
    setBusy(true);
    try {
      await op('screen.decide', { record: rec.id, stage, value, reason: value === 'exclude' && reason !== '' ? reason : undefined, seat: queue === 'conflicts' ? 'final' : undefined });
      setLast({ rec, value });
      changed('decisions', 'review_records');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const undo = async (): Promise<void> => {
    if (last === null) return;
    await op('screen.undo-decision', { record: last.rec.id, stage, seat: queue === 'conflicts' ? 'final' : 'person' });
    setLast(null);
    changed('decisions', 'review_records');
  };
  const decideRef = useRef(decide);
  decideRef.current = decide;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'i') void decideRef.current('include');
      else if (k === 'e') void decideRef.current('exclude');
      else if (k === 'm' && stage === 'title_abstract' && queue !== 'conflicts') void decideRef.current('maybe');
      else if (k === 'u') void undoRef.current();
      else if (/^[1-9]$/.test(k)) {
        const r = review.reasons[Number(k) - 1];
        if (r) setReason((cur) => (cur === r.key ? '' : r.key));
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review.reasons, stage, queue]);

  if (n.data === null) return <div className="flex justify-center p-10"><Spinner size={20} /></div>;
  if (rec === null)
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-[var(--ro-green)]/15 text-[var(--ro-green-text)]">
          <Check size={22} />
        </span>
        <span className="text-[15px] font-bold">{queue === 'conflicts' ? 'No conflicts' : stage === 'title_abstract' ? 'Every title and abstract screened' : 'Every full text assessed'}</span>
        {last !== null && <LastDecision last={last} onUndo={() => void undo()} />}
      </div>
    );
  const others = rec.decisions.filter((d) => d.stage === stage && d.seat !== 'person');
  const mine = rec.decisions.find((d) => d.stage === stage && d.seat === 'person');
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-[12px] text-[var(--ro-muted)]">
        <span className="num font-semibold">{plural(n.data.left, 'record')} left</span>
        {rec.source_db !== '' && <Badge tone="neutral">{rec.source_db}</Badge>}
        {queue === 'conflicts' && <Badge tone="bad">Conflict</Badge>}
      </div>
      <article className="flex flex-col gap-3 rounded-[var(--ro-r-lg)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-5 shadow-[var(--ro-shadow-sm)]">
        <h2 className="serif text-[15px] font-bold leading-[22px]">{rec.title}</h2>
        <p className="text-[12px] text-[var(--ro-muted)]">
          {[rec.authors_short, rec.year > 0 ? String(rec.year) : '', rec.venue].filter((x) => x !== '').join(' · ')}
          {rec.doi !== '' && <> · <a className="underline-offset-2 hover:underline" href={'https://doi.org/' + rec.doi} target="_blank" rel="noreferrer">{rec.doi}</a></>}
        </p>
        {rec.abstract !== '' ? <p className="serif whitespace-pre-wrap text-[15px] leading-[25px]">{rec.abstract}</p> : <p className="text-[13px] italic text-[var(--ro-muted)]">No abstract</p>}
      </article>
      {(queue === 'conflicts' || mine !== undefined) && others.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {[...(mine ? [mine] : []), ...others].map((d) => (
            <div key={d.id} className="flex items-start gap-2 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2 text-[12px]">
              {d.seat === 'agent' ? <Sparkles size={13} className="mt-0.5 text-[var(--ro-accent)]" /> : <CircleHelp size={13} className="mt-0.5 text-[var(--ro-muted)]" />}
              <span className="min-w-0 flex-1">
                <span className="font-bold">{d.seat === 'agent' ? 'Your AI agent' : d.seat === 'final' ? 'Final' : 'You'}: </span>
                <DecisionWord v={d.value} />
                {d.reason !== '' && <span className="text-[var(--ro-muted)]"> ({review.reasons.find((x) => x.key === d.reason)?.label ?? d.reason})</span>}
                {d.confidence !== '' && <span className="text-[var(--ro-muted)]">, {d.confidence.replace('_', ' ')} confidence</span>}
                {d.rationale !== '' && <span className="mt-0.5 block leading-4 text-[var(--ro-ink-2)]">{d.rationale}</span>}
                {d.basis_quote !== '' && <span className="serif mt-0.5 block border-l-2 border-[var(--ro-accent)] pl-2 leading-4 text-[var(--ro-ink-2)]">{clip(d.basis_quote, 300)}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {rec.hidden_decisions > 0 && (
        <p className="flex items-center gap-1.5 text-[12px] text-[var(--ro-muted)]">
          <Sparkles size={12} /> Your AI agent has decided; you see it after you do.
        </p>
      )}
      <div className="sticky bottom-0 flex flex-col gap-2 rounded-[var(--ro-r-lg)] border border-[var(--ro-line)] bg-[var(--ro-shell)] p-3 shadow-[var(--ro-shadow)]">
        <div className="flex flex-wrap gap-1.5">
          {review.reasons.map((r, i) => (
            <button key={r.key} type="button" onClick={() => setReason((cur) => (cur === r.key ? '' : r.key))} className={cn('inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r)] border px-2 text-[12px] font-semibold', reason === r.key ? 'border-[var(--ro-red)] bg-[var(--ro-red)]/10 text-[var(--ro-red-text)]' : 'border-[var(--ro-line)] bg-[var(--ro-card)] hover:bg-[var(--ro-row)]')}>
              <Kbd>{i + 1}</Kbd> {r.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={busy} onClick={() => void decide('include')} className="flex h-11 items-center justify-center gap-2 rounded-[var(--ro-r-md)] bg-[var(--ro-green)] text-[14px] font-bold text-[var(--ro-on-green)] hover:opacity-90 disabled:opacity-50">
            <Check size={16} /> Include <Kbd className="opacity-80">I</Kbd>
          </button>
          {stage === 'title_abstract' && queue !== 'conflicts' ? (
            <button type="button" disabled={busy} onClick={() => void decide('maybe')} className="flex h-11 items-center justify-center gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] text-[14px] font-bold hover:bg-[var(--ro-row)] disabled:opacity-50">
              <CircleHelp size={16} /> Maybe <Kbd>M</Kbd>
            </button>
          ) : (
            <span />
          )}
          <button type="button" disabled={busy} onClick={() => void decide('exclude')} className="flex h-11 items-center justify-center gap-2 rounded-[var(--ro-r-md)] bg-[var(--ro-red)] text-[14px] font-bold text-[var(--ro-on-red)] hover:opacity-90 disabled:opacity-50">
            <X size={16} /> Exclude <Kbd className="opacity-80">E</Kbd>
          </button>
        </div>
        {last !== null && <LastDecision last={last} onUndo={() => void undo()} />}
      </div>
    </div>
  );
}

function DecisionWord({ v }: { v: string }): React.JSX.Element {
  return <span className={cn('font-bold', v === 'include' ? 'text-[var(--ro-green-text)]' : v === 'exclude' ? 'text-[var(--ro-red-text)]' : 'text-[var(--ro-amber-text,var(--ro-ink-2))]')}>{v}</span>;
}

function LastDecision({ last, onUndo }: { last: { rec: Rec; value: string }; onUndo: () => void }): React.JSX.Element {
  return (
    <span className="flex items-center gap-2 text-[12px] text-[var(--ro-muted)]">
      <span className="min-w-0 flex-1 truncate">
        <DecisionWord v={last.value} /> {clip(last.rec.title, 80)}
      </span>
      <Button size="sm" variant="ghost" icon={Undo2} onClick={onUndo}>
        Undo <Kbd className="ml-1">U</Kbd>
      </Button>
    </span>
  );
}

/* -------------------------------------------------------------- records */

const STATES: { key: string; label: string; params: Record<string, string> }[] = [
  { key: 'all', label: 'All', params: {} },
  { key: 'ta_pending', label: 'To screen', params: { ta: 'pending' } },
  { key: 'ta_maybe', label: 'Maybe', params: { ta: 'maybe' } },
  { key: 'ft_pending', label: 'Full text to assess', params: { ft: 'pending' } },
  { key: 'included', label: 'Included', params: { ft: 'include' } },
  { key: 'excluded', label: 'Excluded', params: { ta: 'exclude' } },
  { key: 'ft_excluded', label: 'Excluded at full text', params: { ft: 'exclude' } },
  { key: 'dups', label: 'Duplicates', params: { duplicates: 'true' } },
];

function Records({ review }: { review: Review }): React.JSX.Element {
  const [state, setState] = useState('all');
  const params = STATES.find((s) => s.key === state)?.params ?? {};
  const list = useLive((signal) => op<{ records: Rec[] }>('screen.records', { review: review.id, limit: 500, ...params }, { quiet: true, signal }).then((r) => r.records), ['review_records', 'decisions'], [review.id, state], 200);
  const [q, setQ] = useState('');
  const rows = (list.data ?? []).filter((r) => q.trim() === '' || r.title.toLowerCase().includes(q.trim().toLowerCase()));
  const pill = (v: string): React.JSX.Element => <Badge tone={v === 'include' ? 'good' : v === 'exclude' ? 'bad' : v === 'conflict' ? 'warn' : 'neutral'}>{v === 'none' ? 'n/a' : v}</Badge>;
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATES.map((s) => (
          <button key={s.key} type="button" onClick={() => setState(s.key)} className={cn('h-7 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold', state === s.key ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row-hover)]')}>
            {s.label}
          </button>
        ))}
        <span className="flex-1" />
        <label className="flex h-7 w-48 items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] px-2">
          <Search size={13} className="text-[var(--ro-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a title" aria-label="Find a title" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
        </label>
      </div>
      {list.data === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty compact icon={ListChecks} title="No records here" />
      ) : (
        <div className="overflow-x-auto rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          <table className="ro-table w-full min-w-[640px]">
            <thead>
              <tr>
                <th>Record</th>
                <th className="w-28">Abstract</th>
                <th className="w-28">Full text</th>
                <th className="w-40">Decisions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="line-clamp-2 text-[13px] font-semibold leading-[18px]">{r.title}</span>
                    <span className="block truncate text-[12px] text-[var(--ro-muted)]">{[r.authors_short, r.year || '', r.source_db].filter((x) => x !== '').join(' · ')}</span>
                  </td>
                  <td>{pill(r.ta)}</td>
                  <td>{pill(r.ft)}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {r.decisions.map((d) => (
                        <span key={d.id} className="inline-flex items-center gap-1 text-[12px]" title={d.rationale}>
                          {d.seat === 'agent' ? <Sparkles size={11} className="text-[var(--ro-accent)]" /> : <span className="text-[var(--ro-muted)]">{d.seat === 'final' ? 'F' : 'You'}</span>}
                          <DecisionWord v={d.value} />
                        </span>
                      ))}
                      {r.hidden_decisions > 0 && <span className="text-[12px] text-[var(--ro-muted)]">+{r.hidden_decisions} hidden</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- prisma */

function PrismaFlow({ p, reasons, title }: { p: Prisma; reasons: { key: string; label: string }[]; title: string }): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const reasonLabel = (k: string): string => reasons.find((r) => r.key === k)?.label ?? (k === '' ? 'No reason given' : k);
  const W = 760;
  const L = 40;
  const R = 440;
  const bw = 300;
  const box = (x: number, y: number, h: number, lines: string[], strong = false): React.JSX.Element => (
    <g>
      <rect x={x} y={y} width={bw} height={h} rx={6} style={{ fill: strong ? 'var(--ro-row)' : 'var(--ro-card)', stroke: 'var(--ro-line)' }} />
      {lines.map((t, i) => (
        <text key={i} x={x + 12} y={y + 22 + i * 18} style={{ fill: i === 0 ? 'var(--ro-ink)' : 'var(--ro-ink-2)', fontSize: 12.5, fontWeight: i === 0 ? 700 : 500, fontFamily: 'Manrope Variable, Manrope, sans-serif' }}>
          {t}
        </text>
      ))}
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number): React.JSX.Element => <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: 'var(--ro-ink-2)' }} strokeWidth={1.5} markerEnd="url(#ro-prisma-arrow)" />;
  const sources = p.by_source.length > 0 ? p.by_source.map((s) => (s.source_db || 'Other') + ' (n = ' + s.n + ')') : [];
  const idH = 40 + Math.max(1, sources.length) * 18;
  const exH = 40 + Math.max(1, p.ft_reasons.length) * 18;
  const y1 = 40;
  const y2 = y1 + idH + 40;
  const y3 = y2 + 80;
  const y4 = y3 + Math.max(80, exH) + 40;
  const H = y4 + 90;
  const downloadSvg = (): void => {
    const el = svgRef.current;
    if (el === null) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    // Bake the theme colors into the file.
    const cs = getComputedStyle(document.documentElement);
    let s = new XMLSerializer().serializeToString(clone);
    s = s.replace(/var\((--ro-[a-z0-9-]+)\)/g, (_m, v: string) => cs.getPropertyValue(v).trim() || '#000');
    download((title || 'prisma').replace(/[^\w\- ]+/g, '') + ' PRISMA.svg', s, 'image/svg+xml');
  };
  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="flex w-full max-w-[760px] items-center gap-2">
        <Workflow size={14} className="text-[var(--ro-muted)]" />
        <span className="flex-1 text-[13px] font-bold">PRISMA 2020 flow</span>
        <Button size="sm" icon={Download} onClick={downloadSvg}>
          Download SVG
        </Button>
      </div>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[760px] rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]" style={{ background: 'var(--ro-card)' }}>
        <defs>
          <marker id="ro-prisma-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--ro-ink-2)' }} />
          </marker>
        </defs>
        {box(L, y1, idH, ['Records identified (n = ' + p.identified + ')', ...(sources.length > 0 ? sources : ['From the reading list and imports'])], true)}
        {box(R, y1, 60, ['Duplicates removed', '(n = ' + p.duplicates + ')'])}
        {arrow(L + bw, y1 + 30, R, y1 + 30)}
        {arrow(L + bw / 2, y1 + idH, L + bw / 2, y2)}
        {box(L, y2, 60, ['Records screened', '(n = ' + p.screened + ')'], true)}
        {box(R, y2, 60, ['Records excluded', '(n = ' + p.ta_excluded + ')' + (p.ta_pending > 0 ? ', ' + p.ta_pending + ' still to screen' : '')])}
        {arrow(L + bw, y2 + 30, R, y2 + 30)}
        {arrow(L + bw / 2, y2 + 60, L + bw / 2, y3)}
        {box(L, y3, 60, ['Full texts assessed', '(n = ' + p.assessed + ' of ' + p.sought + ' sought)'], true)}
        {box(R, y3, Math.max(60, exH), ['Full texts excluded (n = ' + p.ft_excluded + ')', ...(p.ft_reasons.length > 0 ? p.ft_reasons.map((r) => reasonLabel(r.reason) + ' (n = ' + r.n + ')') : ['None yet'])])}
        {arrow(L + bw, y3 + 30, R, y3 + 30)}
        {arrow(L + bw / 2, y3 + 60, L + bw / 2, y4)}
        {box(L, y4, 60, ['Studies included in the review', '(n = ' + p.included + ')'], true)}
        {[['Identification', y1], ['Screening', y2], ['Included', y4]].map(([label, y]) => (
          <text key={String(label)} x={14} y={Number(y) + 30} transform={`rotate(-90 14 ${Number(y) + 30})`} textAnchor="middle" style={{ fill: 'var(--ro-muted)', fontSize: 11, fontWeight: 700, fontFamily: 'Manrope Variable, Manrope, sans-serif' }}>
            {String(label)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------- protocol */

function Protocol({ review }: { review: Review }): React.JSX.Element {
  const [title, setTitle] = useState(review.title);
  const [question, setQuestion] = useState(review.question);
  const [inc, setInc] = useState(review.criteria.include.join('\n'));
  const [exc, setExc] = useState(review.criteria.exclude.join('\n'));
  const [reasons, setReasons] = useState(review.reasons.map((r) => r.label).join('\n'));
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    try {
      await op('screen.update', { review: review.id, ...patch });
      changed('reviews');
    } catch {
      /* toasted */
    }
  };
  const lines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter((x) => x !== '');
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4">
      <h2 className="flex items-center gap-2 text-[14px] font-bold">
        <Settings2 size={14} /> Protocol
      </h2>
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() !== review.title && void save({ title: title.trim() })} className={inputCls} />
      </Field>
      <Field label="Review question">
        <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} onBlur={() => question !== review.question && void save({ question })} className={textareaCls} />
      </Field>
      <div className="grid grid-cols-1 gap-3 @min-[760px]:grid-cols-2">
        <Field label="Include when (one per line)">
          <textarea rows={5} value={inc} onChange={(e) => setInc(e.target.value)} onBlur={() => void save({ criteria: { include: lines(inc), exclude: lines(exc) } })} className={textareaCls} placeholder="Adults over 18" />
        </Field>
        <Field label="Exclude when (one per line)">
          <textarea rows={5} value={exc} onChange={(e) => setExc(e.target.value)} onBlur={() => void save({ criteria: { include: lines(inc), exclude: lines(exc) } })} className={textareaCls} placeholder="Animal studies" />
        </Field>
      </div>
      <Field label="Reasons for excluding (one per line, keys 1 to 9)">
        <textarea
          rows={6}
          value={reasons}
          onChange={(e) => setReasons(e.target.value)}
          onBlur={() => {
            const ls = lines(reasons).slice(0, 9);
            const keyOf = (label: string): string => review.reasons.find((r) => r.label === label)?.key ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
            void save({ reasons: ls.map((label) => ({ key: keyOf(label), label })) });
          }}
          className={textareaCls}
        />
      </Field>
      <div className="flex flex-col divide-y divide-[var(--ro-hair)] rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
        {[
          { k: 'dual', label: 'Two screeners', sub: 'A record is settled when two decisions agree', v: review.dual },
          { k: 'blind', label: 'Blinded', sub: "Hide the other screener's decision until you decide", v: review.blind },
          { k: 'agent_seat', label: 'Your AI agent screens', sub: 'It takes the second seat with a reason and a quoted basis for each decision', v: review.agent_seat },
        ].map((x) => (
          <div key={x.k} className="flex items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{x.label}</span>
              <span className="block text-[12px] text-[var(--ro-muted)]">{x.sub}</span>
            </span>
            <Toggle checked={x.v} onChange={(v) => void save({ [x.k]: v })} label={x.label} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- import */

function ImportDialog({ open, review, onClose }: { open: boolean; review: string; onClose: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<'reading_list' | 'pubmed' | 'file'>('reading_list');
  const [query, setQuery] = useState('');
  const [max, setMax] = useState('200');
  const [file, setFile] = useState<File | null>(null);
  const [db, setDb] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setFile(null);
      setQuery('');
    }
  }, [open]);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      let r: { added?: number; duplicates?: number };
      if (mode === 'reading_list') r = await op('screen.import', { review, from: 'reading_list' });
      else if (mode === 'pubmed') r = await op('screen.import', { review, pubmed: query.trim(), max: Number(max) || 200, source_db: 'PubMed', query: query.trim(), searched_on: new Date().toISOString().slice(0, 10) });
      else {
        if (file === null) return;
        const prev = await opForm<{ import: string }>('import.preview', {}, { file });
        r = await op('screen.import', { review, import: prev.import, source_db: db.trim() || file.name.replace(/\.[^.]+$/, '') });
      }
      changed('review_records', 'reviews', 'import_logs');
      toast.success(plural(r.added ?? 0, 'record') + ' imported' + ((r.duplicates ?? 0) > 0 ? ', ' + plural(r.duplicates ?? 0, 'duplicate') + ' found' : ''));
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Import records" icon={Import} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={(mode === 'pubmed' && query.trim() === '') || (mode === 'file' && file === null)} onClick={() => void run()}>Import</Button></>}>
      <div className="flex flex-col gap-3">
        <Segmented label="From" value={mode} onChange={setMode} options={[{ value: 'reading_list', label: 'Reading list', icon: Library }, { value: 'pubmed', label: 'PubMed search', icon: Search }, { value: 'file', label: 'RIS or BibTeX file', icon: FileUp }]} />
        {mode === 'reading_list' && <p className="text-[13px] text-[var(--ro-ink-2)]">Every paper on the project's reading list becomes a record to screen. Records already in the review are found as duplicates.</p>}
        {mode === 'pubmed' && (
          <>
            <Field label="PubMed query">
              <textarea autoFocus rows={3} value={query} onChange={(e) => setQuery(e.target.value)} className={cn(textareaCls, 'font-mono text-[12px]')} placeholder='("sleep"[MeSH] OR "slow-wave sleep") AND memory AND adult[MeSH]' />
            </Field>
            <Field label="At most">
              <input value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={cn(inputCls, 'w-28')} />
            </Field>
          </>
        )}
        {mode === 'file' && (
          <>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--ro-r-md)] border-2 border-dashed border-[var(--ro-line)] bg-[var(--ro-card)] p-6 text-center hover:bg-[var(--ro-row)]">
              <FileUp size={20} className="text-[var(--ro-muted)]" />
              <span className="text-[13px] font-semibold">{file ? file.name : 'Choose a .ris, .bib or .nbib file'}</span>
              <input type="file" accept=".ris,.bib,.bibtex,.nbib,.txt,.json" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <Field label="Database it came from">
              <input value={db} onChange={(e) => setDb(e.target.value)} className={inputCls} placeholder="Scopus, Web of Science, Embase" />
            </Field>
          </>
        )}
        <p className="flex items-center gap-1.5 text-[12px] text-[var(--ro-muted)]">
          <GitCompareArrows size={12} /> Duplicates are found by DOI and PubMed ID and counted in the PRISMA flow.
        </p>
      </div>
    </Modal>
  );
}

