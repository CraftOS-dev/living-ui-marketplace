/**
 * One pay run: what it costs (net pay, gross, deductions, employer
 * contributions), every payslip (searchable and paged for big companies;
 * adjustable while the run is a draft), and the run's steps: recompute,
 * approve, post and pay, each previewed before it touches the books.
 */
import { useEffect, useState } from 'react';
import { BookCheck, Check, Coins, Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { BooksDetail, ConfirmPosting } from '../../components/Books.tsx';
import { SplitBar } from '../../components/charts.tsx';
import { Menu, SearchBox, useDebounced } from '../../components/controls.tsx';
import { PersonAvatar, RUN_STATE, entryLines } from '../../components/people/common.tsx';
import { BankPicker, MoneyInput } from '../../components/pickers.tsx';
import type { Option } from '../../components/pickers.tsx';
import { DataTable, Pager } from '../../components/table.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, LoadError, Modal, Notice, PageHeader, PageSkeleton, PillButton, PillSelect, StatusPill, softArea, softInput, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { decimalsOf, minorToText, money, normalizeNumber, plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { ComponentKind, Components, Payslip, RunDetail } from '../../lib/types/people.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 50;

interface RunPage extends RunDetail {
  payslips_total?: number | undefined;
}

/* --------------------------------------------------------------- adjust */

interface DraftLine {
  key: string;
  component: string;
  basic: boolean;
  name: string;
  kind: ComponentKind;
  amount: string;
}

let seq = 0;

function AdjustModal({ slip, currency, onClose, onSaved }: { slip: Payslip; currency: string; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [lines, setLines] = useState<DraftLine[]>(() => slip.lines.map((l, i) => ({ key: `l${i}`, component: l.component, basic: l.basic, name: l.name, kind: l.kind, amount: minorToText(l.amount, currency) })));
  const [note, setNote] = useState(slip.note);
  const [comps, setComps] = useState<Components | null>(null);
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    op<Components>('payroll.components', { active: true }, { quiet: true })
      .then(setComps)
      .catch(() => setComps(null));
  }, []);
  const d = decimalsOf(currency);
  const minor = (t: string): number => Math.round(Number(normalizeNumber(t, d) ?? '0') * 10 ** d);
  const sum = (k: ComponentKind): number => lines.filter((l) => l.kind === k).reduce((s, l) => s + minor(l.amount), 0);
  const gross = sum('earning');
  const net = gross - sum('deduction');
  const used = new Set(lines.map((l) => l.component));
  const addable = (comps?.components ?? []).filter((c) => !used.has(c.id));
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op(
        'payroll.payslip-update',
        {
          payslip: slip.id,
          lines: lines.map((l) => (l.basic ? { basic: true, amount: l.amount === '' ? '0' : l.amount } : l.component !== '' ? { component: l.component, amount: l.amount === '' ? '0' : l.amount } : { name: l.name.trim(), kind: l.kind, amount: l.amount === '' ? '0' : l.amount })),
          note,
        },
        { quiet: true },
      );
      toast.success('Payslip adjusted');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const group = (k: ComponentKind, title: string): React.JSX.Element | null => {
    const rows = lines.filter((l) => l.kind === k);
    if (rows.length === 0) return null;
    return (
      <div>
        <p className="mb-2 px-1 text-[12px] font-bold text-[var(--erp-muted)]">{title}</p>
        <ul className="flex flex-col gap-2">
          {rows.map((l) => (
            <li key={l.key} className="flex items-center gap-2">
              {l.component === '' && !l.basic ? (
                <input value={l.name} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))} aria-label="Line name" placeholder="Name, e.g. Bonus" className={cn(softInput, 'flex-1')} />
              ) : (
                <span className="min-w-0 flex-1 truncate px-1 text-[14px] font-semibold">{l.name}</span>
              )}
              <MoneyInput value={l.amount} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, amount: v } : x)))} currency={currency} ariaLabel={`Amount of ${l.name !== '' ? l.name : 'line'}`} className="w-36" />
              {l.basic ? <span className="size-9 shrink-0" /> : <CircleButton icon={Trash2} label={`Remove ${l.name}`} variant="ghost" size={36} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust ${slip.employee?.name ?? 'payslip'}`}
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-[13px]">
            Net pay <span className="num text-[15px] font-extrabold">{money(net, currency)}</span>
          </span>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {group('earning', 'Earnings')}
        {group('deduction', 'Deductions')}
        {group('employer', 'Paid by the company')}
        <div className="flex flex-col gap-2 rounded-[18px] bg-[var(--erp-row)] p-3 @min-[480px]:flex-row @min-[480px]:items-center">
          <PillSelect
            value={add}
            onChange={setAdd}
            ariaLabel="Line to add"
            className="flex-1"
            options={[
              { value: '', label: 'Add a line...' },
              { value: 'one:earning', label: 'One-off earning (bonus, overtime)' },
              { value: 'one:deduction', label: 'One-off deduction' },
              ...addable.map((c) => ({ value: `c:${c.id}`, label: `${c.name} (${c.kind === 'earning' ? 'earning' : c.kind === 'deduction' ? 'deduction' : 'company pays'})` })),
            ]}
          />
          <PillButton
            icon={Plus}
            disabled={add === ''}
            onClick={() => {
              seq += 1;
              if (add.startsWith('one:')) setLines((ls) => [...ls, { key: `n${seq}`, component: '', basic: false, name: '', kind: add.slice(4) as ComponentKind, amount: '' }]);
              else {
                const c = addable.find((x) => `c:${x.id}` === add);
                if (c !== undefined) setLines((ls) => [...ls, { key: `n${seq}`, component: c.id, basic: false, name: c.name, kind: c.kind, amount: c.calc === 'fixed' ? minorToText(c.amount, currency) : '' }]);
              }
              setAdd('');
            }}
          >
            Add
          </PillButton>
        </div>
        <Field label="Note on the payslip" optional>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note on the payslip" className={cn(softArea, 'min-h-[56px]')} />
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- page */

function stepsOf(r: RunDetail): { label: string; detail: string; state: 'done' | 'now' | 'todo' }[] {
  const order = ['draft', 'approved', 'posted', 'paid'];
  const at = order.indexOf(r.status);
  const st = (i: number): 'done' | 'now' | 'todo' => (i <= at ? 'done' : i === at + 1 ? 'now' : 'todo');
  return [
    { label: 'Drafted', detail: dayLabel(r.created.slice(0, 10)), state: 'done' },
    { label: at >= 1 ? 'Approved' : 'Approve', detail: r.approved_by, state: st(1) },
    { label: at >= 2 ? 'Posted to the books' : 'Post to the books', detail: r.journal !== null ? `${r.journal.number}, ${dayLabel(r.journal.date)}` : r.posted_by, state: st(2) },
    { label: at >= 3 ? 'Salaries paid' : 'Pay salaries', detail: r.paid_on !== '' ? `${dayLabel(r.paid_on)}${r.bank !== null ? `, from ${r.bank.name}` : ''}` : '', state: st(3) },
  ];
}

export function PayrunPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [dq]);
  const live = useLive(() => op<RunPage>('payroll.run-get', { run: id, q: dq === '' ? undefined : dq, limit: LIMIT, offset }, { quiet: true }), ['payroll_runs', 'payslips', 'journals'], [id, dq, offset]);
  const [adjusting, setAdjusting] = useState<Payslip | null>(null);
  const [posting, setPosting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [bank, setBank] = useState<Option | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();
  useSection('payrun', 'payroll');
  const r = live.data;

  if (r === null) {
    return live.error !== null ? (
      <div>
        <PageHeader title="Pay run" back={() => back('payroll')} />
        <LoadError message={live.error} onRetry={live.reload} />
      </div>
    ) : (
      <PageSkeleton />
    );
  }
  const cur = r.currency;
  const st = RUN_STATE[r.status];
  const run = async (what: 'recompute' | 'approve' | 'delete'): Promise<void> => {
    if (what === 'recompute' && !(await confirm('Every payslip is drafted again from current pay and components. Adjustments made by hand are lost.', 'Recompute this pay run?', 'Recompute', false))) return;
    if (what === 'delete' && !(await confirm(`The draft ${r.month_name} pay run and its ${plural(r.count, 'payslip')} are deleted.`, 'Delete this draft?'))) return;
    setBusy(what);
    try {
      if (what === 'recompute') {
        await op('payroll.run-recompute', { run: r.id });
        toast.success('Recomputed');
        live.reload();
      } else if (what === 'approve') {
        await op('payroll.run-approve', { run: r.id });
        toast.success('Approved. It can now be posted.');
        live.reload();
      } else {
        await op('payroll.run-delete', { run: r.id });
        toast.success('Deleted');
        navigate('payroll');
      }
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };
  const total = r.payslips_total ?? r.payslips.length;
  const steps = stepsOf(r);

  return (
    <div>
      <PageHeader
        back={() => back('payroll')}
        eyebrow={
          <>
            <span className="num">{r.number}</span>
            <StatusPill tone={st.tone} size="sm">
              {st.label}
            </StatusPill>
          </>
        }
        title={`${r.month_name} pay run`}
        subtitle={`Pay date ${dayLabel(r.pay_date)} · ${plural(r.count, 'person', 'people')}${r.note !== '' ? ` · ${r.note}` : ''}`}
        actions={
          <>
            {r.can.edit && (
              <PillButton variant="light" icon={RefreshCw} loading={busy === 'recompute'} onClick={() => void run('recompute')}>
                Recompute
              </PillButton>
            )}
            {r.can.approve && (
              <PillButton icon={Check} dot loading={busy === 'approve'} onClick={() => void run('approve')}>
                Approve
              </PillButton>
            )}
            {r.can.post && (
              <PillButton icon={BookCheck} dot onClick={() => setPosting(true)}>
                Post to the books
              </PillButton>
            )}
            {r.can.pay && (
              <PillButton icon={Wallet} dot onClick={() => setPaying(true)}>
                Pay salaries
              </PillButton>
            )}
            <Menu items={[{ label: 'Delete draft', icon: Trash2, danger: true, hidden: !r.can.delete, onClick: () => void run('delete') }]} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
          <Card tone="dark" delay={1} className="@min-[900px]:col-span-8 @min-[900px]:self-stretch">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] text-[var(--erp-on-dark-muted)]">Net pay to {plural(r.count, 'person', 'people')}</p>
                <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(r.net, cur)}</p>
              </div>
              <div className="text-right">
                <p className="text-[13px] text-[var(--erp-on-dark-muted)]">Total cost</p>
                <p className="num text-[15px] font-bold">{money(r.cost, cur)}</p>
              </div>
            </div>
            <div className="mt-5">
              <SplitBar
                dark
                legend={false}
                height={12}
                parts={[
                  { key: 'net', label: 'Net pay', value: r.net, valueText: money(r.net, cur), fill: 'var(--erp-accent)' },
                  { key: 'ded', label: 'Deductions', value: r.deductions, valueText: money(r.deductions, cur), fill: 'var(--erp-on-dark)' },
                  { key: 'emp', label: 'Employer contributions', value: r.employer, valueText: money(r.employer, cur), fill: 'var(--erp-on-dark-muted)' },
                ]}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 @min-[480px]:grid-cols-4">
              {[
                { label: 'Gross pay', value: r.gross, dot: null },
                { label: 'Net pay', value: r.net, dot: 'var(--erp-accent)' },
                { label: 'Deductions', value: r.deductions, dot: 'var(--erp-on-dark)' },
                { label: 'Employer on top', value: r.employer, dot: 'var(--erp-on-dark-muted)' },
              ].map((t) => (
                <div key={t.label} className="rounded-[18px] bg-[var(--erp-dark-2)]/70 p-3">
                  <p className="flex items-center gap-1.5 text-[12px] text-[var(--erp-on-dark-muted)]">
                    {t.dot !== null && <span className="size-2 rounded-full" style={{ background: t.dot }} />}
                    {t.label}
                  </p>
                  <p className="num truncate text-[15px] font-bold">{money(t.value, cur)}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card delay={2} className="@min-[900px]:col-span-4 @min-[900px]:self-stretch">
            <CardHeader title="Steps" />
            <ol className="flex flex-col gap-3">
              {steps.map((s) => (
                <li key={s.label} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full',
                      s.state === 'done' ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : s.state === 'now' ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-row)] text-[var(--erp-muted)]',
                    )}
                  >
                    {s.state === 'done' ? <Check size={13} strokeWidth={3} aria-hidden /> : <span className="size-1.5 rounded-full bg-current" />}
                  </span>
                  <span className="min-w-0 pt-0.5">
                    <span className={cn('block text-[13px] font-bold', s.state === 'todo' && 'text-[var(--erp-muted)]')}>{s.label}</span>
                    {s.detail !== '' && <span className="block text-[12px] text-[var(--erp-muted)]">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          <Card delay={3} className="@min-[900px]:col-span-12">
            <CardHeader title="Payslips" subtitle={plural(total, 'payslip')} action={r.count > 8 ? <SearchBox value={q} onChange={setQ} placeholder="Find a person" ariaLabel="Find a payslip" soft className="w-48 @min-[480px]:w-64" /> : undefined} />
            <DataTable
              ariaLabel="Payslips"
              rows={r.payslips}
              rowKey={(s) => s.id}
              onOpen={(s) => navigate('payslip', { id: s.id })}
              empty={<Empty icon={Coins} title={dq !== '' ? 'Nobody matches' : 'No payslips'} compact />}
              columns={[
                {
                  key: 'p',
                  label: 'Person',
                  width: 'minmax(0, 2fr)',
                  render: (s) => (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PersonAvatar name={s.employee?.name ?? '?'} photo={s.employee?.photo} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{s.employee?.name ?? 'Former employee'}</span>
                        <span className="block truncate text-[12px] text-[var(--erp-muted)]">{s.employee?.department?.name ?? s.employee?.job_title ?? ''}</span>
                      </span>
                    </span>
                  ),
                },
                { key: 'b', label: 'Basic', width: '120px', align: 'right', hide: 'md', render: (s) => money(s.basic, cur) },
                { key: 'e', label: 'Earnings', width: '120px', align: 'right', hide: 'lg', render: (s) => (s.gross - s.basic !== 0 ? money(s.gross - s.basic, cur) : '') },
                { key: 'd', label: 'Deductions', width: '120px', align: 'right', hide: 'md', render: (s) => (s.deductions !== 0 ? `−${money(s.deductions, cur)}` : '') },
                { key: 'n', label: 'Net pay', width: '120px', align: 'right', render: (s) => <span className={cn('font-bold', s.net < 0 && 'text-[var(--erp-red-text)]')}>{money(s.net, cur)}</span> },
                ...(r.can.edit ? [{ key: 'a', label: '', width: '44px', align: 'right' as const, render: (s: Payslip) => <CircleButton icon={Pencil} label={`Adjust ${s.employee?.name ?? 'payslip'}`} variant="row" size={32} onClick={() => setAdjusting(s)} /> }] : []),
              ]}
              mobile={(s) => ({ title: s.employee?.name ?? 'Former employee', sub: `Gross ${money(s.gross, cur)}${s.note !== '' ? ` · ${s.note}` : ''}`, right: money(s.net, cur), rightSub: 'net', lead: <PersonAvatar name={s.employee?.name ?? '?'} photo={s.employee?.photo} size={34} /> })}
            />
            <Pager offset={offset} limit={LIMIT} total={total} onChange={setOffset} />
          </Card>
        <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
          {(r.entry !== undefined || r.pay_entry !== undefined) && (
            <Card delay={4}>
              <CardHeader title="In the books" />
              <div className="flex flex-col gap-3">
                {r.entry !== undefined && <BooksDetail lines={entryLines(r.entry)} currency={cur} label={`Posted as ${r.entry.number} on ${dayLabel(r.entry.date)}`} />}
                {r.pay_entry !== undefined && <BooksDetail lines={entryLines(r.pay_entry)} currency={cur} label={`Salaries paid as ${r.pay_entry.number} on ${dayLabel(r.pay_entry.date)}`} />}
              </div>
            </Card>
          )}
        </div>
        <RecordActivity entity="payroll_runs" refId={r.id} className="@min-[900px]:col-span-4" />
      </div>

      {adjusting !== null && <AdjustModal slip={adjusting} currency={cur} onClose={() => setAdjusting(null)} onSaved={live.reload} />}
      {posting && (
        <ConfirmPosting
          open
          onClose={() => setPosting(false)}
          title={`Post the ${r.month_name} pay run`}
          verb="Post to the books"
          previewOp="payroll.preview-post"
          runOp="payroll.run-post"
          params={{ run: r.id }}
          onDone={() => {
            toast.success('Posted. Payslips are now visible to each person.');
            live.reload();
          }}
        />
      )}
      {paying && (
        <ConfirmPosting
          open
          onClose={() => setPaying(false)}
          title={`Pay the ${r.month_name} salaries`}
          verb={`Pay ${money(r.net, cur)}`}
          previewOp="payroll.preview-pay"
          runOp="payroll.run-pay"
          params={{ run: r.id, bank: bank?.id ?? undefined }}
          withDate
          defaultDate={r.pay_date > today() ? r.pay_date : today()}
          intro={
            <Field label="Pay from">
              <BankPicker value={bank} onChange={setBank} currency={cur} placeholder="The default bank account" clearable />
            </Field>
          }
          onDone={() => {
            toast.success('Salaries paid');
            live.reload();
          }}
        />
      )}
      {confirmEl}
    </div>
  );
}
