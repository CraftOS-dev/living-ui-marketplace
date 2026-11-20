/**
 * One pay run: the instrument header (the big net total, the state steps
 * Draft, Calculated, Approved, Locked, Paid, the figures), the one next
 * action for its state, and the tabs Employees (dense rows with the change
 * against the last run and issue dots), Issues (blockers and warnings with
 * a Fix link), Changes (run over run), Components and Notes (people and your
 * AI agent). A row opens the payslip in a drawer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Calculator, CircleAlert, Ellipsis, Eye, Hand, Landmark, Lock, MessageSquarePlus, RotateCcw, Send, ShieldCheck, Sparkle, Trash2, Undo2, Users } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, Field, IconButton, LoadError, Loading, Menu, MenuItem, Money, Notice, PageBody, PageHeader, Panel, PinBoxes, RowCue, Segmented, StatusDot, Stepper, Tabs, Tag, Textarea, confirmPin, toast } from '../../../components/ui.tsx';
import type { Column } from '../../../components/ui.tsx';
import { op, errCode } from '../../../lib/api.ts';
import { can, useMe } from '../../../lib/auth.tsx';
import type { PageProps } from '../../../lib/contract.ts';
import { ago, fmtDay } from '../../../lib/format.ts';
import { t, tn } from '../../../lib/i18n.ts';
import { changed, useOp } from '../../../lib/live.ts';
import { navigate, setQuery } from '../../../lib/router.ts';
import { issueText, issueWhen, kindLabel, periodLabel, RunStatus, runTitle } from '../../../components/payroll/bits.tsx';
import { IssueFix } from '../../../components/payroll/IssueFix.tsx';
import { PayslipDrawer } from './Payslip.tsx';
import type { Issue, RunGet, SlipRow } from './types.ts';
import { AgentAskStatus } from '../../../components/agent.tsx';

const READS = ['payruns', 'payslips', 'payslip_lines', 'payrun_notes', 'approvals', 'salary_holds'];
type Tab = 'employees' | 'issues' | 'changes' | 'components' | 'notes';

interface Variance {
  previous: { id: string; number: string; pay_date: string; label: string } | null;
  totals: { this: Totals | null; prev: Totals | null };
  by_employee: { payslip: string; employment: string; number: string; name: string; net_minor: number; prev_net_minor: number; delta_net_minor: number; pct: number | null; reasons: string[] }[];
  by_component: CompRow[];
  components: CompRow[];
  threshold_pct: number;
}
interface Totals {
  gross_minor: number;
  deductions_minor: number;
  employer_minor: number;
  net_minor: number;
  headcount: number;
}
interface CompRow {
  code: string;
  name: string;
  kind: string;
  stage: string;
  this_minor: number;
  prev_minor: number;
  delta_minor: number;
  added: boolean;
  removed: boolean;
}
interface Note {
  id: string;
  employment: string;
  employee_name: string;
  actor: string;
  who: string;
  kind: string;
  severity: string;
  code: string;
  body: string;
  resolved: boolean;
  created: string;
}

interface PayoutTotals {
  net_minor: number;
  held_minor: number;
  held_count: number;
  released_minor: number;
  released_count: number;
  to_pay_minor: number;
  bank_minor: number;
  bank_people: number;
  cash_minor: number;
  cash_count: number;
  cheque_minor: number;
  cheque_count: number;
  balanced: boolean;
}

/** The lock dialog's figures: net pay, less held, plus released holds, is what goes to the bank, in cash and by cheque (payroll-out's reconciliation). */
function LockTotals({ runId, currency }: { runId: string; currency: string }): React.JSX.Element {
  const live = useOp<{ totals: PayoutTotals }>('payout.run', { payrun: runId }, READS);
  const x = live.data?.totals ?? null;
  if (x === null) return live.error !== null ? <Notice tone="bad">{live.error}</Notice> : <Loading />;
  const row = (label: string, minor: number, sign: string): React.JSX.Element => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--hr-muted)]">{label}</span>
      <span className="hr-mono hr-num">
        {sign}
        <Money minor={minor} currency={currency} always />
      </span>
    </div>
  );
  return (
    <div className="flex flex-col gap-1 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] px-3 py-2 text-[13px]">
      {row(t('payroll.recon.net'), x.net_minor, '')}
      {x.held_count > 0 && row(tn('payroll.recon.held_row', x.held_count), x.held_minor, '- ')}
      {x.released_count > 0 && row(tn('payroll.recon.released_row', x.released_count), x.released_minor, '+ ')}
      <div className="my-1 border-t border-[var(--hr-hair)]" />
      {row(tn('payroll.recon.bank_row', x.bank_people), x.bank_minor, '')}
      {x.cash_count > 0 && row(tn('payroll.recon.cash_row', x.cash_count), x.cash_minor, '')}
      {x.cheque_count > 0 && row(tn('payroll.recon.cheque_row', x.cheque_count), x.cheque_minor, '')}
      {!x.balanced && <Notice tone="bad" className="mt-1">{t('payroll.recon.unbalanced')}</Notice>}
    </div>
  );
}

/** What locking pays: net to pay, the pay day, people, the reconciliation and what never changes again. */
function LockSummary({ run }: { run: RunGet['payrun'] }): React.JSX.Element {
  const cur = run.currency;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="hr-label">{t('payroll.net_to_pay')}</div>
          <Money minor={run.to_pay_minor} currency={cur} className="hr-mono hr-num text-[15px]" always />
        </div>
        <div>
          <div className="hr-label">{t('payroll.pay_day')}</div>
          <div className="hr-mono text-[15px]">{fmtDay(run.pay_date, { year: 'always' })}</div>
        </div>
      </div>
      <div>{tn('payroll.lock.people', run.to_pay_count)}</div>
      <LockTotals runId={run.id} currency={cur} />
      {(run.issues_summary.warnings ?? 0) > 0 && <div>{tn('payroll.lock.warnings', run.issues_summary.warnings ?? 0)}</div>}
      <Notice tone="warn">{t('payroll.lock.never')}</Notice>
    </div>
  );
}

export function RunPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = params.id ?? '';
  const live = useOp<RunGet>('payruns.get', { payrun: id, limit: 500 }, READS, { name: 'payroll.run' });
  const payout = useOp<{ files: { id: string; status: string }[] }>('payout.run', { payrun: id }, ['payruns', 'bank_files'], { skip: live.data?.payrun.status !== 'locked' && live.data?.payrun.status !== 'paid' });
  const tab = (query.get('tab') as Tab | null) ?? 'employees';
  const slip = query.get('slip') ?? '';
  const data = live.data;
  const run = data?.payrun ?? null;
  const [busy, setBusy] = useState('');
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [holdFor, setHoldFor] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const continuing = useRef(false);
  const edit = can(me, 'payroll', 'edit');
  const full = can(me, 'payroll', 'full');

  // A calculation in progress: keep it going from this screen (the server works in chunks).
  useEffect(() => {
    if (run === null || run.status !== 'calculating' || continuing.current || !edit) return;
    const lease = Date.parse(run.progress.lease_until ?? '');
    if (!Number.isNaN(lease) && lease > Date.now()) return;
    continuing.current = true;
    void op('payruns.calculate', { payrun: run.id, continue: true }, { quiet: true })
      .catch(() => undefined)
      .finally(() => {
        continuing.current = false;
        changed('payruns');
      });
  }, [run, edit]);

  const openSlip = (r: SlipRow): void => setQuery({ slip: r.id });
  const employmentParam = query.get('employment') ?? '';
  useEffect(() => {
    if (employmentParam === '' || data === null) return;
    const r = data.payslips.find((x) => x.employment === employmentParam);
    if (r !== undefined) setQuery({ slip: r.id, employment: undefined });
  }, [employmentParam, data]);

  if (run === null)
    return (
      <>
        <PageHeader title={t('payroll.run')} back="#/payroll/runs" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );

  const cur = run.currency;
  const run1 = async (key: string, fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setBusy(key);
    try {
      await fn();
      if (done !== undefined) toast.success(done);
      changed('payruns', 'payslips');
    } catch (err) {
      if (errCode(err) === 'aborted') return;
    } finally {
      setBusy('');
    }
  };
  const calculate = (): Promise<void> =>
    run1('calc', async () => {
      let r = await op<{ done: boolean }>('payruns.calculate', { payrun: run.id });
      for (let i = 0; i < 40 && !r.done; i++) r = await op<{ done: boolean }>('payruns.calculate', { payrun: run.id, continue: true });
    }, t('payroll.toast.calculated'));
  const submit = (): Promise<void> => run1('submit', () => op('payruns.submit', { payrun: run.id }), t('payroll.toast.submitted'));
  const lock = async (): Promise<void> => {
    const pin = await confirmPin(<LockSummary run={run} />, t('payroll.lock.title', { number: runTitle(run) }), t('payroll.act.lock_now'));
    if (pin === null) return;
    await run1('lock', () => op('payruns.lock', { payrun: run.id, pin: pin }), t('payroll.toast.locked'));
  };
  const doVoid = (): Promise<void> =>
    run1('void', async () => {
      const r = await op<{ replacement: { id: string; number: string } }>('payruns.void', { payrun: run.id, reason: voidReason.trim(), pin: voidPin });
      setVoidOpen(false);
      setVoidPin('');
      toast.success(t('payroll.toast.voided', { number: r.replacement.number }), { label: t('payroll.open_replacement'), run: () => navigate('/payroll/runs/' + r.replacement.id) });
    });
  const acknowledgeAll = (): Promise<void> => run1('ack', () => op('payruns.acknowledge', { payrun: run.id, reason: 'reviewed_ok' }), t('payroll.toast.acknowledged'));

  const blockers = run.issues_summary.blockers ?? 0;
  const unack = run.issues_summary.unacknowledged ?? 0;
  const pending = run.approval_status === 'pending';
  const progress = run.progress.total ? Math.round(((run.progress.done ?? 0) / run.progress.total) * 100) : 0;

  // The one next step for this state.
  let primary: React.ReactNode = null;
  if (edit && run.status === 'draft')
    primary = (
      <Button variant="primary" icon={Calculator} busy={busy === 'calc'} onClick={() => void calculate()} aria-label={t('payroll.act.calculate')}>
        <span className="hidden sm:inline">{t('payroll.act.calculate')}</span>
      </Button>
    );
  else if (edit && run.status === 'calculated' && blockers > 0)
    primary = (
      <Button variant="primary" icon={CircleAlert} onClick={() => setQuery({ tab: 'issues' })} aria-label={tn('payroll.act.fix_blockers', blockers)}>
        <span className="hidden sm:inline">{tn('payroll.act.fix_blockers', blockers)}</span>
      </Button>
    );
  else if (edit && run.status === 'calculated' && unack > 0)
    primary = (
      <Button variant="primary" icon={BadgeCheck} busy={busy === 'ack'} onClick={() => setQuery({ tab: 'issues' })} aria-label={tn('payroll.act.review_warnings', unack)}>
        <span className="hidden sm:inline">{tn('payroll.act.review_warnings', unack)}</span>
      </Button>
    );
  else if (edit && run.status === 'calculated' && !pending)
    primary = (
      <Button variant="primary" icon={Send} busy={busy === 'submit'} onClick={() => void submit()} aria-label={t('payroll.act.submit')}>
        <span className="hidden sm:inline">{t('payroll.act.submit')}</span>
      </Button>
    );
  else if (full && run.status === 'approved')
    primary = (
      <Button variant="primary" icon={Lock} busy={busy === 'lock'} onClick={() => void lock()}>
        {t('payroll.act.lock')}
      </Button>
    );
  else if (full && (run.status === 'locked' || run.status === 'paid') && run.published_at === '')
    primary = (
      <Button variant="primary" icon={Eye} busy={busy === 'pub'} onClick={() => void run1('pub', () => op('payruns.publish', { payrun: run.id }), t('payroll.toast.published'))} aria-label={t('payroll.act.publish')}>
        <span className="hidden sm:inline">{t('payroll.act.publish')}</span>
      </Button>
    );

  const steps = [
    { key: 'draft', label: t('payroll.step.draft') },
    { key: 'calculated', label: t('payroll.step.calculated') },
    { key: 'approved', label: t('payroll.step.approved') },
    { key: 'locked', label: t('payroll.step.locked') },
    { key: 'paid', label: t('payroll.step.paid') },
  ];
  const current = run.status === 'calculating' ? 'draft' : run.status === 'void' ? 'locked' : run.status;
  const doneSteps = run.steps.filter((s) => s.done && !s.current).map((s) => s.key);
  const meta = [run.entity_name, run.number, periodLabel(run.period_start, run.period_end), t('payroll.pay_day_on', { day: fmtDay(run.pay_date, { year: 'always' }) })].join(' · ');
  const keptBack = run.held_count > 0 || run.released_count > 0;
  const fileWritten = (payout.data?.files ?? []).some((f) => f.status !== 'void' && f.status !== 'superseded');

  return (
    <>
      <PageHeader title={runTitle(run)} meta={meta} back="#/payroll/runs">
        {primary}
        {run.status === 'locked' && (
          <Button variant={primary === null && !fileWritten ? 'primary' : 'default'} icon={Landmark} onClick={() => navigate('/payroll/pay-out/' + run.id)} aria-label={fileWritten ? t('payroll.act.open_payout') : t('payroll.act.bank_file')}>
            <span className="hidden sm:inline">{fileWritten ? t('payroll.act.open_payout') : t('payroll.act.bank_file')}</span>
          </Button>
        )}
        <AgentAskStatus ask={run.agent} reads={['payruns']} className="hidden sm:inline-flex" />
        <IconButton
          className="hidden sm:inline-flex"
          icon={Sparkle}
          label={t('payroll.act.review')}
          onClick={() =>
            void run1('review', async () => {
              const r = await op<{ asked: boolean }>('payruns.review', { payrun: run.id });
              toast.success(r.asked ? t('payroll.toast.review_asked') : t('agent.already_asked'));
            })
          }
        />
        <Menu icon={Ellipsis} label={t('ui.more')}>
          {(close) => (
            <>
              {edit && (run.status === 'calculated' || run.status === 'approved') && (
                <MenuItem icon={Undo2} onClick={() => { close(); void run1('reopen', () => op('payruns.reopen', { payrun: run.id })); }}>
                  {t('payroll.act.reopen')}
                </MenuItem>
              )}
              {edit && run.status === 'calculated' && (
                <MenuItem icon={Calculator} onClick={() => { close(); void calculate(); }}>
                  {t('payroll.act.recalculate')}
                </MenuItem>
              )}
              {(run.status === 'locked' || run.status === 'paid') && (
                <MenuItem icon={ShieldCheck} onClick={() => { close(); void op<{ matching: number; checked: number; run_hash_ok: boolean }>('payruns.verify', { payrun: run.id }).then((v) => (v.matching === v.checked && v.run_hash_ok ? toast.success(t('payroll.toast.verified', { n: v.checked })) : toast.error(t('payroll.toast.verify_failed')))); }}>
                  {t('payroll.act.verify')}
                </MenuItem>
              )}
              {full && run.status === 'locked' && (
                <MenuItem icon={RotateCcw} danger onClick={() => { close(); setVoidOpen(true); }}>
                  {t('payroll.act.void')}
                </MenuItem>
              )}
              {edit && run.status === 'paid' && (
                <MenuItem icon={CircleAlert} onClick={() => { close(); navigate('/payroll/runs', { correct: run.id }); }}>
                  {t('payroll.act.correct')}
                </MenuItem>
              )}
              {full && (run.status === 'draft' || run.status === 'calculated') && (
                <MenuItem icon={Trash2} danger onClick={() => { close(); void run1('del', async () => { await op('payruns.delete', { payrun: run.id }); navigate('/payroll/runs'); }); }}>
                  {t('payroll.act.delete')}
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      </PageHeader>
      <PageBody>
        <div className="hr-panel hr-in mb-3 grid min-w-0 grid-cols-1 gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="min-w-0">
            <div className="hr-label">{t('payroll.net_to_pay')}</div>
            <Money minor={run.to_pay_minor} currency={cur} className="hr-mono hr-num block text-[26px] font-light leading-tight" />
            {keptBack && (
              <div className="hr-wrap mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-[var(--hr-muted)]">
                <span>{t('payroll.recon.net')}</span>
                <Money minor={run.net_minor} currency={cur} />
                {run.held_count > 0 && (
                  <>
                    <span>{tn('payroll.recon.less_held', run.held_count)}</span>
                    <Money minor={run.held_minor} currency={cur} />
                  </>
                )}
                {run.released_count > 0 && (
                  <>
                    <span>{tn('payroll.recon.plus_released', run.released_count)}</span>
                    <Money minor={run.released_minor} currency={cur} />
                  </>
                )}
                <span>{t('payroll.recon.is_bank')}</span>
                <Money minor={run.to_pay_minor} currency={cur} />
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--hr-muted)]">
              <RunStatus status={run.status} />
              {run.kind !== 'regular' && <Tag>{kindLabel(run.kind)}</Tag>}
              <span>{tn('payroll.n_people', run.employee_count)}</span>
              {run.held_count > 0 && <Tag tone="warn">{tn('payroll.n_held', run.held_count)}</Tag>}
              {pending && <Tag tone="warn">{t('payroll.waiting_approval')}</Tag>}
              {run.replaces_run && <a className="cursor-pointer underline" href={'#/payroll/runs/' + run.replaces_run.id}>{t('payroll.replaces', { number: run.replaces_run.number })}</a>}
              {run.replaced_by_run && <a className="cursor-pointer underline" href={'#/payroll/runs/' + run.replaced_by_run.id}>{t('payroll.replaced_by', { number: run.replaced_by_run.number })}</a>}
              {run.corrects_run && <a className="cursor-pointer underline" href={'#/payroll/runs/' + run.corrects_run.id}>{t('payroll.corrects', { number: run.corrects_run.number })}</a>}
            </div>
          </div>
          <div className="min-w-0">
            <div className="hidden sm:block">
              <Stepper steps={steps} current={current} done={doneSteps} />
            </div>
            <div className="text-[12px] text-[var(--hr-muted)] sm:hidden">{t('payroll.step_of', { n: steps.findIndex((s) => s.key === current) + 1, total: steps.length, step: steps.find((s) => s.key === current)?.label ?? '' })}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['payroll.gross', run.gross_minor],
                ['payroll.deductions', run.deductions_minor],
                ['payroll.employer_cost', run.employer_minor],
                ['payroll.reimbursements', run.reimbursement_minor],
              ].map(([k, v]) => (
                <div key={String(k)} className="min-w-0">
                  <div className="hr-label">{t(String(k))}</div>
                  <Money minor={Number(v)} currency={cur} className="hr-mono hr-num text-[13px]" />
                </div>
              ))}
            </div>
          </div>
        </div>
        {run.status === 'calculating' && (
          <div className="hr-panel mb-3 px-4 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span>{t('payroll.calculating', { done: run.progress.done ?? 0, total: run.progress.total ?? 0 })}</span>
              <span className="hr-mono">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hr-sunk)]">
              <div className="h-full bg-[var(--hr-rh)] transition-[width] duration-200" style={{ width: progress + '%' }} />
            </div>
          </div>
        )}
        {run.status === 'void' && <Notice tone="bad" className="mb-3">{t('payroll.void_notice', { reason: run.void_reason, who: run.voided_by_name })}</Notice>}
        {(run.progress.errors ?? []).length > 0 && <Notice tone="bad" className="mb-3">{t('payroll.calc_errors', { n: (run.progress.errors ?? []).length })}</Notice>}
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'employees' ? undefined : v })}
          label={t('payroll.run_tabs')}
          className="mb-3"
          tabs={[
            { value: 'employees', label: t('payroll.tab.employees'), count: run.employee_count },
            { value: 'issues', label: t('payroll.tab.issues'), count: blockers + (run.issues_summary.warnings ?? 0) },
            { value: 'changes', label: t('payroll.tab.changes') },
            { value: 'components', label: t('payroll.tab.components') },
            { value: 'notes', label: t('payroll.tab.notes'), count: data?.open_notes ?? 0 },
          ]}
        />
        {tab === 'employees' && <EmployeesTab data={data} onOpen={openSlip} />}
        {tab === 'issues' && <IssuesTab runId={run.id} currency={cur} periodStart={run.period_start} open={['draft', 'calculated', 'approved'].indexOf(run.status) >= 0} canAck={edit && run.status === 'calculated'} onAckAll={() => void acknowledgeAll()} />}
        {tab === 'changes' && <ChangesTab runId={run.id} currency={cur} onOpen={(s) => setQuery({ slip: s })} />}
        {tab === 'components' && <ComponentsTab runId={run.id} currency={cur} />}
        {tab === 'notes' && <NotesTab runId={run.id} />}
      </PageBody>
      <PayslipDrawer
        id={slip}
        fix
        onClose={() => setQuery({ slip: undefined })}
        extra={(s) =>
          edit && ['draft', 'calculated', 'approved'].indexOf(run.status) >= 0 && !s.held ? (
            <Button size="sm" variant="ghost" icon={Hand} onClick={() => setHoldFor(s.employment)}>
              {t('payroll.act.hold')}
            </Button>
          ) : null
        }
      />
      <Dialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={t('payroll.void.title', { number: runTitle(run) })}
        footer={
          <>
            <Button onClick={() => setVoidOpen(false)}>{t('ui.cancel')}</Button>
            <Button variant="danger" icon={RotateCcw} busy={busy === 'void'} disabled={voidReason.trim() === '' || voidPin.length !== 6} onClick={() => void doVoid()}>
              {t('payroll.act.void_now')}
            </Button>
          </>
        }
      >
        <Field label={t('payroll.void.reason')}>
          <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} minRows={3} />
        </Field>
        <div className="mt-2 text-[12px] text-[var(--hr-muted)]">{t('payroll.void.what')}</div>
        <Field label={t('payroll.pin_label')} className="mt-3">
          <PinBoxes value={voidPin} onChange={setVoidPin} label={t('payroll.pin_label')} align="start" />
        </Field>
      </Dialog>
      <Dialog
        open={holdFor !== ''}
        onClose={() => setHoldFor('')}
        title={t('payroll.hold.title')}
        footer={
          <>
            <Button onClick={() => setHoldFor('')}>{t('ui.cancel')}</Button>
            <Button variant="primary" icon={Hand} disabled={holdReason.trim() === ''} onClick={() => void run1('hold', async () => { await op('holds.hold', { payrun: run.id, employment: holdFor, reason: holdReason.trim() }); setHoldFor(''); setHoldReason(''); }, t('payroll.toast.held'))}>
              {t('payroll.act.hold')}
            </Button>
          </>
        }
      >
        <Field label={t('payroll.hold.reason')}>
          <Textarea value={holdReason} onChange={(e) => setHoldReason(e.target.value)} minRows={2} />
        </Field>
      </Dialog>
    </>
  );
}

function reasonText(reasons: string[] | undefined): string {
  return (reasons ?? []).map((r) => t('payroll.reason.' + r)).join(', ');
}

function EmployeesTab({ data, onOpen }: { data: RunGet | null; onOpen: (r: SlipRow) => void }): React.JSX.Element {
  const cur = data?.payrun.currency ?? '';
  const [only, setOnly] = useState<'all' | 'issues'>('all');
  const columns: Column<SlipRow>[] = useMemo(
    () => [
      { key: 'name', label: t('payroll.col.person'), width: 'minmax(200px,2fr)', sort: (r) => r.name, phone: 'title', render: (r) => (
          <span className="flex min-w-0 items-center gap-2">
            {r.blockers > 0 ? <StatusDot tone="bad" /> : r.warnings > 0 ? <StatusDot tone="warn" /> : <StatusDot tone="faint" />}
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{r.number}</span>
            {r.held && <Tag tone="warn">{t('payroll.held')}</Tag>}
          </span>
        ) },
      { key: 'gross', label: t('payroll.gross'), width: '130px', align: 'right', mono: true, sort: (r) => r.gross_minor, hideBelow: 'lg', render: (r) => <Money minor={r.gross_minor} currency={cur} /> },
      { key: 'ded', label: t('payroll.deductions'), width: '120px', align: 'right', mono: true, sort: (r) => r.deductions_minor, hideBelow: 'lg', render: (r) => <Money minor={r.deductions_minor} currency={cur} /> },
      { key: 'net', label: t('payroll.net'), width: '130px', align: 'right', mono: true, sort: (r) => r.net_minor, phone: 'end', render: (r) => <Money minor={r.net_minor} currency={cur} /> },
      { key: 'change', label: t('payroll.col.change'), width: 'minmax(150px,1.2fr)', align: 'right', mono: true, sort: (r) => Math.abs(r.variance.delta_net_minor ?? 0), render: (r) =>
          r.variance.pct === null || r.variance.pct === undefined ? (
            <span className="text-[12px] text-[var(--hr-faint)]">{reasonText(r.variance.reasons)}</span>
          ) : (
            <span title={reasonText(r.variance.reasons)} className={Math.abs(r.variance.pct) > 10 ? 'text-[var(--hr-warn)]' : ''}>
              {(r.variance.pct > 0 ? '+' : '') + r.variance.pct + '%'}
            </span>
          ) },
      { key: 'employer', label: t('payroll.employer_cost'), width: '120px', align: 'right', mono: true, hideBelow: 'xl', sort: (r) => r.employer_minor, render: (r) => <Money minor={r.employer_minor} currency={cur} /> },
    ],
    [cur],
  );
  if (data === null) return <Loading />;
  const rows = only === 'issues' ? data.payslips.filter((r) => r.blockers + r.warnings > 0) : data.payslips;
  return (
    <div className="hr-panel hr-in min-w-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2">
        <Segmented value={only} onChange={setOnly} size="sm" label={t('payroll.show')} options={[{ value: 'all', label: t('payroll.show_all') }, { value: 'issues', label: t('payroll.show_issues') }]} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        label={t('payroll.tab.employees')}
        initialSort={{ key: 'name', dir: 'asc' }}
        empty={<Empty icon={Users} title={data.payrun.status === 'draft' ? t('payroll.empty.not_calculated') : t('payroll.empty.nobody')} />}
      />
    </div>
  );
}

/** "Marcus Lee, Grace Kim and 3 more". */
function peopleWords(names: string[]): string {
  const shown = names.slice(0, 4);
  return names.length > 4 ? t('payroll.people_and_more', { names: shown.join(', '), n: names.length - 4 }) : shown.join(', ');
}

function IssuesTab({ runId, currency, periodStart, open, canAck, onAckAll }: { runId: string; currency: string; periodStart: string; open: boolean; canAck: boolean; onAckAll: () => void }): React.JSX.Element {
  const [details, setDetails] = useState<Record<string, boolean>>({});
  const live = useOp<{ issues: Issue[]; summary: { blockers: number; warnings: number; unacknowledged: number } }>('payruns.issues', { payrun: runId }, READS);
  const d = live.data;
  if (d === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  if (d.issues.length === 0) return <Empty icon={BadgeCheck} title={t('payroll.empty.no_issues')} />;
  const groups = [
    { sev: 'blocker', label: t('payroll.blockers'), items: d.issues.filter((i) => i.severity === 'blocker') },
    { sev: 'warning', label: t('payroll.warnings'), items: d.issues.filter((i) => i.severity === 'warning') },
    { sev: 'held', label: t('payroll.issues_held'), items: d.issues.filter((i) => i.severity === 'held') },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, gi) => {
        // One block per person, the run's own issues first.
        const people: { key: string; name: string; number: string; items: Issue[] }[] = [];
        for (const i of g.items) {
          const key = i.employment ?? '';
          let p = people.find((x) => x.key === key);
          if (p === undefined) {
            p = { key: key, name: i.name ?? '', number: i.number ?? '', items: [] };
            people.push(p);
          }
          p.items.push(i);
        }
        people.sort((a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : a.name.localeCompare(b.name)));
        return (
          <Panel key={g.sev} index={String(gi + 1).padStart(2, '0')} label={g.label + ' · ' + g.items.length} aside={g.sev === 'warning' && canAck && d.summary.unacknowledged > 0 ? <Button size="sm" icon={BadgeCheck} onClick={onAckAll}>{t('payroll.act.ack_all')}</Button> : undefined}>
            {g.sev === 'held' && <div className="mb-2 text-[12px] text-[var(--hr-muted)]">{t('payroll.issues_held_note')}</div>}
            <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
              {people.map((p) => (
                <div key={p.key} className="min-w-0 py-2">
                  {p.key !== '' && (
                    <div className="mb-1 flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 truncate text-[13px] font-medium">{p.name}</span>
                      <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{p.number}</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {p.items.map((i, k) => (
                      <div key={k} className="flex min-w-0 flex-wrap items-start gap-2">
                        <span className="mt-1.5">
                          <StatusDot tone={i.severity === 'blocker' ? 'bad' : i.severity === 'held' ? 'faint' : i.acknowledged ? 'faint' : 'warn'} />
                        </span>
                        <div className="hr-wrap min-w-0 flex-1 text-[13px]">
                          <span className="text-[var(--hr-ink-2)]">{issueText(i)}</span>
                          {issueWhen(i) !== '' && <span className="text-[var(--hr-muted)]">{' (' + issueWhen(i) + ')'}</span>}
                          {i.people !== undefined && i.people.length > 0 && <div className="text-[12px] text-[var(--hr-muted)]">{peopleWords(i.people.map((x) => x.name))}</div>}
                          {i.acknowledged && <div className="text-[12px] text-[var(--hr-muted)]">{t('payroll.acknowledged_by', { who: i.acknowledged.by_name, reason: t('payroll.ack.' + i.acknowledged.reason) })}</div>}
                          <button type="button" className="hr-link block cursor-pointer text-[12px] text-[var(--hr-faint)] hover:text-[var(--hr-muted)] max-sm:min-h-10" aria-expanded={details[i.key] === true} onClick={() => setDetails((x) => ({ ...x, [i.key]: !x[i.key] }))}>
                            {t('payroll.details')}
                          </button>
                          {details[i.key] === true && (
                            <div className="hr-mono hr-wrap text-[10.5px] text-[var(--hr-faint)]">{[i.code, i.pack ?? '', i.detail ?? ''].filter((x) => x !== '').join(' · ')}</div>
                          )}
                        </div>
                        {open ? <IssueFix issue={i} runId={runId} currency={currency} periodStart={periodStart} /> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function ChangesTab({ runId, currency, onOpen }: { runId: string; currency: string; onOpen: (slip: string) => void }): React.JSX.Element {
  const live = useOp<Variance>('payruns.variance', { payrun: runId }, READS);
  const v = live.data;
  if (v === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  if (v.previous === null) return <Empty icon={BadgeCheck} title={t('payroll.empty.no_previous')} />;
  const tt = v.totals.this;
  const pt = v.totals.prev;
  const delta = (a: number, b: number): React.ReactNode => {
    const d = a - b;
    return <Money minor={d} currency={currency} format={{ sign: true }} className={d === 0 ? 'text-[var(--hr-faint)]' : ''} />;
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('payroll.changes.totals', { number: v.previous.number })}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {tt && pt && [
            ['payroll.gross', tt.gross_minor, pt.gross_minor],
            ['payroll.deductions', tt.deductions_minor, pt.deductions_minor],
            ['payroll.employer_cost', tt.employer_minor, pt.employer_minor],
            ['payroll.net', tt.net_minor, pt.net_minor],
          ].map(([k, a, b]) => (
            <div key={String(k)} className="min-w-0">
              <div className="hr-label">{t(String(k))}</div>
              <div className="hr-mono hr-num text-[13px]">{delta(Number(a), Number(b))}</div>
            </div>
          ))}
          {tt && pt && (
            <div>
              <div className="hr-label">{t('payroll.headcount')}</div>
              <div className="hr-mono hr-num text-[13px]">{(tt.headcount - pt.headcount > 0 ? '+' : '') + (tt.headcount - pt.headcount)}</div>
            </div>
          )}
        </div>
      </Panel>
      <Panel index="02" label={t('payroll.changes.people')} flush>
        <div className="divide-y divide-[var(--hr-hair)]">
          {v.by_employee.filter((x) => x.delta_net_minor !== 0).slice(0, 200).map((x) => (
            <button key={x.payslip} type="button" onClick={() => onOpen(x.payslip)} className="group flex min-h-10 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--hr-hover)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{x.name}</span>
                <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{reasonText(x.reasons)}</span>
              </span>
              <span className="hr-mono hr-num text-right text-[13px]">
                {delta(x.net_minor, x.prev_net_minor)}
                {x.pct !== null && <span className="ml-2 text-[12px] text-[var(--hr-faint)]">{(x.pct > 0 ? '+' : '') + x.pct + '%'}</span>}
              </span>
              <RowCue />
            </button>
          ))}
          {v.by_employee.every((x) => x.delta_net_minor === 0) && <div className="px-4 py-3 text-[13px] text-[var(--hr-muted)]">{t('payroll.changes.none')}</div>}
        </div>
      </Panel>
      <Panel index="03" label={t('payroll.changes.components')} flush>
        <div className="divide-y divide-[var(--hr-hair)]">
          {v.by_component.slice(0, 100).map((c) => (
            <div key={c.code + c.kind} className="flex min-h-10 items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {c.name} <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{c.code}</span>
                {c.added && <Tag tone="rh" className="ml-2">{t('payroll.added')}</Tag>}
                {c.removed && <Tag tone="faint" className="ml-2">{t('payroll.removed')}</Tag>}
              </span>
              <span className="hr-mono hr-num text-[13px]">{delta(c.this_minor, c.prev_minor)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ComponentsTab({ runId, currency }: { runId: string; currency: string }): React.JSX.Element {
  const live = useOp<Variance>('payruns.variance', { payrun: runId }, READS);
  const v = live.data;
  if (v === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const rows = v.components.filter((c) => c.this_minor !== 0);
  if (rows.length === 0) return <Empty icon={Calculator} title={t('payroll.empty.not_calculated')} />;
  const cols: Column<CompRow>[] = [
    { key: 'name', label: t('payroll.col.component'), width: 'minmax(200px,2fr)', phone: 'title', sort: (r) => r.name, render: (r) => (<span className="min-w-0 truncate">{r.name} <span className="hr-mono text-[10.5px] text-[var(--hr-faint)]">{r.code}</span></span>) },
    { key: 'kind', label: t('payroll.col.kind'), width: '160px', render: (r) => t('payroll.ckind.' + r.kind) + (r.stage !== '' ? ' · ' + t('payroll.stage.' + r.stage) : '') },
    { key: 'this', label: t('payroll.this_run'), width: '140px', align: 'right', mono: true, phone: 'end', sort: (r) => r.this_minor, render: (r) => <Money minor={r.this_minor} currency={currency} /> },
    { key: 'prev', label: t('payroll.last_run'), width: '140px', align: 'right', mono: true, hideBelow: 'lg', sort: (r) => r.prev_minor, render: (r) => <Money minor={r.prev_minor} currency={currency} /> },
  ];
  return (
    <div className="hr-panel hr-in min-w-0">
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.code + r.kind} label={t('payroll.tab.components')} />
    </div>
  );
}

function NotesTab({ runId }: { runId: string }): React.JSX.Element {
  const live = useOp<{ notes: Note[] }>('payruns.notes', { payrun: runId }, READS);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('payruns.note', { payrun: runId, body: text.trim() });
      setText('');
      changed('payrun_notes');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const notes = live.data?.notes ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="hr-panel flex flex-col gap-2 px-3 py-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} minRows={2} placeholder={t('payroll.note_placeholder')} />
        <div className="flex justify-end">
          <Button size="sm" icon={MessageSquarePlus} busy={busy} disabled={text.trim() === ''} onClick={() => void add()}>
            {t('payroll.act.add_note')}
          </Button>
        </div>
      </div>
      {notes === null ? (
        <Loading />
      ) : notes.length === 0 ? (
        <Empty icon={MessageSquarePlus} title={t('payroll.empty.no_notes')} />
      ) : (
        notes.map((n) => (
          <div key={n.id} className="hr-panel px-3 py-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--hr-muted)]">
              {n.actor === 'agent' && <Sparkle size={13} />}
              <span className="font-medium text-[var(--hr-ink)]">{n.who}</span>
              {n.kind !== 'note' && <Tag tone={n.kind === 'flag' ? (n.severity === 'blocker' ? 'bad' : 'warn') : n.actor === 'agent' ? 'agent' : 'neutral'}>{t('payroll.note_kind.' + n.kind)}</Tag>}
              {n.employee_name !== '' && <span>{n.employee_name}</span>}
              {n.code !== '' && <span className="hr-mono text-[10.5px]">{n.code}</span>}
              <span className="flex-1" />
              <span>{ago(n.created)}</span>
              {!n.resolved && n.kind === 'flag' && (
                <Button size="sm" variant="ghost" onClick={() => void op('payruns.note-resolve', { note: n.id }).then(() => changed('payrun_notes'))}>
                  {t('payroll.act.resolve')}
                </Button>
              )}
            </div>
            <div className={'hr-wrap whitespace-pre-line text-[13px] ' + (n.resolved ? 'text-[var(--hr-faint)]' : '')}>{n.body}</div>
          </div>
        ))
      )}
    </div>
  );
}
