/**
 * Pay out: locked pay runs waiting to leave the company, and one run's
 * pay-out (bank file with its problems, split pay, cash and cheque lists,
 * confirming the upload, the GL journal). Every action is an operation; the
 * bank file, the upload confirmation and "mark paid" ask for the PIN.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Banknote, BookOpen, Check, Download, FileText, Landmark, Printer, Settings2, ShieldCheck, Wallet } from 'lucide-react';
import { Button, Checkbox, DataTable, DayPicker, Dialog, Empty, Field, Hint, IconButton, Input, LoadError, Loading, Menu, MenuItem, Notice, PageBody, PageHeader, Panel, Segmented, StatTile, Stepper, Tag, Money } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { FileStatus, FormatTag, RunStatus } from '../../../components/payroll-out/parts.tsx';
import { download, op, OpError } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { ago, fmtDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { navigate, setQuery } from '../../../lib/router.ts';
import { toast } from '../../../lib/toast.ts';
import { useUi } from '../../../lib/store.tsx';
import type { BankPerson, CashList, ItemRow, JournalPreview, OverviewRun, PayTotals, Problem, RunPayout } from './types.ts';

const READS = ['payruns', 'payslips', 'bank_files', 'journal_exports', 'payout_lists', 'payout_settings', 'bank_accounts'];

function methodsText(r: OverviewRun): string {
  const parts: string[] = [];
  for (const m of ['bank', 'cash', 'cheque']) if (r.methods[m]) parts.push(tn('po.method.' + m + '_n', r.methods[m].count));
  return parts.join(' · ');
}

export function PayOutPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const status = (query.get('status') as 'open' | 'paid' | 'all' | null) ?? 'open';
  const live = useOp<{ runs: OverviewRun[]; total: number }>('payout.overview', { status, entity: entity === '' ? undefined : entity, limit: 100 }, READS, { name: 'payout.overview' });
  const columns: Column<OverviewRun>[] = useMemo(
    () => [
      { key: 'run', label: t('po.col.run'), width: 'minmax(170px,1.6fr)', phone: 'title', sort: (r) => r.number, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="font-medium">{r.label !== '' ? r.label : r.number}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.label !== '' ? r.number + ' · ' : ''}{t('po.kind.' + r.kind)}</span></span> },
      { key: 'entity', label: t('po.col.entity'), width: 'minmax(130px,1.2fr)', hideBelow: 'lg', sort: (r) => r.entity_name, render: (r) => r.entity_name },
      { key: 'pay_date', label: t('po.col.pay_date'), width: '112px', mono: true, sort: (r) => r.pay_date, render: (r) => fmtDay(r.pay_date) },
      { key: 'methods', label: t('po.col.how'), width: 'minmax(150px,1.2fr)', hideBelow: 'xl', render: (r) => <span className="text-[12px] text-[var(--hr-muted)]">{methodsText(r)}</span> },
      { key: 'net', label: t('po.col.to_pay'), width: '140px', align: 'right', mono: true, sort: (r) => r.totals.to_pay_minor, phone: 'end', render: (r) => <span className="flex flex-col items-end leading-tight"><Money minor={r.totals.to_pay_minor} currency={r.currency} />{r.totals.held_count > 0 && <span className="text-[12px] text-[var(--hr-warn)]">{tn('po.held_n', r.totals.held_count)}</span>}</span> },
      { key: 'status', label: t('po.col.status'), width: '96px', sort: (r) => r.status, render: (r) => <RunStatus status={r.status} /> },
      { key: 'next', label: t('po.col.next'), width: '150px', render: (r) => (r.next === 'done' ? <span className="text-[12px] text-[var(--hr-muted)]">{t('po.next.done')}</span> : <Tag tone={r.next === 'journal' ? 'neutral' : 'rh'}>{t('po.next.' + r.next)}</Tag>) },
    ],
    [],
  );
  const runs = live.data?.runs ?? null;
  const open = runs?.filter((r) => r.status === 'locked') ?? [];
  const toPay = open.reduce((s, r) => s + r.totals.to_pay_minor, 0);
  const cur = open[0]?.currency ?? '';
  const mixed = open.some((r) => r.currency !== cur);
  return (
    <>
      <PageHeader title={t('po.payout.title')} meta={runs !== null ? tn('po.payout.meta', open.length) : undefined}>
        <Segmented
          value={status}
          onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
          label={t('po.col.status')}
          size="sm"
          className="hidden md:inline-flex"
          options={[
            { value: 'open', label: t('po.f.to_pay') },
            { value: 'paid', label: t('po.f.paid') },
            { value: 'all', label: t('po.f.all') },
          ]}
        />
        {can(me, 'payroll', 'full') && <IconButton icon={Settings2} label={t('po.settings.title')} onClick={() => navigate('/payroll/pay-out/settings')} />}
      </PageHeader>
      <PageBody>
        <div className="mb-3 md:hidden"><Segmented
          value={status}
          onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
          label={t('po.col.status')}
          size="sm"
          options={[
            { value: 'open', label: t('po.f.to_pay') },
            { value: 'paid', label: t('po.f.paid') },
            { value: 'all', label: t('po.f.all') },
          ]}
        /></div>
        {runs !== null && runs.length > 0 && status === 'open' && (
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <StatTile index="01" label={t('po.kpi.runs_to_pay')} value={open.length} />
            <StatTile index="02" label={t('po.kpi.to_pay')} value={mixed ? t('po.kpi.several_currencies') : <Money minor={toPay} currency={cur} />} />
            <StatTile index="03" label={t('po.kpi.next_pay_date')} value={open.length > 0 ? fmtDay(open.map((r) => r.pay_date).sort()[0] ?? '') : t('ui.none')} className="hidden md:block" />
          </div>
        )}
        <div className="hr-panel hr-in min-w-0">
          {runs === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <DataTable
              label={t('po.payout.title')}
              columns={columns}
              rows={runs}
              rowKey={(r) => r.id}
              rowHref={(r) => `#/payroll/pay-out/${r.id}`}
              empty={
                <Empty icon={Banknote} title={status === 'open' ? t('po.payout.empty') : t('po.payout.empty_other')} action={<Button icon={ArrowRight} iconRight={undefined} onClick={() => navigate('/payroll')}>{t('po.payout.to_runs')}</Button>}>
                  {status === 'open' ? t('po.payout.empty_text') : undefined}
                </Empty>
              }
            />
          )}
        </div>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------- one run */

/** Net pay of the run less held pay (plus released holds) = to the bank + cash + cheques, as on the run's lock dialog. */
function Reconcile({ totals, currency }: { totals: PayTotals; currency: string }): React.JSX.Element {
  const row = (label: string, minor: number, sub?: string, tone?: string): React.JSX.Element => (
    <div className={`flex min-w-0 items-baseline justify-between gap-3 py-1 ${tone ?? ''}`}>
      <span className="min-w-0 text-[13px]">
        {label}
        {sub !== undefined && <span className="ml-1.5 text-[12px] text-[var(--hr-muted)]">{sub}</span>}
      </span>
      <Money minor={minor} currency={currency} className="text-[13px]" />
    </div>
  );
  return (
    <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] px-3 py-1.5" aria-label={t('po.rec.label')}>
      {row(t('po.rec.net'), totals.net_minor)}
      {totals.held_count > 0 && row(t('po.rec.held'), -totals.held_minor, tn('po.n_people', totals.held_count), 'text-[var(--hr-warn)]')}
      {totals.released_count > 0 && row(t('po.rec.released'), totals.released_minor, tn('po.n_people', totals.released_count))}
      <div className="border-t border-[var(--hr-line)]">{row(t('po.rec.to_pay'), totals.to_pay_minor)}</div>
      {row(t('po.rec.bank'), totals.bank_minor, tn('po.n_people', totals.bank_people), 'font-semibold')}
      {totals.cash_count + totals.cheque_count > 0 && row(t('po.rec.cash_cheque'), totals.cash_minor + totals.cheque_minor, tn('po.n_people', totals.cash_count + totals.cheque_count))}
      {!totals.balanced && <p className="py-1 text-[12px] text-[var(--hr-bad)]">{t('po.rec.unbalanced')}</p>}
    </div>
  );
}

function ProblemList({ problems }: { problems: Problem[] }): React.JSX.Element {
  return (
    <ul className="mt-2 flex flex-col divide-y divide-[var(--hr-hair)] rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
      {problems.map((p, i) => (
        <li key={i} className="flex min-w-0 items-start gap-3 px-3 py-2 text-[13px]">
          <span className="hr-mono w-[64px] shrink-0 text-[12px] text-[var(--hr-muted)]">{p.ref !== '' ? p.ref : t('po.bank.employer')}</span>
          <span className="hr-wrap min-w-0 flex-1">
            {p.name !== '' && <span className="font-medium">{p.name}: </span>}
            {p.message}
          </span>
          {p.ref !== '' ? (
            <a className="hr-link inline-flex min-h-10 shrink-0 items-center text-[12px] md:min-h-0" href={`#/people/${p.ref}`}>
              {t('po.bank.open_profile')}
            </a>
          ) : (
            <a className="hr-link inline-flex min-h-10 shrink-0 items-center text-[12px] md:min-h-0" href="#/payroll/pay-out/settings">
              {t('po.bank.open_settings')}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function ConfirmDialog({ open, onClose, fileId, payDate }: { open: boolean; onClose: () => void; fileId: string; payDate: string }): React.JSX.Element {
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(payDate);
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('payout.confirm-upload', { bank_file: fileId, reference: reference.trim(), paid_on: paidOn }, { pin: { title: t('po.confirm.pin_title'), text: t('po.confirm.pin_text') } });
      changed('payruns', 'bank_files');
      toast.success(t('po.confirm.done'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('po.confirm.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" icon={ShieldCheck} busy={busy} disabled={reference.trim() === ''} onClick={() => void run()}>
            {t('po.confirm.ok')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('po.confirm.reference')} hint={t('po.confirm.reference_hint')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
        </Field>
        <Field label={t('po.confirm.paid_on')}>
          <DayPicker value={paidOn} onChange={setPaidOn} label={t('po.confirm.paid_on')} />
        </Field>
      </div>
    </Dialog>
  );
}

function MarkPaidDialog({ open, onClose, run, bankOpen }: { open: boolean; onClose: () => void; run: RunPayout['run']; bankOpen: boolean }): React.JSX.Element {
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [outside, setOutside] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('payout.mark-paid', { payrun: run.id, reference: reference.trim(), note: note.trim() === '' ? undefined : note.trim(), outside: bankOpen ? outside : undefined }, { pin: { title: t('po.markpaid.pin_title') } });
      changed('payruns', 'bank_files');
      toast.success(t('po.markpaid.done'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('po.markpaid.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" icon={Check} busy={busy} disabled={reference.trim() === '' || (bankOpen && !outside)} onClick={() => void go()}>
            {t('po.markpaid.ok')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('po.markpaid.reference')} hint={t('po.markpaid.reference_hint')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
        </Field>
        <Field label={t('po.markpaid.note')} optional>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {bankOpen && <Checkbox checked={outside} onChange={setOutside} label={t('po.markpaid.outside')} />}
      </div>
    </Dialog>
  );
}

function BankRows({ people, currency }: { people: BankPerson[]; currency: string }): React.JSX.Element {
  const columns: Column<BankPerson>[] = [
    { key: 'person', label: t('po.col.person'), width: 'minmax(180px,1.6fr)', phone: 'title', sort: (r) => r.name, render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{r.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.employee_number}{r.kind === 'hold_release' ? ' · ' + t('po.bank.released') : ''}</span></span> },
    {
      key: 'accounts',
      label: t('po.col.accounts'),
      width: 'minmax(220px,2fr)',
      render: (r) =>
        r.parts.length === 0 ? (
          <span className="text-[12px] text-[var(--hr-bad)]">{t('po.bank.no_account')}</span>
        ) : (
          <span className="flex min-w-0 flex-col gap-0.5">
            {r.parts.map((p) => (
              <span key={p.bank_account} className="flex min-w-0 items-center gap-2 text-[12px]">
                <span className="hr-mono truncate text-[var(--hr-muted)]">{[p.bank_code, p.branch_code].filter((x) => x !== '').join(' ')} {p.number_masked}</span>
                {r.parts.length > 1 && <Money minor={p.amount_minor} currency={currency} className="text-[12px]" />}
              </span>
            ))}
          </span>
        ),
    },
    { key: 'amount', label: t('po.col.amount'), width: '140px', align: 'right', mono: true, sort: (r) => r.amount_minor, phone: 'end', render: (r) => <Money minor={r.amount_minor} currency={currency} /> },
  ];
  return <DataTable label={t('po.bank.people')} columns={columns} rows={people} rowKey={(r) => r.payslip + r.kind} rowClass={(r) => (r.problems.length > 0 ? 'bg-[var(--hr-bad-soft)]' : '')} />;
}

function CashPanel({ runId, method }: { runId: string; method: 'cash' | 'cheque' }): React.JSX.Element | null {
  const me = useMe();
  const live = useOp<CashList>('payout.list', { payrun: runId, method }, ['payout_lists', 'payslips'], { name: 'payout.list.' + method });
  const list = live.data;
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  if (list === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : null;
  if (list.rows.length === 0) return null;
  const editable = can(me, 'payroll', 'edit');
  const save = async (payslip: string, patch: { handed?: boolean; cheque_number?: string }): Promise<void> => {
    const row = list.rows.find((r) => r.payslip === payslip);
    if (!row) return;
    try {
      await op('payout.list-set', { payrun: runId, method, items: [{ payslip, cheque_number: patch.cheque_number ?? row.cheque_number, handed: patch.handed ?? row.handed }] });
      changed('payout_lists');
    } catch {
      /* toast shown */
    }
  };
  const columns: Column<CashList['rows'][number]>[] = [
    { key: 'person', label: t('po.col.person'), width: 'minmax(180px,1.6fr)', phone: 'title', render: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{r.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.employee_number}</span></span> },
    ...(method === 'cheque'
      ? [{ key: 'cheque', label: t('po.cash.cheque_number'), width: '150px', render: (r: CashList['rows'][number]) => (editable ? <Input value={numbers[r.payslip] ?? r.cheque_number} onChange={(e) => setNumbers((n) => ({ ...n, [r.payslip]: e.target.value }))} onBlur={() => numbers[r.payslip] !== undefined && numbers[r.payslip] !== r.cheque_number && void save(r.payslip, { cheque_number: numbers[r.payslip] ?? '' })} className="h-7 text-[12px]" aria-label={t('po.cash.cheque_number')} /> : <span className="hr-mono">{r.cheque_number}</span>) } as Column<CashList['rows'][number]>]
      : []),
    { key: 'amount', label: t('po.col.amount'), width: '140px', align: 'right', mono: true, phone: 'end', render: (r) => <Money minor={r.amount_minor} currency={list.currency} /> },
    { key: 'handed', label: t('po.cash.handed'), width: '120px', render: (r) => <Checkbox checked={r.handed} disabled={!editable} onChange={(v) => void save(r.payslip, { handed: v })} label={t('po.cash.handed')} hideLabel /> },
  ];
  return (
    <Panel
      label={t('po.cash.' + method + '_list')}
      flush
      aside={
        <Button size="sm" variant="ghost" icon={Printer} onClick={() => navigate(`/print/payroll/cash/${runId}`, { method })}>
          {t('po.print')}
        </Button>
      }
    >
      <DataTable label={t('po.cash.' + method + '_list')} columns={columns} rows={list.rows} rowKey={(r) => r.payslip} foot={<span className="flex justify-between px-3 text-[12px]"><span>{list.status === 'done' ? t('po.cash.all_handed') : tn('po.cash.to_hand', list.rows.filter((r) => !r.handed).length)}</span><Money minor={list.total_minor} currency={list.currency} /></span>} />
      {list.denominations.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hr-line)] px-3.5 py-2.5">
          <span className="hr-label w-full">{t('po.cash.draw')}</span>
          {list.denominations.map((d) => (
            <span key={d.value_minor} className="hr-mono text-[12px]">
              {d.count} × <Money minor={d.value_minor} currency={list.currency} always />
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

function JournalPanel({ runId, locked }: { runId: string; locked: boolean }): React.JSX.Element {
  const me = useMe();
  const [format, setFormat] = useState<string>('');
  const live = useOp<JournalPreview>('journal.preview', { payrun: runId, format: format === '' ? undefined : format }, ['journal_exports', 'payout_settings', 'payslip_lines'], { name: 'journal.preview' });
  const j = live.data;
  const [busy, setBusy] = useState(false);
  const exportIt = async (): Promise<void> => {
    if (j === null) return;
    setBusy(true);
    try {
      const r = await op<{ journal: { id: string; filename: string } }>('journal.export', { payrun: runId, format: j.format });
      changed('journal_exports');
      await download('journal.download', { journal: r.journal.id }, 'save', r.journal.filename);
      toast.success(t('po.journal.exported'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const columns: Column<JournalPreview['lines'][number]>[] = [
    { key: 'account', label: t('po.col.account'), width: 'minmax(150px,1.4fr)', phone: 'title', mono: true, render: (l) => l.account },
    { key: 'desc', label: t('po.col.description'), width: 'minmax(180px,2fr)', render: (l) => <span className="hr-wrap text-[12px]">{l.description}</span> },
    { key: 'cc', label: t('po.col.cost_center'), width: '110px', hideBelow: 'lg', render: (l) => l.cost_center },
    { key: 'dept', label: t('po.col.department'), width: '110px', hideBelow: 'lg', render: (l) => l.department },
    { key: 'debit', label: t('po.col.debit'), width: '130px', align: 'right', mono: true, render: (l) => (l.debit_minor > 0 ? <Money minor={l.debit_minor} currency={j?.run.currency ?? ''} /> : '') },
    { key: 'credit', label: t('po.col.credit'), width: '130px', align: 'right', mono: true, phone: 'end', render: (l) => (l.credit_minor > 0 ? <Money minor={l.credit_minor} currency={j?.run.currency ?? ''} /> : '') },
  ];
  return (
    <Panel
      label={t('po.journal.title')}
      flush
      aside={
        j !== null ? (
          <span className="flex items-center gap-2">
            <Segmented value={j.format} onChange={setFormat} label={t('po.journal.format')} size="sm" options={j.formats.map((f) => ({ value: f.code, label: t('po.journal.fmt.' + f.code) }))} className="hidden sm:inline-flex" />
            {can(me, 'payroll', 'edit') && locked && (
              <Button size="sm" icon={Download} busy={busy} disabled={!j.balanced} onClick={() => void exportIt()}>
                {t('po.journal.export')}
              </Button>
            )}
          </span>
        ) : undefined
      }
    >
      {j === null ? (
        live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
      ) : (
        <>
          {j.unset.length > 0 && (
            <Notice tone="warn" className="mx-3.5 mb-2" action={can(me, 'payroll', 'edit') ? <Button size="sm" onClick={() => navigate('/payroll/pay-out/settings', { tab: 'gl' })}>{t('po.journal.set_accounts')}</Button> : undefined}>
              {t('po.journal.unset', { roles: j.unset.map((u) => u.label).join(', ') })}
            </Notice>
          )}
          <DataTable
            label={t('po.journal.title')}
            columns={columns}
            rows={j.lines}
            rowKey={(l) => l.account + l.cost_center + l.department + l.description}
            foot={
              <span className="flex items-center justify-between gap-3 px-3 text-[12px]">
                <span className={j.balanced ? 'text-[var(--hr-good)]' : 'text-[var(--hr-bad)]'}>{j.balanced ? t('po.journal.balanced') : t('po.journal.unbalanced')}</span>
                <span className="flex gap-6">
                  <Money minor={j.debit_minor} currency={j.run.currency} />
                  <Money minor={j.credit_minor} currency={j.run.currency} />
                </span>
              </span>
            }
          />
        </>
      )}
    </Panel>
  );
}

export function RunPayOutPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const runId = params['run'] ?? '';
  const [format, setFormat] = useState('');
  const live = useOp<RunPayout>('payout.run', { payrun: runId, format: format === '' ? undefined : format }, READS, { name: 'payout.run' });
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const d = live.data;
  if (d === null)
    return (
      <>
        <PageHeader title={t('po.payout.title')} back="#/payroll/pay-out" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const cur = d.run.currency;
  const current = d.files.find((f) => f.status === 'exported') ?? null;
  const uploaded = d.files.find((f) => f.status === 'uploaded') ?? null;
  const locked = d.run.status === 'locked';
  const shown = problems ?? d.check.problems;
  const bankCount = d.bank.length;
  const step = d.run.status === 'paid' ? (d.journals.length > 0 ? 'journal' : 'journal') : current !== null ? 'upload' : 'file';
  const exportFile = async (): Promise<void> => {
    setBusy(true);
    setProblems(null);
    setExportOpen(false);
    try {
      const r = await op<{ bank_file: { id: string; filename: string; count: number } }>('bankfiles.export', { payrun: d.run.id, format: d.format }, { pin: { title: t('po.bank.pin_title'), text: tn('po.bank.pin_text', d.check.count ?? bankCount) }, quiet: true });
      changed('bank_files');
      await download('bankfiles.download', { bank_file: r.bank_file.id }, 'save', r.bank_file.filename);
      toast.success(t('po.bank.written'), { label: t('po.bank.confirm_upload'), run: () => setConfirmOpen(true) });
    } catch (err) {
      if (err instanceof OpError && err.code === 'bank_file_problems') setProblems((err.data['problems'] as Problem[]) ?? []);
      else if (err instanceof OpError && err.code !== 'aborted') toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const meta = [d.run.entity_name, fmtDay(d.run.pay_date), t('po.run.status.' + d.run.status).toUpperCase()].join(' · ');
  return (
    <>
      <PageHeader title={d.run.label !== '' ? d.run.label : d.run.number} meta={meta} back="#/payroll/pay-out">
        <Button variant="ghost" icon={FileText} onClick={() => navigate(`/payroll/runs/${d.run.id}`)} className="hidden md:inline-flex">
          {t('po.run.open')}
        </Button>
        <IconButton icon={FileText} label={t('po.run.open')} onClick={() => navigate(`/payroll/runs/${d.run.id}`)} className="md:hidden" />
        {d.can.mark_paid && (
          <Menu icon={Wallet} label={t('ui.more')}>
            {(close) => (
              <MenuItem icon={Check} onClick={() => (close(), setPaidOpen(true))}>
                {t('po.markpaid.title')}
              </MenuItem>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        <Stepper
          className="mb-3"
          steps={[
            { key: 'file', label: t('po.step.file') },
            { key: 'upload', label: t('po.step.upload') },
            { key: 'journal', label: t('po.step.journal') },
          ]}
          current={step}
          done={d.run.status === 'paid' ? (d.journals.length > 0 ? ['file', 'upload', 'journal'] : ['file', 'upload']) : current !== null ? ['file'] : []}
        />
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile index="01" label={tn('po.kpi.to_bank_n', d.totals.bank_people)} value={<Money minor={d.totals.bank_minor} currency={cur} />} />
          <StatTile index="02" label={tn('po.kpi.held_n', d.totals.held_count)} value={<Money minor={d.totals.held_minor} currency={cur} />} tone={d.totals.held_count > 0 ? 'warn' : undefined} />
          <StatTile index="03" label={tn('po.kpi.cash_cheque_n', d.totals.cash_count + d.totals.cheque_count)} value={<Money minor={d.totals.cash_minor + d.totals.cheque_minor} currency={cur} />} />
          <StatTile index="04" label={tn('po.kpi.net_n', d.run.employee_count)} value={<Money minor={d.totals.net_minor} currency={cur} />} />
        </div>
        <div className="flex flex-col gap-3">
          {bankCount > 0 && (
            <Panel
              label={t('po.bank.title')}
              flush
              aside={d.formats.length > 1 ? <Segmented value={d.format} onChange={setFormat} label={t('po.bank.format')} size="sm" options={d.formats.map((f) => ({ value: f, label: t('po.fmt.' + f) }))} /> : undefined}
            >
              <div className="flex flex-col gap-2 px-3.5 pb-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Landmark size={15} className="text-[var(--hr-muted)]" aria-hidden />
                  <span className="font-medium">{d.format_info.name}</span>
                  <FormatTag official={d.format_info.official} />
                  <span className="hr-wrap min-w-0 basis-full text-[12px] text-[var(--hr-muted)] sm:basis-auto">{d.format_info.label}</span>
                </div>
                <Reconcile totals={d.totals} currency={cur} />
                {d.payer_missing.length > 0 && (
                  <Notice tone="warn" action={can(me, 'payroll', 'full') ? <Button size="sm" onClick={() => navigate('/payroll/pay-out/settings', { format: d.format })}>{t('po.bank.add_details')}</Button> : undefined}>
                    {t('po.bank.payer_missing', { fields: d.payer_missing.map((f) => f.label).join(', ') })}
                  </Notice>
                )}
                {shown.length > 0 && (
                  <Notice tone="bad">
                    {tn('po.bank.problems', shown.length)}
                    <ProblemList problems={shown} />
                  </Notice>
                )}
                {uploaded !== null ? (
                  <Notice tone="good">{t('po.bank.uploaded', { reference: uploaded.reference, when: fmtDay(uploaded.paid_on) })}</Notice>
                ) : current !== null ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] px-3 py-2">
                    <FileStatus status={current.status} />
                    <span className="hr-mono min-w-0 flex-1 truncate text-[12px]">{current.filename}</span>
                    <Money minor={current.total_minor} currency={current.currency} className="text-[12px]" />
                    <span className="inline-flex items-center gap-1 text-[12px] text-[var(--hr-muted)]">
                      {t('po.bank.fingerprint')}
                      <Hint text={t('po.bank.sha', { hash: current.hash })} />
                    </span>
                    <span className="text-[12px] text-[var(--hr-muted)]">{t('po.bank.exported_by', { who: current.exported_by, when: ago(current.exported_at) })}</span>
                    <Button size="sm" variant="ghost" icon={Download} onClick={() => void download('bankfiles.download', { bank_file: current.id }, 'save', current.filename)}>
                      {t('po.bank.download')}
                    </Button>
                    {d.can.confirm && (
                      <Button size="sm" variant="primary" icon={ShieldCheck} onClick={() => setConfirmOpen(true)}>
                        {t('po.bank.confirm_upload')}
                      </Button>
                    )}
                  </div>
                ) : null}
                {locked && d.can.export && uploaded === null && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={current === null ? 'primary' : 'default'} icon={FileText} busy={busy} disabled={d.payer_missing.length > 0} onClick={() => setExportOpen(true)}>
                      {current === null ? t('po.bank.write') : t('po.bank.write_again')}
                    </Button>
                    <span className="text-[12px] text-[var(--hr-muted)]">{tn('po.bank.will_hold', d.check.count ?? bankCount)}</span>
                  </div>
                )}
              </div>
              <BankRows people={d.bank} currency={cur} />
            </Panel>
          )}
          {bankCount === 0 && locked && d.can.mark_paid && (
            <Notice tone="neutral" action={<Button variant="primary" icon={Check} onClick={() => setPaidOpen(true)}>{t('po.markpaid.title')}</Button>}>
              {t('po.payout.no_bank')}
            </Notice>
          )}
          <CashPanel runId={d.run.id} method="cash" />
          <CashPanel runId={d.run.id} method="cheque" />
          <JournalPanel runId={d.run.id} locked={locked || d.run.status === 'paid'} />
          {d.files.length > 0 && (
            <Panel label={t('po.bank.history')} flush>
              <ul className="divide-y divide-[var(--hr-hair)]">
                {d.files.map((f) => (
                  <li key={f.id} className="grid min-h-10 min-w-0 grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-[12px] md:grid-cols-[112px_minmax(0,1fr)_120px_minmax(0,200px)_96px]">
                    <FileStatus status={f.status} />
                    <span className="hr-mono min-w-0 truncate">{f.filename}</span>
                    <Money minor={f.total_minor} currency={f.currency} className="text-right" />
                    <span className="hidden truncate text-[var(--hr-muted)] md:block">{f.exported_by} · {ago(f.exported_at)}</span>
                    <span className="hidden md:block">{f.reference !== '' && <Tag>{f.reference}</Tag>}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {d.journals.length > 0 && (
            <Panel label={t('po.journal.exports')} flush>
              <ul className="divide-y divide-[var(--hr-hair)]">
                {d.journals.map((jx) => (
                  <li key={jx.id} className="grid min-h-10 min-w-0 grid-cols-[14px_minmax(0,1fr)_32px] items-center gap-3 px-4 py-2 text-[12px] md:grid-cols-[14px_minmax(0,1fr)_minmax(0,200px)_32px]">
                    <BookOpen size={14} className="text-[var(--hr-muted)]" aria-hidden />
                    <span className="hr-mono min-w-0 truncate">{jx.filename}</span>
                    <span className="hidden truncate text-[var(--hr-muted)] md:block">{jx.exported_by} · {ago(jx.exported_at)}</span>
                    <span className="flex justify-end">
                      {can(me, 'payroll', 'edit') && <IconButton icon={Download} label={t('po.bank.download')} onClick={() => void download('journal.download', { journal: jx.id }, 'save', jx.filename)} />}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </PageBody>
      {current !== null && <ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fileId={current.id} payDate={d.run.pay_date} />}
      <MarkPaidDialog open={paidOpen} onClose={() => setPaidOpen(false)} run={d.run} bankOpen={bankCount > 0} />
      <Dialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={t('po.bank.write_title')}
        meta={d.format_info.name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              {t('ui.cancel')}
            </Button>
            <Button variant="primary" icon={ShieldCheck} busy={busy} onClick={() => void exportFile()}>
              {t('po.bank.write_with_pin')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Reconcile totals={d.totals} currency={cur} />
          <p className="text-[13px] text-[var(--hr-muted)]">{tn('po.bank.write_text', d.check.count ?? bankCount)}</p>
          {!d.format_info.official && <Notice tone="warn">{t('po.bank.check_layout')}</Notice>}
        </div>
      </Dialog>
    </>
  );
}

export type { ItemRow };
