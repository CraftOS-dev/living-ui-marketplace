/**
 * Settings, Fees: official renewal and maintenance fees per office, used
 * for renewal cost estimates and forecasts (converted to the home currency
 * with the exchange rates). Managers add and edit rows; each row cites its
 * source.
 */
import { useMemo, useState } from 'react';
import { Coins, Plus } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtMoney, toPb } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { CURRENCIES, OFFICES, jurisdictionName } from '../lib/labels.ts';
import type { FeeRec } from '../lib/records.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { Checkbox, EmptyHint, ErrorBox, JurChip, Loading, Notice, Section, TONE_TEXT } from './ui.tsx';
import { DialogBody, ReadOnlyNote, num } from './orgShared.tsx';
import { DeleteButton } from './deleteRecord.tsx';

const FEE_KINDS = ['renewal', 'annuity', 'second_half', 'sec8', 'sec71', 'sec15'];

export function feeKindLabel(k: string): string {
  return (
    {
      renewal: t('Renewal'),
      annuity: t('Annual fee'),
      second_half: t('Second half of the split registration fee'),
      sec8: t('Declaration of use (Section 8)'),
      sec71: t('Declaration of use (Section 71)'),
      sec15: t('Incontestability (Section 15)'),
    }[k] ?? k
  );
}

function ipTypeLabel(v: string): string {
  return v === 'design' ? t('Design') : v === 'trademark' ? t('Trademark') : v;
}

function cycleText(f: FeeRec): string {
  if (f.cycle <= 0) return '';
  if (f.cycle_to > f.cycle) return t('Years {from} to {to}', { from: f.cycle, to: f.cycle_to });
  return t('Year {n}', { n: f.cycle });
}

export function FeesTab(): React.JSX.Element {
  const { can } = useApp();
  const fees = useCollection<FeeRec>('fee_schedule', { sort: 'office,ip_type,fee_kind,cycle' });
  const [office, setOffice] = useState('');
  const [editing, setEditing] = useState<FeeRec | 'new' | null>(null);

  const rows = useMemo(() => (office === '' ? fees.records : fees.records.filter((f) => f.office === office)), [fees.records, office]);

  const columns: Col<FeeRec>[] = [
    { key: 'office', label: t('Office'), value: (r) => r.office, render: (r) => <JurChip code={r.office} /> },
    { key: 'kind', label: t('Fee'), value: (r) => `${ipTypeLabel(r.ip_type)} ${feeKindLabel(r.fee_kind)}`, render: (r) => (
      <div className="min-w-0">
        <div className="font-medium">{feeKindLabel(r.fee_kind)}</div>
        <div className="text-xs text-[var(--agent-app-muted)]">
          {ipTypeLabel(r.ip_type)}
          {cycleText(r) !== '' ? ` · ${cycleText(r)}` : ''}
        </div>
      </div>
    ) },
    { key: 'amount', label: t('Amount'), align: 'right', value: (r) => r.amount, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtMoney(r.amount, r.currency)}</span> },
    { key: 'per_class', label: t('Per class'), value: (r) => (r.per_class ? t('Yes') : t('No')) },
    {
      key: 'grace',
      label: t('Grace surcharge'),
      align: 'right',
      value: (r) => r.grace_surcharge,
      render: (r) => (r.grace_surcharge > 0 ? <span className="whitespace-nowrap tabular-nums">{r.surcharge_percent ? `${r.grace_surcharge}%` : fmtMoney(r.grace_surcharge, r.currency)}</span> : <span className="text-[var(--agent-app-muted)]">-</span>),
    },
    { key: 'entity', label: t('Applicant size'), optional: true, value: (r) => enumLabel('fee_schedule.entity', r.entity) },
    { key: 'effective_from', label: t('In force from'), value: (r) => d10(r.effective_from), render: (r) => fmtDate(r.effective_from) },
    { key: 'source', label: t('Source|fee'), optional: true, render: (r) => <span className="line-clamp-2 text-xs text-[var(--agent-app-muted)]">{r.source}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      {!can.manage && <ReadOnlyNote>{t('Only administrators and managers can change fees.')}</ReadOnlyNote>}
      <Notice tone="info" icon={Coins}>
        {t('Official fees are used to estimate renewal costs. Amounts are in the office\'s own currency and converted with the exchange rates. Check the source before relying on an amount; offices change fees.')}
      </Notice>
      <Section
        title={t('Fees')}
        meta={fees.loading ? undefined : String(rows.length)}
        flush
        actions={
          can.manage ? (
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden /> {t('Add a fee')}
            </Button>
          ) : undefined
        }
      >
        {fees.loading ? (
          <Loading />
        ) : fees.error !== null ? (
          <div className="p-4">
            <ErrorBox message={fees.error} onRetry={fees.refresh} />
          </div>
        ) : (
          <DataTable<FeeRec>
            tableId="eipm-fees"
            exportName="fees"
            rows={rows}
            columns={columns}
            dense
            onRowClick={can.manage ? (r) => setEditing(r) : undefined}
            toolbar={
              <div className="w-full sm:w-56">
                <Select aria-label={t('Office')} className="h-8" value={office} placeholder={t('Every office')} options={OFFICES.map((o) => ({ value: o, label: `${o} · ${jurisdictionName(o)}` }))} onChange={(e) => setOffice(e.target.value)} />
              </div>
            }
            empty={
              <EmptyHint
                compact
                icon={Coins}
                title={t('No fees for this office')}
                message={t('Add the office\'s official fee so renewal costs can be estimated.')}
                action={can.manage ? <Button size="sm" onClick={() => setEditing('new')}>{t('Add a fee')}</Button> : undefined}
              />
            }
          />
        )}
      </Section>
      {editing !== null && <FeeDialog fee={editing === 'new' ? null : editing} defaultOffice={office} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FeeDialog({ fee, defaultOffice, onClose }: { fee: FeeRec | null; defaultOffice: string; onClose: () => void }): React.JSX.Element {
  const [office, setOffice] = useState(fee?.office ?? (defaultOffice || 'JP'));
  const [ipType, setIpType] = useState(fee?.ip_type ?? 'trademark');
  const [kind, setKind] = useState(fee?.fee_kind ?? 'renewal');
  const [cycle, setCycle] = useState(String(fee?.cycle ?? 0));
  const [cycleTo, setCycleTo] = useState(String(fee?.cycle_to ?? 0));
  const [entity, setEntity] = useState<string>(fee?.entity || 'any');
  const [amount, setAmount] = useState(String(fee?.amount ?? ''));
  const [currency, setCurrency] = useState(fee?.currency ?? 'JPY');
  const [perClass, setPerClass] = useState(fee?.per_class ?? false);
  const [grace, setGrace] = useState(String(fee?.grace_surcharge ?? 0));
  const [gracePct, setGracePct] = useState(fee?.surcharge_percent ?? false);
  const [from, setFrom] = useState(d10(fee?.effective_from) || '');
  const [source, setSource] = useState(fee?.source ?? '');
  const [notes, setNotes] = useState(fee?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const ok = office !== '' && kind.trim() !== '' && amount.trim() !== '' && /^[A-Z]{3}$/.test(currency);

  const kinds = FEE_KINDS.includes(kind) ? FEE_KINDS : [...FEE_KINDS, kind];

  const save = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const body = {
      office,
      ip_type: ipType,
      fee_kind: kind,
      cycle: Math.round(num(cycle)),
      cycle_to: Math.round(num(cycleTo)),
      entity,
      amount: num(amount),
      currency,
      per_class: perClass,
      grace_surcharge: num(grace),
      surcharge_percent: gracePct,
      effective_from: from !== '' ? toPb(from) : '',
      source: source.trim(),
      notes: notes.trim(),
    };
    try {
      if (fee === null) await createRecord('fee_schedule', body);
      else await updateRecord('fee_schedule', fee.id, body);
      toast.success(t('Fee saved'));
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={fee === null ? t('Add a fee') : t('Edit fee')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          {fee !== null && <DeleteButton collection="fee_schedule" id={fee.id} className="mr-auto" onDeleted={onClose} />}
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('Office')} value={office} options={OFFICES.map((o) => ({ value: o, label: `${o} · ${jurisdictionName(o)}` }))} onChange={(e) => setOffice(e.target.value)} />
          <Select
            label={t('Right')}
            value={ipType}
            options={[
              { value: 'trademark', label: t('Trademark') },
              { value: 'design', label: t('Design') },
            ]}
            onChange={(e) => setIpType(e.target.value)}
          />
          <Select label={t('Fee')} value={kind} options={kinds.map((k) => ({ value: k, label: feeKindLabel(k) }))} onChange={(e) => setKind(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label={t('Amount')} type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select label={t('Currency')} value={currency} options={(CURRENCIES.includes(currency) ? CURRENCIES : [...CURRENCIES, currency]).map((c) => ({ value: c, label: c }))} onChange={(e) => setCurrency(e.target.value)} />
          <Select label={t('Applicant size')} value={entity} options={enumOptions('fee_schedule.entity').map(([value, label]) => ({ value, label }))} onChange={(e) => setEntity(e.target.value)} />
        </div>
        <Checkbox checked={perClass} onChange={setPerClass} label={t('Charged per class (or per design)')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('From year (0 for any)')} type="number" min={0} value={cycle} onChange={(e) => setCycle(e.target.value)} />
          <Input label={t('To year (0 for the same)')} type="number" min={0} value={cycleTo} onChange={(e) => setCycleTo(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Grace surcharge')} type="number" min={0} step="any" value={grace} onChange={(e) => setGrace(e.target.value)} />
          <div className="flex items-end pb-2">
            <Checkbox checked={gracePct} onChange={setGracePct} label={t('The surcharge is a percentage')} />
          </div>
        </div>
        <Input label={t('In force from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Textarea label={t('Source|fee')} rows={2} placeholder={t('Where the amount comes from, for example the office fee schedule and its date')} value={source} onChange={(e) => setSource(e.target.value)} />
        <Textarea label={t('Notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </DialogBody>
    </Dialog>
  );
}
