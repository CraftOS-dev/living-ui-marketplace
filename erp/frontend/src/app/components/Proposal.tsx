/**
 * Something your AI agent wants to do that changes the books (post a bill,
 * record a payment, adjust stock): what, why, exactly what it posts, and
 * Approve or Reject. Nothing happens until a person with the rights says yes.
 */
import { useState } from 'react';
import { ArrowUpRight, Check, Sparkles, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { ago } from '../lib/dates.ts';
import { money } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { Proposal } from '../lib/types.ts';
import { BooksDetail } from './Books.tsx';
import { statusOf, PROPOSAL_STATUS } from './status.ts';
import { Avatar, Notice, PillButton, StatusPill, TextLink, softArea } from './ui.tsx';

const TARGET_PAGE: Record<string, Page> = {
  documents: 'doc',
  payments: 'payment',
  banks: 'bank',
  journals: 'journal',
  warehouses: 'stock-changes',
  stock_changes: 'stock-change',
  builds: 'build',
  assets: 'assets',
  expense_claims: 'claim',
  payroll_runs: 'payrun',
};

export function openTarget(t: Proposal['target']): (() => void) | null {
  const page = TARGET_PAGE[t.entity];
  if (page === undefined || t.id === '') return null;
  if (page === 'stock-changes' || page === 'assets') return () => navigate(page);
  return () => navigate(page, { id: t.id });
}

export function ProposalCard({ p, onDecided, compact = false }: { p: Proposal; onDecided?: (() => void) | undefined; compact?: boolean | undefined }): React.JSX.Element {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const st = statusOf(PROPOSAL_STATUS, p.status);
  const go = openTarget(p.target);
  const cur = p.preview.currency;

  const decide = async (approve: boolean): Promise<void> => {
    setBusy(approve ? 'approve' : 'reject');
    try {
      await op(approve ? 'proposals.approve' : 'proposals.reject', { proposal: p.id, note: note.trim() === '' ? undefined : note.trim() });
      toast.success(approve ? 'Approved' : 'Rejected');
      setRejecting(false);
      onDecided?.();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={cn('rounded-[22px] bg-[var(--erp-row)] p-4', compact ? '' : '@min-[640px]:p-5')}>
      <div className="flex items-start gap-3">
        <Avatar name="Your AI agent" agent size={36} tone="accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 className="min-w-0 text-[14px] font-bold leading-5">{p.title}</h3>
            <span className="num shrink-0 text-[15px] font-extrabold">{p.amount !== 0 ? money(Math.abs(p.amount), cur) : ''}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--erp-muted)]">
            {ago(p.created)}
            {p.summary !== '' ? ` · ${p.summary}` : ''}
          </p>
        </div>
      </div>
      {p.reason !== '' && (
        <div className="mt-3 flex items-start gap-2 rounded-[16px] bg-[var(--erp-card)] px-3 py-2.5 text-[13px] leading-5">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--erp-ink-2)]" aria-hidden />
          <span>{p.reason}</span>
        </div>
      )}
      {p.preview.warning !== '' && (
        <div className="mt-3">
          <Notice tone="warn">{p.preview.warning}</Notice>
        </div>
      )}
      {p.preview.lines.length > 0 && (
        <div className="mt-3">
          <BooksDetail lines={p.preview.lines} currency={cur} label="What it posts" />
        </div>
      )}
      {p.status !== 'waiting' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--erp-muted)]">
          <StatusPill tone={st.tone} size="sm">
            {st.label}
          </StatusPill>
          {p.decided_by !== '' && <span>by {p.decided_by}</span>}
          {p.decision_note !== '' && <span>· {p.decision_note}</span>}
          {p.error !== '' && <span className="font-semibold text-[var(--erp-red-text)]">{p.error}</span>}
        </div>
      )}
      {rejecting && (
        <div className="mt-3">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Why not" placeholder="Why not (your AI agent reads this)" className={cn(softArea, 'min-h-[60px] bg-[var(--erp-card)]')} autoFocus />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {p.status === 'waiting' && p.can_decide && !rejecting && (
          <>
            <PillButton size="sm" icon={Check} dot loading={busy === 'approve'} onClick={() => void decide(true)}>
              Approve
            </PillButton>
            <PillButton size="sm" variant="light" icon={X} onClick={() => setRejecting(true)}>
              Reject
            </PillButton>
          </>
        )}
        {rejecting && (
          <>
            <PillButton size="sm" variant="danger" loading={busy === 'reject'} onClick={() => void decide(false)}>
              Reject
            </PillButton>
            <PillButton size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Keep it
            </PillButton>
          </>
        )}
        {p.status === 'waiting' && !p.can_decide && <span className="text-[12px] text-[var(--erp-muted)]">Waiting for someone with the rights to approve it</span>}
        <span className="flex-1" />
        <TextLink tone="muted" onClick={() => navigate('proposal', { id: p.id })}>
          Details
        </TextLink>
        {go !== null && (
          <TextLink tone="muted" onClick={go}>
            {p.target.label !== '' ? p.target.label : 'Open'} <ArrowUpRight size={13} aria-hidden />
          </TextLink>
        )}
      </div>
    </article>
  );
}
