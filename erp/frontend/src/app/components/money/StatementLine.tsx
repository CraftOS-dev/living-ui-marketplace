/**
 * One statement line to reconcile, as a row card: when, what the bank
 * wrote, how much; on the right the best match the app found (a payment or
 * entry of the same amount, or an open invoice or bill) with a one-tap
 * Match; your AI agent's proposal when it made one; and the other ways to
 * settle it: record a payment, book it to an account, a transfer, or
 * ignore it.
 */
import { useEffect, useState } from 'react';
import { ArrowLeftRight, BookOpen, Check, EyeOff, FileText, Link2, MoreHorizontal, RotateCcw, Sparkles, Trash2, Unlink, Wallet } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { ago, dayLabel } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Proposal } from '../../lib/types.ts';
import type { Bank, BankLine, Suggest, Suggestion } from '../../lib/types/money.ts';
import { BooksDetail } from '../Books.tsx';
import { MenuRow, Popover, PillButton, Skeleton, TextLink, useConfirm } from '../ui.tsx';
import { Signed } from './bits.tsx';

export type LineAction = 'payment' | 'book' | 'transfer';

function DayBlock({ day }: { day: string }): React.JSX.Element {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return (
    <span className="flex w-12 shrink-0 flex-col items-center rounded-[14px] bg-[var(--erp-card)] py-1.5" aria-label={dayLabel(day)}>
      <span className="text-[12px] font-semibold uppercase text-[var(--erp-muted)]">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
      <span className="num text-[15px] font-extrabold leading-5">{d.getDate()}</span>
    </span>
  );
}

function suggestionText(s: Suggestion): string {
  if (s.kind === 'invoice') return `Pays ${s.label}${s.party !== '' ? `, ${s.party}` : ''}`;
  if (s.kind === 'bill') return `Pays ${s.label}${s.party !== '' ? `, ${s.party}` : ''}`;
  return `Matches ${s.label}${s.party !== '' ? `, ${s.party}` : ''}`;
}

export function LineCard({
  line,
  bank,
  canEdit,
  canPost,
  proposal,
  onAction,
  onChanged,
}: {
  line: BankLine;
  bank: Bank;
  canEdit: boolean;
  canPost: boolean;
  proposal?: Proposal | undefined;
  onAction: (a: LineAction, line: BankLine, s?: Suggestion | undefined) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [sug, setSug] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    let live = true;
    op<Suggest>('bank.suggest', { line: line.id }, { quiet: true })
      .then((r) => {
        if (live) setSug(r.suggestions);
      })
      .catch(() => {
        if (live) setSug([]);
      });
    return () => {
      live = false;
    };
  }, [line.id]);

  const best = sug !== null && sug.length > 0 ? sug[0] : undefined;
  const incoming = line.amount > 0;

  const match = async (s: Suggestion): Promise<void> => {
    if (s.kind === 'invoice' || s.kind === 'bill') {
      onAction('payment', line, s);
      return;
    }
    setBusy('match');
    try {
      await op('bank.match', { line: line.id, ...(s.kind === 'payment' ? { payment: s.id } : { journal: s.id }) });
      toast.success('Matched');
      onChanged();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  const ignore = async (): Promise<void> => {
    setBusy('ignore');
    try {
      await op('bank.ignore', { line: line.id, ignore: true });
      toast.success('Ignored. It is under Ignored if you need it back.');
      onChanged();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    setMenu(false);
    const ok = await confirm('The line is removed from this account. Lines from an import come back if the same statement is imported again.', 'Delete this line?');
    if (!ok) return;
    try {
      await op('bank.delete-line', { line: line.id });
      toast.success('Line deleted');
      onChanged();
    } catch {
      /* shown */
    }
  };

  const decide = async (approve: boolean): Promise<void> => {
    if (proposal === undefined) return;
    setBusy(approve ? 'approve' : 'reject');
    try {
      await op(approve ? 'proposals.approve' : 'proposals.reject', { proposal: proposal.id });
      toast.success(approve ? 'Approved' : 'Rejected');
      setRejecting(false);
      onChanged();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="erp-rise rounded-[22px] bg-[var(--erp-row)] p-3 @min-[640px]:p-4">
      <div className="grid grid-cols-1 gap-3 @min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] @min-[900px]:items-center @min-[900px]:gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <DayBlock day={line.date} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{line.description !== '' ? line.description : 'No description'}</span>
            <span className="block truncate text-[12px] text-[var(--erp-muted)]">
              {incoming ? 'Money in' : 'Money out'}
              {line.reference !== '' ? ` · ${line.reference}` : ''}
            </span>
          </span>
          <Signed minor={line.amount} currency={bank.currency} className="shrink-0 text-[15px]" />
        </div>

        {proposal !== undefined ? (
          <div className="flex min-w-0 flex-col gap-2 rounded-[18px] bg-[var(--erp-card)] px-3 py-2.5 ring-2 ring-inset ring-[var(--erp-accent)]">
            <div className="flex min-w-0 items-start gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--erp-accent)] text-[var(--erp-on-accent)]">
                <Sparkles size={13} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold">{proposal.title}</span>
                {proposal.reason !== '' && <span className="block text-[12px] leading-5 text-[var(--erp-ink-2)]">{proposal.reason}</span>}
              </span>
            </div>
            {proposal.preview.lines.length > 0 && <BooksDetail lines={proposal.preview.lines} currency={proposal.preview.currency} label="What it posts" />}
            {proposal.can_decide && (
              <div className="flex flex-wrap items-center gap-2">
                {!rejecting ? (
                  <>
                    <PillButton size="sm" icon={Check} dot loading={busy === 'approve'} onClick={() => void decide(true)}>
                      Approve
                    </PillButton>
                    <PillButton size="sm" variant="light" onClick={() => setRejecting(true)}>
                      Not this
                    </PillButton>
                  </>
                ) : (
                  <>
                    <PillButton size="sm" variant="danger" loading={busy === 'reject'} onClick={() => void decide(false)}>
                      Reject the proposal
                    </PillButton>
                    <PillButton size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                      Keep it
                    </PillButton>
                  </>
                )}
              </div>
            )}
          </div>
        ) : sug === null ? (
          <Skeleton className="h-12" />
        ) : best !== undefined ? (
          <div className="flex min-w-0 items-center gap-3 rounded-[18px] bg-[var(--erp-card)] px-3 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--erp-accent-soft)]">
              {best.kind === 'invoice' || best.kind === 'bill' ? <FileText size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold">{suggestionText(best)}</span>
              <span className="block truncate text-[12px] text-[var(--erp-muted)]">{best.why}</span>
            </span>
            {canEdit && (best.kind === 'payment' || best.kind === 'journal' || canPost) && (
              <PillButton size="sm" icon={Check} dot loading={busy === 'match'} onClick={() => void match(best)}>
                {best.kind === 'invoice' || best.kind === 'bill' ? 'Record' : 'Match'}
              </PillButton>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-3 rounded-[18px] border border-dashed border-[var(--erp-line)] px-3 py-2.5">
            <span className="min-w-0 flex-1 text-[13px] text-[var(--erp-muted)]">No match in the books yet</span>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 @min-[900px]:pl-[60px]">
          {canPost && (
            <LineButton icon={Wallet} onClick={() => onAction('payment', line)}>
              {incoming ? 'From a customer' : 'To a supplier'}
            </LineButton>
          )}
          {canPost && (
            <LineButton icon={BookOpen} onClick={() => onAction('book', line)}>
              {incoming ? 'Book as income' : 'Book as an expense'}
            </LineButton>
          )}
          {canPost && (
            <LineButton icon={ArrowLeftRight} onClick={() => onAction('transfer', line)}>
              Transfer
            </LineButton>
          )}
          <LineButton icon={EyeOff} onClick={() => void ignore()} busy={busy === 'ignore'}>
            Ignore
          </LineButton>
          {sug !== null && sug.length > 1 && (
            <span className="relative">
              <LineButton icon={MoreHorizontal} onClick={() => setMenu((m) => !m)}>
                {sug.length - 1} other {sug.length - 1 === 1 ? 'match' : 'matches'}
              </LineButton>
              <Popover open={menu} onClose={() => setMenu(false)} className="w-80">
                <div role="menu">
                  {sug.slice(1).map((s) => (
                    <MenuRow key={`${s.kind}-${s.id}`} icon={s.kind === 'invoice' || s.kind === 'bill' ? FileText : Link2} label={suggestionText(s)} hint={money(s.amount, bank.currency)} onClick={() => {
                      setMenu(false);
                      void match(s);
                    }} />
                  ))}
                  <MenuRow icon={Trash2} label="Delete the line" danger onClick={() => void remove()} />
                </div>
              </Popover>
            </span>
          )}
          {(sug === null || sug.length <= 1) && (
            <button type="button" onClick={() => void remove()} aria-label="Delete the line" title="Delete the line" className="ml-auto flex size-8 items-center justify-center rounded-full text-[var(--erp-muted)] hover:bg-[var(--erp-card)] hover:text-[var(--erp-red-text)]">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      {confirmEl}
    </li>
  );
}

function LineButton({ icon: Icon, children, onClick, busy = false }: { icon: typeof Wallet; children: React.ReactNode; onClick: () => void; busy?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--erp-card)] px-3 text-[12px] font-semibold text-[var(--erp-ink-2)] transition-colors hover:text-[var(--erp-ink)] disabled:opacity-50"
    >
      <Icon size={13} aria-hidden />
      {children}
    </button>
  );
}

/** A matched line: what it matched, who matched it, and Unmatch. */
export function MatchedRow({ line, bank, canEdit, onChanged }: { line: BankLine; bank: Bank; canEdit: boolean; onChanged: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const unmatch = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('bank.unmatch', { line: line.id });
      toast.success('Unmatched. The payment or entry stays in the books.');
      onChanged();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };
  const m = line.match;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5">
      <DayBlock day={line.date} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold">{line.description !== '' ? line.description : 'No description'}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] text-[var(--erp-muted)]">
          {m !== null ? (
            <TextLink tone="muted" onClick={() => navigate(m.kind === 'payment' ? 'payment' : 'journal', { id: m.id })} className="text-[12px]">
              <Link2 size={12} aria-hidden /> {m.label}
              {m.party !== '' ? `, ${m.party}` : ''}
            </TextLink>
          ) : (
            'Matched'
          )}
          {line.matched_by !== '' && <span>by {line.matched_by}</span>}
          {line.matched_at !== '' && <span>{ago(line.matched_at)}</span>}
        </span>
      </span>
      <Signed minor={line.amount} currency={bank.currency} className="text-[14px]" />
      {canEdit && (
        <button type="button" onClick={() => void unmatch()} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--erp-card)] px-3 text-[12px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)] disabled:opacity-50">
          <Unlink size={13} aria-hidden /> Unmatch
        </button>
      )}
    </li>
  );
}

/** An ignored line, with Bring back. */
export function IgnoredRow({ line, bank, canEdit, onChanged }: { line: BankLine; bank: Bank; canEdit: boolean; onChanged: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const restore = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('bank.ignore', { line: line.id, ignore: false });
      toast.success('Back in To reconcile');
      onChanged();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5">
      <DayBlock day={line.date} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-[var(--erp-ink-2)]">{line.description !== '' ? line.description : 'No description'}</span>
        <span className="block text-[12px] text-[var(--erp-muted)]">Ignored{line.reference !== '' ? ` · ${line.reference}` : ''}</span>
      </span>
      <Signed minor={line.amount} currency={bank.currency} className="text-[14px]" muted />
      {canEdit && (
        <button type="button" onClick={() => void restore()} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--erp-card)] px-3 text-[12px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)] disabled:opacity-50">
          <RotateCcw size={13} aria-hidden /> Bring back
        </button>
      )}
    </li>
  );
}

