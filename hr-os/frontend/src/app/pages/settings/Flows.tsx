/**
 * Approval flows: for each kind of request, a short chain of steps (the
 * manager, then payroll, ...) and an optional rule that approves small ones
 * on its own. A kind without a flow goes to the person's manager.
 */
import { useEffect, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { ArrowRight, ClipboardList, Plus, Trash2, X } from 'lucide-react';
import { Button, Dialog, Empty, Field, IconButton, Input, Loading, MenuItem, Notice, Panel, Picker, Popover, RowCue, Tag, Toggle, confirmAsk } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import { useRef } from 'react';
import { kindLabel } from '../../lib/kinds.ts';
import { departmentOutline, useDepartments } from '../people/data.ts';

interface Step {
  type: string;
  role?: string | undefined;
  member?: string | undefined;
}

interface Flow {
  id: string;
  kind: string;
  entity: string;
  department: string;
  steps: Step[];
  auto: { max_amount_minor?: number | undefined; currency?: string | undefined; max_days?: number | undefined };
  active: boolean;
  note: string;
}

interface Role {
  id: string;
  code: string;
  name: string;
}

function stepLabel(s: Step, roles: Role[]): string {
  if (s.type === 'role') return roles.find((r) => r.code === s.role)?.name ?? s.role ?? '';
  return t(`flow.step.${s.type}`);
}

function StepAdder({ types, roles, onAdd }: { types: string[]; roles: Role[]; onAdd: (s: Step) => void }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={ref} size="sm" icon={Plus} onClick={() => setOpen(true)}>
        {t('flow.add_step')}
      </Button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={240} label={t('flow.add_step')}>
        {types
          .filter((x) => x !== 'role' && x !== 'member')
          .map((x) => (
            <MenuItem key={x} onClick={() => (onAdd({ type: x }), setOpen(false))}>
              {t(`flow.step.${x}`)}
            </MenuItem>
          ))}
        {types.includes('role') &&
          roles
            .filter((r) => r.code !== 'employee')
            .map((r) => (
              <MenuItem key={r.code} hint={t('flow.role')} onClick={() => (onAdd({ type: 'role', role: r.code }), setOpen(false))}>
                {r.name}
              </MenuItem>
            ))}
      </Popover>
    </>
  );
}

function FlowDialog({ open, flow, kinds, types, roles, onClose }: { open: boolean; flow: Flow | null; kinds: string[]; types: string[]; roles: Role[]; onClose: () => void }): React.JSX.Element | null {
  const me = useMe();
  const [kind, setKind] = useState('');
  const [entity, setEntity] = useState('');
  const [department, setDepartment] = useState('');
  const [steps, setSteps] = useState<Step[]>([{ type: 'manager' }]);
  const [maxDays, setMaxDays] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const departments = useDepartments('');
  useEffect(() => {
    if (!open) return;
    setKind(flow?.kind ?? kinds[0] ?? '');
    setEntity(flow?.entity ?? '');
    setDepartment(flow?.department ?? '');
    setSteps(flow?.steps ?? [{ type: 'manager' }]);
    setMaxDays(flow?.auto.max_days !== undefined ? String(flow.auto.max_days) : '');
    setMaxAmount('');
    setCurrency(flow?.auto.currency ?? me.entities[0]?.currency ?? '');
    setActive(flow?.active ?? true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flow?.id]);
  if (!open) return null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const auto: Record<string, unknown> = {};
    if (maxDays !== '') auto['max_days'] = Number(maxDays);
    if (maxAmount !== '') {
      auto['max_amount'] = maxAmount;
      auto['currency'] = currency.toUpperCase();
    }
    try {
      await op('approval-flows.save', { flow: flow?.id, kind, entity, department, steps, auto, active }, { quiet: true });
      changed('approval_flows');
      toast.success(t('ui.saved'));
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={flow === null ? t('flow.add') : kindLabel(flow.kind)}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={kind === '' || steps.length === 0} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('flow.kind')}>
            <Picker value={kind} onChange={setKind} items={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} label={t('flow.kind')} disabled={flow !== null} />
          </Field>
          <Field label={t('org.f.entity_any')} optional>
            <Picker value={entity} onChange={setEntity} items={me.entities.map((e) => ({ value: e.id, label: e.name, sub: e.country }))} label={t('org.f.entity_any')} clearable />
          </Field>
          <Field label={t('people.col.department')} optional>
            <Picker value={department} onChange={setDepartment} items={departmentOutline(departments ?? []).map(({ dept, depth }) => ({ value: dept.id, label: '  '.repeat(depth) + dept.name }))} label={t('people.col.department')} clearable />
          </Field>
        </div>
        <div>
          <div className="hr-label mb-2">{t('flow.steps')}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {steps.map((s, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={13} aria-hidden className="text-[var(--hr-faint)]" />}
                <span className="inline-flex h-8 items-center gap-1 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] pl-2.5 pr-1 text-[13px]">
                  <span className="hr-mono mr-1 text-[10.5px] text-[var(--hr-muted)]">{i + 1}</span>
                  {stepLabel(s, roles)}
                  <IconButton icon={X} label={t('ui.remove')} size={22} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} disabled={steps.length === 1} />
                </span>
              </span>
            ))}
            {steps.length < 6 && <StepAdder types={types} roles={roles} onAdd={(s) => setSteps((x) => [...x, s])} />}
          </div>
        </div>
        <div>
          <div className="hr-label mb-2">{t('flow.auto')}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t('flow.max_days')} optional>
              <Input value={maxDays} onChange={(e) => setMaxDays(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className="hr-mono" aria-label={t('flow.max_days')} />
            </Field>
            <Field label={t('flow.max_amount')} optional hint={flow?.auto.max_amount_minor !== undefined ? t('flow.now', { v: String(flow.auto.max_amount_minor) }) : undefined}>
              <Input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputMode="decimal" className="hr-mono" aria-label={t('flow.max_amount')} />
            </Field>
            <Field label={t('org.f.currency')} optional>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="hr-mono" aria-label={t('org.f.currency')} />
            </Field>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] px-3 py-2">
          <span className="text-[13px]">{t('flow.active')}</span>
          <Toggle checked={active} onChange={setActive} label={t('flow.active')} />
        </div>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}

export function FlowsSection(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ flows: Flow[]; kinds: string[]; step_types: string[] }>('approval-flows.list', {}, ['approval_flows'], { name: 'settings.flows' });
  const roles = useOp<{ roles: Role[] }>('roles.list', {}, ['roles'], { name: 'settings.roles' });
  const depts = useDepartments('');
  const [edit, setEdit] = useState<Flow | null>(null);
  const [adding, setAdding] = useState(false);
  const editable = can(me, 'admin', 'full');
  if (live.data === null) return <Loading />;
  const { flows, kinds, step_types } = live.data;
  const roleList = roles.data?.roles ?? [];
  const remove = async (f: Flow): Promise<void> => {
    const ok = await confirmAsk(t('flow.delete_text', { kind: kindLabel(f.kind) }), t('flow.delete'), t('ui.remove'));
    if (!ok) return;
    try {
      await op('approval-flows.delete', { flow: f.id });
      changed('approval_flows');
    } catch {
      /* toast shown */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel label={t('settings.approvals')} aside={editable ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('flow.add')}</Button> : undefined} flush>
        {flows.length === 0 ? (
          <Empty icon={ClipboardList} title={t('flow.none')} action={editable ? <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>{t('flow.add')}</Button> : undefined}>
            {t('flow.none_text')}
          </Empty>
        ) : (
          <ul className="flex flex-col px-1.5 pb-1.5">
            {flows.map((f) => (
              <li key={f.id} onClick={(e) => editable && e.target === e.currentTarget && setEdit(f)} className={cn('group flex items-center gap-2 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] pr-2 last:border-b-0', editable && 'cursor-pointer hover:bg-[var(--hr-hover)]')}>
                <button type="button" disabled={!editable} onClick={() => setEdit(f)} className="hr-focus hr-tap flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--hr-radius-sm)] px-2 py-2.5 text-left disabled:cursor-default">
                  <span className="w-[180px] min-w-0">
                    <span className="block truncate text-[13px] font-medium">{kindLabel(f.kind)}</span>
                    <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[f.entity !== '' ? (me.entities.find((e) => e.id === f.entity)?.name ?? '') : t('flow.all_entities'), f.department !== '' ? (depts?.find((d) => d.id === f.department)?.name ?? '') : ''].filter((x) => x !== '').join(' · ')}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {f.steps.map((s, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <ArrowRight size={12} aria-hidden className="text-[var(--hr-faint)]" />}
                        <Tag>{stepLabel(s, roleList)}</Tag>
                      </span>
                    ))}
                  </span>
                  {f.auto.max_days !== undefined && <span className="hr-label">{t('flow.auto_days', { n: f.auto.max_days })}</span>}
                  {!f.active && <Tag tone="faint">{t('flow.off')}</Tag>}
                </button>
                {editable && <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" size={28} onClick={() => void remove(f)} onRow className="hover-only opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />}
                {editable && <RowCue edit />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <FlowDialog open={adding} flow={null} kinds={kinds} types={step_types} roles={roleList} onClose={() => setAdding(false)} />
      <FlowDialog open={edit !== null} flow={edit} kinds={kinds} types={step_types} roles={roleList} onClose={() => setEdit(null)} />
    </div>
  );
}
