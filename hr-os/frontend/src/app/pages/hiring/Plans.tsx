/**
 * Requisitions (requests for new people, approved in the Inbox) and
 * staffing plans (planned headcount and budget per department against the
 * people there today). An approved requisition becomes an opening in one
 * step.
 */
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FilePlus2, LayoutList, Plus, Send, Trash2 } from 'lucide-react';
import { Button, DataTable, DayPicker, Dialog, Empty, Field, Input, LoadError, Loading, Money, MoneyInput, Notice, PageBody, PageHeader, Panel, Picker, RowCue, Segmented, Sheet, SheetHeader, StatTile, Textarea, confirmAsk, majorParam } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { OpeningDialog, RequisitionDialog } from '../../components/hiring/forms.tsx';
import { KV, Status, statusLabel, PayRange } from '../../components/hiring/bits.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { dayKey, fmtDay, fmtRange } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { toast } from '../../lib/toast.ts';
import { pickItems, useOrgList } from '../people/data.ts';
import type { Plan, PlanLine, Requisition } from './types.ts';
import { READS } from './types.ts';

/* -------------------------------------------------------- requisitions */

function ReqSheet({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const live = useOp<{ requisition: Requisition }>('requisitions.get', { requisition: id }, READS, { name: 'hiring.req' });
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const r = live.data?.requisition ?? null;
  const submit = async (): Promise<void> => {
    if (r === null) return;
    try {
      await op('requisitions.submit', { requisition: r.id });
      changed('requisitions', 'approvals');
      toast.success(t('hiring.req_sent', { number: r.number }));
    } catch {
      /* toast shown */
    }
  };
  const close = async (): Promise<void> => {
    if (r === null || !(await confirmAsk(t('hiring.close_req_text'), t('hiring.close_req'), t('hiring.close_req'), 'primary'))) return;
    try {
      await op('requisitions.close', { requisition: r.id });
      changed('requisitions', 'approvals');
      toast.success(t('hiring.req_closed'));
    } catch {
      /* toast shown */
    }
  };
  const remove = async (): Promise<void> => {
    if (r === null || !(await confirmAsk(t('hiring.delete_req_text'), t('hiring.delete_req')))) return;
    try {
      await op('requisitions.delete', { requisition: r.id });
      changed('requisitions');
      toast.success(t('hiring.req_deleted'));
      onClose();
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <SheetHeader title={r?.title ?? ''} meta={r !== null ? [r.number, statusLabel('requisition', r.status)].join(' · ') : undefined} onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {r === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : (
          <div className="flex flex-col gap-4">
            {r.status === 'rejected' && r.decided_note !== '' && <Notice tone="warn">{t('hiring.req_declined', { note: r.decided_note })}</Notice>}
            {r.status === 'pending' && <Notice>{t('hiring.waiting_approval')}</Notice>}
            <div className="flex flex-wrap gap-2">
              {r.can.submit && (
                <Button variant="primary" icon={Send} onClick={() => void submit()}>
                  {t('hiring.send_for_approval')}
                </Button>
              )}
              {r.can.open && (
                <Button variant="primary" icon={Plus} onClick={() => setOpening(true)}>
                  {t('hiring.create_opening')}
                </Button>
              )}
              {r.can.edit && <Button onClick={() => setEditing(true)}>{t('ui.edit')}</Button>}
              {r.can.close && <Button onClick={() => void close()}>{t('hiring.close_req')}</Button>}
              {r.can.edit && r.openings.length === 0 && (
                <Button variant="ghost" icon={Trash2} onClick={() => void remove()}>
                  {t('ui.remove')}
                </Button>
              )}
            </div>
            <div className="flex flex-col divide-y divide-[var(--hr-hair)]">
              <KV label={t('hiring.entity')}>{r.entity_name}</KV>
              {r.department_name !== '' && <KV label={t('hiring.department')}>{r.department_name}</KV>}
              <KV label={t('hiring.headcount')}>
                <span className="hr-mono hr-num">{r.hired > 0 ? `${r.hired}/${r.headcount}` : r.headcount}</span>
              </KV>
              <KV label={t('hiring.why_needed')}>{t(`hiring.req_reason.${r.reason}`) + (r.replaces_name !== '' ? ': ' + r.replaces_name : '')}</KV>
              {(r.pay_min !== '' || r.pay_max !== '') && (
                <KV label={t('hiring.pay_range_short')}>
                  <PayRange lo={r.pay_min_minor} hi={r.pay_max_minor} currency={r.currency} per={r.pay_per} />
                </KV>
              )}
              {r.budget_minor !== null && r.budget_minor > 0 && (
                <KV label={t('hiring.budget_short')}>
                  <Money minor={r.budget_minor} currency={r.currency} format={{ display: 'code' }} />
                </KV>
              )}
              {r.target_start_day !== '' && <KV label={t('hiring.target_start')}>{fmtDay(r.target_start_day)}</KV>}
              {r.hiring_manager_name !== '' && <KV label={t('hiring.hiring_manager')}>{r.hiring_manager_name}</KV>}
              <KV label={t('hiring.requested_by')}>{r.requested_by_name}</KV>
              {r.plan !== null && <KV label={t('hiring.plan')}>{r.plan.name}</KV>}
              {r.justification !== '' && <KV label={t('hiring.justification')}>{r.justification}</KV>}
            </div>
            {r.openings.length > 0 && (
              <div>
                <div className="hr-label mb-1">{t('hiring.openings')}</div>
                <ul className="divide-y divide-[var(--hr-line)] rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)]">
                  {r.openings.map((o) => (
                    <li key={o.id}>
                      <a href={`#/hiring/openings/${o.id}`} className="group hr-focus flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--hr-hover)]">
                        <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{o.number}</span>
                        <span className="hr-wrap min-w-0 flex-1 text-[13px]">{o.title}</span>
                        <Status kind="opening" status={o.status} />
                        <RowCue />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      {r !== null && <RequisitionDialog open={editing} onClose={() => setEditing(false)} requisition={r} />}
      {r !== null && <OpeningDialog open={opening} onClose={() => setOpening(false)} requisition={r} />}
    </>
  );
}

export function RequisitionsPage({ query }: PageProps): React.JSX.Element {
  const view = query.get('status') ?? 'open';
  const openId = query.get('open') ?? '';
  const [creating, setCreating] = useState(false);
  const live = useOp<{ requisitions: Requisition[]; total: number }>('requisitions.list', { status: view, limit: 300 }, READS, { name: 'hiring.reqs' });
  const me = useMe();
  const columns: Column<Requisition>[] = useMemo(
    () => [
      { key: 'title', label: t('hiring.col.title'), width: 'minmax(200px,1.6fr)', sort: (r) => r.title, phone: 'title', render: (r) => (
        <span className="min-w-0">
          <span className="hr-wrap block font-medium">{r.title}</span>
          <span className="hr-mono block text-[12px] text-[var(--hr-muted)]">{r.number}</span>
        </span>
      ) },
      { key: 'where', label: t('hiring.col.where'), width: 'minmax(150px,1.2fr)', sort: (r) => r.entity_name, phone: 'sub', render: (r) => [r.department_name, r.entity_name].filter((x) => x !== '').join(' · ') },
      { key: 'n', label: t('hiring.col.headcount'), width: '90px', align: 'right', mono: true, sort: (r) => r.headcount, hideBelow: 'lg', phone: 'hide', render: (r) => (r.hired > 0 ? `${r.hired}/${r.headcount}` : r.headcount) },
      { key: 'by', label: t('hiring.col.requested_by'), width: 'minmax(120px,1fr)', sort: (r) => r.requested_by_name, hideBelow: 'xl', phone: 'hide', render: (r) => r.requested_by_name },
      { key: 'status', label: t('hiring.col.status'), width: '120px', sort: (r) => r.status, phone: 'end', render: (r) => <Status kind="requisition" status={r.status} /> },
    ],
    [],
  );
  const d = live.data;
  return (
    <>
      <PageHeader title={t('hiring.requisitions')} meta={d !== null ? tn('hiring.meta_requisitions', d.total) : undefined}>
        {can(me, 'hiring', 'edit') && (
          <Button variant="primary" icon={FilePlus2} onClick={() => setCreating(true)} aria-label={t('hiring.request_role')}>
            <span className="hidden sm:inline">{t('hiring.request_role')}</span>
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <Segmented value={view} onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })} label={t('hiring.col.status')} size="sm" options={(['open', 'filled', 'closed', 'all'] as const).map((v) => ({ value: v, label: t(`hiring.rview.${v}`) }))} />
          </div>
          {d === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <DataTable
              label={t('hiring.requisitions')}
              columns={columns}
              rows={d.requisitions}
              rowKey={(r) => r.id}
              onRowClick={(r) => setQuery({ open: r.id })}
              empty={<Empty icon={ClipboardList} title={view === 'open' ? t('hiring.no_requisitions') : t('hiring.none_match')} action={can(me, 'hiring', 'edit') ? <Button icon={FilePlus2} onClick={() => setCreating(true)}>{t('hiring.request_role')}</Button> : undefined}>{view === 'open' ? t('hiring.no_requisitions_text') : undefined}</Empty>}
            />
          )}
        </div>
      </PageBody>
      <Sheet open={openId !== ''} onClose={() => setQuery({ open: undefined })} label={t('hiring.requisition')} width={480}>
        {openId !== '' && <ReqSheet id={openId} onClose={() => setQuery({ open: undefined })} />}
      </Sheet>
      <RequisitionDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/* ------------------------------------------------------- staffing plans */

function PlanDialog({ open, onClose, plan }: { open: boolean; onClose: () => void; plan?: Plan | null | undefined }): React.JSX.Element | null {
  const me = useMe();
  const { entity: chosen } = useUi();
  const year = Number(dayKey().slice(0, 4)) + 1;
  const [entity, setEntity] = useState('');
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'closed'>('draft');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setEntity(plan?.entity ?? (chosen !== '' ? chosen : (me.entities[0]?.id ?? '')));
    setName(plan?.name ?? t('hiring.plan_default_name', { year }));
    setFrom(plan?.from_day ?? `${year}-01-01`);
    setTo(plan?.to_day ?? `${year}-12-31`);
    setStatus(plan?.status ?? 'draft');
  }, [open, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ plan: Plan }>('staffing-plans.save', { plan: plan?.id, entity, name, from_day: from, to_day: to, status });
      changed('staffing_plans');
      toast.success(t('ui.saved'));
      if (!plan) navigate('/hiring/plans', { plan: r.plan.id });
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={plan ? t('hiring.edit_plan') : t('hiring.new_plan')}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={name.trim() === '' || entity === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hiring.entity')}>
          <Picker value={entity} onChange={(v) => setEntity(v)} items={me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.currency }))} label={t('hiring.entity')} disabled={plan !== undefined && plan !== null} />
        </Field>
        <Field label={t('hiring.plan_name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('hiring.plan_name')} />
        </Field>
        <Field label={t('hiring.from')}>
          <DayPicker value={from} onChange={setFrom} label={t('hiring.from')} />
        </Field>
        <Field label={t('hiring.until')}>
          <DayPicker value={to} onChange={setTo} label={t('hiring.until')} min={from} />
        </Field>
        <Field label={t('hiring.col.status')} className="sm:col-span-2">
          <Segmented value={status} onChange={setStatus} label={t('hiring.col.status')} size="sm" options={(['draft', 'active', 'closed'] as const).map((s) => ({ value: s, label: statusLabel('plan', s) }))} />
        </Field>
      </div>
    </Dialog>
  );
}

function LineDialog({ open, onClose, plan, line }: { open: boolean; onClose: () => void; plan: Plan; line: PlanLine | null }): React.JSX.Element | null {
  const departments = useOrgList('departments', plan.entity).items;
  const titles = useOrgList('titles').items;
  const [department, setDepartment] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [planned, setPlanned] = useState('0');
  const [budget, setBudget] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDepartment(line?.department ?? '');
    setJobTitle(line?.job_title ?? '');
    setPlanned(String(line?.planned ?? 0));
    setBudget(line?.budget_minor ?? null);
    setNote(line?.note ?? '');
  }, [open, line?.id]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('staffing-plans.line-save', { line: line?.id, plan: plan.id, department, job_title: jobTitle, planned: Number(planned), budget: majorParam(budget, plan.currency) ?? '0', note });
      changed('staffing_plan_lines', 'staffing_plans');
      toast.success(t('ui.saved'));
      onClose();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (line === null || !(await confirmAsk(t('hiring.remove_line_text'), t('hiring.remove_line')))) return;
    try {
      await op('staffing-plans.line-delete', { line: line.id });
      changed('staffing_plan_lines', 'staffing_plans');
      onClose();
    } catch {
      /* toast shown */
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={line ? t('hiring.edit_line') : t('hiring.add_line')}
      meta={plan.name}
      footer={
        <>
          {line !== null && (
            <Button variant="ghost" icon={Trash2} onClick={() => void remove()} className="mr-auto">
              {t('ui.remove')}
            </Button>
          )}
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={department === '' && jobTitle === ''} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('hiring.department')}>
          <Picker value={department} onChange={(v) => setDepartment(v)} items={pickItems(departments)} label={t('hiring.department')} clearable />
        </Field>
        <Field label={t('hiring.title_list')} optional>
          <Picker value={jobTitle} onChange={(v) => setJobTitle(v)} items={pickItems(titles)} label={t('hiring.title_list')} clearable />
        </Field>
        <Field label={t('hiring.planned_headcount')}>
          <Input value={planned} onChange={(e) => setPlanned(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" aria-label={t('hiring.planned_headcount')} />
        </Field>
        <Field label={t('hiring.budget', { currency: plan.currency })} optional>
          <MoneyInput value={budget} onChange={setBudget} currency={plan.currency} label={t('hiring.budget_short')} />
        </Field>
        <Field label={t('hiring.note')} optional className="sm:col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('hiring.note')} minRows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

function PlanView({ id }: { id: string }): React.JSX.Element {
  const live = useOp<{ plan: Plan }>('staffing-plans.get', { plan: id }, READS, { name: 'hiring.plan' });
  const me = useMe();
  const full = can(me, 'hiring', 'full');
  const [line, setLine] = useState<PlanLine | null | 'new'>(null);
  const [editing, setEditing] = useState(false);
  const p = live.data?.plan ?? null;
  const columns: Column<PlanLine>[] = useMemo(
    () => [
      { key: 'what', label: t('hiring.col.department'), width: 'minmax(180px,1.6fr)', sort: (r) => r.department_name, phone: 'title', render: (r) => (
        <span className="min-w-0">
          <span className="hr-wrap block font-medium">{r.department_name || r.title}</span>
          {r.job_title_name !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{r.job_title_name}</span>}
        </span>
      ) },
      { key: 'planned', label: t('hiring.col.planned'), width: '90px', align: 'right', mono: true, sort: (r) => r.planned, render: (r) => r.planned },
      { key: 'current', label: t('hiring.col.today'), width: '90px', align: 'right', mono: true, sort: (r) => r.current, render: (r) => r.current },
      { key: 'requested', label: t('hiring.col.requested'), width: '100px', align: 'right', mono: true, sort: (r) => r.requested, hideBelow: 'lg', phone: 'hide', render: (r) => r.requested },
      { key: 'gap', label: t('hiring.col.gap'), width: '80px', align: 'right', mono: true, sort: (r) => r.gap, phone: 'end', render: (r) => <span className={r.gap > 0 ? 'text-[var(--hr-warn)]' : ''}>{r.gap}</span> },
      { key: 'budget', label: t('hiring.col.budget'), width: '150px', align: 'right', mono: true, sort: (r) => r.budget_minor ?? 0, hideBelow: 'lg', phone: 'hide', render: (r) => (r.budget_minor !== null && r.budget_minor > 0 && p !== null ? <Money minor={r.budget_minor} currency={p.currency} format={{ display: 'code' }} /> : '') },
    ],
    [p?.currency], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (p === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile index="01" label={t('hiring.kpi.planned')} value={p.totals.planned} />
        <StatTile index="02" label={t('hiring.kpi.today')} value={p.totals.current} />
        <StatTile index="03" label={t('hiring.kpi.requested')} value={p.totals.requested} />
        <StatTile index="04" label={t('hiring.kpi.gap')} value={p.totals.gap} tone={p.totals.gap > 0 ? 'warn' : undefined} />
      </div>
      <Panel
        index="05"
        label={`${p.name} · ${fmtRange(p.from_day, p.to_day)}`}
        flush
        aside={
          full ? (
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t('ui.edit')}
              </Button>
              <Button size="sm" icon={Plus} onClick={() => setLine('new')}>
                {t('hiring.add_line')}
              </Button>
            </span>
          ) : undefined
        }
      >
        <DataTable
          label={p.name}
          columns={columns}
          rows={p.lines ?? []}
          rowKey={(r) => r.id}
          onRowClick={full ? (r) => setLine(r) : undefined}
          empty={<Empty icon={LayoutList} title={t('hiring.no_lines')} action={full ? <Button variant="primary" icon={Plus} onClick={() => setLine('new')}>{t('hiring.add_line')}</Button> : undefined}>{t('hiring.no_lines_text')}</Empty>}
        />
      </Panel>
      <LineDialog open={line !== null} onClose={() => setLine(null)} plan={p} line={line === 'new' ? null : line} />
      <PlanDialog open={editing} onClose={() => setEditing(false)} plan={p} />
    </div>
  );
}

export function PlansPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ plans: Plan[]; total: number }>('staffing-plans.list', {}, READS, { name: 'hiring.plans' });
  const [creating, setCreating] = useState(false);
  const plans = live.data?.plans ?? null;
  const chosen = query.get('plan') ?? plans?.find((p) => p.status === 'active')?.id ?? plans?.[0]?.id ?? '';
  const full = can(me, 'hiring', 'full');
  return (
    <>
      <PageHeader title={t('hiring.plans')} meta={plans !== null ? tn('hiring.meta_plans', plans.length) : undefined}>
        {plans !== null && plans.length > 1 && <Picker value={chosen} onChange={(v) => setQuery({ plan: v })} items={plans.map((p) => ({ value: p.id, label: p.name, sub: [p.entity_name, statusLabel('plan', p.status)].join(' · ') }))} label={t('hiring.plan')} className="w-[220px]" />}
        {full && (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} aria-label={t('hiring.new_plan')}>
            <span className="hidden sm:inline">{t('hiring.new_plan')}</span>
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {plans === null ? (
          live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
        ) : plans.length === 0 ? (
          <div className="hr-panel">
            <Empty icon={LayoutList} title={t('hiring.no_plans')} action={full ? <Button icon={Plus} onClick={() => setCreating(true)}>{t('hiring.new_plan')}</Button> : undefined}>
              {t('hiring.no_plans_text')}
            </Empty>
          </div>
        ) : (
          <PlanView id={chosen} />
        )}
      </PageBody>
      <PlanDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

