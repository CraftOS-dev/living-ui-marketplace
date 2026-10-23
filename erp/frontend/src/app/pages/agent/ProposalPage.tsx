/**
 * One proposal in full, so the person deciding sees exactly what happens
 * before it happens: what your AI agent proposes and why, the exact journal
 * lines, the operation it runs with every parameter in plain words (the raw
 * call one step away), the record it touches, and its decision history.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, Ban, BookOpen, Check, ChevronDown, CircleCheck, CircleX, Code2, History, Sparkles, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { JournalLines } from '../../components/Books.tsx';
import { openTarget } from '../../components/Proposal.tsx';
import { LinesStack } from '../../components/agent/LinesStack.tsx';
import { ENTITY_WORD, humanize, opWords, proposalKind, stamp, valueWords } from '../../components/agent/words.ts';
import { PROPOSAL_STATUS, statusOf } from '../../components/status.ts';
import { ActorPill, Avatar, Card, CardHeader, LoadError, Notice, PageHeader, PageSkeleton, PillButton, StatusPill, TextLink, softArea } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { back, navigate } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';
import type { Me, Proposal } from '../../lib/types.ts';

export function ProposalPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const data = useLive(() => op<Proposal>('proposals.get', { proposal: id }, { quiet: true }), ['proposals'], [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);

  if (id === '') return <LoadError message="No proposal was chosen." />;
  if (data.data === null && data.error !== null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (data.data === null) return <PageSkeleton rows={5} />;
  const p = data.data;
  const st = statusOf(PROPOSAL_STATUS, p.status);
  const cur = p.preview.currency;
  const kind = proposalKind(p.kind);

  const decide = async (approve: boolean): Promise<void> => {
    setBusy(approve ? 'approve' : 'reject');
    try {
      const r = await op<{ proposal: Proposal } | Proposal>(approve ? 'proposals.approve' : 'proposals.reject', { proposal: p.id, note: note.trim() === '' ? undefined : note.trim() });
      toast.success(approve ? 'Approved: it ran as you' : 'Rejected: nothing was posted');
      setNote('');
      setRejecting(false);
      data.set('proposal' in r ? r.proposal : r);
      data.reload();
    } catch {
      data.reload();
    } finally {
      setBusy(null);
    }
  };

  const decision = (
    <DecisionCard p={p} me={me} note={note} setNote={setNote} busy={busy} rejecting={rejecting} setRejecting={setRejecting} onDecide={(a) => void decide(a)} />
  );

  return (
    <div>
      <PageHeader
        back={() => back('proposals')}
        eyebrow={
          <>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
            <span>{kind.one}</span>
            <span aria-hidden>·</span>
            <span>Proposed {ago(p.created)}</span>
          </>
        }
        title={p.title}
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-8">
          <Hero p={p} />
          <div className="@min-[900px]:hidden">{decision}</div>
          <Card delay={2}>
            <CardHeader
              icon={BookOpen}
              title={p.status === 'approved' ? 'What it posted to the books' : 'What it posts to the books'}
              subtitle={p.preview.lines.length === 0 ? undefined : p.status === 'waiting' ? 'The exact journal lines, before anything is posted.' : p.status === 'approved' ? 'The journal lines as they were approved.' : 'What it would have posted. Nothing was posted.'}
            />
            <div className="flex flex-col gap-3">
              {p.preview.warning !== '' && p.preview.warning !== undefined && (
                <Notice tone="warn" icon={AlertTriangle}>
                  {p.preview.warning}
                </Notice>
              )}
              {p.preview.lines.length > 0 ? (
                <>
                  <div className="hidden @min-[640px]:block">
                    <JournalLines lines={p.preview.lines} currency={cur} />
                  </div>
                  <LinesStack lines={p.preview.lines} currency={cur} className="@min-[640px]:hidden" />
                </>
              ) : (
                <p className="text-[13px] text-[var(--erp-muted)]">Nothing is posted to the accounts.</p>
              )}
            </div>
          </Card>
          <Operation p={p} />
        </div>

        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-4">
          <div className="hidden @min-[900px]:block">{decision}</div>
          <TargetCard p={p} />
          <HistoryCard p={p} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero({ p }: { p: Proposal }): React.JSX.Element {
  return (
    <Card tone="dark" delay={1}>
      <div className="flex items-start gap-3">
        <Avatar name="Your AI agent" agent size={40} tone="accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{p.status === 'waiting' ? 'Your AI agent proposes' : 'Your AI agent proposed'}</p>
          <p className="mt-0.5 text-[15px] font-bold leading-[22px]">{p.summary !== '' ? p.summary : p.title}</p>
        </div>
      </div>
      {p.amount !== 0 && (
        <div className="mt-5">
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Amount</p>
          <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(Math.abs(p.amount), p.preview.currency)}</p>
        </div>
      )}
      <div className="mt-5 rounded-[18px] bg-[var(--erp-dark-2)] px-4 py-3">
        <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">
          <Sparkles size={13} aria-hidden className="text-[var(--erp-accent)]" /> Why
        </p>
        <p className="text-[14px] leading-6">{p.reason !== '' ? p.reason : 'Your AI agent gave no reason.'}</p>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- decision */

function DecisionCard({
  p,
  me,
  note,
  setNote,
  busy,
  rejecting,
  setRejecting,
  onDecide,
}: {
  p: Proposal;
  me: Me;
  note: string;
  setNote: (v: string) => void;
  busy: 'approve' | 'reject' | null;
  rejecting: boolean;
  setRejecting: (v: boolean) => void;
  onDecide: (approve: boolean) => void;
}): React.JSX.Element {
  const cur = p.preview.currency;
  const overLimit = me.approval_limit > 0 && Math.abs(p.amount) > me.approval_limit && cur === me.company.currency;

  if (p.status === 'waiting') {
    return (
      <Card delay={1} tone="sand">
        <CardHeader title="Your decision" subtitle={p.can_decide ? 'Approving runs it now, as you, exactly as shown.' : undefined} />
        {!p.can_decide ? (
          <p className="text-[13px] leading-5 text-[var(--erp-ink-2)]">Waiting for someone with the rights to do this themselves. Your role cannot approve it.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {overLimit && (
              <Notice tone="warn" icon={AlertTriangle}>
                This is over your approval limit of {money(me.approval_limit, me.company.currency)}. Someone with a higher limit approves it.
              </Notice>
            )}
            <label className="flex flex-col gap-2">
              <span className="px-1 text-[13px] font-semibold text-[var(--erp-ink-2)]">
                {rejecting ? 'Why not' : 'Note'} <span className="font-medium text-[var(--erp-muted)]">({rejecting ? 'your AI agent reads this' : 'optional'})</span>
              </span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={rejecting ? 'Why not' : 'Note'} className={cn(softArea, 'min-h-[72px] bg-[var(--erp-card)]')} autoFocus={rejecting} />
            </label>
            <div className="flex flex-wrap gap-2">
              {rejecting ? (
                <>
                  <PillButton variant="danger" icon={X} loading={busy === 'reject'} onClick={() => onDecide(false)}>
                    Reject
                  </PillButton>
                  <PillButton variant="ghost" onClick={() => setRejecting(false)}>
                    Keep it
                  </PillButton>
                </>
              ) : (
                <>
                  {!overLimit && (
                    <PillButton icon={Check} dot loading={busy === 'approve'} onClick={() => onDecide(true)}>
                      Approve
                    </PillButton>
                  )}
                  <PillButton variant="light" icon={X} onClick={() => setRejecting(true)}>
                    Reject
                  </PillButton>
                </>
              )}
            </div>
          </div>
        )}
      </Card>
    );
  }

  const tone = p.status === 'approved' ? 'good' : p.status === 'failed' ? 'bad' : 'neutral';
  const Icon = p.status === 'approved' ? CircleCheck : p.status === 'failed' ? CircleX : Ban;
  const go = openTarget(p.target);
  return (
    <Card delay={1}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            tone === 'good' && 'bg-[var(--erp-green)]/15 text-[var(--erp-green-text)]',
            tone === 'bad' && 'bg-[var(--erp-red)]/15 text-[var(--erp-red-text)]',
            tone === 'neutral' && 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
          )}
        >
          <Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold">{statusOf(PROPOSAL_STATUS, p.status).label}</p>
          <p className="text-[13px] text-[var(--erp-muted)]">
            {p.decided_by !== '' ? `By ${p.decided_by}` : p.status === 'rejected' ? 'Taken back by your AI agent' : ''}
            {p.decided_at !== '' ? `${p.decided_by !== '' || p.status === 'rejected' ? ', ' : ''}${stamp(p.decided_at)}` : ''}
          </p>
        </div>
      </div>
      {p.decision_note !== '' && <p className="mt-4 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-[13px] leading-5">{p.decision_note}</p>}
      {p.status === 'failed' && p.error !== '' && (
        <div className="mt-4">
          <Notice tone="bad" icon={AlertTriangle}>
            {p.error}
          </Notice>
          <p className="mt-2 text-[12px] text-[var(--erp-muted)]">Nothing was posted. Your AI agent sees this and can propose it again.</p>
        </div>
      )}
      {p.status === 'approved' && go !== null && (
        <PillButton className="mt-4" size="sm" variant="soft" icon={ArrowUpRight} onClick={go}>
          {resultNumber(p) !== '' ? `Open ${resultNumber(p)}` : `Open the ${ENTITY_WORD[p.target.entity] ?? 'record'}`}
        </PillButton>
      )}
    </Card>
  );
}

/** The number of what an approved proposal made or posted ("BILL-00015"), when it says. */
function resultNumber(p: Proposal): string {
  const r = p.result;
  if (r !== null && typeof r === 'object' && 'number' in r && typeof (r as { number?: unknown }).number === 'string') return (r as { number: string }).number;
  return '';
}

/* ------------------------------------------------------------- operation */

function Operation({ p }: { p: Proposal }): React.JSX.Element {
  const [raw, setRaw] = useState(false);
  const words = opWords(p.op);
  const keys = [...Object.keys(words.params).filter((k) => k in p.params), ...Object.keys(p.params).filter((k) => !(k in words.params))];
  const go = openTarget(p.target);
  const valueOf = (k: string): ReactNode => {
    const v = p.params[k];
    // The record the proposal is about reads by its name, and opens.
    if (typeof v === 'string' && (v === p.target.id || (k === 'line' && p.target.entity === 'banks')) && p.target.label !== '') {
      return go !== null ? (
        <TextLink onClick={go}>
          {p.target.label} <ArrowUpRight size={13} aria-hidden />
        </TextLink>
      ) : (
        p.target.label
      );
    }
    const lines = valueWords(k, v);
    if (lines.length === 1) return lines[0];
    return (
      <ul className="flex flex-col gap-1">
        {lines.map((l, i) => (
          <li key={i} className="num">
            {l}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <Card delay={3}>
      <CardHeader icon={Code2} title="How it runs" subtitle={p.status === 'waiting' ? 'The operation approving runs, with everything it is given.' : p.status === 'approved' ? 'The operation that ran, with everything it was given.' : 'The operation it asked to run.'} />
      <div className="rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
        <p className="text-[14px] font-bold">{words.label}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--erp-ink-2)]">{words.text}</p>
      </div>
      {keys.length > 0 && (
        <dl className="mt-4 flex flex-col">
          {keys.map((k) => (
            <div key={k} className="grid grid-cols-1 gap-1 border-b border-[var(--erp-line)] py-3 last:border-b-0 @min-[480px]:grid-cols-[180px_minmax(0,1fr)] @min-[480px]:gap-4">
              <dt className="text-[13px] font-semibold text-[var(--erp-muted)]">{words.params[k] ?? humanize(k)}</dt>
              <dd className="min-w-0 break-words text-[14px]">{valueOf(k)}</dd>
            </div>
          ))}
        </dl>
      )}
      <button type="button" onClick={() => setRaw((r) => !r)} aria-expanded={raw} className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
        {raw ? 'Hide details' : 'Show details'}
        <ChevronDown size={14} aria-hidden className={cn('transition-transform', raw && 'rotate-180')} />
      </button>
      {raw && (
        <pre className="num mt-3 max-h-80 overflow-auto rounded-[18px] bg-[var(--erp-row)] p-4 text-[12px] leading-5 text-[var(--erp-ink-2)]">
          {JSON.stringify({ operation: p.op, params: p.params }, null, 2)}
        </pre>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- target */

function TargetCard({ p }: { p: Proposal }): React.JSX.Element | null {
  const go = openTarget(p.target);
  if (p.target.entity === '' && p.target.label === '') return null;
  const word = ENTITY_WORD[p.target.entity] ?? 'record';
  return (
    <Card delay={2}>
      <p className="text-[12px] font-semibold text-[var(--erp-muted)]">It touches this {word}</p>
      {go !== null ? (
        <button type="button" onClick={go} className="mt-2 flex w-full items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-left transition-colors hover:bg-[var(--erp-row-hover)]">
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{p.target.label !== '' ? p.target.label : `Open the ${word}`}</span>
          <ArrowUpRight size={16} aria-hidden className="shrink-0" />
        </button>
      ) : (
        <p className="mt-2 text-[14px] font-bold">{p.target.label}</p>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- history */

function HistoryCard({ p }: { p: Proposal }): React.JSX.Element {
  const steps: { key: string; icon: ReactNode; title: ReactNode; sub: string; body?: string | undefined; tone?: 'bad' | undefined }[] = [
    {
      key: 'proposed',
      icon: <Avatar name="Your AI agent" agent size={30} tone="accent" />,
      title: <ActorPill actor="agent" />,
      sub: `Proposed it, ${stamp(p.created)}`,
    },
  ];
  if (p.status !== 'waiting') {
    const word = p.status === 'approved' ? 'Approved' : p.status === 'failed' ? 'Approved, but it could not run' : p.decided_by === '' ? 'Withdrew it' : 'Rejected';
    steps.push({
      key: 'decided',
      icon: p.decided_by === '' && p.status === 'rejected' ? <Avatar name="Your AI agent" agent size={30} tone="accent" /> : <Avatar name={p.decided_by !== '' ? p.decided_by : '?'} size={30} tone="ink" />,
      title: p.decided_by !== '' ? <span className="text-[13px] font-bold">{p.decided_by}</span> : <ActorPill actor="agent" />,
      sub: `${word}${p.decided_at !== '' ? `, ${stamp(p.decided_at)}` : ''}`,
      body: p.status === 'failed' ? p.error : undefined,
      tone: p.status === 'failed' ? 'bad' : undefined,
    });
  } else {
    steps.push({
      key: 'waiting',
      icon: (
        <span className="flex size-[30px] items-center justify-center rounded-full bg-[var(--erp-amber)]/25 text-[var(--erp-amber-text)]">
          <History size={14} aria-hidden />
        </span>
      ),
      title: <span className="text-[13px] font-bold">Waiting for a decision</span>,
      sub: 'Nothing is posted until then',
    });
  }
  return (
    <Card delay={3}>
      <CardHeader title="History" />
      <ol className="flex flex-col gap-4">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3">
            {s.icon}
            <div className="min-w-0 flex-1">
              <div>{s.title}</div>
              <p className="mt-0.5 text-[12px] text-[var(--erp-muted)]">{s.sub}</p>
              {s.body !== undefined && s.body !== '' && (
                <p className={cn('mt-1.5 rounded-[14px] bg-[var(--erp-row)] px-3 py-2 text-[13px] leading-5', s.tone === 'bad' && 'text-[var(--erp-red-text)]')}>{s.body}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <TextLink tone="muted" className="mt-4" onClick={() => navigate('agent-activity')}>
        Everything your AI agent did <ArrowUpRight size={13} aria-hidden />
      </TextLink>
    </Card>
  );
}
