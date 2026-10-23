/**
 * Warehouses: each one as a card with its code, address, how many items and
 * units it holds, what they are worth, and the split of that value by
 * category. Add or change one in a small form; archive or delete it, with
 * the server's reason shown plainly when it refuses (stock still there, or
 * history that must keep its name).
 */
import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeftRight, ClipboardCheck, MapPin, Pencil, Plus, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { SplitBar } from '../../components/charts.tsx';
import { Menu } from '../../components/controls.tsx';
import { useStockChange } from '../../components/stock/StockChangeScreen.tsx';
import { Card, Empty, Field, LoadError, Modal, Notice, PageHeader, PageSkeleton, PillButton, Toggle, softArea, softInput, useConfirm } from '../../components/ui.tsx';
import { errCode, errMessage, op } from '../../lib/api.ts';
import { money, plural, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { OTHER_COLOR, segmentColor } from '../../lib/palette.ts';
import { navigate } from '../../lib/router.ts';
import type { ItemList, LevelList, Warehouse, WarehouseList } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

interface Split {
  key: string;
  label: string;
  value: number;
}

export function WarehousesPage({ query }: PageProps): React.JSX.Element {
  void query;
  const me = useMe();
  const canManage = can(me, 'inventory', 'full');
  const canChange = can(me, 'inventory', 'edit');
  const live = useLive(() => op<WarehouseList>('warehouses.list', {}, { quiet: true }), ['warehouses', 'stock', 'valuation'], []);
  const defaults = useLive(
    () => op<{ defaults?: { warehouse?: string | undefined } | undefined }>('settings.get', {}, { quiet: true }).catch(() => ({ defaults: undefined })),
    ['settings'],
    [],
  );
  // Value by category in each warehouse (what the stock there is made of).
  const mix = useLive(
    async () => {
      const [levels, items] = await Promise.all([op<LevelList>('stock.levels', { limit: 1000 }, { quiet: true }), op<ItemList>('items.list', { kind: 'stock', archived: 'all', limit: 1000 }, { quiet: true })]);
      const cat = new Map(items.items.map((i) => [i.id, i.category?.name ?? 'No category']));
      const by = new Map<string, Map<string, number>>();
      for (const l of levels.levels) {
        const m = by.get(l.warehouse.id) ?? new Map<string, number>();
        const c = cat.get(l.item.id) ?? 'No category';
        m.set(c, (m.get(c) ?? 0) + l.value);
        by.set(l.warehouse.id, m);
      }
      return { by, complete: levels.total <= 1000 };
    },
    READS.stock,
    [],
  );
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  const [refusal, setRefusal] = useState<{ w: Warehouse; message: string; code: string } | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const change = useStockChange();

  const all = live.data?.warehouses ?? [];
  const active = all.filter((w) => !w.archived);
  const archived = all.filter((w) => w.archived);
  const currency = live.data?.currency ?? me.company.currency;
  const defaultId = defaults.data?.defaults?.warehouse ?? '';
  const total = active.reduce((s, w) => s + w.value, 0);

  const splits = useMemo(() => {
    const out = new Map<string, Split[]>();
    if (mix.data === null || !mix.data.complete) return out;
    for (const [wh, m] of mix.data.by) {
      const parts = [...m.entries()].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value);
      const top = parts.slice(0, 4);
      const rest = parts.slice(4).reduce((s, p) => s + p.value, 0);
      out.set(wh, rest > 0 ? [...top, { key: 'other', label: 'Other', value: rest }] : top);
    }
    return out;
  }, [mix.data]);

  const setArchived = async (w: Warehouse, value: boolean): Promise<void> => {
    try {
      await op('warehouses.update', { warehouse: w.id, archived: value });
      toast.success(value ? `${w.name} archived` : `${w.name} restored`);
      live.reload();
    } catch {
      /* shown */
    }
  };
  const remove = async (w: Warehouse): Promise<void> => {
    if (w.items > 0) {
      setRefusal({ w, message: `${w.name} still holds ${plural(w.items, 'item')}. Transfer the stock first.`, code: 'has_stock' });
      return;
    }
    try {
      await op('warehouses.delete', { warehouse: w.id, preview: true }, { quiet: true });
    } catch (e) {
      setRefusal({ w, message: errMessage(e), code: errCode(e) });
      return;
    }
    if (!(await confirm(`${w.name} has no stock and no history, so it is removed for good.`, `Delete ${w.name}?`))) return;
    try {
      await op('warehouses.delete', { warehouse: w.id });
      toast.success(`${w.name} deleted`);
      live.reload();
    } catch {
      /* shown */
    }
  };

  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <PageSkeleton rows={3} />;

  const card = (w: Warehouse, i: number): React.JSX.Element => {
    const parts = splits.get(w.id) ?? [];
    const share = total > 0 ? w.value / total : 0;
    return (
      <Card key={w.id} delay={Math.min(5, i + 1)} className={cn('flex flex-col', w.archived && 'text-[var(--erp-muted)]')}>
        <div className="flex items-start gap-3">
          <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-[16px]', w.archived ? 'bg-[var(--erp-row)]' : 'erp-on-sand bg-[var(--erp-sand)]')}>
            <WarehouseIcon size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num rounded-full bg-[var(--erp-row)] px-2.5 py-0.5 text-[12px] font-bold">{w.code}</span>
              {w.id === defaultId && <span className="rounded-full bg-[var(--erp-accent-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--erp-ink)]">Default</span>}
              {w.archived && <span className="rounded-full bg-[var(--erp-row)] px-2.5 py-0.5 text-[12px] font-semibold">Archived</span>}
            </div>
            <button type="button" onClick={() => navigate('stock', { warehouse: w.id })} className="mt-1 block max-w-full truncate text-left text-[15px] font-bold hover:underline">
              {w.name}
            </button>
            <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-[var(--erp-muted)]">
              <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span className="line-clamp-2">{w.address !== '' ? w.address : 'No address'}</span>
            </p>
          </div>
          <Menu
            variant="row"
            size={36}
            items={[
              { label: 'Edit', icon: Pencil, hidden: !canManage, onClick: () => setEditing(w) },
              { label: 'Transfer stock from here', icon: ArrowLeftRight, hidden: !canChange || w.archived || w.items === 0 || active.length < 2, onClick: () => change.open(null, { mode: 'transfer', warehouse: w.id }) },
              { label: 'Count stock here', icon: ClipboardCheck, hidden: !canChange || w.archived, onClick: () => change.open(null, { mode: 'count', warehouse: w.id }) },
              { label: w.archived ? 'Restore' : 'Archive', icon: w.archived ? ArchiveRestore : Archive, hidden: !canManage, onClick: () => void setArchived(w, !w.archived) },
              { label: 'Delete', icon: Trash2, danger: true, hidden: !canManage, onClick: () => void remove(w) },
            ]}
          />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Stat label="Items" value={qty(w.items)} />
          <Stat label="Units" value={qty(Math.round(w.units))} />
          <Stat label="Value" value={money(w.value, currency, 'short')} />
        </div>
        <div className="mt-5 flex-1">
          {parts.length > 0 ? (
            <>
              <SplitBar parts={parts.map((p, j) => ({ ...p, valueText: money(p.value, currency, 'short'), ...(p.key === 'other' ? OTHER_COLOR : segmentColor(j, false)) }))} height={10} legend={false} />
              <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                {parts.map((p, j) => (
                  <li key={p.key} className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--erp-ink-2)]">
                    <span aria-hidden className="h-2 w-4 rounded-full" style={{ background: (p.key === 'other' ? OTHER_COLOR : segmentColor(j, false)).fill }} />
                    {p.label}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[12px] text-[var(--erp-muted)]">{w.items === 0 ? 'Empty' : ' '}</p>
          )}
        </div>
        {!w.archived && total > 0 && (
          <p className="num mt-4 border-t border-[var(--erp-line)] pt-3 text-[12px] text-[var(--erp-muted)]">{Math.round(share * 100)}% of all stock value</p>
        )}
      </Card>
    );
  };

  return (
    <div>
      <PageHeader
        title="Warehouses"
        subtitle={<span className="num">{plural(active.length, 'warehouse')} · {money(total, currency)} in stock</span>}
        actions={
          canManage ? (
            <PillButton icon={Plus} dot onClick={() => setEditing('new')}>
              New warehouse
            </PillButton>
          ) : undefined
        }
      />
      {active.length === 0 ? (
        <Card>
          <Empty icon={WarehouseIcon} title="No warehouses yet" action={canManage ? <PillButton icon={Plus} dot onClick={() => setEditing('new')}>New warehouse</PillButton> : undefined}>
            A warehouse is any place you keep stock: a store room, a shop, a van.
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2 @min-[1100px]:grid-cols-3">{active.map((w, i) => card(w, i))}</div>
      )}
      {archived.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 px-1 text-[15px] font-bold text-[var(--erp-ink-2)]">Archived</h2>
          <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2 @min-[1100px]:grid-cols-3">{archived.map((w, i) => card(w, i))}</div>
        </>
      )}

      {editing !== null && (
        <WarehouseForm
          w={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            live.reload();
          }}
        />
      )}
      <Modal
        open={refusal !== null}
        onClose={() => setRefusal(null)}
        title={refusal !== null ? `${refusal.w.name} cannot be deleted` : ''}
        footer={
          <>
            <PillButton variant="soft" onClick={() => setRefusal(null)}>
              Close
            </PillButton>
            {refusal !== null && refusal.code === 'has_stock' && canChange && active.length > 1 && (
              <PillButton
                icon={ArrowLeftRight}
                onClick={() => {
                  const w = refusal.w;
                  setRefusal(null);
                  change.open(null, { mode: 'transfer', warehouse: w.id });
                }}
              >
                Transfer stock
              </PillButton>
            )}
            {refusal !== null && refusal.code !== 'has_stock' && !refusal.w.archived && (
              <PillButton
                icon={Archive}
                onClick={() => {
                  const w = refusal.w;
                  setRefusal(null);
                  void setArchived(w, true);
                }}
              >
                Archive instead
              </PillButton>
            )}
          </>
        }
      >
        <Notice tone="warn" icon={Trash2}>
          {refusal?.message}
        </Notice>
        {refusal !== null && refusal.code !== 'has_stock' && <p className="mt-3 text-[13px] leading-5 text-[var(--erp-ink-2)]">Archiving hides it from new documents and stock changes while its history keeps the name.</p>}
      </Modal>
      {confirmEl}
      {change.node}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-[16px] bg-[var(--erp-row)] px-3 py-2">
      <span className="block text-[12px] text-[var(--erp-muted)]">{label}</span>
      <span className="num block truncate text-[15px] font-bold text-[var(--erp-ink)]">{value}</span>
    </div>
  );
}

function WarehouseForm({ w, onClose, onSaved }: { w: Warehouse | null; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const [name, setName] = useState(w?.name ?? '');
  const [code, setCode] = useState(w?.code ?? '');
  const [address, setAddress] = useState(w?.address ?? '');
  const [archived, setArchived] = useState(w?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      setError('Give it a name');
      return;
    }
    setBusy(true);
    try {
      if (w === null) await op('warehouses.add', { name: name.trim(), code: code.trim(), address: address.trim() }, { quiet: true });
      else await op('warehouses.update', { warehouse: w.id, name: name.trim(), code: code.trim(), address: address.trim(), archived }, { quiet: true });
      toast.success(w === null ? `${name.trim()} added` : 'Saved');
      onSaved();
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
      title={w === null ? 'New warehouse' : `Edit ${w.name}`}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            {w === null ? 'Add warehouse' : 'Save'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Name">
            <input
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={80}
              placeholder="e.g. Shop floor"
              aria-label="Name"
              className={softInput}
            />
          </Field>
          <Field label="Code">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} maxLength={20} placeholder="Auto" aria-label="Code" className={cn(softInput, 'num')} />
          </Field>
        </div>
        <Field label="Address" optional>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={600} rows={3} placeholder="Street, city" aria-label="Address" className={softArea} />
        </Field>
        {w !== null && (
          <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
            <span>
              <span className="block text-[14px] font-semibold">Archived</span>
              <span className="block text-[12px] text-[var(--erp-muted)]">Hidden from new documents and stock changes</span>
            </span>
            <Toggle checked={archived} onChange={setArchived} label="Archived" />
          </div>
        )}
        {error !== null && <Notice tone="bad">{error}</Notice>}
      </div>
    </Modal>
  );
}
