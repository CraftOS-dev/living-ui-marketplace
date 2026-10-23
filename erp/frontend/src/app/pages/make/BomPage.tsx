/**
 * One bill of materials: what it makes, its components with their cost at
 * average cost, labor and overhead, and the cost of one unit. Components
 * are edited in place; the right side says how many can be built now in
 * each warehouse (and what limits it), recent builds, and its activity.
 */
import { useState } from 'react';
import { AlertTriangle, Factory, Pencil, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { SplitBar } from '../../components/charts.tsx';
import { Menu } from '../../components/controls.tsx';
import { ComponentsEditor, buildStatus, linesOf, linesParam } from '../../components/make/parts.tsx';
import type { LineDraft } from '../../components/make/parts.tsx';
import { MoneyInput, NumberInput } from '../../components/pickers.tsx';
import { DataTable } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, CardHeader, Field, LoadError, Modal, Notice, PageHeader, PageSkeleton, PillButton, StatusPill, TextLink, ToggleRow, softArea, softInput, useConfirm } from '../../components/ui.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money, plain, plural, price, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { back, navigate, useSection } from '../../lib/router.ts';
import type { BomComponent, BomDetail } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

export function BomPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  useSection('bom', 'boms');
  const live = useLive(() => op<BomDetail>('boms.get', { bom: id }, { quiet: true }), ['boms', 'bom_lines', 'builds', ...READS.stock], [id]);
  const b = live.data;
  const [editing, setEditing] = useState<LineDraft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  if (b === null) {
    return live.error !== null ? (
      <div>
        <PageHeader title="Bill of materials" back={() => back('boms')} />
        <LoadError message={live.error} onRetry={live.reload} />
      </div>
    ) : (
      <PageSkeleton />
    );
  }

  const saveLines = async (): Promise<void> => {
    if (editing === null) return;
    const lp = linesParam(editing);
    if ('error' in lp) {
      setLineError(lp.error);
      return;
    }
    setSaving(true);
    try {
      const r = await op<BomDetail>('boms.update', { bom: b.id, lines: lp.lines }, { quiet: true });
      live.set(r);
      setEditing(null);
      toast.success('Components saved');
    } catch (e) {
      setLineError(errMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const setActive = async (on: boolean): Promise<void> => {
    try {
      const r = await op<BomDetail>('boms.update', { bom: b.id, active: on });
      live.set(r);
      toast.success(on ? 'In use again' : 'Not in use: no new builds from it');
    } catch {
      /* shown */
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await op('boms.delete', { bom: b.id, preview: true });
    } catch {
      return;
    }
    if (!(await confirm(`${b.name} and its ${plural(b.lines_count, 'component')} are deleted. No build used it.`, 'Delete this bill of materials?'))) return;
    try {
      await op('boms.delete', { bom: b.id });
      toast.success('Deleted');
      navigate('boms');
    } catch {
      /* shown */
    }
  };

  const perUnitExtra = b.extra_cost_e4;
  const perUnitComp = b.component_unit_cost_e4;
  const unit = b.item?.unit ?? '';
  const columns: Column<BomComponent>[] = [
    {
      key: 'item',
      label: 'Component',
      width: 'minmax(200px, 2fr)',
      render: (c) =>
        c.item !== null ? (
          <button type="button" onClick={() => navigate('item', { id: c.item?.id ?? '' })} className="min-w-0 text-left">
            <span className="block truncate font-bold hover:underline">{c.item.name}</span>
            <span className="num block truncate text-[12px] text-[var(--erp-muted)]">{c.item.sku}</span>
          </button>
        ) : (
          <span className="text-[var(--erp-red-text)]">Missing item</span>
        ),
    },
    {
      key: 'qty',
      label: b.output_qty === 1 ? 'Qty per unit' : 'Qty per batch',
      align: 'right',
      width: '120px',
      render: (c) => (
        <span>
          <span className="font-bold">{qty(c.qty)}</span> <span className="text-[12px] text-[var(--erp-muted)]">{c.item?.unit ?? ''}</span>
        </span>
      ),
    },
    { key: 'stock', label: 'On hand', align: 'right', width: '96px', hide: 'lg', render: (c) => qty(c.on_hand) },
    { key: 'avg', label: 'Cost each', align: 'right', width: '112px', hide: 'md', render: (c) => price(c.avg_cost, b.currency) },
    { key: 'line', label: 'Line cost', align: 'right', width: '112px', render: (c) => <span className="font-semibold">{money(c.line_cost, b.currency)}</span> },
  ];

  return (
    <div>
      <PageHeader
        back={() => back('boms')}
        eyebrow={
          <>
            <span>Bill of materials</span>
            <StatusPill tone={b.active ? 'good' : 'neutral'} size="sm">
              {b.active ? 'In use' : 'Not in use'}
            </StatusPill>
          </>
        }
        title={b.name}
        subtitle={
          b.item !== null ? (
            <>
              Makes {qty(b.output_qty)} {unit} of{' '}
              <TextLink onClick={() => navigate('item', { id: b.item?.id ?? '' })} className="!text-[13px]">
                {b.item.name}
              </TextLink>{' '}
              per batch
            </>
          ) : undefined
        }
        actions={
          <>
            <Menu
              items={[
                { label: 'Edit details', icon: Pencil, hidden: !b.can.edit, onClick: () => setDetails(true) },
                { label: 'Delete', icon: Trash2, danger: true, hidden: !b.can.delete, onClick: () => void remove() },
              ]}
            />
            {b.can.build && (
              <PillButton icon={Factory} dot onClick={() => navigate('builds', { new: '1', bom: b.id })}>
                New build
              </PillButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
          {b.problems.length > 0 && (
            <Notice tone="warn" icon={AlertTriangle}>
              {b.problems.join(' ')}
            </Notice>
          )}
          <Card delay={1} className={editing === null ? '!p-3 @min-[640px]:!p-5' : undefined}>
            <div className={editing === null ? 'flex items-start justify-between gap-3 px-2 pb-3 pt-1 @min-[640px]:px-1' : 'mb-4 flex items-start justify-between gap-3'}>
              <div>
                <h2 className="text-[15px] font-bold">Components</h2>
                <p className="text-[13px] text-[var(--erp-muted)]">{plural(b.lines_count, 'stock item')} at average cost</p>
              </div>
              {b.can.edit && editing === null && (
                <PillButton
                  size="sm"
                  variant="soft"
                  icon={Pencil}
                  onClick={() => {
                    setLineError(null);
                    setEditing(linesOf(b));
                  }}
                >
                  Edit components
                </PillButton>
              )}
            </div>
            {editing === null ? (
              <>
                <DataTable
                  ariaLabel="Components"
                  rows={b.components}
                  columns={columns}
                  rowKey={(c) => c.line}
                  onOpen={(c) => c.item !== null && navigate('item', { id: c.item.id })}
                  mobile={(c) => ({ title: c.item?.name ?? 'Missing item', sub: `${qty(c.qty)} ${c.item?.unit ?? ''} · ${price(c.avg_cost, b.currency)} each`, right: money(c.line_cost, b.currency) })}
                />
                <dl className="mt-3 flex flex-col gap-2 border-t border-[var(--erp-line)] px-3 pt-3 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--erp-muted)]">Components, per unit made</dt>
                    <dd className="num font-semibold">{price(b.component_unit_cost, b.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--erp-muted)]">Labor and overhead, per unit made</dt>
                    <dd className="num font-semibold">{price(b.extra_cost, b.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 text-[15px]">
                    <dt className="font-bold">Cost per unit</dt>
                    <dd className="num font-extrabold">{price(b.unit_cost, b.currency)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <div className="flex flex-col gap-4">
                <ComponentsEditor lines={editing} onChange={setEditing} exclude={b.item?.id} />
                {lineError !== null && (
                  <Notice tone="bad" icon={AlertTriangle}>
                    {lineError}
                  </Notice>
                )}
                <div className="flex justify-end gap-2">
                  <PillButton variant="soft" onClick={() => setEditing(null)}>
                    Cancel
                  </PillButton>
                  <PillButton loading={saving} onClick={() => void saveLines()}>
                    Save components
                  </PillButton>
                </div>
              </div>
            )}
          </Card>

          {b.notes !== '' && (
            <Card tone="sand" delay={2}>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-line text-[14px] leading-6">{b.notes}</p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          <Card tone="dark" delay={1}>
            <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Cost per unit{unit !== '' ? ` (${unit})` : ''}</p>
            <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{price(b.unit_cost, b.currency)}</p>
            <div className="mt-4">
              <SplitBar
                dark
                parts={[
                  { key: 'comp', label: 'Components', value: perUnitComp, valueText: price(b.component_unit_cost, b.currency), fill: 'var(--erp-accent)' },
                  { key: 'extra', label: 'Labor and overhead', value: perUnitExtra, valueText: price(b.extra_cost, b.currency), fill: 'var(--erp-on-dark)' },
                ]}
              />
            </div>
          </Card>

          <Card delay={2}>
            <CardHeader title="Can build now" subtitle="From the stock in each warehouse" icon={WarehouseIcon} />
            <ul className="flex flex-col gap-2">
              {b.can_build.map((w) => (
                <li key={w.warehouse.id} className="flex items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5">
                  <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)] text-[12px] font-bold">{w.warehouse.code.slice(0, 3)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{w.warehouse.name}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">{w.limited_by !== null ? `Limited by ${w.limited_by.name}` : 'No components there'}</span>
                  </span>
                  <span className="num text-right">
                    <span className="block text-[15px] font-bold">{qty(w.qty)}</span>
                    <span className="block text-[12px] text-[var(--erp-muted)]">{unit}</span>
                  </span>
                </li>
              ))}
            </ul>
            {b.can.edit && (
              <div className="mt-4">
                <ToggleRow title="In use" text={b.active ? 'New builds can use it' : 'Kept for history; no new builds'} checked={b.active} onChange={(v) => void setActive(v)} />
              </div>
            )}
          </Card>

          <Card delay={3}>
            <CardHeader title="Builds" subtitle={`${qty(b.builds.done)} done · ${qty(b.builds.draft)} planned${b.builds.void > 0 ? ` · ${qty(b.builds.void)} void` : ''}`} icon={Factory} />
            {b.recent_builds.length === 0 ? (
              <p className="text-[13px] text-[var(--erp-ink-2)]">No builds from it yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {b.recent_builds.map((r) => {
                  const st = buildStatus(r.status);
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => navigate('build', { id: r.id })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2 text-left transition-colors hover:bg-[var(--erp-row-hover)]">
                        <span className="min-w-0 flex-1">
                          <span className="num block truncate text-[13px] font-bold">{r.number}</span>
                          <span className="block truncate text-[12px] text-[var(--erp-muted)]">{dayLabel(r.date)}</span>
                        </span>
                        <span className="num text-[13px] font-bold">
                          {qty(r.qty)} {unit}
                        </span>
                        <StatusPill tone={st.tone} size="sm">
                          {st.label}
                        </StatusPill>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <RecordActivity entity="boms" refId={b.id} />
        </div>
      </div>

      {details && (
        <DetailsForm
          b={b}
          onClose={() => setDetails(false)}
          onSaved={(r) => {
            live.set(r);
            setDetails(false);
          }}
        />
      )}
      {confirmEl}
    </div>
  );
}

function DetailsForm({ b, onClose, onSaved }: { b: BomDetail; onClose: () => void; onSaved: (r: BomDetail) => void }): React.JSX.Element {
  const [name, setName] = useState(b.name);
  const [output, setOutput] = useState(plain(b.output_qty));
  const [extra, setExtra] = useState(b.extra_cost_e4 > 0 ? b.extra_cost : '');
  const [notes, setNotes] = useState(b.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<BomDetail>('boms.update', { bom: b.id, name: name.trim() !== b.name ? name.trim() : undefined, output_qty: output === '' ? '1' : output, extra_cost: extra === '' ? '0' : extra, notes: notes.trim() }, { quiet: true });
      toast.success('Saved');
      onSaved(r);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${b.name}`}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Name" className={softInput} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="One batch makes">
            <NumberInput value={output} onChange={setOutput} ariaLabel="One batch makes" suffix={b.item?.unit} />
          </Field>
          <Field label="Labor and overhead" hint="Per unit made">
            <MoneyInput value={extra} onChange={setExtra} currency={b.currency} decimals={4} ariaLabel="Labor and overhead per unit" />
          </Field>
        </div>
        <Field label="Notes" optional>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} aria-label="Notes" className={softArea} />
        </Field>
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  );
}
