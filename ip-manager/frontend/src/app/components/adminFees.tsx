/**
 * Settings, Fees and currency: the official fee schedule used to estimate
 * renewal costs, and exchange rates (ECB reference rates plus any rate
 * entered by hand). Managers edit; automatic rate updates are an
 * organization setting (admin).
 */
import { useMemo, useState } from 'react';
import { Calculator, Coins, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, Switch, Textarea, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, d10, fmtDate, fmtMoney, today, toPb } from '../lib/format.ts';
import { CURRENCIES, IP_TYPE_LABEL } from '../lib/labels.ts';
import type { FeeRec, FxRec, IpType, RuleRec } from '../lib/types.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { JurisdictionSelect } from './pickers.tsx';
import { EmptyHint, ErrorBox, Field, JurChip, Loading, Notice, Section, Tag } from './ui.tsx';
import { DateField, ReadOnlyNote, num } from './adminShared.tsx';

const ENTITY_LABEL: Record<string, string> = { any: 'Any', large: 'Large', small: 'Small', micro: 'Micro', '': 'Any' };
const IP_TYPES = Object.keys(IP_TYPE_LABEL) as IpType[];

export function FeesTab(): React.JSX.Element {
  const { can } = useApp();
  return (
    <div className="flex flex-col gap-4">
      {!can.manage && <ReadOnlyNote>Only admins and IP managers can change fees and exchange rates.</ReadOnlyNote>}
      <FeeSchedule />
      <Exchange />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fee schedule                                                        */
/* ------------------------------------------------------------------ */

function tierText(tiers: { from: number; amount: number }[], currency: string): string {
  return [...tiers]
    .sort((a, b) => a.from - b.from)
    .map((t) => `${fmtMoney(t.amount, currency)} per class from class ${t.from}`)
    .join(', ');
}

function FeeSchedule(): React.JSX.Element {
  const { can } = useApp();
  const fees = useCollection<FeeRec>('fee_schedule', { sort: 'office,ip_type,fee_kind,cycle' });
  const rules = useCollection<RuleRec>('rules', { filter: 'fee_kind != ""' });
  const [editing, setEditing] = useState<FeeRec | 'new' | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const kinds = useMemo(() => [...new Set([...rules.records.map((r) => r.fee_kind), ...fees.records.map((f) => f.fee_kind)].filter((k) => k !== ''))].sort(), [rules.records, fees.records]);

  const remove = async (f: FeeRec): Promise<void> => {
    if (!(await confirm(`Delete the ${f.office} ${f.fee_kind} fee (${fmtMoney(f.amount, f.currency)})? Renewal costs that used it become unknown when they are next recomputed.`, 'Delete fee?'))) return;
    try {
      await deleteRecord('fee_schedule', f.id);
      toast.success('Fee deleted');
    } catch {
      /* the client already showed the server's message */
    }
  };

  const columns: Col<FeeRec>[] = [
    { key: 'office', label: 'Office', render: (r) => <JurChip code={r.office} /> },
    { key: 'ip_type', label: 'IP type', value: (r) => IP_TYPE_LABEL[r.ip_type as IpType] ?? r.ip_type },
    { key: 'fee_kind', label: 'Fee kind', render: (r) => <span className="font-mono text-[12px]">{r.fee_kind}</span> },
    {
      key: 'cycle',
      label: 'Cycle',
      align: 'right',
      value: (r) => r.cycle,
      render: (r) =>
        r.cycle === 0 ? <span className="text-[var(--agent-app-muted)]">Any</span> : r.cycle_to > r.cycle ? <span className="whitespace-nowrap">{`${r.cycle} to ${r.cycle_to}`}</span> : r.cycle,
    },
    { key: 'entity', label: 'Entity', value: (r) => ENTITY_LABEL[r.entity] ?? r.entity },
    { key: 'per_class', label: 'Per class', value: (r) => (r.per_class ? 'Yes' : 'No') },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      value: (r) => r.amount,
      render: (r) => (
        <span className="whitespace-nowrap">
          {fmtMoney(r.amount, r.currency)}
          {r.per_claim_amount > 0 && <span className="text-[var(--agent-app-muted)]">{` + ${fmtMoney(r.per_claim_amount, r.currency)} per claim`}</span>}
          {(r.class_tiers ?? []).length > 0 && <span className="block text-xs text-[var(--agent-app-muted)]">{tierText(r.class_tiers ?? [], r.currency)}</span>}
        </span>
      ),
    },
    {
      key: 'grace_surcharge',
      label: 'Grace surcharge',
      align: 'right',
      value: (r) => r.grace_surcharge,
      render: (r) => (r.grace_surcharge > 0 ? <span className="whitespace-nowrap">{r.surcharge_percent ? `+${r.grace_surcharge}%` : `+${fmtMoney(r.grace_surcharge, r.currency)}`}</span> : ''),
    },
    { key: 'effective_from', label: 'From', value: (r) => d10(r.effective_from), render: (r) => <span className="whitespace-nowrap">{fmtDate(r.effective_from)}</span> },
    { key: 'source', label: 'Source', optional: true, render: (r) => <span className="line-clamp-2 min-w-[14rem] text-xs text-[var(--agent-app-muted)]">{r.source}</span> },
    ...(can.manage
      ? [
          {
            key: 'actions',
            label: '',
            sortable: false,
            render: (r: FeeRec) => (
              <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Edit fee" onClick={() => setEditing(r)}>
                  <Pencil size={13} aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Delete fee" onClick={() => void remove(r)}>
                  <Trash2 size={13} aria-hidden />
                </Button>
              </span>
            ),
          } satisfies Col<FeeRec>,
        ]
      : []),
  ];

  return (
    <Section
      title="Official fees"
      meta={fees.loading ? undefined : String(fees.records.length)}
      flush
      actions={
        can.manage ? (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus size={13} aria-hidden /> Add fee
          </Button>
        ) : undefined
      }
    >
      {confirmEl}
      <p className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
        Renewal costs are estimated from these fees: office, IP type and fee kind must match the rule; a fee for a specific cycle and entity size wins over "any". Per-class fees are multiplied by the number of classes, class tiers price the classes beyond the base, and a per-claim amount is added once for each claim on the matter.
      </p>
      {fees.loading ? (
        <Loading />
      ) : fees.error !== null ? (
        <div className="p-4">
          <ErrorBox message={fees.error} onRetry={fees.refresh} />
        </div>
      ) : (
        <DataTable<FeeRec>
          tableId="fees"
          exportName="fee-schedule"
          rows={fees.records}
          columns={columns}
          dense
          onRowClick={can.manage ? (r) => setEditing(r) : undefined}
          empty={
            <EmptyHint
              compact
              icon={Coins}
              title="No fees on file"
              message="Without fees, renewal costs show as unknown. Add the official fees you pay most often."
              action={can.manage ? <Button size="sm" onClick={() => setEditing('new')}>Add fee</Button> : undefined}
            />
          }
        />
      )}
      {editing !== null && <FeeDialog fee={editing === 'new' ? null : editing} kinds={kinds} onClose={() => setEditing(null)} />}
    </Section>
  );
}

interface FeeDraft {
  office: string;
  ip_type: string;
  fee_kind: string;
  cycle: number;
  cycle_to: number;
  entity: FeeRec['entity'];
  per_class: boolean;
  amount: string;
  per_claim_amount: string;
  tiers: { from: string; amount: string }[];
  currency: string;
  grace_surcharge: string;
  surcharge_percent: boolean;
  effective_from: string;
  source: string;
  notes: string;
}

function FeeDialog({ fee, kinds, onClose }: { fee: FeeRec | null; kinds: string[]; onClose: () => void }): React.JSX.Element {
  const { settings, homeCurrency } = useApp();
  const [d, setD] = useState<FeeDraft>(() => ({
    office: fee?.office ?? 'US',
    ip_type: fee?.ip_type ?? 'patent',
    fee_kind: fee?.fee_kind ?? '',
    cycle: fee?.cycle ?? 0,
    cycle_to: fee?.cycle_to ?? 0,
    entity: fee?.entity || 'any',
    per_class: fee?.per_class ?? false,
    amount: fee !== null ? String(fee.amount) : '',
    per_claim_amount: fee !== null && fee.per_claim_amount > 0 ? String(fee.per_claim_amount) : '',
    tiers: (fee?.class_tiers ?? []).map((t) => ({ from: String(t.from), amount: String(t.amount) })),
    currency: fee?.currency ?? homeCurrency,
    grace_surcharge: fee !== null && fee.grace_surcharge > 0 ? String(fee.grace_surcharge) : '',
    surcharge_percent: fee?.surcharge_percent ?? false,
    effective_from: d10(fee?.effective_from),
    source: fee?.source ?? '',
    notes: fee?.notes ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FeeDraft>(k: K, v: FeeDraft[K]): void => setD((x) => ({ ...x, [k]: v }));
  const amountOk = d.amount.trim() !== '' && Number.isFinite(Number(d.amount)) && Number(d.amount) >= 0;
  const rangeOk = d.cycle_to === 0 || d.cycle_to > d.cycle;
  const tiersOk = d.tiers.every((t) => Number(t.from) >= 2 && t.amount.trim() !== '' && Number.isFinite(Number(t.amount)));
  const ok = d.office !== '' && d.fee_kind.trim() !== '' && amountOk && rangeOk && tiersOk && d.currency !== '';

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const data: Record<string, unknown> = {
      office: d.office.toUpperCase(),
      ip_type: d.ip_type,
      fee_kind: d.fee_kind.trim(),
      cycle: Math.max(0, Math.round(d.cycle)),
      cycle_to: d.cycle > 0 ? Math.max(0, Math.round(d.cycle_to)) : 0,
      entity: d.entity,
      per_class: d.per_class,
      amount: Number(d.amount),
      per_claim_amount: num(d.per_claim_amount),
      class_tiers: d.tiers.map((t) => ({ from: Math.round(Number(t.from)), amount: Number(t.amount) })).sort((a, b) => a.from - b.from),
      currency: d.currency.toUpperCase(),
      grace_surcharge: num(d.grace_surcharge),
      surcharge_percent: d.surcharge_percent,
      effective_from: toPb(d.effective_from),
      source: d.source.trim(),
      notes: d.notes.trim(),
    };
    try {
      if (fee === null) await createRecord('fee_schedule', data);
      else await updateRecord('fee_schedule', fee.id, data);
      toast.success(fee === null ? 'Fee added. Open renewals were re-priced.' : 'Fee saved. Open renewals were re-priced.');
      onClose();
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={fee === null ? 'Add an official fee' : 'Edit fee'}
      className="max-h-[92vh] w-[min(94vw,40rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            {fee === null ? 'Add fee' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <JurisdictionSelect label="Office" value={d.office} preferred={settings?.jurisdictions ?? undefined} onChange={(v) => set('office', v)} />
          <Select label="IP type" value={d.ip_type} options={IP_TYPES.map((t) => ({ value: t, label: IP_TYPE_LABEL[t] }))} onChange={(e) => set('ip_type', e.target.value)} />
          <Field label="Fee kind" help="Must match the rule, for example renewal or annuity.">
            <Input aria-label="Fee kind" list="ipm-fee-kind-list" className="font-mono" value={d.fee_kind} onChange={(e) => set('fee_kind', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
            <datalist id="ipm-fee-kind-list">
              {kinds.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Cycle" help="0 applies to every cycle. Otherwise the renewal year or maintenance point, for example 2.">
            <Input aria-label="Cycle" type="number" min={0} value={String(d.cycle)} onChange={(e) => set('cycle', Math.round(num(e.target.value)))} />
          </Field>
          <Field label="Up to cycle" help="Leave 0 for one cycle. For a range such as years 4 to 6, enter 6." error={rangeOk ? undefined : 'Must be after the first cycle.'}>
            <Input aria-label="Up to cycle" type="number" min={0} disabled={d.cycle === 0} value={String(d.cycle_to)} onChange={(e) => set('cycle_to', Math.round(num(e.target.value)))} />
          </Field>
          <Select
            label="Entity size"
            value={d.entity}
            options={['any', 'large', 'small', 'micro'].map((x) => ({ value: x, label: ENTITY_LABEL[x] ?? x }))}
            onChange={(e) => {
              const v = e.target.value;
              set('entity', v === 'large' || v === 'small' || v === 'micro' ? v : 'any');
            }}
          />
          <div className="flex items-end pb-2">
            <Switch checked={d.per_class} onCheckedChange={(v) => set('per_class', v)} label="Per class" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
          <Input label="Amount" type="number" min={0} step="0.01" value={d.amount} error={d.amount !== '' && !amountOk ? 'Enter an amount.' : undefined} onChange={(e) => set('amount', e.target.value)} />
          <Input label="Plus per claim" type="number" min={0} step="0.01" placeholder="0" value={d.per_claim_amount} onChange={(e) => set('per_claim_amount', e.target.value)} />
          <Select label="Currency" value={d.currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={(e) => set('currency', e.target.value)} />
        </div>
        <Field label="Further classes" help="For offices that price classes beyond the base differently. EUIPO: from class 2 at 50, from class 3 at 150. Madrid: from class 4 at 100. Leave empty when the fee is simply per class.">
          <div className="flex flex-col gap-2">
            {d.tiers.map((t, i) => (
              <div key={i} className="flex items-end gap-2">
                <Input
                  label="From class"
                  type="number"
                  min={2}
                  value={t.from}
                  error={t.from !== '' && Number(t.from) < 2 ? 'From class 2 on.' : undefined}
                  onChange={(e) => set('tiers', d.tiers.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                />
                <Input label="Amount per class" type="number" min={0} step="0.01" value={t.amount} onChange={(e) => set('tiers', d.tiers.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" className="mb-0.5 h-8 px-2" aria-label="Remove this tier" onClick={() => set('tiers', d.tiers.filter((_, j) => j !== i))}>
                  <Trash2 size={13} aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button size="sm" variant="outline" onClick={() => set('tiers', [...d.tiers, { from: String(d.tiers.length === 0 ? 2 : Number(d.tiers[d.tiers.length - 1]?.from ?? 1) + 1), amount: '' }])}>
                <Plus size={13} aria-hidden /> Add a class tier
              </Button>
            </div>
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Input label="Grace period surcharge" type="number" min={0} step="0.01" placeholder="0" value={d.grace_surcharge} onChange={(e) => set('grace_surcharge', e.target.value)} />
          <div className="pb-2">
            <Switch checked={d.surcharge_percent} onCheckedChange={(v) => set('surcharge_percent', v)} label="Percent of the fee" />
          </div>
        </div>
        <DateField label="In force from" value={d.effective_from} onChange={(v) => set('effective_from', v)} help="When the office changes its fees, add the new amount with its start date; the newest one applies." />
        <Input label="Source" placeholder="Official fee schedule and date" value={d.source} onChange={(e) => set('source', e.target.value)} />
        <Textarea label="Notes" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Exchange rates                                                      */
/* ------------------------------------------------------------------ */

function Exchange(): React.JSX.Element {
  const { can, settings, homeCurrency } = useApp();
  const rates = useCollection<FxRec>('fx_rates', { sort: 'code' });
  const [editing, setEditing] = useState<FxRec | 'new' | null>(null);
  const [busy, setBusy] = useState<'ecb' | 'costs' | 'auto' | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const refreshEcb = async (): Promise<void> => {
    setBusy('ecb');
    try {
      const r = await op<{ updated: number; as_of: string }>('fx/refresh', {});
      toast.success(`Updated ${r.updated} rates (ECB, ${fmtDate(r.as_of)}). Renewal costs were recomputed.`);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const recompute = async (): Promise<void> => {
    setBusy('costs');
    try {
      const r = await op<{ refreshed: number }>('renewals/refresh-costs', {});
      toast.success(`Recomputed ${r.refreshed} renewal ${r.refreshed === 1 ? 'cost' : 'costs'}`);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const setAuto = async (v: boolean): Promise<void> => {
    if (settings === null) return;
    setBusy('auto');
    try {
      await updateRecord('settings', settings.id, { fx_auto: v });
      toast.success(v ? 'Rates update every working day' : 'Automatic rate updates are off');
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: FxRec): Promise<void> => {
    if (!(await confirm(`Delete the ${r.code} rate? Amounts in ${r.code} cannot be converted until a rate is available again${r.source === 'manual' ? '; the next ECB update adds it back if the ECB publishes it' : ''}.`, 'Delete rate?'))) return;
    try {
      await deleteRecord('fx_rates', r.id);
      toast.success(`${r.code} rate deleted`);
    } catch {
      /* the client already showed the server's message */
    }
  };

  const columns: Col<FxRec>[] = [
    { key: 'code', label: 'Currency', render: (r) => <span className="font-mono font-semibold">{r.code}</span> },
    { key: 'per_eur', label: 'Per 1 EUR', align: 'right', render: (r) => r.per_eur.toLocaleString(undefined, { maximumFractionDigits: 6 }) },
    { key: 'as_of', label: 'As of', value: (r) => d10(r.as_of), render: (r) => fmtDate(r.as_of) },
    { key: 'source', label: 'Source', value: (r) => r.source, render: (r) => <Tag>{r.source === 'ecb' ? 'ECB' : 'Manual'}</Tag> },
    ...(can.manage
      ? [
          {
            key: 'actions',
            label: '',
            sortable: false,
            render: (r: FxRec) =>
              r.code === 'EUR' ? null : (
                <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Set ${r.code} by hand`} onClick={() => setEditing(r)}>
                    <Pencil size={13} aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Delete ${r.code}`} onClick={() => void remove(r)}>
                    <Trash2 size={13} aria-hidden />
                  </Button>
                </span>
              ),
          } satisfies Col<FxRec>,
        ]
      : []),
  ];

  return (
    <Section
      title="Currency"
      meta={`Home currency ${homeCurrency}`}
      flush
      actions={
        can.manage ? (
          <>
            <Button size="sm" variant="ghost" loading={busy === 'costs'} disabled={busy !== null} onClick={() => void recompute()}>
              <Calculator size={13} aria-hidden /> <span className="hidden md:inline">Recompute renewal costs</span>
            </Button>
            <Button size="sm" variant="outline" loading={busy === 'ecb'} disabled={busy !== null} onClick={() => void refreshEcb()}>
              <RefreshCw size={13} aria-hidden /> <span className="hidden sm:inline">Refresh ECB rates now</span>
            </Button>
          </>
        ) : undefined
      }
    >
      {confirmEl}
      <div className="flex flex-col gap-3 border-b border-[var(--agent-app-border)] px-4 py-3">
        <Notice tone="neutral" icon={Coins}>
          Amounts convert through euro reference rates: an amount is divided by its currency's rate and multiplied by the rate of {homeCurrency}. The European Central Bank publishes about 30 currencies every working day. Add any other currency by hand; a rate you set by hand is never overwritten by the ECB.
        </Notice>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Switch
            checked={settings?.fx_auto ?? false}
            disabled={!can.admin || busy !== null}
            onCheckedChange={(v) => void setAuto(v)}
            label="Update ECB rates automatically every working day"
          />
          <span className="text-xs text-[var(--agent-app-muted)]">
            {settings?.fx_updated ? `Last update ${ago(settings.fx_updated)}` : 'Not updated from the ECB yet'}
            {!can.admin ? ' · Only admins change this switch' : ''}
          </span>
        </div>
      </div>
      {rates.loading ? (
        <Loading />
      ) : (
        <DataTable<FxRec>
          tableId="fx-rates"
          exportName="exchange-rates"
          rows={rates.records}
          columns={columns}
          dense
          toolbar={
            can.manage ? (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing('new')}>
                <Plus size={13} aria-hidden /> Add a rate by hand
              </Button>
            ) : undefined
          }
          empty={<EmptyHint compact icon={Coins} title="No rates yet" message="Refresh ECB rates to load them, or add one by hand." />}
        />
      )}
      {editing !== null && <RateDialog rate={editing === 'new' ? null : editing} existing={rates.records} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function RateDialog({ rate, existing, onClose }: { rate: FxRec | null; existing: FxRec[]; onClose: () => void }): React.JSX.Element {
  const [code, setCode] = useState(rate?.code ?? '');
  const [value, setValue] = useState(rate !== null ? String(rate.per_eur) : '');
  const [busy, setBusy] = useState(false);
  const clash = rate === null ? existing.find((r) => r.code === code.toUpperCase()) : undefined;
  const ok = /^[A-Z]{3}$/.test(code.toUpperCase()) && Number(value) > 0 && code.toUpperCase() !== 'EUR';
  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const data = { code: code.toUpperCase(), per_eur: Number(value), as_of: toPb(today()), source: 'manual' };
    try {
      const target = rate ?? clash ?? null;
      if (target === null) await createRecord('fx_rates', data);
      else await updateRecord('fx_rates', target.id, data);
      toast.success(`${data.code} set to ${data.per_eur} per EUR`);
      onClose();
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={rate === null ? 'Add a rate by hand' : `Set ${rate.code} by hand`}
      description="Enter how many units of the currency buy 1 euro. Rates you set by hand are kept when ECB rates update."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            Save rate
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Input label="Currency" className="font-mono uppercase" maxLength={3} disabled={rate !== null} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        <Input label="Units per 1 EUR" type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} />
        {clash !== undefined && <p className="text-xs text-[var(--agent-app-muted)] sm:col-span-2">{clash.code} already has a rate ({clash.per_eur} per EUR); saving replaces it with yours.</p>}
      </div>
    </Dialog>
  );
}
