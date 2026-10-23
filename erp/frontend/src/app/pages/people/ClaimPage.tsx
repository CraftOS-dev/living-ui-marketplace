/**
 * One expense claim: its expenses with their receipts, where it stands
 * (drafted, submitted, approved or rejected, posted, paid back), the action
 * its state allows for the viewer, what it posted to the books, and the
 * record's history.
 */
import { useRef, useState } from 'react';
import { BookCheck, Camera, Check, ExternalLink, FileText, FolderKanban, Pencil, Send, Trash2, Wallet, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { BooksDetail, ConfirmPosting } from '../../components/Books.tsx';
import { Menu } from '../../components/controls.tsx';
import { useFullScreen } from '../../components/FullScreen.tsx';
import { ClaimEditor } from '../../components/people/ClaimEditor.tsx';
import { CLAIM_STATE, PersonAvatar, entryLines, useReceipt } from '../../components/people/common.tsx';
import { BankPicker } from '../../components/pickers.tsx';
import type { Option } from '../../components/pickers.tsx';
import { ActorPill, Card, CardHeader, Field, LoadError, Modal, PageHeader, PageSkeleton, PillButton, StatusPill, TextLink, softArea, useConfirm } from '../../components/ui.tsx';
import { download, op, opForm } from '../../lib/api.ts';
import { ago, dayLabel, today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { ClaimDetail, ClaimLine } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

function ReceiptThumb({ line, onView }: { line: ClaimLine; onView: (url: string) => void }): React.JSX.Element {
  const r = useReceipt(line.receipt !== null ? line.id : null);
  if (line.receipt === null) {
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-[16px] border-2 border-dashed border-[var(--erp-line)] text-[var(--erp-muted)]" title="No receipt">
        <FileText size={18} aria-hidden />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => (r.image && r.url !== null ? onView(r.url) : void download('claims.receipt', { line: line.id }, 'open', line.receipt?.name ?? 'receipt'))}
      aria-label={`Open the receipt for ${line.description !== '' ? line.description : 'this expense'}`}
      className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[var(--erp-row)] transition-transform hover:scale-[1.03]"
    >
      {r.image && r.url !== null ? <img src={r.url} alt="" className="size-full object-cover" /> : <FileText size={18} aria-hidden />}
    </button>
  );
}

function AddReceipt({ claimId, lineId, onDone }: { claimId: string; lineId: string; onDone: (c: ClaimDetail) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PillButton size="sm" variant="soft" icon={Camera} loading={busy} onClick={() => input.current?.click()}>
        Add receipt
      </PillButton>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f === undefined) return;
          setBusy(true);
          opForm<ClaimDetail>('claims.add-receipt', { claim: claimId, line: lineId }, { file: f })
            .then((c) => {
              toast.success('Receipt added');
              onDone(c);
            })
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

interface Step {
  key: string;
  label: string;
  detail: string;
  state: 'done' | 'now' | 'todo' | 'bad';
}

function steps(c: ClaimDetail): Step[] {
  const order = ['draft', 'submitted', 'approved', 'posted', 'paid'];
  const at = c.status === 'rejected' ? 1 : order.indexOf(c.status);
  const st = (i: number): Step['state'] => (i <= at ? 'done' : i === at + 1 ? 'now' : 'todo');
  const decided = [c.decided_by, c.decision_note].filter((x) => x !== '').join(': ');
  return [
    { key: 'draft', label: 'Drafted', detail: `${c.prepared_by !== '' ? `${c.prepared_by}, ` : ''}${ago(c.created)}`, state: 'done' },
    { key: 'submitted', label: at >= 1 ? 'Submitted' : 'Submit for approval', detail: '', state: st(1) },
    c.status === 'rejected'
      ? { key: 'decided', label: 'Rejected', detail: decided, state: 'bad' }
      : { key: 'decided', label: at >= 2 ? 'Approved' : 'Manager approves', detail: at >= 2 ? decided : '', state: st(2) },
    { key: 'posted', label: at >= 3 ? 'Posted to the books' : 'Post to the books', detail: c.journal !== null ? `${c.journal.number}, ${dayLabel(c.journal.date)}` : '', state: c.status === 'rejected' ? 'todo' : st(3) },
    { key: 'paid', label: at >= 4 ? 'Paid back' : 'Pay back', detail: c.paid_on !== '' ? `${dayLabel(c.paid_on)}${c.bank !== null ? `, from ${c.bank.name}` : ''}` : '', state: c.status === 'rejected' ? 'todo' : st(4) },
  ];
}

function Timeline({ c }: { c: ClaimDetail }): React.JSX.Element {
  const list = steps(c);
  return (
    <ol className="flex flex-col">
      {list.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < list.length - 1 && <span aria-hidden className={cn('absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5', s.state === 'done' ? 'bg-[var(--erp-ink)]' : 'bg-[var(--erp-line)]')} />}
          <span
            className={cn(
              'relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full',
              s.state === 'done' && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]',
              s.state === 'now' && 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]',
              s.state === 'todo' && 'bg-[var(--erp-row)] text-[var(--erp-muted)]',
              s.state === 'bad' && 'bg-[var(--erp-red)] text-[var(--erp-on-red)]',
            )}
          >
            {s.state === 'done' ? <Check size={13} strokeWidth={3} aria-hidden /> : s.state === 'bad' ? <X size={13} strokeWidth={3} aria-hidden /> : <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className={cn('text-[13px] font-bold leading-5', s.state === 'todo' && 'text-[var(--erp-muted)]')}>{s.label}</p>
            {s.detail !== '' && <p className="text-[12px] text-[var(--erp-muted)]">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ClaimPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = query.get('id') ?? '';
  const live = useLive(() => op<ClaimDetail>('claims.get', { claim: id }, { quiet: true }), ['expense_claims', 'claim_lines', 'journals', 'attachments'], [id]);
  const fs = useFullScreen();
  const [confirmEl, confirm] = useConfirm();
  const [view, setView] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [bank, setBank] = useState<Option | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useSection('claim', 'claims');
  const c = live.data;

  if (c === null) {
    return live.error !== null ? (
      <div>
        <PageHeader title="Expense claim" back={() => back('claims')} />
        <LoadError message={live.error} onRetry={live.reload} />
      </div>
    ) : (
      <PageSkeleton />
    );
  }

  const st = CLAIM_STATE[c.status];
  const run = async (what: 'submit' | 'approve' | 'reject' | 'delete'): Promise<void> => {
    setBusy(what);
    try {
      if (what === 'submit') {
        live.set(await op<ClaimDetail>('claims.submit', { claim: c.id }));
        toast.success('Sent for approval');
      } else if (what === 'approve' || what === 'reject') {
        live.set(await op<ClaimDetail>('claims.decide', { claim: c.id, approve: what === 'approve', note: note.trim() === '' ? undefined : note.trim() }));
        toast.success(what === 'approve' ? 'Approved' : 'Rejected');
        setRejecting(false);
      } else {
        if (!(await confirm(`${c.number} "${c.title}" and its receipts are deleted.`, 'Delete this draft?'))) return;
        await op('claims.delete', { claim: c.id });
        toast.success('Deleted');
        navigate('claims');
      }
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };
  const isMine = me.employee !== null && c.employee?.id === me.employee.id;
  const primary = c.can.submit ? 'submit' : c.can.decide ? 'decide' : c.can.post ? 'post' : c.can.pay ? 'pay' : null;

  return (
    <div>
      <PageHeader
        back={() => back('claims')}
        eyebrow={
          <>
            <span className="num">{c.number}</span>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
            {c.actor === 'agent' && <ActorPill actor="agent" />}
          </>
        }
        title={c.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {c.employee !== null && (
              <TextLink tone="muted" onClick={() => navigate('employee', { id: c.employee?.id ?? '' })}>
                {isMine ? 'You' : c.employee.name}
              </TextLink>
            )}
            <span>· {dayLabel(c.date)}</span>
            {c.project !== null && (
              <TextLink tone="muted" onClick={() => navigate('project', { id: c.project?.id ?? '' })}>
                <FolderKanban size={13} aria-hidden /> {c.project.name}
              </TextLink>
            )}
          </span>
        }
        actions={
          <>
            {c.can.edit && (
              <PillButton variant="light" icon={Pencil} onClick={(e) => fs.open(e.currentTarget)}>
                Edit
              </PillButton>
            )}
            {c.can.decide && !rejecting && (
              <PillButton variant="light" icon={X} onClick={() => setRejecting(true)}>
                Reject
              </PillButton>
            )}
            {primary === 'submit' && (
              <PillButton icon={Send} dot loading={busy === 'submit'} onClick={() => void run('submit')}>
                Submit for approval
              </PillButton>
            )}
            {primary === 'decide' && !rejecting && (
              <PillButton icon={Check} dot loading={busy === 'approve'} onClick={() => void run('approve')}>
                Approve
              </PillButton>
            )}
            {primary === 'post' && (
              <PillButton icon={BookCheck} dot onClick={() => setPosting(true)}>
                Post to the books
              </PillButton>
            )}
            {primary === 'pay' && (
              <PillButton icon={Wallet} dot onClick={() => setPaying(true)}>
                Pay back
              </PillButton>
            )}
            <Menu items={[{ label: 'Delete draft', icon: Trash2, danger: true, hidden: !c.can.delete, onClick: () => void run('delete') }]} />
          </>
        }
      />

      {rejecting && (
        <Card tone="sand" className="mb-5">
          <CardHeader title={`Reject ${c.number}`} subtitle={`${(c.employee?.name ?? '').split(' ')[0] ?? ''} can change it and submit again`} />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus aria-label="Why not" placeholder="Why not" className={cn(softArea, 'bg-[var(--erp-card)]')} />
          <div className="mt-3 flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setRejecting(false)}>
              Keep it
            </PillButton>
            <PillButton variant="danger" loading={busy === 'reject'} onClick={() => void run('reject')}>
              Reject
            </PillButton>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
          <Card delay={1}>
            <CardHeader title="Expenses" subtitle={`${c.lines.length} ${c.lines.length === 1 ? 'line' : 'lines'}, ${c.receipts} with ${c.receipts === 1 ? 'a receipt' : 'receipts'}`} />
            <ul className="flex flex-col gap-2">
              {c.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-[20px] bg-[var(--erp-row)] p-2.5 pr-4 @min-[480px]:flex-nowrap">
                  <ReceiptThumb line={l} onView={setView} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold">{l.description !== '' ? l.description : (l.account?.name ?? 'Expense')}</p>
                    <p className="truncate text-[12px] text-[var(--erp-muted)]">
                      {[l.account !== null ? `${l.account.code} ${l.account.name}` : '', dayLabel(l.date), l.project?.name ?? ''].filter((x) => x !== '').join(' · ')}
                    </p>
                    {l.tax !== null && l.tax_amount > 0 && (
                      <p className="text-[12px] text-[var(--erp-muted)]">
                        Includes {money(l.tax_amount, c.currency)} {l.tax.name}
                      </p>
                    )}
                  </div>
                  {l.receipt === null && c.can.add_receipt && c.status !== 'paid' && <AddReceipt claimId={c.id} lineId={l.id} onDone={live.set} />}
                  <span className="num shrink-0 text-[15px] font-extrabold">{money(l.amount, c.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col items-end gap-1 border-t border-[var(--erp-line)] pt-4 text-[13px]">
              {c.tax > 0 && (
                <span className="flex gap-6 text-[var(--erp-ink-2)]">
                  Tax included <span className="num w-28 text-right">{money(c.tax, c.currency)}</span>
                </span>
              )}
              <span className="flex items-baseline gap-6 font-bold">
                Total <span className="num w-28 text-right text-[15px] font-extrabold">{money(c.total, c.currency)}</span>
              </span>
            </div>
          </Card>
          {(c.entry !== undefined || c.pay_entry !== undefined) && (
            <Card delay={2}>
              <CardHeader title="In the books" />
              <div className="flex flex-col gap-4">
                {c.entry !== undefined && (
                  <div>
                    <p className="mb-2 text-[13px]">
                      Posted as{' '}
                      <TextLink onClick={() => navigate('journal', { id: c.entry?.id ?? '' })}>
                        {c.entry.number} <ExternalLink size={12} aria-hidden />
                      </TextLink>{' '}
                      on {dayLabel(c.entry.date)}
                    </p>
                    <BooksDetail lines={entryLines(c.entry)} currency={c.currency} label="What it posted" />
                  </div>
                )}
                {c.pay_entry !== undefined && (
                  <div>
                    <p className="mb-2 text-[13px]">
                      Paid back as{' '}
                      <TextLink onClick={() => navigate('journal', { id: c.pay_entry?.id ?? '' })}>
                        {c.pay_entry.number} <ExternalLink size={12} aria-hidden />
                      </TextLink>{' '}
                      on {dayLabel(c.pay_entry.date)}
                    </p>
                    <BooksDetail lines={entryLines(c.pay_entry)} currency={c.currency} label="What the payment posted" />
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          <Card tone="dark" delay={1}>
            <p className="text-[13px] text-[var(--erp-on-dark-muted)]">{c.status === 'paid' ? 'Paid back' : c.status === 'rejected' ? 'Claimed, rejected' : isMine ? 'You are owed' : `Owed to ${(c.employee?.name ?? '').split(' ')[0] ?? ''}`}</p>
            <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(c.total, c.currency)}</p>
            {c.tax > 0 && <p className="num mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">including {money(c.tax, c.currency)} tax</p>}
          </Card>
          <Card delay={2}>
            <CardHeader title="Where it stands" />
            <Timeline c={c} />
          </Card>
          {c.employee !== null && (
            <Card delay={3}>
              <button type="button" onClick={() => navigate('employee', { id: c.employee?.id ?? '' })} className="flex w-full items-center gap-3 text-left">
                <PersonAvatar name={c.employee.name} photo={c.employee.photo} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{c.employee.name}</span>
                  <span className="block truncate text-[12px] text-[var(--erp-muted)]">{[c.employee.job_title, c.employee.department?.name ?? ''].filter((x) => x !== '').join(' · ')}</span>
                </span>
              </button>
            </Card>
          )}
          <RecordActivity entity="expense_claims" refId={c.id} />
        </div>
      </div>

      <Modal open={view !== null} onClose={() => setView(null)} title="Receipt" size="lg">
        {view !== null && <img src={view} alt="Receipt" className="mx-auto max-h-[70vh] rounded-[18px] object-contain" />}
      </Modal>
      {posting && (
        <ConfirmPosting
          open
          onClose={() => setPosting(false)}
          title={`Post ${c.number}`}
          verb="Post to the books"
          previewOp="claims.preview-post"
          runOp="claims.post"
          params={{ claim: c.id }}
          onDone={(r) => {
            live.set(r as ClaimDetail);
            toast.success('Posted');
          }}
        />
      )}
      {paying && (
        <ConfirmPosting
          open
          onClose={() => setPaying(false)}
          title={`Pay back ${c.number}`}
          verb={`Pay ${money(c.total, c.currency)}`}
          previewOp="claims.preview-pay"
          runOp="claims.pay"
          params={{ claim: c.id, bank: bank?.id ?? undefined }}
          withDate
          defaultDate={today()}
          intro={
            <Field label="Pay from">
              <BankPicker value={bank} onChange={setBank} currency={c.currency} placeholder="The default bank account" clearable />
            </Field>
          }
          onDone={() => {
            live.reload();
            toast.success('Paid back');
          }}
        />
      )}
      {fs.node(
        <ClaimEditor
          claim={c}
          currency={c.currency}
          onClose={fs.close}
          onSaved={() => {
            fs.close();
            live.reload();
          }}
        />,
        { title: `Edit ${c.number}` },
      )}
      {confirmEl}
    </div>
  );
}
