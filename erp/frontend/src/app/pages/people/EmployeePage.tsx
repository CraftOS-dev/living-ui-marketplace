/**
 * One person: their profile (photo, job, department, manager, reports) and
 * tabs for what the viewer may see: an overview (contact, employment, leave
 * rings, upcoming leave, recent claims), their leave, claims, pay (basic pay,
 * pay components, payslips), time on projects, and the record's history.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Briefcase,
  Camera,
  CalendarDays,
  CalendarPlus,
  Clock,
  Copy,
  Image as ImageIcon,
  KeyRound,
  Mail,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Trash2,
  UserX,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { Bars } from '../../components/charts.tsx';
import { Menu, Tabs } from '../../components/controls.tsx';
import { CLAIM_STATE, EMPLOYEE_STATUS, EMPLOYMENT_LABEL, FREQUENCY_LABEL, PersonAvatar, RUN_STATE, rangeLabel } from '../../components/people/common.tsx';
import { EmployeeForm } from '../../components/people/EmployeeForm.tsx';
import { BalanceRing, LeaveRequestModal, LeaveRow } from '../../components/people/Leave.tsx';
import { MoneyInput, NumberInput } from '../../components/pickers.tsx';
import { DataTable } from '../../components/table.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, LoadError, Modal, Notice, PageHeader, PageSkeleton, PillButton, PillSelect, Skeleton, StatusPill, TextLink, Tile, softInput, useConfirm } from '../../components/ui.tsx';
import { op, opForm } from '../../lib/api.ts';
import { addDays, dayLabel, shortDay, today } from '../../lib/dates.ts';
import { hours, money, plural, qty } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { baseCurrency, can, moduleOn, useMe } from '../../lib/me.ts';
import { back, navigate, replaceQuery, useSection } from '../../lib/router.ts';
import type { Me } from '../../lib/types.ts';
import type { ClaimList, Components, EmployeeDetail, LeaveList, MyPayslips } from '../../lib/types/people.ts';
import type { TimeList } from '../../lib/types/work.ts';
import type { PageProps } from '../../routes.tsx';

type Tab = 'overview' | 'leave' | 'claims' | 'pay' | 'time' | 'activity';

/** How the viewer reaches this person's self-service records. */
function scopeFor(e: EmployeeDetail, all: boolean): 'mine' | 'team' | 'all' {
  if (e.own) return 'mine';
  if (all) return 'all';
  return 'team';
}

function tenure(start: string): string {
  if (start === '') return '';
  const t = today();
  let months = (Number(t.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + (Number(t.slice(5, 7)) - Number(start.slice(5, 7)));
  if (Number(t.slice(8, 10)) < Number(start.slice(8, 10))) months -= 1;
  if (months < 0) return 'starts soon';
  if (months < 1) return 'new this month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y > 0 ? plural(y, 'year') : '', m > 0 ? plural(m, 'month') : ''].filter((x) => x !== '').join(' ');
}

function Row({ icon: Icon, label, children }: { icon?: typeof Mail | undefined; label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon !== undefined && (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">
          <Icon size={14} aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-[var(--erp-muted)]">{label}</p>
        <div className="break-words text-[14px] font-semibold">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- invite */

function InviteModal({ e, onClose }: { e: EmployeeDetail; onClose: () => void }): React.JSX.Element {
  const [roles, setRoles] = useState<{ id: string; name: string; key: string }[] | null>(null);
  const [role, setRole] = useState('');
  const [email, setEmail] = useState(e.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    op<{ roles: { id: string; name: string; key: string }[] }>('roles.list', {}, { quiet: true })
      .then((r) => {
        setRoles(r.roles.filter((x) => x.key !== 'owner'));
        setRole(r.roles.find((x) => x.key === 'employee')?.id ?? r.roles[0]?.id ?? '');
      })
      .catch((err: unknown) => setError((err as Error).message));
  }
  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await op<{ code: string }>('members.invite', { name: e.name, email: email.trim(), role, title: e.job_title, employee: e.id }, { quiet: true });
      setCode(r.code);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={code === null ? `Invite ${e.name} to the app` : 'Invite ready'}
      description={code === null ? 'They sign in to request leave, file claims, log time and see their payslips.' : undefined}
      footer={
        code === null ? (
          <>
            <PillButton variant="soft" onClick={onClose}>
              Cancel
            </PillButton>
            <PillButton icon={KeyRound} dot loading={busy} disabled={email.trim() === '' || role === ''} onClick={() => void send()}>
              Create invite
            </PillButton>
          </>
        ) : (
          <PillButton onClick={onClose}>Done</PillButton>
        )
      }
    >
      {code === null ? (
        <div className="flex flex-col gap-4">
          <Field label="Their email">
            <input value={email} onChange={(x) => setEmail(x.target.value)} type="email" aria-label="Their email" className={softInput} />
          </Field>
          {roles === null ? <Skeleton className="h-11" rounded="rounded-full" /> : <PillSelect soft label="Role" value={role} onChange={setRole} options={roles.map((r) => ({ value: r.id, label: r.name }))} />}
          {error !== null && <Notice tone="bad">{error}</Notice>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-[var(--erp-ink-2)]">Give {e.name.split(' ')[0]} this code. It is shown only once and works for 7 days.</p>
          <div className="flex items-center gap-3 rounded-[20px] bg-[var(--erp-row)] px-4 py-3">
            <span className="num min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-wider">{code}</span>
            <CircleButton
              icon={Copy}
              label="Copy the code"
              variant="light"
              size={36}
              onClick={() => {
                void navigator.clipboard.writeText(code).then(() => toast.success('Copied'));
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------- tabs */

function UpcomingLeave({ e, scope }: { e: EmployeeDetail; scope: 'mine' | 'team' | 'all' }): React.JSX.Element {
  const live = useLive(() => op<LeaveList>('leave.list', { scope, employee: e.own ? undefined : e.id, from: today(), limit: 5 }, { quiet: true }), ['leave_requests'], [e.id, scope]);
  const rows = (live.data?.requests ?? []).filter((r) => r.status === 'approved' || r.status === 'submitted');
  return (
    <Card delay={3}>
      <CardHeader title="Upcoming leave" icon={CalendarDays} />
      {live.data === null ? (
        <Skeleton className="h-12" />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[var(--erp-muted)]">Nothing booked.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{r.type?.name ?? 'Leave'}</span>
                <span className="block truncate text-[12px] text-[var(--erp-muted)]">{rangeLabel(r.from, r.to)}</span>
              </span>
              <StatusPill tone={r.status === 'approved' ? 'good' : 'warn'} size="sm">
                {r.status === 'approved' ? qty(r.days) + (r.days === 1 ? ' day' : ' days') : 'Waiting'}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LeaveTab({ e, scope, onRequest }: { e: EmployeeDetail; scope: 'mine' | 'team' | 'all'; onRequest: () => void }): React.JSX.Element {
  const live = useLive(() => op<LeaveList>('leave.list', { scope, employee: e.own ? undefined : e.id, limit: 100 }, { quiet: true }), ['leave_requests'], [e.id, scope]);
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <Card className="@min-[900px]:col-span-8">
        <CardHeader
          title="Leave requests"
          subtitle={live.data !== null ? plural(live.data.total, 'request') : undefined}
          action={
            e.own ? (
              <PillButton size="sm" icon={CalendarPlus} dot onClick={onRequest}>
                Request leave
              </PillButton>
            ) : undefined
          }
        />
        {live.error !== null && live.data === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : live.data === null ? (
          <Skeleton className="h-16" />
        ) : live.data.requests.length === 0 ? (
          <Empty icon={CalendarDays} title="No leave yet" compact />
        ) : (
          <ul className="flex flex-col gap-2">
            {live.data.requests.map((r) => (
              <LeaveRow key={r.id} r={r} showPerson={false} onChanged={live.reload} />
            ))}
          </ul>
        )}
      </Card>
      {e.leave !== undefined && (
        <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
          <CardHeader title={`Balances ${e.leave.year}`} />
          <div className="flex flex-col gap-2">
            {e.leave.types.map((b) => (
              <BalanceRing key={b.type.id} b={b} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ClaimsTab({ e, scope }: { e: EmployeeDetail; scope: 'mine' | 'team' | 'all' }): React.JSX.Element {
  const live = useLive(() => op<ClaimList>('claims.list', { scope, employee: e.own ? undefined : e.id, limit: 100 }, { quiet: true }), ['expense_claims', 'claim_lines'], [e.id, scope]);
  const d = live.data;
  return (
    <Card>
      <CardHeader
        title="Expense claims"
        subtitle={d !== null ? `${plural(d.total, 'claim')} · ${money(d.totals.total, d.currency)}` : undefined}
        action={
          e.own ? (
            <PillButton size="sm" icon={Plus} dot onClick={() => navigate('claims', { new: '1' })}>
              New claim
            </PillButton>
          ) : undefined
        }
      />
      {live.error !== null && d === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : (
        <DataTable
          ariaLabel="Expense claims"
          rows={d?.claims ?? []}
          loading={d === null}
          rowKey={(c) => c.id}
          onOpen={(c) => navigate('claim', { id: c.id })}
          empty={<Empty icon={Receipt} title="No claims yet" compact />}
          columns={[
            { key: 'n', label: 'Claim', width: '120px', render: (c) => <span className="num font-semibold">{c.number}</span> },
            { key: 't', label: 'For', width: 'minmax(0, 2fr)', render: (c) => <span className="truncate">{c.title}</span> },
            { key: 'd', label: 'Date', width: '120px', hide: 'md', render: (c) => <span className="text-[var(--erp-ink-2)]">{dayLabel(c.date)}</span> },
            {
              key: 's',
              label: 'Status',
              width: '120px',
              render: (c) => (
                <StatusPill tone={CLAIM_STATE[c.status].tone} size="sm">
                  {CLAIM_STATE[c.status].label}
                </StatusPill>
              ),
            },
            { key: 'a', label: 'Amount', width: '120px', align: 'right', render: (c) => money(c.total, c.currency) },
          ]}
          mobile={(c) => ({ title: c.title, sub: `${c.number} · ${dayLabel(c.date)}`, right: money(c.total, c.currency), rightSub: CLAIM_STATE[c.status].label })}
        />
      )}
    </Card>
  );
}

function AssignModal({ e, onClose }: { e: EmployeeDetail; onClose: () => void }): React.JSX.Element {
  const cur = e.currency ?? 'USD';
  const live = useLive(() => op<Components>('payroll.components', { active: true }, { quiet: true }), ['pay_components'], []);
  const [comp, setComp] = useState('');
  const [mode, setMode] = useState<'default' | 'amount' | 'percent'>('default');
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comps = live.data?.components ?? [];
  const chosen = comps.find((c) => c.id === comp) ?? comps[0];
  const save = async (): Promise<void> => {
    if (chosen === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await op('payroll.assign', { employee: e.id, component: chosen.id, amount: mode === 'amount' ? amount : undefined, percent: mode === 'percent' ? percent : undefined }, { quiet: true });
      toast.success(`${chosen.name} added`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Give ${e.name.split(' ')[0] ?? ''} a pay component`}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Plus} loading={busy} disabled={chosen === undefined} onClick={() => void save()}>
            Add
          </PillButton>
        </>
      }
    >
      {live.data === null ? (
        <Skeleton className="h-11" rounded="rounded-full" />
      ) : comps.length === 0 ? (
        <Notice>No pay components yet. Add them on the Payroll page.</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <PillSelect
            soft
            label="Component"
            value={chosen?.id ?? ''}
            onChange={setComp}
            options={comps.map((c) => ({ value: c.id, label: `${c.name} (${c.calc === 'percent' ? `${c.percent}% of basic` : money(c.amount, cur)})` }))}
          />
          <PillSelect
            soft
            label="Amount"
            value={mode}
            onChange={(v) => setMode(v as 'default' | 'amount' | 'percent')}
            options={[
              { value: 'default', label: 'As the component says' },
              { value: 'amount', label: 'Their own amount' },
              { value: 'percent', label: 'Their own percent of basic pay' },
            ]}
          />
          {mode === 'amount' && (
            <Field label={`Per month (${cur})`}>
              <MoneyInput value={amount} onChange={setAmount} currency={cur} ariaLabel="Amount per month" />
            </Field>
          )}
          {mode === 'percent' && (
            <Field label="Percent of basic pay">
              <NumberInput value={percent} onChange={setPercent} ariaLabel="Percent of basic pay" suffix="%" decimals={2} />
            </Field>
          )}
          {error !== null && <Notice tone="bad">{error}</Notice>}
        </div>
      )}
    </Modal>
  );
}

function PayTab({ e, me }: { e: EmployeeDetail; me: Me }): React.JSX.Element {
  const cur = e.currency ?? baseCurrency(me);
  const [assigning, setAssigning] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const canAssign = can(me, 'payroll', 'edit');
  const slips = useLive(() => (e.own ? op<MyPayslips>('payroll.my-payslips', { limit: 24 }, { quiet: true }) : Promise.resolve(null)), ['payroll_runs', 'payslips'], [e.own]);
  const remove = async (componentId: string, name: string): Promise<void> => {
    if (!(await confirm(`${e.name} no longer gets ${name} from the next pay run.`, `Take away ${name}?`, 'Take away'))) return;
    try {
      await op('payroll.assign', { employee: e.id, component: componentId, active: false });
      toast.success('Removed');
    } catch {
      /* shown */
    }
  };
  const comps = e.components ?? [];
  return (
    <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
      <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
        <Card tone="dark">
          <p className="text-[13px] text-[var(--erp-on-dark-muted)]">Basic pay, {FREQUENCY_LABEL[e.pay_frequency ?? 'monthly'].toLowerCase()}</p>
          <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(e.pay_basic ?? 0, cur)}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 @min-[480px]:grid-cols-4">
            <Tile dark label="Cost per hour" value={(e.hourly_cost ?? 0) > 0 ? money(e.hourly_cost ?? 0, cur) : 'Not set'} />
            <Tile dark label="Salary account" value={e.bank_details !== undefined && e.bank_details !== '' ? e.bank_details : 'Not set'} />
            <Tile dark label="National id" value={e.national_id !== undefined && e.national_id !== '' ? e.national_id : 'Not set'} />
            <Tile dark label="Tax number" value={e.tax_number !== undefined && e.tax_number !== '' ? e.tax_number : 'Not set'} />
          </div>
        </Card>
        {e.own ? (
          <Card>
            <CardHeader title="Payslips" subtitle="Shown once a pay run is posted" />
            <DataTable
              ariaLabel="Payslips"
              rows={slips.data?.payslips ?? []}
              loading={slips.data === null}
              rowKey={(s) => s.id}
              onOpen={(s) => navigate('payslip', { id: s.id })}
              empty={<Empty icon={Wallet} title="No payslips yet" compact />}
              columns={[
                { key: 'm', label: 'Month', render: (s) => <span className="font-semibold">{s.run.month_name}</span> },
                { key: 'd', label: 'Paid', hide: 'md', render: (s) => <span className="text-[var(--erp-ink-2)]">{dayLabel(s.run.paid_on !== '' ? s.run.paid_on : s.run.pay_date)}</span> },
                { key: 'g', label: 'Gross', align: 'right', hide: 'md', render: (s) => money(s.gross, cur) },
                { key: 'n', label: 'Net pay', align: 'right', render: (s) => <span className="font-bold">{money(s.net, cur)}</span> },
              ]}
              mobile={(s) => ({ title: s.run.month_name, sub: RUN_STATE[s.run.status].label, right: money(s.net, cur) })}
            />
          </Card>
        ) : can(me, 'payroll') ? (
          <PayEstimate e={e} />
        ) : null}
      </div>
      <Card className="@min-[900px]:col-span-4" delay={2}>
        <CardHeader
          title="Pay components"
          subtitle="Only the ones given to this person; components for everyone apply too"
          action={canAssign ? <CircleButton icon={Plus} label="Add a pay component" variant="row" size={36} onClick={() => setAssigning(true)} /> : undefined}
        />
        {comps.length === 0 ? (
          <p className="text-[13px] text-[var(--erp-muted)]">None of their own.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {comps.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{c.component.name}</span>
                  <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                    {c.component.kind === 'earning' ? 'Earning' : c.component.kind === 'deduction' ? 'Deduction' : 'Paid by the company'} · {c.uses}
                  </span>
                </span>
                {canAssign && <CircleButton icon={Trash2} label={`Take away ${c.component.name}`} variant="ghost" size={32} onClick={() => void remove(c.component.id, c.component.name)} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {assigning && <AssignModal e={e} onClose={() => setAssigning(false)} />}
      {confirmEl}
    </div>
  );
}

const FACTOR: Record<string, [number, number]> = { monthly: [1, 1], semi_monthly: [2, 1], biweekly: [26, 12], weekly: [52, 12] };

/**
 * A month's pay as the next pay run would draft it: basic pay (per month)
 * with every component that applies to this person. An estimate: the pay
 * run computes the real figures.
 */
function PayEstimate({ e }: { e: EmployeeDetail }): React.JSX.Element {
  const cur = e.currency ?? 'USD';
  const live = useLive(() => op<Components>('payroll.components', { active: true }, { quiet: true }), ['pay_components', 'employee_components'], []);
  if (live.data === null) return <Skeleton className="h-48" rounded="rounded-[24px]" />;
  const f = FACTOR[e.pay_frequency ?? 'monthly'] ?? [1, 1];
  const basic = Math.round(((e.pay_basic ?? 0) * f[0]) / f[1]);
  const mine = new Map((e.components ?? []).map((a) => [a.component.id, a]));
  const lines: { name: string; kind: 'earning' | 'deduction' | 'employer'; amount: number }[] = [];
  for (const c of live.data.components) {
    const a = mine.get(c.id);
    if (c.applies === 'selected' && a === undefined) continue;
    let amount = c.calc === 'percent' ? Math.round((basic * c.percent_bp) / 10000) : c.amount;
    if (a !== undefined && a.override) amount = a.percent_bp > 0 ? Math.round((basic * a.percent_bp) / 10000) : a.amount;
    if (amount !== 0) lines.push({ name: c.name, kind: c.kind, amount });
  }
  const earnings = lines.filter((l) => l.kind === 'earning');
  const deductions = lines.filter((l) => l.kind === 'deduction');
  const employer = lines.filter((l) => l.kind === 'employer');
  const gross = basic + earnings.reduce((x, l) => x + l.amount, 0);
  const ded = deductions.reduce((x, l) => x + l.amount, 0);
  const emp = employer.reduce((x, l) => x + l.amount, 0);
  const net = gross - ded;
  const block = (title: string, rows: { name: string; amount: number }[], sign: string): React.JSX.Element | null =>
    rows.length === 0 ? null : (
      <div>
        <p className="mb-1 text-[12px] font-bold text-[var(--erp-muted)]">{title}</p>
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.name} className="flex items-baseline justify-between gap-3 py-1 text-[14px]">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="num shrink-0 font-semibold">
                {sign}
                {money(r.amount, cur)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <Card delay={2}>
      <CardHeader title="A month's pay" subtitle="As the next pay run drafts it; the run can still be adjusted" icon={Wallet} />
      {basic === 0 ? (
        <p className="text-[13px] text-[var(--erp-muted)]">No basic pay set, so pay runs leave this person out unless they have components.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 @min-[640px]:grid-cols-[1fr_220px]">
          <div className="flex flex-col gap-4">
            {block('Earnings', [{ name: 'Basic pay', amount: basic }, ...earnings], '')}
            {block('Deductions', deductions, '−')}
            {block('Paid by the company on top', employer, '')}
          </div>
          <div className="flex flex-col justify-between gap-4 rounded-[20px] bg-[var(--erp-row)] p-4">
            <div>
              <p className="text-[12px] font-semibold text-[var(--erp-muted)]">Net pay</p>
              <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(net, cur)}</p>
            </div>
            <div className="flex flex-col gap-1 text-[13px]">
              <span className="flex justify-between gap-2">
                <span className="text-[var(--erp-muted)]">Gross</span>
                <span className="num font-semibold">{money(gross, cur)}</span>
              </span>
              <span className="flex justify-between gap-2">
                <span className="text-[var(--erp-muted)]">Cost to the company</span>
                <span className="num font-semibold">{money(gross + emp, cur)}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function mondayOf(day: string): string {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return addDays(day, -((d.getDay() + 6) % 7));
}

function TimeTab({ e, scope }: { e: EmployeeDetail; scope: 'mine' | 'team' | 'all' }): React.JSX.Element {
  const start = mondayOf(addDays(today(), -7 * 11));
  const live = useLive(() => op<TimeList>('timesheets.list', { scope, employee: e.own ? undefined : e.id, from: start, limit: 1000 }, { quiet: true }), ['timesheets'], [e.id, scope]);
  const d = live.data;
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(start, i * 7));
  const per = new Map<string, number>();
  for (const t of d?.entries ?? []) {
    if (t.status === 'rejected') continue;
    const w = mondayOf(t.date);
    per.set(w, (per.get(w) ?? 0) + t.hours);
  }
  const thisWeek = mondayOf(today());
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Hours per week" subtitle={d !== null ? `${hours(d.totals.hours)} in 12 weeks, ${hours(d.totals.billable_hours)} billable` : undefined} />
        {live.error !== null && d === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : d === null ? (
          <Skeleton className="h-44" />
        ) : (
          <Bars
            height={160}
            format={(n) => qty(n)}
            points={weeks.map((w) => ({ key: w, label: `Week of ${dayLabel(w)}`, axis: shortDay(w), value: Math.round((per.get(w) ?? 0) * 100) / 100, text: hours(per.get(w) ?? 0), current: w === thisWeek }))}
          />
        )}
      </Card>
      <Card delay={2}>
        <CardHeader title="Latest time" />
        <DataTable
          ariaLabel="Time entries"
          rows={(d?.entries ?? []).slice(0, 30)}
          loading={d === null}
          rowKey={(t) => t.id}
          onOpen={(t) => navigate('project', { id: t.project.id })}
          empty={<Empty icon={Clock} title="No time logged lately" compact />}
          columns={[
            { key: 'd', label: 'Day', width: '130px', render: (t) => dayLabel(t.date) },
            { key: 'p', label: 'Project', width: 'minmax(0, 2fr)', render: (t) => <span className="truncate font-semibold">{t.project.name}</span> },
            { key: 'k', label: 'Task', hide: 'md', render: (t) => <span className="truncate text-[var(--erp-ink-2)]">{t.task?.title ?? ''}</span> },
            { key: 's', label: 'Status', width: '110px', hide: 'sm', render: (t) => <span className="text-[13px] text-[var(--erp-ink-2)]">{t.status === 'submitted' ? 'Waiting' : t.status === 'invoiced' ? 'Billed' : t.status[0]?.toUpperCase() + t.status.slice(1)}</span> },
            { key: 'h', label: 'Hours', width: '90px', align: 'right', render: (t) => hours(t.hours) },
          ]}
          mobile={(t) => ({ title: t.project.name, sub: `${dayLabel(t.date)}${t.task !== null ? ` · ${t.task.title}` : ''}`, right: hours(t.hours) })}
        />
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export function EmployeePage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = query.get('id') ?? '';
  const live = useLive(() => op<EmployeeDetail>('employees.get', { employee: id }, { quiet: true }), ['employees', 'departments', 'leave_requests', 'leave_adjustments', 'leave_types', 'expense_claims', 'employee_components', 'members'], [id]);
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [confirmEl, confirm] = useConfirm();
  useSection('employee', can(me, 'people') ? 'employees' : null);
  const e = live.data;

  if (e === null) {
    if (live.error !== null) {
      return (
        <div>
          <PageHeader back={() => back('employees')} title="Person" />
          <LoadError message={live.error} onRetry={live.reload} />
        </div>
      );
    }
    return <PageSkeleton />;
  }

  const tabParam = (query.get('tab') ?? 'overview') as Tab;
  const showTime = moduleOn(me, 'projects') && (e.own || can(me, 'projects') || e.can.leave);
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    ...(e.can.leave ? [{ value: 'leave' as Tab, label: 'Leave' }] : []),
    ...(e.claims !== undefined ? [{ value: 'claims' as Tab, label: 'Claims' }] : []),
    ...(e.pay ? [{ value: 'pay' as Tab, label: 'Pay' }] : []),
    ...(showTime ? [{ value: 'time' as Tab, label: 'Time' }] : []),
    ...(e.details ? [{ value: 'activity' as Tab, label: 'Activity' }] : []),
  ];
  const tab = tabs.some((t) => t.value === tabParam) ? tabParam : 'overview';
  const setTab = (t: Tab): void => replaceQuery('employee', { id, tab: t === 'overview' ? undefined : t });
  const allSelf = can(me, 'people');
  const leaveScope = scopeFor(e, allSelf);
  const claimScope = scopeFor(e, allSelf || can(me, 'accounting'));
  const timeScope = scopeFor(e, can(me, 'projects'));
  const st = EMPLOYEE_STATUS[e.status];

  const upload = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const r = await opForm<EmployeeDetail>('employees.update', { employee: e.id }, { photo: file });
      live.set(r);
      toast.success('Photo updated');
    } catch {
      /* shown */
    } finally {
      setUploading(false);
    }
  };
  const removePhoto = async (): Promise<void> => {
    try {
      const r = await op<EmployeeDetail>('employees.update', { employee: e.id, remove_photo: true });
      live.set(r);
    } catch {
      /* shown */
    }
  };
  const remove = async (): Promise<void> => {
    try {
      const p = await op<{ reports_moved: number; reports_move_to: { name: string } | null }>('employees.delete', { employee: e.id, preview: true }, { quiet: true });
      const ok = await confirm(
        `${e.name} is deleted.${p.reports_moved > 0 ? ` Their ${plural(p.reports_moved, 'report')} move to ${p.reports_move_to?.name ?? 'the top of the chart'}.` : ''}`,
        `Delete ${e.name}?`,
      );
      if (!ok) return;
      await op('employees.delete', { employee: e.id });
      toast.success('Deleted');
      navigate('employees');
    } catch (err) {
      const msg = (err as Error).message;
      await confirm(<span>{msg}</span>, 'This person cannot be deleted', 'Mark as left', false).then(async (yes) => {
        if (!yes) return;
        try {
          const r = await op<EmployeeDetail>('employees.update', { employee: e.id, status: 'left' });
          live.set(r);
        } catch {
          /* shown */
        }
      });
    }
  };

  return (
    <div>
      <header className="erp-rise mb-6 flex flex-wrap items-center gap-4 @min-[640px]:mb-7">
        <CircleButton icon={ArrowLeft} label="Back" variant="light" size={40} onClick={() => back(can(me, 'people') ? 'employees' : 'home')} className="self-start" />
        <div className="relative shrink-0">
          <PersonAvatar name={e.name} photo={e.photo} size={76} tone="card" />
          {e.can.edit && (
            <>
              <button
                type="button"
                aria-label={e.photo !== '' ? 'Change photo' : 'Add a photo'}
                title={e.photo !== '' ? 'Change photo' : 'Add a photo'}
                onClick={() => fileRef.current?.click()}
                className="erp-on-ink absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full bg-[var(--erp-ink)] text-[var(--erp-shell)] ring-4 ring-[var(--erp-shell)] transition-transform active:scale-90"
              >
                {uploading ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Camera size={14} aria-hidden />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(x) => {
                  const f = x.target.files?.[0];
                  if (f !== undefined) void upload(f);
                  x.target.value = '';
                }}
              />
            </>
          )}
        </div>
        <div className="min-w-[11rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-[26px] font-bold leading-[34px] tracking-[-0.01em]">{e.name}</h1>
            {e.status !== 'active' && st !== undefined && <StatusPill tone={st.tone}>{st.label}</StatusPill>}
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--erp-ink-2)]">
            {[e.job_title, e.department?.name ?? ''].filter((x) => x !== '').join(' · ') || 'No job title'}
            <span className="num text-[var(--erp-muted)]"> · {e.number}</span>
          </p>
          {e.manager !== null && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--erp-muted)]">
              Reports to
              <button type="button" onClick={() => navigate('employee', { id: e.manager?.id ?? '' })} className="inline-flex items-center gap-1.5 font-semibold text-[var(--erp-ink)] hover:underline">
                <PersonAvatar name={e.manager.name} photo={e.manager.photo} size={20} />
                {e.manager.name}
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {e.own && e.can.leave && (
            <PillButton variant="light" icon={CalendarPlus} onClick={() => setRequesting(true)}>
              Request leave
            </PillButton>
          )}
          {e.can.edit && (
            <PillButton variant="dark" icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </PillButton>
          )}
          <Menu
            items={[
              { label: 'Invite to the app', icon: KeyRound, hidden: !(me.admin && e.details && (e.member === null || e.member === undefined)), onClick: () => setInviting(true) },
              { label: 'Remove photo', icon: ImageIcon, hidden: !(e.can.edit && e.photo !== ''), onClick: () => void removePhoto() },
              { label: 'Mark as left', icon: UserX, hidden: !(e.can.edit && e.status !== 'left'), onClick: () => void op<EmployeeDetail>('employees.update', { employee: e.id, status: 'left' }).then(live.set).catch(() => undefined) },
              { label: 'Delete', icon: Trash2, danger: true, hidden: !e.can.delete, onClick: () => void remove() },
            ]}
          />
        </div>
      </header>

      {tabs.length > 1 && <Tabs ariaLabel="Sections" value={tab} onChange={setTab} tabs={tabs} />}

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
          <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
            <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2">
              <Card delay={1}>
                <CardHeader title="Contact" />
                <div className="-my-2 divide-y divide-[var(--erp-line)]">
                  <Row icon={Mail} label="Email">
                    {e.email !== '' ? (
                      <a href={`mailto:${e.email}`} className="hover:underline">
                        {e.email}
                      </a>
                    ) : (
                      <span className="text-[var(--erp-muted)]">Not set</span>
                    )}
                  </Row>
                  <Row icon={Phone} label="Phone">
                    {e.phone !== '' ? (
                      <a href={`tel:${e.phone}`} className="hover:underline">
                        {e.phone}
                      </a>
                    ) : (
                      <span className="text-[var(--erp-muted)]">Not set</span>
                    )}
                  </Row>
                  {e.details && e.address !== undefined && e.address !== '' && <Row label="Home address">{e.address}</Row>}
                  {e.details && e.birthday !== undefined && e.birthday !== '' && <Row label="Birthday">{dayLabel(e.birthday)}</Row>}
                  {e.details && e.emergency_contact !== undefined && e.emergency_contact !== '' && <Row label="Emergency contact">{e.emergency_contact}</Row>}
                </div>
              </Card>
              <Card delay={2}>
                <CardHeader title="Employment" />
                {e.details ? (
                  <div className="-my-2 divide-y divide-[var(--erp-line)]">
                    <Row icon={Briefcase} label="Contract">
                      {EMPLOYMENT_LABEL[e.employment ?? 'full_time']}
                    </Row>
                    <Row icon={CalendarDays} label="Started">
                      {e.start_date !== undefined && e.start_date !== '' ? (
                        <>
                          {dayLabel(e.start_date)} <span className="font-medium text-[var(--erp-muted)]">({tenure(e.start_date)})</span>
                        </>
                      ) : (
                        'Not set'
                      )}
                    </Row>
                    {e.end_date !== undefined && e.end_date !== '' && <Row label="Ends">{dayLabel(e.end_date)}</Row>}
                    <Row icon={Users} label="App account">
                      {e.member !== null && e.member !== undefined ? (
                        <span>
                          {e.member.email}
                          {e.member.status !== 'active' && <span className="font-medium text-[var(--erp-muted)]"> ({e.member.status})</span>}
                        </span>
                      ) : (
                        <span className="text-[var(--erp-muted)]">Not invited</span>
                      )}
                    </Row>
                  </div>
                ) : (
                  <p className="text-[13px] text-[var(--erp-muted)]">{e.department !== null ? `Works in ${e.department.name}.` : 'No department.'}</p>
                )}
              </Card>
            </div>
            {(e.reports.length > 0 || e.chain.length > 0) && (
              <Card delay={3}>
                <CardHeader title="Team" subtitle={e.reports.length > 0 ? plural(e.reports.length, 'direct report') : undefined} action={<TextLink tone="muted" onClick={() => navigate('org')}>Org chart</TextLink>} />
                {e.chain.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center gap-1 text-[12px] text-[var(--erp-muted)]">
                    {[...e.chain].reverse().map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1">
                        <button type="button" onClick={() => navigate('employee', { id: m.id })} className="rounded-full bg-[var(--erp-row)] px-2.5 py-1 font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
                          {m.name}
                        </button>
                        <span aria-hidden>/</span>
                      </span>
                    ))}
                    <span className="rounded-full px-1 font-bold text-[var(--erp-ink)]">{e.name}</span>
                  </div>
                )}
                {e.reports.length > 0 && (
                  <ul className="grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2">
                    {e.reports.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => navigate('employee', { id: r.id })} className="flex w-full items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5 text-left hover:bg-[var(--erp-row-hover)]">
                          <PersonAvatar name={r.name} photo={r.photo} size={36} tone="card" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-bold">{r.name}</span>
                            <span className="block truncate text-[12px] text-[var(--erp-muted)]">{r.job_title !== '' ? r.job_title : (r.department?.name ?? '')}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
          <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
            {e.leave !== undefined && (
              <Card tone="sand" delay={2}>
                <CardHeader
                  title={`Leave ${e.leave.year}`}
                  action={
                    e.own ? (
                      <PillButton size="sm" icon={CalendarPlus} dot onClick={() => setRequesting(true)}>
                        Request
                      </PillButton>
                    ) : undefined
                  }
                />
                <div className="flex flex-col gap-2">
                  {e.leave.types.map((b) => (
                    <BalanceRing key={b.type.id} b={b} onClick={() => setTab('leave')} />
                  ))}
                </div>
              </Card>
            )}
            {e.can.leave && <UpcomingLeave e={e} scope={leaveScope} />}
            {e.claims !== undefined && (
              <Card delay={4}>
                <CardHeader title="Recent claims" icon={Receipt} action={e.claims.length > 0 ? <TextLink tone="muted" onClick={() => setTab('claims')}>All</TextLink> : undefined} />
                {e.claims.length === 0 ? (
                  <p className="text-[13px] text-[var(--erp-muted)]">No claims yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {e.claims.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => navigate('claim', { id: c.id })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2 text-left hover:bg-[var(--erp-row-hover)]">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-bold">{c.title}</span>
                            <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                              {c.number} · {CLAIM_STATE[c.status].label}
                            </span>
                          </span>
                          <span className="num text-[13px] font-bold">{money(c.total, e.currency ?? baseCurrency(me))}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {e.details && e.notes !== undefined && e.notes !== '' && (
              <Card delay={5}>
                <CardHeader title="Notes" />
                <p className="whitespace-pre-line text-[14px] leading-[22px]">{e.notes}</p>
              </Card>
            )}
          </div>
        </div>
      )}
      {tab === 'leave' && <LeaveTab e={e} scope={leaveScope} onRequest={() => setRequesting(true)} />}
      {tab === 'claims' && <ClaimsTab e={e} scope={claimScope} />}
      {tab === 'pay' && <PayTab e={e} me={me} />}
      {tab === 'time' && <TimeTab e={e} scope={timeScope} />}
      {tab === 'activity' && <RecordActivity entity="employees" refId={e.id} title="History, notes and files" className="max-w-3xl" />}

      {editing && <EmployeeForm open={editing} onClose={() => setEditing(false)} employee={e} canPay={e.can.pay} currency={e.currency ?? baseCurrency(me)} onSaved={live.set} />}
      {requesting && <LeaveRequestModal open={requesting} onClose={() => setRequesting(false)} onDone={() => live.reload()} />}
      {inviting && <InviteModal e={e} onClose={() => setInviting(false)} />}
      {confirmEl}
    </div>
  );
}
